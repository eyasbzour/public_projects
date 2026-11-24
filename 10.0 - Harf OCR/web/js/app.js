/* Harf OCR web app: drafts, page reading, review editor, Word export. */
(function () {
  'use strict';

  // ------------------------------------------------------------------ helpers
  const $ = (id) => document.getElementById(id);
  const el = (tag, props, ...kids) => {
    const n = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const icon = (name) => {
    const s = document.createElementNS(SVG_NS, 'svg'); s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(SVG_NS, 'use'); u.setAttribute('href', 'vendor/icons.svg#' + name); s.append(u); return s;
  };
  const iconBtn = (name, label, fn, cls) => el('button', { type: 'button', class: cls, title: label, 'aria-label': label,
    onclick: (e) => { e.stopPropagation(); fn(); } }, icon(name));
  const uid = () => Math.random().toString(36).slice(2, 10);
  let toastTimer;
  // actions: [[label, onclick]], buttons after the text (it then stays longer, to be reached)
  function toast(msg, isErr, actions = []) {
    const t = $('toast');
    t.replaceChildren(msg, ...actions.map(([label, fn]) => el('button', { type: 'button', class: 'toast-act', onclick: fn }, label)));
    t.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), isErr ? 7000 : actions.length ? 9000 : 3500);
  }
  async function api(path, opts = {}) {
    const res = await fetch(path, opts);
    let data = null;
    try { data = JSON.parse(await res.text(), I18N.revive); } catch (e) { /* non-json */ }  // messages in the language
    if (!res.ok) {
      const err = new Error(I18N.message(data) || tx('app.errorStatus', { status: res.status }));
      err.status = res.status; err.data = data; throw err;
    }
    return data;
  }
  // The app's own confirm / message box, in place of the browser's confirm() and alert().
  // Resolves true for OK. A destructive question focuses "إلغاء", so Enter never deletes by accident.
  // OK, Cancel and Esc answer the open question at once. The dialog's "close" event comes a moment
  // later, and would answer the next question instead if one was asked straight after.
  let askAnswer = null;
  function ask(message, { ok = tx('app.continue'), danger = false, cancel = true } = {}) {
    const dlg = $('dlgAsk');
    if (!dlg.dataset.bound) {
      dlg.dataset.bound = '1';
      const answer = (v) => (e) => {
        if (e) e.preventDefault();
        const done = askAnswer; askAnswer = null;
        if (dlg.open) dlg.close();
        if (done) done(v);
      };
      $('askOk').addEventListener('click', answer(true));
      $('askCancel').addEventListener('click', answer(false));
      dlg.addEventListener('cancel', answer(false));  // Esc
    }
    $('askText').textContent = message;
    $('askOk').textContent = ok;
    $('askOk').className = 'btn ' + (danger ? 'danger-fill' : 'primary');
    $('askCancel').classList.toggle('hidden', !cancel);
    return new Promise((resolve) => {
      askAnswer = resolve;
      dlg.showModal();
      (danger && cancel ? $('askCancel') : $('askOk')).focus();
    });
  }
  window.appAsk = ask;  // the image editor uses it too
  const jsonOpts = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const fmtTime = (s) => new Date(s * 1000).toLocaleString(I18N.lang(), { dateStyle: 'medium', timeStyle: 'short' });
  const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const isoToDMY = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

  // ------------------------------------------------------------------ settings (per browser)
  const store = {
    get(k) { try { return localStorage.getItem('ds.' + k) ?? sessionStorage.getItem('ds.' + k); } catch (e) { return null; } },
    set(k, v, persist) {
      try {
        localStorage.removeItem('ds.' + k); sessionStorage.removeItem('ds.' + k);
        if (v) (persist ? localStorage : sessionStorage).setItem('ds.' + k, v);
      } catch (e) { /* storage blocked */ }
    }
  };
  const settings = {
    get author() { return store.get('author') || ''; },
    get claudeKey() { return store.get('claudeKey') || ''; },
    get googleKey() { return store.get('googleKey') || ''; },
    get remember() { return store.get('remember') === '1'; }
  };

  // ------------------------------------------------------------------ state
  let ENGINES = [], CLAUDE_MODELS = [], TEMPLATES = [], TPL_ADMIN = false, FORMATS = [];
  const useEngines = (eng) => { ENGINES = eng.engines; };
  const useTemplates = (tpl) => { TEMPLATES = tpl.templates; TPL_ADMIN = tpl.adminRequired; };
  // the open draft, the page shown, the editor's page and saving (workspace.js); draft is ws.draft, for short
  const ws = window.Workspace.create({
    save: (d) => api('/api/drafts/' + d.id, jsonOpts('PUT', d)),
    onState: () => setSaveState(),
    onFail: (e) => toast(e.status === 409 ? tx('app.editConflictHelp') : tx('app.couldntSave', { error: e.message }), true),
  });
  let draft = null;
  const busyPages = new Map();  // page id -> its reading's AbortController (stopReading)

  // ------------------------------------------------------------------ boot
  // the Windows program checks GitHub for a newer version at start (server/updater.py); a quiet bar offers it
  // a list shows its first n items and scrolls past them: its height ends under item n, however the items wrap
  function capTo(box, items, n) {
    box.style.maxHeight = '';
    if (items.length <= n) return;
    const pad = parseFloat(getComputedStyle(box).paddingBottom) || 0;
    box.style.maxHeight = (items[n - 1].getBoundingClientRect().bottom - box.getBoundingClientRect().top + pad) + 'px';
  }
  const mb = (n) => Math.round(n / 1048576).toLocaleString('en');  // bytes as whole megabytes, for the download bars
  let appVersion;  // the Windows program's version; null on a server (no updates there), undefined until asked
  async function checkUpdate(tries = 4) {
    let st;
    try { st = await api('/api/update'); } catch (e) { return; }  // offline or an older server: nothing to show
    appVersion = st.current;
    if (!st.checked && tries > 0) { setTimeout(() => checkUpdate(tries - 1), 4000); return; }
    if (st.update && store.get('skipUpdate') !== st.update.version) showUpdate(st.update);
  }
  function showUpdate(u) {
    $('updateText').textContent = tx('app.newVersionProgramAvailable', { version: u.version });
    $('updateBar').classList.remove('hidden');
    // the tag's message, one change per line ("- " or "* " in front is dropped); shown as text, never as HTML
    const lines = (u.notes || '').split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
    $('updateNotes').replaceChildren(...lines.map((l) => el('li', null, l)));
    const notesBtn = $('updateNotesBtn'), openNotes = (open) => {
      $('updateNotes').classList.toggle('hidden', !open); notesBtn.setAttribute('aria-expanded', open);
      if (open) { $('updateNotes').scrollTop = 0; capTo($('updateNotes'), $('updateNotes').children, 4); }
      notesBtn.textContent = open ? tx('app.hideDetails') : tx('app.whatsNew');
    };
    notesBtn.classList.toggle('hidden', !lines.length); openNotes(false);
    notesBtn.onclick = () => openNotes(notesBtn.getAttribute('aria-expanded') !== 'true');
    $('updateLater').onclick = () => { $('updateBar').classList.add('hidden'); openNotes(false); store.set('skipUpdate', u.version); };
    const start = async () => {
      if (!(await ask(tx('app.versionWillDownloadedInstalledProgram', { version: u.version }), { ok: tx('app.update') }))) return;
      if (draft && ws.dirty) await ws.save();
      busy(true); $('updateText').textContent = tx('app.downloadingUpdateProgramWillClose');
      try { await api('/api/update/install', { method: 'POST' }); watch(); } catch (e) { toast(e.message, true); busy(false); }
    };
    const cancel = async () => {  // the download stops; watch() sees it and offers the update again
      $('btnUpdate').disabled = true;
      try { await api('/api/update/cancel', { method: 'POST' }); } catch (e) { toast(e.message, true); $('btnUpdate').disabled = false; }
    };
    // while it downloads, the button cancels it (Later waits: the bar has to stay to show the download)
    const busy = (on) => {
      const btn = $('btnUpdate');
      btn.disabled = false; btn.textContent = on ? tx('ui.cancel') : tx('app.updateNow'); btn.onclick = on ? cancel : start;
      btn.classList.toggle('primary', !on); btn.classList.toggle('ghost', on);
      $('updateLater').disabled = on; $('updateProg').classList.toggle('hidden', !on);
      if (!on) $('updateText').textContent = tx('app.newVersionProgramAvailable', { version: u.version });
    };
    if ($('updateProg').classList.contains('hidden')) busy(false);  // shown again (Settings) while it downloads: left as it is
    // the download's share on the bar (server/updater.py), then the installer takes over and the program closes
    const watch = async () => {
      let st;
      try { st = (await api('/api/update')).install; } catch (e) { return; }  // the program is closing
      const prog = $('updateProg');
      if (!st || st.state === 'error' || st.state === 'idle') {
        if (st && st.error) toast(I18N.message(st.error), true); else if (st && st.state === 'idle') toast(tx('app.updateCancelled'));
        busy(false); return;
      }
      if (st.state === 'installing') {  // the installer runs and the program closes: too late to cancel
        $('updateText').textContent = tx('app.installingUpdate'); prog.removeAttribute('value'); $('btnUpdate').disabled = true; return;
      }
      if (st.total) {
        prog.value = st.done / st.total;
        $('updateText').textContent = tx('app.downloadingUpdateMb', { done: mb(st.done), total: mb(st.total) });
      }
      setTimeout(watch, 500);
    };
  }
  // use on phone (the Windows program, on the PC; server/remote.py): the top bar's button shows while the link is open
  let phoneTimer = null;
  async function checkPhone() {
    try { showPhone(await api('/api/remote')); $('btnPhone').classList.remove('hidden'); }
    catch (e) { /* a server, or the phone itself: no button */ }
  }
  async function refreshPhone() {
    try { showPhone(await api('/api/remote')); } catch (e) { /* the program is closing */ }
  }
  async function phoneAction(path) {
    try { showPhone(await api(path, { method: 'POST' })); } catch (e) { toast(e.message, true); }
  }
  function showPhone(st) {
    const on = st.state === 'on', busy = st.state === 'starting', show = (id, yes) => $(id).classList.toggle('hidden', !yes);
    $('btnPhone').classList.toggle('live', on);
    $('btnPhone').querySelector('span').textContent = on ? tx('app.phoneOn') : tx('app.phone');
    show('phoneOff', !on && !busy); show('phoneBusy', busy); show('phoneOn', on);
    show('phoneError', st.state === 'error'); $('phoneError').textContent = I18N.message(st.error);
    show('phoneStart', !on && !busy); $('phoneStart').textContent = st.state === 'error' ? tx('app.tryAgain') : tx('app.start');
    show('phoneStop', on || busy);
    if (on) { $('phoneQr').innerHTML = st.qr; $('phoneUrl').textContent = st.url; $('phonePw').textContent = st.shown; }
    clearTimeout(phoneTimer);  // quick while it starts; now and then while open, so the button stays true
    if (busy || on) phoneTimer = setTimeout(refreshPhone, busy ? 1000 : 15000);
  }
  function copyText(id) {
    navigator.clipboard.writeText($(id).textContent).then(() => toast(tx('app.copied')), () => toast(tx('app.couldntCopy'), true));
  }

  // Settings > Updates: asked for, so a version put off with "later" is offered again
  async function checkUpdateNow() {
    const btn = $('btnCheckUpdate');
    btn.disabled = true; $('updateInfo').textContent = tx('app.checking');
    try {
      const st = await api('/api/update/check', { method: 'POST' });
      if (st.update) {
        $('updateInfo').textContent = tx('app.versionAvailable', { version: st.update.version });
        showUpdate(st.update);
        $('checkUpdateLabel').textContent = tx('app.updateNow');
        btn.onclick = () => { $('dlgSettings').close(); $('btnUpdate').click(); };
      } else {
        $('updateInfo').textContent = tx('app.versionLatest', { version: st.current });
      }
    } catch (e) { $('updateInfo').textContent = e.message; }
    btn.disabled = false;
  }

  async function boot() {
    if (matchMedia('(max-width: 899px)').matches) $('flagsPanel').open = false;  // small screens: give the text the room
    bindStatic();
    try {
      const [eng, tpl, fmt] = await Promise.all([api('/api/engines'), api('/api/templates'), api('/api/formats')]);
      FORMATS = fmt.formats;  // its labels, the readers' and the built-in template's arrive in the language (api)
      useEngines(eng); useTemplates(tpl);
      CLAUDE_MODELS = eng.claudeModels;
    } catch (e) { toast(tx('app.couldntReachServer', { error: e.message }), true); }
    fillEngineSelect(); fillTemplateSelect(); fillFormats();
    $('newOwner').value = settings.author;
    route();
    setTimeout(() => checkUpdate(), 2500);
    watchParts(true);  // a download still running after a reload, or a restart it is waiting for
    checkPhone();
    window.addEventListener('hashchange', route);
  }

  function route() {
    const m = location.hash.match(/^#\/d\/([a-f0-9]{32})$/);
    if (m) openDraft(m[1]); else showHome();
  }

  // ------------------------------------------------------------------ home
  async function showHome() {
    if (draft && ws.dirty) await ws.save();
    destroyEditor();
    draft = null; ws.load(null);
    closeColFilter(false);
    $('viewDraft').classList.add('hidden'); $('viewHome').classList.remove('hidden');
    document.body.classList.remove('in-draft');
    loadDraftList();
  }

  let draftItems = [];  // the list as the server last sent it
  async function loadDraftList() {
    const box = $('draftList');
    try {
      draftItems = (await api('/api/drafts')).drafts;
      if (!draftItems.length) {
        box.replaceChildren(firstRun()); $('draftCount').textContent = ''; $('draftFilters').classList.add('hidden');
        return;
      }
      renderDraftList();
    } catch (e) {
      box.replaceChildren(el('p', { class: 'muted draft-none' }, tx('app.couldntLoadDrafts', { error: e.message }),
        el('button', { type: 'button', class: 'btn ghost small', onclick: loadDraftList }, tx('app.retry'))));
    }
  }

  // Columns: [key, title, searchable]. A title click sorts (again flips: text أ to ي first, numbers and dates
  // largest/newest first); the funnel beside it, or a double-click on the title, searches that column.
  const DRAFT_COLS = [['name', tx('app.colDocument'), true], ['owner', tx('app.colBy'), true], ['pages', tx('app.colPages'), true], ['updated', tx('app.lastEdited'), false]];
  // kept for this visit only: a filter left on from an earlier day would look like lost drafts
  const draftFilter = { name: '', owner: '', pages: '' };
  const matchesFilter = (d) => (!draftFilter.name || searchable(d.name).includes(searchable(draftFilter.name)))
    && (!draftFilter.owner || searchable(d.owner).includes(searchable(draftFilter.owner)))
    && (draftFilter.pages === '' || d.pages === Number(draftFilter.pages));
  const pagesText = (n) => tx('app.pageCount', { n });
  let sortBeforeClick = null;

  function sortDraftsBy(k, e) {
    if (e.detail > 1) return;  // the second click of a double-click: that opens the search instead
    const [key, dir] = (store.get('draftSort') || 'updated:desc').split(':');
    sortBeforeClick = store.get('draftSort');
    const flip = k === key ? (dir === 'asc' ? 'desc' : 'asc') : (k === 'name' || k === 'owner' ? 'asc' : 'desc');
    store.set('draftSort', k + ':' + flip, true);
    renderDraftList();
  }

  // the list reaches down to the home screen's bottom and scrolls under its header, so the screen itself doesn't
  // scroll: more drafts show on a tall screen, fewer on a phone; never under about three rows
  function fitDrafts() {
    const s = document.querySelector('.draft-scroll'), home = $('viewHome');
    if (!s || !s.offsetParent) return;  // home isn't shown
    const top = s.getBoundingClientRect().top + home.scrollTop;  // where the list starts, home scrolled to its top
    const pad = parseFloat(getComputedStyle(home).paddingBottom) || 0;
    s.style.maxHeight = Math.max(200, home.getBoundingClientRect().bottom - top - pad - 2) + 'px';
  }
  addEventListener('resize', fitDrafts);
  // the bars above it (an update, its notes, readers downloading) push it down when they show
  const refitDrafts = new MutationObserver(fitDrafts);
  for (const id of ['updateBar', 'updateNotes', 'partsBar']) refitDrafts.observe($(id), { attributes: true, attributeFilter: ['class', 'style'] });

  function renderDraftList() {
    const box = $('draftList');
    let table = box.querySelector('table');
    if (!table) {  // the header is built once, so both clicks of a double-click land on the same button
      const head = DRAFT_COLS.map(([k, label, canSearch]) => el('th', { dataset: { k } }, el('div', { class: 'th-in' },
        el('button', { type: 'button', class: 'sort', onclick: (e) => sortDraftsBy(k, e),
          ondblclick: () => { if (!canSearch) return; store.set('draftSort', sortBeforeClick, true); renderDraftList(); openColFilter(k); } }),
        canSearch ? el('button', { type: 'button', class: 'filt btn ghost small icon-only', title: tx('app.searchColumn', { column: label }),
          'aria-label': tx('app.searchColumn', { column: label }), 'aria-expanded': 'false',
          onclick: () => (colFilterFor === k ? closeColFilter(true) : openColFilter(k)) }, icon('magnifying-glass')) : null)));
      table = el('table', null, el('thead', null, el('tr', null, head, el('th', null))), el('tbody'));
      box.replaceChildren(el('div', { class: 'draft-scroll' }, table), el('p', { class: 'muted draft-none hidden', id: 'draftNone' }, tx('app.noDraftMatchesSearch'),
        el('button', { type: 'button', class: 'btn ghost small', onclick: clearDraftFilters }, tx('app.clearSearch'))));
    }

    const [key, dir] = (store.get('draftSort') || 'updated:desc').split(':');
    for (const th of table.tHead.rows[0].cells) {
      const col = DRAFT_COLS.find((c) => c[0] === th.dataset.k);
      if (!col) continue;
      if (col[0] === key) th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending'); else th.removeAttribute('aria-sort');
      const arrow = icon(col[0] === key && dir === 'asc' ? 'caret-up' : 'caret-down');
      if (col[0] !== key) arrow.classList.add('idle');  // faint until hovered: shows the column can be sorted
      th.querySelector('.sort').replaceChildren(col[1], arrow);
      const f = th.querySelector('.filt');
      if (f) f.classList.toggle('on', draftFilter[col[0]] !== '');
    }

    const text = key === 'name' || key === 'owner';
    const cmp = (a, b) => (text ? (a[key] || '').localeCompare(b[key] || '', I18N.lang()) : a[key] - b[key]) * (dir === 'asc' ? 1 : -1);
    const shown = draftItems.filter(matchesFilter).sort(cmp);
    // whole row opens the draft; the name link (keyboard) and the delete button handle their own clicks
    table.tBodies[0].replaceChildren(...shown.map((d) => el('tr', { class: 'open-row',
      onclick: (e) => { if (!e.target.closest('a, button')) location.hash = '#/d/' + d.id; } },
      el('td', null, el('a', { href: '#/d/' + d.id }, d.name || tx('app.untitled')),
        el('span', { class: 'sub' }, d.owner ? tx('app.draftOwnerPages', { owner: d.owner, pages: pagesText(d.pages) }) : pagesText(d.pages))),
      el('td', null, d.owner || ''),
      el('td', { class: 'num' }, String(d.pages)),
      el('td', null, fmtTime(d.updated)),
      el('td', { class: 'act' }, iconBtn('trash', d.name ? tx('app.deleteNamed', { name: d.name }) : tx('app.deleteDraft'), () => deleteDraft(d), 'btn ghost small icon-only danger')))));
    $('draftNone').classList.toggle('hidden', shown.length > 0);
    fitDrafts();

    const active = DRAFT_COLS.filter(([k, , s]) => s && draftFilter[k] !== '');
    $('draftCount').textContent = active.length ? tx('app.shownOfAll', { shown: shown.length, all: draftItems.length }) : String(draftItems.length);
    $('draftFilters').replaceChildren(...active.map(([k, label]) => el('button', { type: 'button', class: 'chip',
      'aria-label': tx('app.clearColumnSearch', { column: label, text: draftFilter[k] }), onclick: () => setDraftFilter(k, '') }, `${label}: ${draftFilter[k]}`, icon('x'))),
    active.length > 1 ? el('button', { type: 'button', class: 'btn ghost small', onclick: clearDraftFilters }, tx('app.clearAll')) : '');
    $('draftFilters').classList.toggle('hidden', !active.length);
  }

  function setDraftFilter(k, v) { draftFilter[k] = v.trim(); renderDraftList(); }
  function clearDraftFilters() { for (const k in draftFilter) draftFilter[k] = ''; closeColFilter(false); renderDraftList(); }

  // phones show the popups as bottom sheets (app.css, --phone-ui): then they are not placed beside what opened them
  const sheets = () => getComputedStyle(document.documentElement).getPropertyValue('--phone-ui').trim() === '1';
  // a sheet slides away before it goes (app.css .sheet-out), unless motion is turned down; done() then hides it.
  // Showing it again meanwhile (slideIn) keeps it.
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function slideOut(node, done) {
    clearTimeout(node.slideTimer);
    if (!sheets() || calm() || !node.isConnected) { node.classList.remove('sheet-out'); done(); return; }
    node.classList.add('sheet-out');
    node.slideTimer = setTimeout(() => { node.classList.remove('sheet-out'); done(); }, 280);
  }
  function slideIn(node) { clearTimeout(node.slideTimer); node.classList.remove('sheet-out'); }
  const shutPop = (d) => { if (d.open) slideOut(d.querySelector(':scope > .pop') || d, () => { d.open = false; }); };

  // phones: the reading bar is a sheet, opened from the toolbar's القراءة
  function setReadSheet(on) {
    const bar = $('readBar'), open = document.body.classList.contains('read-open');
    if (on && !open) { slideIn(bar); document.body.classList.add('read-open'); $('btnReadSheet').setAttribute('aria-expanded', 'true'); }
    else if (!on && open) slideOut(bar, () => { document.body.classList.remove('read-open'); $('btnReadSheet').setAttribute('aria-expanded', 'false'); });
  }

  // phones: a list of three or more choices opens as a sheet; two stay the phone's own control (a toggle, really)
  let selFor = null;
  const sheetSelect = (t) => {
    const s = t && t.closest && t.closest('select');
    return s && sheets() && !s.disabled && !s.multiple && s.options.length > 2 ? s : null;
  };
  function selName(s) {
    if (s.getAttribute('aria-label')) return s.getAttribute('aria-label');
    const by = s.getAttribute('aria-labelledby'); if (by && $(by)) return $(by).textContent.trim();
    const l = s.closest('label'); if (l) return [...l.childNodes].filter((n) => !(n.matches && n.matches('select, input, textarea'))).map((n) => n.textContent).join(' ').trim();
    return s.title || '';
  }
  function openSelSheet(s) {
    selFor = s;
    const list = $('selList'), opts = [];
    const add = (o) => {
      const b = el('button', { type: 'button', class: 'sel-opt', role: 'option', 'aria-selected': String(o.selected), disabled: o.disabled, title: o.title || null,
        onclick: () => pickSel(o.value) }, o.textContent);
      opts.push(b); return b;
    };
    list.replaceChildren(...[...s.children].flatMap((n) => n.tagName === 'OPTGROUP'
      ? [el('div', { class: 'sel-group', role: 'presentation' }, n.label), ...[...n.children].map(add)] : [add(n)]));
    $('selTitle').textContent = selName(s);
    slideIn($('selSheet')); $('selSheet').classList.remove('hidden');
    (opts.find((b) => b.getAttribute('aria-selected') === 'true') || opts[0]).focus({ preventScroll: false });
  }
  function closeSelSheet(refocus) {
    const s = selFor; if (!s) return;
    selFor = null;
    slideOut($('selSheet'), () => $('selSheet').classList.add('hidden'));
    if (refocus) s.focus({ preventScroll: true });
  }
  function pickSel(v) {
    const s = selFor; closeSelSheet(false);
    if (s.value !== v) { s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  // phones: a sheet goes away when pulled down, by its top or, when it is scrolled to its top, by anything in it.
  // Not too short a pull, unless a quick flick; less than that and it springs back.
  const SHEETS = '.pop, .note-pop, .tb-pop, .sel-sheet, #readBar, dialog:not(#dlgImage)';
  function initSheetDrag() {
    let d = null;
    const scroller = (el) => (el.tagName === 'DIALOG' ? el.querySelector('.dlg-body') || el.querySelector('.dlg') : el);
    document.addEventListener('touchstart', (e) => {
      d = null;
      if (!sheets() || e.touches.length !== 1) return;
      const t = e.touches[0], el = e.target.closest && e.target.closest(SHEETS);
      if (!el || (el.tagName !== 'DIALOG' && getComputedStyle(el).position !== 'fixed')) return;
      if (e.target.closest('input, textarea, select, [contenteditable="true"], .tbl-grid, .line-crop')) return;
      const top = t.clientY - el.getBoundingClientRect().top < 56;  // the grabber and the title
      const sc = scroller(el);
      if (!top && sc && sc.scrollTop > 0) return;
      d = { el, y0: t.clientY, t0: e.timeStamp, dy: 0, top, sc };
    }, { passive: true, capture: true });
    document.addEventListener('touchmove', (e) => {
      if (!d) return;
      const dy = e.touches[0].clientY - d.y0;
      if (!d.dy && (dy < 0 || (!d.top && d.sc && d.sc.scrollTop > 0))) { d = null; return; }  // a scroll, not a pull
      if (dy <= 0 && !d.dy) return;
      e.preventDefault();
      d.dy = Math.max(0, dy);
      d.el.classList.add('sheet-pulled');
      d.el.style.transform = `translateY(${d.dy}px)`;
    }, { passive: false, capture: true });
    const end = (e) => {
      if (!d) return;
      const { el, dy, t0 } = d; d = null;
      if (dy < 4) { el.classList.remove('sheet-pulled'); el.style.transform = ''; return; }
      const flick = dy / Math.max(1, e.timeStamp - t0) > 0.5;
      if (dy > Math.min(140, el.offsetHeight * 0.3) || flick) { dismissSheet(el, dy); return; }
      el.classList.remove('sheet-pulled');
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.32, .72, 0, 1)' });
      el.style.transform = '';
    };
    document.addEventListener('touchend', end, true); document.addEventListener('touchcancel', end, true);
  }
  // the pulled sheet alone closes, the way its own close does (Esc closed every sheet open, the one under it too).
  // pulled: it has already slid away under the finger.
  function closeSheet(el, pulled) {
    const d = el.closest('details');
    if (el.tagName === 'DIALOG') { if (el.dispatchEvent(new Event('cancel', { cancelable: true }))) el.close(); }
    else if (el.id === 'readBar') setReadSheet(false);
    else if (el.classList.contains('sel-sheet')) closeSelSheet(true);
    else if (el.id === 'notePop') closeNote();
    else if (el.id === 'linePop') closeLine();
    else if (el.id === 'colFilter') closeColFilter(true);
    else if (el.classList.contains('tb-pop')) el.dispatchEvent(new CustomEvent('sheet-close', { detail: { refocus: !pulled } }));  // editor.js popover
    else if (d) { if (pulled) d.open = false; else shutPop(d); }  // a menu (.pop), or the text toolbar's menus on phones
  }
  // the sheet on top: a list over a menu, a colour panel over the text's menu, a menu over the reading bar. A tap
  // beside it, its dim, Esc and a pull close that one only, so the one it came from stays.
  function topSheet() {
    if (selFor) return $('selSheet');
    const panel = [...document.querySelectorAll('body > .tb-pop')].filter((x) => !x.classList.contains('sheet-out')).pop();
    if (panel) return panel;
    if (noteMark) return $('notePop');
    if (lineAt) return $('linePop');
    if (colFilterFor) return $('colFilter');
    const menu = [...document.querySelectorAll('details.pop-wrap[open]')].filter((d) => !d.querySelector(':scope > .pop.sheet-out')).pop();
    if (menu) return menu.querySelector(':scope > .pop') || menu;
    return document.body.classList.contains('read-open') ? $('readBar') : null;
  }
  // sliding on from where the finger left it
  function dismissSheet(el, dy) {
    el.classList.remove('sheet-pulled');
    const out = el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(100%)' }],
      { duration: 220, easing: 'cubic-bezier(.32, .72, 0, 1)', fill: 'forwards' });
    out.onfinish = () => {
      closeSheet(el, true);
      el.style.transform = ''; el.classList.add('sheet-gone');
      setTimeout(() => { out.cancel(); el.classList.remove('sheet-gone'); }, 320);  // after its own slide-out, if any
    };
  }
  function initSelSheets() {
    let touch = null;
    // the phone's own list opens on the tap: the press is taken here, and the sheet opens when the finger lifts in place
    document.addEventListener('touchstart', (e) => {
      const s = sheetSelect(e.target); if (!s) return;
      e.preventDefault(); touch = { s, x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { capture: true, passive: false });
    document.addEventListener('touchend', (e) => {
      const t = touch; touch = null; if (!t) return;
      const p = e.changedTouches[0];
      if (Math.abs(p.clientX - t.x) < 10 && Math.abs(p.clientY - t.y) < 10) openSelSheet(t.s);
    }, true);
    document.addEventListener('mousedown', (e) => { const s = sheetSelect(e.target); if (s) { e.preventDefault(); openSelSheet(s); } }, true);
    document.addEventListener('keydown', (e) => {
      const s = sheetSelect(e.target);
      if (s && (e.key === ' ' || e.key === 'Enter' || (e.altKey && e.key === 'ArrowDown'))) { e.preventDefault(); openSelSheet(s); }
    }, true);
  }
  // phones: a few bar controls live in a sheet (data-phone-in = the slot's id), and come back on wider screens
  function placeForPhone() {
    const phone = sheets();
    document.querySelectorAll('[data-phone-in]').forEach((el) => {
      if (!el.phoneHome) { el.phoneHome = document.createComment(' ' + el.dataset.phoneIn + ' '); el.before(el.phoneHome); }
      if (phone) { if (el.parentElement.id !== el.dataset.phoneIn) $(el.dataset.phoneIn).append(el); }
      else if (el.phoneHome.nextSibling !== el) el.phoneHome.after(el);
    });
  }
  // phones: every sheet opens with its name, in one style (app.css .sheet-title); a menu without a title of its own
  // takes its button's name (shown on phones only)
  function titleSheet(pop, named) {
    if (!pop || !named) return;
    const name = named.getAttribute('aria-label') || named.title || named.textContent.trim();
    const own = pop.querySelector(':scope > .sheet-title');
    if (!own) { if (name) pop.prepend(el('h3', { class: 'sheet-title auto' }, name)); }
    else if (own.classList.contains('auto')) own.textContent = name;  // the language may have changed
  }
  function asSheet(pop) {
    if (!sheets()) return false;
    pop.style.top = pop.style.left = pop.style.right = '';
    return true;
  }
  let colFilterFor = null;  // which column's search panel is open
  function openColFilter(k) {
    closeColFilter(false);
    const pop = $('colFilter'), th = $('draftList').querySelector(`th[data-k="${k}"]`);
    colFilterFor = k;
    pop.dataset.col = k;
    for (const inp of pop.querySelectorAll('input')) inp.value = draftFilter[inp.dataset.col];
    titleSheet(pop, pop);
    slideIn(pop); pop.classList.remove('hidden');
    // under the header, its right edge on the header's (the page is right to left), kept inside the list
    if (!asSheet(pop)) {
      const area = pop.offsetParent.getBoundingClientRect(), r = th.getBoundingClientRect();
      pop.style.top = (r.bottom - area.top + 4) + 'px';
      pop.style.right = Math.max(0, Math.min(area.right - r.right, area.width - pop.offsetWidth)) + 'px';
    }
    th.querySelector('.filt').setAttribute('aria-expanded', 'true');
    pop.querySelector(`input[data-col="${k}"]`).focus();
  }
  function closeColFilter(refocus) {
    if (!colFilterFor) return;
    const b = $('draftList').querySelector(`th[data-k="${colFilterFor}"] .filt`);
    colFilterFor = null;
    slideOut($('colFilter'), () => $('colFilter').classList.add('hidden'));
    if (b) { b.setAttribute('aria-expanded', 'false'); if (refocus) b.focus(); }
  }

  // Arabic spellings vary (أحمد / احمد, رسالة / رساله, harakat), so both sides are compared in one plain form
  const searchable = (s) => (s || '').toLowerCase().replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

  const firstRun = () => el('div', { class: 'first-run' }, el('h3', null, tx('app.noDraftsYet')),
    el('ol', null, [
      ['images', tx('app.addPhotosPages'), tx('app.phoneWhatsappRightOrder')],
      ['scan', tx('app.readText'), tx('app.freeReaderServerAiUsing')],
      ['flag', tx('app.reviewExportFile'), tx('app.unclearSpotsHighlightedNoteFile')]
    ].map(([ic, t, s]) => el('li', null, icon(ic), el('div', null, el('b', null, t), el('span', { class: 'muted' }, s))))));

  async function deleteDraft(d) {
    if (!(await ask(tx('app.deleteDraftPhotosGood', { name: d.name }), { ok: tx('app.delete'), danger: true }))) return;
    await api('/api/drafts/' + d.id, { method: 'DELETE' });
    loadDraftList();
  }

  async function createDraft(ev) {
    ev.preventDefault();
    const owner = $('newOwner').value.trim();
    const d = await api('/api/drafts', jsonOpts('POST', {
      name: $('newName').value.trim(), owner, date: todayISO(), template: TEMPLATES[0] && TEMPLATES[0].id
    }));
    $('newName').value = '';
    location.hash = '#/d/' + d.id;
  }

  // ------------------------------------------------------------------ draft open/save
  async function openDraft(id) {
    // straight from another draft (back / forward, a link): save it and close its editor first, as going home does
    if (draft && ws.dirty) await ws.save();
    closeColFilter(false);  // the list's search, left open: its dim would cover the draft
    destroyEditor();
    try { draft = await api('/api/drafts/' + id); }
    catch (e) { toast(tx('app.couldntOpenDraft', { error: e.message }), true); location.hash = ''; return; }
    ws.load(draft);
    $('viewHome').classList.add('hidden'); $('viewDraft').classList.remove('hidden');
    document.body.classList.add('in-draft');
    $('draftName').value = draft.name || '';
    $('draftDate').value = draft.date || todayISO();
    if (!draft.template && TEMPLATES[0]) draft.template = TEMPLATES[0].id;
    $('templateSel').value = draft.template || '';
    renderPages(); showPage(0);
    setPane(draft.pages.length ? 'text' : 'pages');
  }

  // narrow screens show one pane at a time
  function setPane(name) {
    closeNote();
    $('workspace').dataset.pane = name;
    document.querySelectorAll('.pane-tabs [role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.pane === name)));
    if (name === 'photo') applyPhotoTransform();
  }

  function setSaveState() {
    const s = $('saveState'), e = ws.error;  // why the last save failed; cleared by the next one that works
    const why = e && (e.status === 409 ? tx('app.editConflict') : tx('app.couldntSave', { error: e.message }));
    const [state, icon, text] = ws.saving ? ['busy', 'circle-dashed', tx('app.saving')] : why ? ['failed', 'warning-circle', tx('app.notSaved')]
      : ws.dirty ? ['busy', 'circle-dashed', tx('app.notSavedYet')] : ['saved', 'check-circle', tx('app.saved')];
    s.dataset.state = state;
    s.querySelector('use').setAttribute('href', 'vendor/icons.svg#' + icon);
    s.querySelector('span').textContent = text;
    s.title = why ? tx('app.pressSaveTryAgain', { error: why }) : '';
  }

  window.addEventListener('beforeunload', (e) => { if (ws.dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ------------------------------------------------------------------ pages
  function renderPages() {
    updateStage();
    const list = $('pageList');
    const at = ws.index;
    list.replaceChildren(...draft.pages.map((p, i) => {
      const flags = countFlags(p.blocks);
      const [stCls, stIcon, stText] = busyPages.has(p.id) ? ['busy', 'circle-notch', tx('app.stateReading')]
        : p.blocks ? ['read', 'check-circle', tx('app.stateRead')] : ['', 'circle', tx('app.stateNotRead')];
      return el('li', { class: 'page-item' + (i === at ? ' active' : ''), draggable: 'true', title: p.file || '', tabindex: '0',
          'aria-current': i === at ? 'true' : null, 'aria-label': flags ? tx('app.pageFlaggedSpots', { page: i + 1, state: stText, n: flags })
            : tx('app.pageState', { page: i + 1, state: stText }),
          onclick: () => showPage(i), ondblclick: () => editImage(i),
          onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); showPage(i); } },
          ondragstart: (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-page', String(i)); },
          ondragover: (e) => { if (dragFrom != null) { e.preventDefault(); e.currentTarget.classList.add('drop-target'); } },
          ondragleave: (e) => e.currentTarget.classList.remove('drop-target'),
          ondrop: (e) => { if (dragFrom == null) return; e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('drop-target'); movePageTo(dragFrom, i); dragFrom = null; },
          ondragend: () => { dragFrom = null; } },
        el('div', { class: 'thumb' }, el('img', { src: imgUrl(p), alt: tx('app.pageNumber', { page: i + 1 }), loading: 'lazy', draggable: 'false',
          class: (p.rotation || 0) % 180 ? 'sideways' : '', style: `transform: rotate(${p.rotation || 0}deg)` })),
        el('div', { class: 'page-meta' },
          el('span', { class: 'num' }, String(i + 1)),
          el('span', { class: 'state ' + stCls }, icon(stIcon), stText),
          flags ? el('span', { class: 'pill', title: tx('app.flaggedSpots') }, String(flags)) : null),
        el('div', { class: 'page-actions' },
          iconBtn('pencil-simple', tx('app.editPhoto'), () => editImage(i)),
          iconBtn('arrow-clockwise', tx('app.rotate'), () => rotatePage(i, 90)),
          iconBtn('caret-up', tx('app.moveUp'), () => movePage(i, -1)),
          iconBtn('caret-down', tx('app.moveDown'), () => movePage(i, 1)),
          iconBtn('trash', tx('app.deletePage'), () => removePage(i), 'danger')));
    }));
    $('dropHint').classList.toggle('hidden', draft.pages.length > 0);
    $('pageCount').textContent = draft.pages.length ? String(draft.pages.length) : '';
  }
  const imgUrl = (p) => `/api/drafts/${draft.id}/images/${p.image}`;

  // ---- page order
  // name:    file name, numbers in order (1, 2, 10) and "photo" before "photo (1)"   [default]
  // alpha:   plain alphabetical
  // date:    file date (when the photo was taken/saved), oldest first
  // picked:  the order the files were picked in
  const stem = (n) => (n || '').replace(/\.[^.]+$/, '').replace(/[\s._()\-]+/g, ' ').trim();
  const alpha = new Intl.Collator(undefined, { sensitivity: 'base' });
  const ORDERERS = {
    name: (a, b) => natural.compare(stem(a.file), stem(b.file)),
    alpha: (a, b) => alpha.compare(a.file || '', b.file || ''),
    date: (a, b) => (a.fileTime || 0) - (b.fileTime || 0) || natural.compare(stem(a.file), stem(b.file)),
    picked: () => 0
  };
  const orderMode = () => $('orderSel').value || 'name';

  async function addFiles(files) {
    const items = [...files].filter((f) => f.type.startsWith('image/'))
      .map((f, k) => ({ f, file: f.name, fileTime: f.lastModified, k }));
    if (!items.length) return 0;
    const cmp = ORDERERS[orderMode()];
    items.sort((a, b) => cmp(a, b) || a.k - b.k);
    ws.flush();
    let added = 0, cut = 0;
    for (const it of items) {
      const fd = new FormData(); fd.append('file', it.f);
      fd.append('fit', '1');  // a sheet photographed on a desk: cut out and flattened, the photo as taken kept (sheet.py)
      try {
        const r = await api(`/api/drafts/${draft.id}/images`, { method: 'POST', body: fd });
        const page = { id: uid(), image: r.name, file: it.file, fileTime: it.fileTime, rotation: 0, blocks: null, versions: [] };
        if (r.original) { Object.assign(page, { original: r.original, edited: true }); cut++; }  // Restore original undoes it
        ws.addPages([page]);
        added++; renderPages();
      } catch (e) { toast(tx('app.couldntUpload', { file: it.file, error: e.message }), true); }
    }
    if (added && draft.pages.length === added) showPage(0);
    if (cut) toast(tx('app.sheetsCutFlattened'));
    return added;
  }

  // what was dropped: files, and the photos in dropped folders and their subfolders (read while the drop lasts:
  // its items are gone after the handler returns)
  function droppedFiles(dt) {
    const entries = [...(dt.items || [])].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
    if (!entries.some((en) => en.isDirectory)) return Promise.resolve([...dt.files]);
    const walk = (en) => (en.isFile ? new Promise((res) => en.file(res, () => res(null))) : new Promise((res) => {
      const reader = en.createReader(), all = [];
      const next = () => reader.readEntries((batch) => {  // a folder comes in batches of up to 100
        if (batch.length) { all.push(...batch); next(); } else Promise.all(all.map(walk)).then((fs) => res(fs.flat()));
      }, () => res([]));
      next();
    }));
    return Promise.all(entries.map(walk)).then((fs) => fs.flat().filter(Boolean));
  }

  async function resortPages() {
    if (orderMode() === 'picked') { toast(tx('app.chooseSortOrder')); return; }
    if (!(await ask(tx('app.reorderAllPagesWay'), { ok: tx('app.reorder') }))) return;
    ws.sortPages(ORDERERS[orderMode()]);
    renderPages(); showPage(Math.max(0, ws.index));
  }

  function rotatePage(i, delta) {
    const p = draft.pages[i]; if (!p) return;
    p.rotation = ((p.rotation || 0) + delta + 360) % 360;
    renderPages(); ws.changed();
    if (i === ws.index) applyPhotoTransform();
    if (p.blocks) toast(tx('app.photoRotatedReadPageAgain'));
  }

  function editImage(i) {
    const p = draft.pages[i]; if (!p) return;
    window.ImageEditor.open({
      src: imgUrl(p), rotation: p.rotation || 0, hasOriginal: !!p.original,
      onSave: async (blob) => {
        const fd = new FormData(); fd.append('file', blob, (p.file || 'page') + '-edited.jpg');
        const r = await api(`/api/drafts/${draft.id}/images`, { method: 'POST', body: fd });
        if (!p.original) p.original = p.image;
        p.image = r.name; p.rotation = 0; p.edited = true;
        afterImageChange(i);
      },
      onRestore: async () => {
        p.image = p.original; delete p.original; p.rotation = 0; p.edited = false;
        afterImageChange(i);
      }
    });
  }
  function afterImageChange(i) {
    renderPages(); if (i === ws.index) showPage(i); ws.changed();
    toast(draft.pages[i].blocks ? tx('app.photoSavedReadPageAgain') : tx('app.photoSaved'));
  }

  // drag a page thumbnail onto another to move it there
  let dragFrom = null;
  function movePageTo(from, to) {
    if (from == null || to == null || !ws.movePage(from, to)) return;
    renderPages();
  }

  function movePage(i, dir) {
    if (ws.movePage(i, i + dir)) renderPages();
  }

  async function removePage(i) {
    if (!(await ask(tx('app.deletePageDraft', { page: i + 1 }), { ok: tx('app.delete'), danger: true }))) return;
    ws.removePage(i);
    renderPages(); showPage(Math.max(0, ws.index));
  }

  function showPage(k) {
    const p = ws.show(k), i = ws.index;
    document.querySelectorAll('.page-item').forEach((n, k) => {
      n.classList.toggle('active', k === i);
      if (k === i) n.setAttribute('aria-current', 'true'); else n.removeAttribute('aria-current');
    });
    if (!p) {
      $('photoImg').removeAttribute('src'); $('photoLabel').textContent = '';
      destroyEditor();
      $('editor').replaceChildren(el('div', { class: 'empty-hint' }, tx('app.addPhotosPagesReadThem')));
      renderFlags(); fillVersions(); updateReadState(); if (toolbar) toolbar.update(); return;  // also clears the last draft's status
    }
    $('photoImg').src = imgUrl(p);
    // the file name in its own direction box, and what follows its last Arabic word ("1.jpg") left to right,
    // so "تقرير 1.jpg" does not show as "jpg.1 تقرير"
    const name = p.file && p.file.replace(/[^\u0600-\u06FF\s][^\u0600-\u06FF]*$/, (tail) => '\u2066' + tail + '\u2069');
    $('photoLabel').replaceChildren(tx('app.pageOfTotal', { page: i + 1, total: draft.pages.length }), ...(name ? [' · ', el('bdi', {}, name)] : []));
    applyPhotoTransform();
    renderEditor(); fillVersions(); updateReadState();
  }

  function applyPhotoTransform() {
    const p = ws.page; if (!p) return;
    const img = $('photoImg'), z = $('zoom').value / 100, rot = p.rotation || 0;
    const frame = $('photoFrame');
    $('zoomVal').textContent = $('zoom').value + '%';
    const fit = () => {
      const side = rot % 180 ? img.naturalHeight : img.naturalWidth;
      const pad = parseFloat(getComputedStyle(frame).paddingLeft) * 2 || 0;
      const base = (frame.clientWidth - pad) / (side || 1);
      img.style.width = (img.naturalWidth * base * z) + 'px';
      img.style.transform = `rotate(${rot}deg)`;
      const h = img.naturalHeight * base * z, w = img.naturalWidth * base * z;
      img.style.margin = rot % 180 ? `${(w - h) / 2}px auto` : '0 auto';
    };
    const fitted = () => { fit(); frame.classList.toggle('can-pan', frame.scrollWidth > frame.clientWidth + 1 || frame.scrollHeight > frame.clientHeight + 1); placeSel(); };
    if (img.complete && img.naturalWidth) fitted(); else img.onload = fitted;
  }

  function rotate(delta) { rotatePage(ws.index, delta); }

  // ------------------------------------------------------------------ engines & reading
  function fillEngineSelect() {
    const sel = $('engineSel');
    const groups = { free: el('optgroup', { label: tx('app.freeServer') }), ai: el('optgroup', { label: tx('app.aiNeedsKey') }) };
    for (const e of ENGINES) {
      groups[e.group].append(el('option', { value: e.id, disabled: !e.available && !e.installable, title: e.reason || '' },
        e.available ? e.label : e.installable ? tx('app.readerNeedsDownload', { name: e.label }) : tx('app.readerNotAvailable', { name: e.label })));
    }
    sel.replaceChildren(groups.free, groups.ai);
    const saved = store.get('engine');
    const first = ENGINES.find((e) => e.available);
    sel.value = (saved && ENGINES.find((e) => e.id === saved && e.available)) ? saved : (first ? first.id : '');
    $('modelSel').replaceChildren(...CLAUDE_MODELS.map((m) => el('option', { value: m }, m)));
    $('modelSel').value = store.get('model') || CLAUDE_MODELS[0] || '';
    engineChanged();
  }
  function engineChanged() {
    const id = $('engineSel').value;
    const e = ENGINES.find((x) => x.id === id) || {};
    $('cleanupWrap').classList.toggle('hidden', !e.cleanup);  // only Tesseract takes them: the server says which
    $('langsWrap').classList.toggle('hidden', !e.cleanup);
    $('modelWrap').classList.toggle('hidden', id !== 'claude');
    $('skipWrap').classList.toggle('hidden', id !== 'claude');
    // every reader has the page direction now; Tesseract also its clean-up and language
  }
  const engineLabel = (id) => (ENGINES.find((e) => e.id === id) || {}).label || id;

  // the Windows program: Nuqta and EasyOCR come as one download (server/parts.py); picking either offers it
  let partsWanted = null;  // the reader to switch to once they are in
  async function offerParts(engineId) {
    if (!(await ask(tx('app.nuqtaEasyocrReadersDownloadTogether'), { ok: tx('app.download') }))) return;
    partsWanted = engineId;
    startParts();
  }
  async function startParts() {
    try { await api('/api/parts/install', { method: 'POST' }); } catch (e) { toast(e.message, true); return; }
    watchParts();
  }
  // every second while it runs; atStart: a download begun before the page was reloaded, nothing to announce otherwise
  let partsBusy = false;  // downloading or unpacking: Settings says so instead of offering it again
  async function watchParts(atStart = false) {
    let st;
    try { st = await api('/api/parts'); } catch (e) { return; }
    const bar = $('partsBar'), prog = $('partsProg');
    const show = (id, on) => $(id).classList.toggle('hidden', !on);
    partsBusy = st.state === 'downloading' || st.state === 'unpacking';
    if (st.state === 'idle' || (atStart && st.state === 'done')) { bar.classList.add('hidden'); showPartsBox(); return; }
    bar.classList.remove('hidden');
    show('partsProg', partsBusy); show('partsStop', st.state === 'downloading');
    show('partsRetry', st.state === 'error'); show('partsClose', st.state === 'error');
    show('partsRestart', st.state === 'restart');
    if (st.state === 'error') { $('partsText').textContent = I18N.message(st.error); showPartsBox(); return; }
    if (st.state === 'restart') {
      $('partsText').textContent = tx('app.downloadCompleteRestartProgramNuqta');
      try { useEngines(await api('/api/engines')); fillEngineSelect(); } catch (e) { /* the list stays */ }
      showPartsBox();
      return;
    }
    if (st.state === 'done') {
      bar.classList.add('hidden');
      try { useEngines(await api('/api/engines')); } catch (e) { return; }
      fillEngineSelect();
      if (partsWanted && ENGINES.some((e) => e.id === partsWanted && e.available)) {
        $('engineSel').value = partsWanted; store.set('engine', partsWanted, true); engineChanged();
      }
      toast(tx('app.nuqtaEasyocrReadersReady'));
      showPartsBox();
      return;
    }
    if (st.state === 'unpacking') { $('partsText').textContent = tx('app.unpackingExtraReaders'); prog.removeAttribute('value'); }
    else if (st.total) { $('partsText').textContent = tx('app.downloadingExtraReadersMb', { done: mb(st.done), total: mb(st.total) }); prog.value = st.done / st.total; }
    else { $('partsText').textContent = tx('app.downloadingExtraReaders'); prog.removeAttribute('value'); }
    showPartsBox();
    setTimeout(watchParts, 1000);
  }
  function showPartsBox() {
    $('partsBox').classList.toggle('hidden', !ENGINES.some((e) => e.installable));
    $('partsInfo').textContent = partsBusy ? $('partsText').textContent
      : tx('app.nuqtaMostAccurateArabicSlower');
    $('btnParts').disabled = partsBusy;
  }

  function keyFor(engineId) {
    const e = ENGINES.find((x) => x.id === engineId);
    if (!e || !e.key) return '';
    return e.key === 'claude' ? settings.claudeKey : settings.googleKey;
  }

  async function readPage(i, opts = {}) {
    const p = draft.pages[i]; if (!p || busyPages.has(p.id)) return false;
    const engine = opts.engine || $('engineSel').value;
    const e = ENGINES.find((x) => x.id === engine);
    if (!e || !e.available) { toast(tx('app.readerIsntAvailableServer'), true); return false; }
    const key = keyFor(engine);
    if (e.key && !key && !e.serverKey) {
      toast(e.key === 'claude' ? tx('app.enterClaudeKeySettings') : tx('app.enterGoogleVisionKeySettings'), true);
      $('dlgSettings').showModal(); return false;
    }
    if (p === ws.page) ws.flush();
    if (p.blocks && hasEdits(p) && !opts.silent &&
        !(await ask(tx('app.pageAlreadyHasTextNew'), { ok: tx('app.readAgain') }))) return false;
    const fd = new FormData();
    fd.append('draft_id', draft.id); fd.append('image', p.image); fd.append('engine', engine);
    fd.append('rotation', String(p.rotation || 0)); fd.append('cleanup', $('cleanupSel').value);
    fd.append('model', $('modelSel').value); fd.append('skip_letterhead', $('skipLetterhead').checked ? 'true' : 'false');
    fd.append('langs', $('langsSel').value); fd.append('direction', $('dirSel').value);
    if (key) fd.append('api_key', key);
    const stop = new AbortController();
    busyPages.set(p.id, stop); renderPages(); updateReadState();
    try {
      const r = await api('/api/ocr', { method: 'POST', body: fd, signal: stop.signal });
      // the page was deleted, or another draft opened, while it was read: the reading has nowhere to go
      if (!draft || !draft.pages.includes(p)) { busyPages.delete(p.id); updateReadState(); return false; }
      if (p.blocks) pushVersion(p, p.readWith ? { engine: p.readWith, edited: true } : { kind: 'earlier' }, p.blocks);
      pushVersion(p, { engine }, r.blocks);
      p.blocks = clone(r.blocks); p.readWith = engine; p.readImage = p.image; p.readRot = p.rotation || 0; p.docLang = r.lang;
      busyPages.delete(p.id);
      if (p === ws.page) { renderEditor(); fillVersions(); }
      ws.changed(); renderPages(); updateReadState(tx('app.readInSeconds', { seconds: r.seconds }));
      return true;
    } catch (err) {
      busyPages.delete(p.id); renderPages(); updateReadState();
      if (err.name !== 'AbortError') toast(tx('app.pageError', { page: i + 1, error: err.message }), true);  // else stopped
      return false;
    }
  }

  // reading all the unread pages, one after another; stopReading ends the run (a new run number)
  let readRun = 0, readingAll = false;
  async function readAllUnread() {
    const todo = draft.pages.map((p, i) => i).filter((i) => !draft.pages[i].blocks);
    if (!todo.length) { toast(tx('app.allPagesRead')); return true; }
    const run = ++readRun;
    let ok = true;
    readingAll = true;
    try {
      for (const i of todo) {
        if (run !== readRun) return false;
        updateReadState(tx('app.readingPage', { page: i + 1 }));
        ok = (await readPage(i, { silent: true })) && ok;
      }
      return ok;
    } finally {
      if (run === readRun) readingAll = false;
      updateReadState();
    }
  }
  // the page keeps what it had; the server finishes the reading it started and its result is dropped
  function stopReading() {
    readRun++; readingAll = false;
    for (const stop of busyPages.values()) stop.abort();
    updateReadState(); toast(tx('app.readingStopped'));
  }

  // add photos -> read -> produce: only the next step is the green button; tools that need a page wait for one
  function updateStage() {
    if (!draft) return;
    const pages = draft.pages.length, p = ws.page;
    const allRead = pages && draft.pages.every((x) => x.blocks);
    document.querySelector('#panePages .file-btn').classList.toggle('primary', !pages);
    $('btnRead').classList.toggle('primary', !!p && !p.blocks);
    $('btnExport').classList.toggle('primary', !!allRead);
    for (const id of ['btnExport', 'btnQuick', 'btnReadAll', 'btnEditImg', 'rotL', 'rotR', 'zoom']) $(id).disabled = !pages;
    $('btnReadAll').disabled = !draft.pages.some((x) => !x.blocks);
    $('photoEmpty').classList.toggle('hidden', !!pages);
    $('photoFrame').classList.toggle('empty', !pages);
    $('photoImg').classList.toggle('hidden', !pages);
  }
  function updateReadState(text) {
    const p = ws.page;
    const busy = p && busyPages.has(p.id);
    updateStage();
    $('btnRead').disabled = !p || busy;
    $('btnStopRead').classList.toggle('hidden', !busyPages.size && !readingAll);
    $('readState').textContent = text || (busy ? tx('app.readingNow') : p && p.readWith ? tx('app.readWith', { reader: engineLabel(p.readWith) }) : '');
    $('btnReadSheet').classList.toggle('busy', !!busy);  // phones: the reading shows on the toolbar's القراءة
    $('btnReadSheet').classList.toggle('unread', !!p && !busy && !p.blocks);
  }

  // what a version is stays data ({ engine, edited } or { kind }), so its name shows in the language of the moment
  function pushVersion(p, label, blocks) {
    p.versions = p.versions || [];
    p.versions.unshift({ id: uid(), label, at: Date.now() / 1000, blocks: clone(blocks) });
    p.versions = p.versions.slice(0, 8);
  }
  function versionLabel(v) {
    const w = v.label;
    if (typeof w === 'string') return w;  // saved before 1.0.6, as text
    if (!w || w.kind === 'earlier') return tx('app.earlierVersion');
    if (w.kind === 'restore') return tx('app.beforeRestoring');
    return w.edited ? tx('app.readerAfterEdits', { reader: engineLabel(w.engine) }) : engineLabel(w.engine);
  }
  function hasEdits(p) { return p.blocks && p.blocks.length; }
  const clone = (x) => JSON.parse(JSON.stringify(x));

  function fillVersions() {
    const p = ws.page;
    const vs = (p && p.versions) || [];
    $('verList').replaceChildren(...(vs.length ? vs.map((v) => el('li', null,
      el('span', null, versionLabel(v), el('small', { class: 'muted' }, fmtTime(v.at))),
      el('span', { class: 'ver-acts' },
        el('button', { type: 'button', class: 'btn ghost small', onclick: () => useVersion(v) }, tx('app.use')),
        iconBtn('trash', tx('app.deleteVersion'), () => deleteVersion(v), 'btn ghost small icon-only danger'))))
      : [el('li', { class: 'muted' }, tx('app.pageHasNoEarlierVersions'))]));
  }
  async function deleteVersion(v) {
    const p = ws.page;
    if (!(await ask(tx('app.deleteVersionCantUndone', { name: versionLabel(v) }), { ok: tx('app.delete'), danger: true }))) return;
    p.versions = (p.versions || []).filter((x) => x.id !== v.id);
    fillVersions(); ws.changed();
  }
  async function useVersion(v) {
    const p = ws.page;
    $('verPop').open = false;
    if (!(await ask(tx('app.versionsTextWillReplaceCurrent'), { ok: tx('app.useVersion') }))) return;
    ws.flush();
    pushVersion(p, { kind: 'restore' }, p.blocks || []);
    p.blocks = clone(v.blocks); renderEditor(); fillVersions(); ws.changed();
  }

  // ------------------------------------------------------------------ a second opinion on spots of the page
  // Flagged words and paragraphs remember where they sit on the photo that was read; another engine can read
  // just those spots again (/api/ocr-spots).
  const engineChoices = () => {
    const p = ws.page;
    const usable = ENGINES.filter((e) => e.available);
    const pick = (usable.find((e) => p && e.id !== p.readWith && e.group === 'free') || usable[0] || {}).id;
    return usable.map((e) => [e.id, e.label, e.id === pick]);
  };
  function fillEngineChoices(sel) {
    sel.replaceChildren(...engineChoices().map(([id, label, on]) => el('option', { value: id, selected: on }, label)));
  }
  async function readSpots(engine, boxes) {
    const p = ws.page;
    if (!spots.readable(p)) throw new Error(tx('app.pagePhotoChangedAfterRead'));
    const key = keyFor(engine), e = ENGINES.find((x) => x.id === engine) || {};
    if (e.key && !key && !e.serverKey) throw new Error(tx('app.enterReadersKeySettings'));
    const fd = new FormData();
    fd.append('draft_id', draft.id); fd.append('image', p.readImage); fd.append('engine', engine);
    fd.append('boxes', JSON.stringify(boxes)); fd.append('rotation', String(p.readRot || 0));
    fd.append('cleanup', $('cleanupSel').value); fd.append('langs', $('langsSel').value); fd.append('model', $('modelSel').value);
    if (p.docLang) fd.append('doc_lang', p.docLang);  // the notes in what comes back in the page's language (/api/ocr)
    if (key) fd.append('api_key', key);
    return (await api('/api/ocr-spots', { method: 'POST', body: fd })).results;
  }
  const markBox = (m) => (m && m.dataset.box ? m.dataset.box.split(',').map(Number) : null);

  // ------------------------------------------------------------------ editor (web/js/editor.js)
  let pe = null;        // the shown page's editor (bound to it in ws)
  let toolbar = null;   // the formatting toolbar, working on pe
  let flagTimer = 0;
  function destroyEditor() {
    if (pe) { ws.release(); pe.destroy(); pe = null; }  // callers flush first when its text is to be kept
    closeNote(); closeLine();
  }
  function renderEditor() {
    const p = ws.page;
    destroyEditor();
    const host = $('editor');
    host.replaceChildren();
    if (!p.blocks) {
      host.append(el('div', { class: 'empty-hint' }, tx('app.pageIsntReadYetChoose'), ' ',
        el('button', { type: 'button', class: 'btn small', onclick: () => { p.blocks = []; ws.changed(); renderEditor(); if (pe) pe.chain().run(); } }, tx('app.startTyping'))));
    } else {
      pe = window.DocEditor.mount(host, p.blocks, {
        src: (name) => `/api/drafts/${draft.id}/images/${name}`,
        onChange: () => {
          ws.changed(); closeLine();  // its line may have moved or changed
          clearTimeout(flagTimer);
          flagTimer = setTimeout(() => { ws.flush(); renderFlags(); renderPages(); }, 250);
        },
        onState: () => { if (toolbar) toolbar.update(); },
        onPasteImage: pasteIntoText,
      });
      ws.bind(pe);
    }
    renderFlags();
    if (toolbar) toolbar.update();
  }

  // ------------------------------------------------------------------ flags / notes
  const countFlags = (blocks) => window.BlocksDoc.segLists(blocks).reduce((n, segs) => n + segs.filter((s) => s.note != null).length, 0);

  // "قراءة غير مؤكدة (درجة الثقة 22%)، قارن مع الصورة الأصلية" said the same long sentence under every word
  // the server's low-confidence note (engines/common.py) in any language, its {conf} caught
  let lowNote = null;
  const shortNote = (note) => {
    lowNote = lowNote || new RegExp(I18N.texts('doc.uncertainReadingConfidenceCompareOriginal')
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{conf\\}', '(\\d+)')).join('|'));
    const m = lowNote.exec(note || '');
    return m ? tx('app.uncertainPercent', { percent: m.slice(1).find(Boolean) }) : note || tx('app.noNote');
  };

  // whether a page can be read again in spots, and the second readings (spots.js); the flags are the editor's marks
  const spots = window.Spots.create({ read: (p, engine, boxes) => readSpots(engine, boxes) });
  const flagOf = (m) => ({ el: m, text: m.textContent, box: markBox(m) });
  const pageFlags = () => [...document.querySelectorAll('#editor mark.flag')].map(flagOf);
  function renderFlags() {
    const flags = pageFlags(), p = ws.page;
    $('flagCount').textContent = String(flags.length);
    const readable = flags.filter((f) => f.box);
    $('flagTools').classList.toggle('hidden', !readable.length || !spots.readable(p));
    if (readable.length && !$('flagEngine').options.length) fillEngineChoices($('flagEngine'));
    $('flagList').replaceChildren(...(flags.length ? flags.map((f) => {
      const m = f.el, s = spots.offer(p, f);
      return el('li', null,
        el('button', { type: 'button', class: 'flag-item', title: m.dataset.note || '', onclick: () => { m.scrollIntoView({ block: 'center' }); openNote(m); } },
          el('b', null, (m.textContent || '').slice(0, 60) || tx('app.noTextParens')), el('span', { class: 'why' }, shortNote(m.dataset.note))),
        s ? el('div', { class: 'flag-suggest' },
          el('span', null, tx('app.readerQuote', { reader: engineLabel(s.engine), text: s.text })),
          el('button', { type: 'button', class: 'btn ghost small', onclick: () => useSuggestion(m, s) }, tx('app.use'))) : null);
    }) : [el('li', { class: 'flags-empty' }, tx('app.noFlaggedSpotsPageSelect'))]));
    $('flagUseAll').classList.toggle('hidden', spots.pending(p, flags).length < 2);
  }
  // a second reading replaces the flagged text; the flag stays until the reviewer removes it
  function useSuggestion(m, s) {
    if (!pe || !s.text) return;
    pe.replaceFlag(m, s.text, {});
    ws.flush(); renderFlags(); renderPages(); ws.changed();
  }
  function useAllSuggestions() {
    if (!pe) return;
    pe.replaceFlags(spots.pending(ws.page, pageFlags()).map((x) => ({ el: x.flag.el, text: x.text })));
    ws.flush(); renderFlags(); renderPages(); ws.changed();
  }
  async function rereadFlags() {
    const flags = pageFlags().filter((f) => f.box);
    if (!flags.length) return;
    const engine = $('flagEngine').value, btn = $('flagReread');
    btn.disabled = true; updateReadState(tx('app.readingSpots', { n: flags.length, reader: engineLabel(engine) }));
    try {
      await spots.reread(ws.page, engine, flags);
      renderFlags();
      updateReadState(tx('app.spotsReadSuggestionsUnderEach', { reader: engineLabel(engine) }));
    } catch (e) { toast(e.message, true); updateReadState(); }
    btn.disabled = false;
  }

  // Clicking a flagged word opens a small panel for fixing just that word: the note as one read-only
  // status line, the spot on the photo, and the word itself ready to edit. Only a flag the user has
  // just added (no note yet) asks for its note.
  let noteMark = null;
  function openNote(mark, editNote) {
    document.querySelectorAll('mark.flag.focus').forEach((m) => m.classList.remove('focus'));
    noteMark = mark; mark.classList.add('focus');
    const note = mark.dataset.note || '';
    $('noteStatus').textContent = note ? (shortNote(note) !== note ? tx('app.noteComparePhoto', { note: shortNote(note) }) : shortNote(note)) : tx('app.noNoteYet');
    $('noteStatus').title = note;
    $('noteText').value = note;
    $('noteWord').value = mark.textContent;
    setNoteEditing(!!editNote || !note);
    const pop = $('notePop');
    const p = ws.page;
    const canRead = !!markBox(mark) && spots.readable(p);
    $('noteReread').classList.toggle('hidden', !canRead);
    $('noteSuggest').classList.add('hidden');
    if (canRead) fillEngineChoices($('noteEngine'));
    const known = spots.reading(p, flagOf(mark));
    if (known) showSuggestion(known);
    slideIn(pop); pop.classList.remove('hidden');
    placeNote();
    showCrop(mark);  // async; the panel is placed again once the picture has a size
    const f = editNote || !note ? $('noteText') : $('noteWord'); f.focus(); f.select();
  }
  function placeNote() {
    if (!noteMark) return;
    const pop = $('notePop'), r = noteMark.getBoundingClientRect();
    if (asSheet(pop)) return;
    const below = r.bottom + 8, fits = below + pop.offsetHeight < window.innerHeight - 10;
    pop.style.top = Math.max(10, fits ? below : r.top - pop.offsetHeight - 8) + 'px';
    pop.style.left = Math.max(10, Math.min(window.innerWidth - pop.offsetWidth - 10, r.left)) + 'px';
  }
  function setNoteEditing(on) { $('noteText').classList.toggle('hidden', !on); }
  function showSuggestion(s) {
    const b = $('noteSuggest');
    b.dataset.text = s.text;
    b.textContent = tx('app.readPressPutField', { reader: engineLabel(s.engine), text: s.text || tx('app.noText') });
    b.disabled = !s.text;
    b.classList.remove('hidden');
    placeNote();
  }
  async function rereadNote() {
    const mark = noteMark, engine = $('noteEngine').value;
    $('noteReadBtn').disabled = true;
    try {
      const [s] = await spots.reread(ws.page, engine, [flagOf(mark)]);
      if (noteMark === mark) showSuggestion(s);
      renderFlags();
    } catch (e) { toast(e.message, true); }
    $('noteReadBtn').disabled = false;
  }
  function closeNote() {
    slideOut($('notePop'), () => $('notePop').classList.add('hidden'));
    if (noteMark) noteMark.classList.remove('focus');
    noteMark = null;
  }
  // unflag: the word is checked, keep the (edited) text and remove the highlight and note
  function saveNote(unflag) {
    if (!noteMark || !pe) return;
    const text = $('noteWord').value.replace(/\s+/g, ' ').trim();  // an emptied word is deleted
    const note = $('noteText').classList.contains('hidden') ? null : ($('noteText').value.trim() || tx('app.checkSpot'));
    pe.replaceFlag(noteMark, text, { unflag, note });
    closeNote(); ws.flush(); renderFlags(); renderPages(); ws.changed();
    pe.focus();  // back in the text, so Ctrl+Z undoes it
  }

  // a spot of the page photo (a flagged word, a line, a paragraph), when the reading recorded it (free
  // engines) and the photo is still the one that was read. lineH: the height of one photo line there (a
  // fraction of the page); with it the text is drawn big enough to read, and wider than the panel scrolls.
  let cropSrc = { key: '', canvas: null };
  async function drawCrop(cv, box, still, lineH) {
    cv.classList.add('hidden');
    const p = ws.page;
    if (!box || !spots.readable(p)) return false;
    const key = p.image + '@' + (p.readRot || 0);
    if (cropSrc.key !== key) {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = imgUrl(p); }).catch(() => null);
      if (!img) return false;
      cropSrc = { key, canvas: window.ImageEditor._render(img, { rot90: p.readRot || 0, fine: 0, bright: 100, contrast: 100, gray: false }) };
    }
    if (!still()) return false;  // another spot was opened meanwhile
    const src = cropSrc.canvas, W = src.width, H = src.height;
    const pad = Math.max(12, Math.min(box[3] - box[1], lineH || 1) * H * 0.6);
    const sx = Math.max(0, box[0] * W - 2 * pad), sy = Math.max(0, box[1] * H - pad);
    const sw = Math.min(W, box[2] * W + 2 * pad) - sx, sh = Math.min(H, box[3] * H + pad) - sy;
    if (lineH) {  // about 2.6rem per line, at the screen's own pixel density
      const fit = cv.parentElement.clientWidth / sw, scale = Math.max(fit, Math.min(1.5, 42 / (lineH * H)));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.style.width = Math.round(sw * scale) + 'px'; cv.style.height = Math.round(sh * scale) + 'px';
      cv.width = Math.min(4096, Math.round(sw * scale * dpr)); cv.height = Math.round(cv.width * sh / sw);
    } else {
      cv.width = Math.round(Math.min(640, sw * 2)); cv.height = Math.round(cv.width * sh / sw);
    }
    cv.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    cv.shown = { sx, sy, sw, sh };  // what part of the read photo it shows (lineCut)
    cv.classList.remove('hidden');
    return true;
  }
  async function showCrop(mark) {
    if (await drawCrop($('noteCrop'), markBox(mark), () => noteMark === mark)) placeNote();
  }

  // ------------------------------------------------------------------ a line or paragraph of the text
  // A click into the text opens a small panel under that line, like a flagged word's: its spot on the photo,
  // and reading the line, or its whole paragraph, again with another reader. In a table: the cell, or its
  // row (to compare only). Text with no place on the photo (read before this, read by an AI reader, or
  // typed) shows nothing on a click; the toolbar button says why.
  let lineAt = null;       // { t: pe.readTarget(), which: 'line' | 'para' | 'row', result }
  let lineWhich = 'line';  // the last choice, while the app is open
  // the click preview can be turned off from the toolbar (remembered on this computer); phones start with it off,
  // since there it comes up as a sheet over half the screen on every tap into the text
  const previewOn = () => { const v = store.get('linePreview'); return v ? v === 'on' : !sheets(); };
  function togglePreview() {
    const on = !previewOn();
    store.set('linePreview', on ? 'on' : 'off', true);
    if (!on) closeLine();
    toast(on ? tx('app.clickTextSeeLinePhoto') : tx('app.linePreviewClickOffReread'));
  }
  function openLine(asked, pos) {
    const t = pe && pe.readTarget(pos), p = ws.page;
    const stale = !spots.readable(p);
    if (!t || (!asked && (!t.box || stale))) { closeLine(); return; }
    closeNote();
    const why = !t.box ? tx('app.textsPlacePhotoUnknownPage')
      : stale ? tx('app.photoChangedNoPlace') : '';
    const can = ['line', 'para', 'row'].filter((k) => t[k]);
    lineAt = { t, which: can.includes(lineWhich) ? lineWhich : t.line ? 'line' : 'para', result: null };
    $('lineWhy').textContent = why;
    $('lineWhy').classList.toggle('hidden', !why);
    $('lineBody').classList.toggle('hidden', !!why);
    $('lineWhich').classList.toggle('hidden', !!why || can.length < 2);
    $('linePickLine').classList.toggle('hidden', !t.line);
    $('linePickRow').classList.toggle('hidden', !t.row);
    $('linePickPara').textContent = t.cell ? tx('app.cell') : tx('app.paragraph');
    slideIn($('linePop')); $('linePop').classList.remove('hidden');
    if (!why) {
      const sel = $('lineEngine'), keep = sel.value;
      fillEngineChoices(sel);
      if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
      showLineTarget();
    }
    placeLine();
  }
  function showLineTarget() {
    const at = lineAt, tg = at.t[at.which];
    $('linePickLine').textContent = at.t.line && at.t.line.count > 1 ? tx('app.linesCount', { n: at.t.line.count }) : tx('app.line');
    for (const k of ['line', 'para', 'row']) $('linePick' + k[0].toUpperCase() + k.slice(1)).setAttribute('aria-pressed', String(at.which === k));
    $('lineResult').classList.add('hidden');
    at.result = null;
    const wrap = $('lineCrop').closest('.line-crop');
    wrap.dir = at.t.ltr ? 'ltr' : 'rtl';  // scrolled to where the line starts
    wrap.classList.remove('hidden');      // its width sizes the picture
    clearLinePart();
    drawCrop($('lineCrop'), tg.box, () => lineAt === at && at.t[at.which] === tg, tg.lineH).then((ok) => {
      wrap.classList.toggle('hidden', !ok); $('linePick').classList.toggle('hidden', !ok);
      wrap.scrollLeft = 0; wrap.scrollTop = 0;
      placeLine();
    });
  }
  function pickLine(which) {
    if (!lineAt || !lineAt.t[which]) return;
    lineWhich = lineAt.which = which;
    showLineTarget();
  }
  function placeLine() {
    if (!lineAt || !pe) return;
    const t = lineAt.t, near = t.line || t.para;  // next to the line that was clicked, also for its paragraph
    const r = near ? pe.rectOf(near.from, near.to) : pe.rectOf(t.at, t.at);
    const pop = $('linePop'), w = pop.offsetWidth, h = pop.offsetHeight;
    if (asSheet(pop)) return;
    const below = r.bottom + 8, fits = below + h < window.innerHeight - 10;
    pop.style.top = Math.max(10, fits ? below : r.top - h - 8) + 'px';
    pop.style.left = Math.max(10, Math.min(window.innerWidth - w - 10, r.right - w)) + 'px';
  }
  async function rereadLine() {
    const at = lineAt; if (!at) return;
    const tg = at.t[at.which], engine = $('lineEngine').value, btn = $('lineReadBtn');
    btn.disabled = true; $('lineUse').disabled = true;
    $('lineText').textContent = tx('app.readingWith', { reader: engineLabel(engine) });
    $('lineResult').classList.remove('hidden'); placeLine();
    try {
      const [r] = await readSpots(engine, [tg.box]);
      if (lineAt !== at || at.t[at.which] !== tg) return;  // closed, or switched to the other one meanwhile
      at.result = { tg, segs: r.segs || [], text: (r.text || '').trim() };
      const same = at.result.text === tg.text.trim();
      const reader = engineLabel(engine);
      $('lineText').textContent = !at.result.text ? tx('app.foundNoTextHere', { reader })
        : same ? tx('app.readerSameText', { reader, text: at.result.text }) : tx('app.readerQuote', { reader, text: at.result.text });
      if (tg.readOnly && at.result.text) $('lineText').textContent = tx('app.rowsReadingOnlyComparingRead', { reading: $('lineText').textContent });
      $('lineUse').textContent = at.which === 'para' ? (at.t.cell ? tx('app.replaceCell') : tx('app.replaceParagraph')) : tg.count > 1 ? tx('app.replaceLines') : tx('app.replaceLine');
      $('lineUse').classList.toggle('hidden', !!tg.readOnly);
      $('lineUse').disabled = !at.result.text || same;
    } catch (e) {
      if (lineAt === at) $('lineResult').classList.add('hidden');
      toast(e.message, true);
    } finally {
      btn.disabled = false;
      placeLine();
    }
  }
  function useLine() {
    const r = lineAt && lineAt.result;
    if (!r || !pe) return;
    if (!pe.replaceRange(r.tg.from, r.tg.to, r.tg.text, r.segs)) { toast(tx('app.textChangedReadAgain'), true); return; }
    closeLine(); ws.flush(); renderFlags(); renderPages(); ws.changed();
    pe.focus();
  }
  // the preview as a picture in the text: the part dragged around while تحديد is on, or all of it. The part is
  // kept as fractions of the preview, and cut from the read photo at its full resolution.
  let linePart = null;  // { x0, y0, x1, y1 }
  function setLinePicking(on) {
    $('linePickPart').setAttribute('aria-pressed', String(on));
    $('lineCrop').closest('.line-crop').classList.toggle('picking', on);
    if (!on) clearLinePart();
  }
  function clearLinePart() { linePart = null; $('lineBox').classList.add('hidden'); }
  function placeLinePart() {
    const cv = $('lineCrop'), b = $('lineBox'), w = cv.offsetWidth, h = cv.offsetHeight;
    Object.assign(b.style, { left: cv.offsetLeft + linePart.x0 * w + 'px', top: cv.offsetTop + linePart.y0 * h + 'px', width: (linePart.x1 - linePart.x0) * w + 'px', height: (linePart.y1 - linePart.y0) * h + 'px' });
    b.classList.remove('hidden');
  }
  function lineCut() {
    const cv = $('lineCrop'), s = cv.shown, src = cropSrc.canvas;
    if (!s || !src || cv.classList.contains('hidden')) return null;
    const k = linePart || { x0: 0, y0: 0, x1: 1, y1: 1 };
    const sx = s.sx + k.x0 * s.sw, sy = s.sy + k.y0 * s.sh, sw = (k.x1 - k.x0) * s.sw, sh = (k.y1 - k.y0) * s.sh;
    const f = Math.min(1, 3000 / Math.max(sw, sh)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * f)); c.height = Math.max(1, Math.round(sh * f));
    c.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return { canvas: c, wFrac: sw / src.width };
  }
  async function insertLinePart() {
    const cut = lineCut(); if (!cut) return;
    const blob = await new Promise((res) => cut.canvas.toBlob(res, 'image/jpeg', 0.92));
    try { await insertFigure(blob, cut.wFrac); closeLine(); ws.flush(); ws.changed(); } catch (e) { toast(e.message, true); }
  }
  function copyLinePart() {
    const cut = lineCut(); if (!cut) return;
    if (!navigator.clipboard || !window.ClipboardItem) { toast(tx('app.browserDoesntAllowCopyingPictures'), true); return; }
    const png = new Promise((res) => cut.canvas.toBlob(res, 'image/png'));  // made with the click (Safari)
    navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      .then(() => toast(tx('app.partCopiedPasteIntoText')), () => toast(tx('app.couldntCopy'), true));
  }
  function initLinePick() {
    // no toast for the hint (its title has it): on a phone a toast would sit over the sheet's buttons
    $('linePickPart').onclick = () => setLinePicking($('linePickPart').getAttribute('aria-pressed') !== 'true');
    $('linePickInsert').onclick = insertLinePart;
    $('linePickCopy').onclick = copyLinePart;
    const shot = $('lineCrop').parentElement;
    // a finger drawing the box is only that: the browser starts no gesture of its own (which would swallow the
    // next tap, on Insert)
    shot.addEventListener('touchmove', (e) => { if ($('linePickPart').getAttribute('aria-pressed') === 'true') e.preventDefault(); }, { passive: false });
    shot.addEventListener('pointerdown', (e) => {
      if ($('linePickPart').getAttribute('aria-pressed') !== 'true' || e.button !== 0) return;
      const r = $('lineCrop').getBoundingClientRect();
      if (!r.width) return;
      e.preventDefault(); shot.setPointerCapture(e.pointerId);
      const fx = (ev) => Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), fy = (ev) => Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      const x = fx(e), y = fy(e), drag = new AbortController();
      linePart = { x0: x, y0: y, x1: x, y1: y };
      shot.addEventListener('pointermove', (ev) => {
        linePart = { x0: Math.min(x, fx(ev)), x1: Math.max(x, fx(ev)), y0: Math.min(y, fy(ev)), y1: Math.max(y, fy(ev)) };
        placeLinePart();
      }, { signal: drag.signal });
      const up = () => {
        drag.abort();
        if ((linePart.x1 - linePart.x0) * r.width < 8 || (linePart.y1 - linePart.y0) * r.height < 8) clearLinePart();  // a click, not a drag
      };
      shot.addEventListener('pointerup', up, { signal: drag.signal }); shot.addEventListener('pointercancel', up, { signal: drag.signal });
    });
  }
  function closeLine() {
    lineAt = null;
    setLinePicking(false);
    slideOut($('linePop'), () => $('linePop').classList.add('hidden'));
  }

  // a picture on the clipboard pasted into the text goes in as a picture of the document, after the line
  // the cursor is in; pasted anywhere else in a draft, it is a new page. picked: pictures from a file instead
  async function pasteIntoText(files, picked) {
    const p = ws.page;
    for (const f of files) {
      const fd = new FormData(); fd.append('file', f, f.name || 'pasted.png');
      try {
        const r = await api(`/api/drafts/${draft.id}/images`, { method: 'POST', body: fd });
        if (!pe && p) { p.blocks = p.blocks || []; renderEditor(); }
        if (!pe) return;
        // a screenshot about 1000 px wide fills the page width; a small one stays small
        pe.insertBlock({ type: 'figure', attrs: { image: r.name, w: r.width, h: r.height, wFrac: +Math.max(0.1, Math.min(1, r.width / 1000)).toFixed(3), align: null } });
      } catch (e) { toast(picked ? tx('app.couldntInsertPicture', { error: e.message }) : tx('app.couldntPastePicture', { error: e.message }), true); return; }
    }
    const what = picked ? (files.length > 1 ? tx('app.picturesInserted') : tx('app.pictureInserted')) : (files.length > 1 ? tx('app.picturesPastedIntoText') : tx('app.picturePastedIntoText'));
    toast(files.length > 1 ? what : tx('app.clickChangeTextWrappingSize', { done: what }));
  }
  // any picture on this computer or phone, into the text after the line the cursor is in
  let imagePick = null;
  function pickImage() {
    if (!imagePick) {
      imagePick = document.createElement('input');
      imagePick.type = 'file'; imagePick.accept = 'image/*'; imagePick.multiple = true; imagePick.hidden = true;
      imagePick.addEventListener('change', () => {
        const files = [...imagePick.files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(f.name));
        imagePick.value = '';
        if (files.length && draft) pasteIntoText(files, true);
      });
      document.body.append(imagePick);
    }
    imagePick.click();
  }
  function pastePages(e) {
    if (!draft || !document.body.classList.contains('in-draft')) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
    const d = e.clipboardData;
    if (!d || (d.getData('text/plain') || '').trim()) return;
    const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    const files = [...(d.files || [])].filter((f) => f.type.startsWith('image/'))
      .map((f, k) => new File([f], `${tx('app.pasted')}-${stamp}${k ? '-' + (k + 1) : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type, lastModified: Date.now() }));
    if (!files.length) return;
    e.preventDefault();
    addFiles(files).then((n) => { if (n) toast(tx('app.pagesAddedClipboard', { n })); });
  }

  // pick an area of the page photo (logo, chart, signature) and put it after the block the cursor is in
  function insertPicture() {
    const p = ws.page;
    if (!p) { toast(tx('app.addPagePhoto'), true); return; }
    window.ImageEditor.open({ src: imgUrl(p), rotation: p.rotation || 0, pick: true, onSave: (blob, crop) => insertFigure(blob, crop.w) });
  }
  // wFrac: the picture's share of the page width on the photo, so it comes out the same size on paper
  async function insertFigure(blob, wFrac) {
    const p = ws.page;
    const fd = new FormData(); fd.append('file', blob, 'figure.jpg');
    const r = await api(`/api/drafts/${draft.id}/images`, { method: 'POST', body: fd });
    if (!pe) { p.blocks = p.blocks || []; renderEditor(); }
    pe.insertBlock({ type: 'figure', attrs: { image: r.name, w: r.width, h: r.height, wFrac: +wFrac.toFixed(3), align: null } });
    toast(tx('app.pictureInsertedClickChangeText'));
  }

  // Select on the photo: drag a box around a part of it, drag inside the box to move it, then copy it (to paste
  // anywhere, the text too) or insert it in the text. The box is kept as fractions of the photo as shown (after
  // its rotation), so zooming keeps it in place; another page or another rotation drops it.
  let sel = null;  // { key, x0, y0, x1, y1 }
  const selKey = () => { const p = ws.page; return p ? p.image + '@' + (p.rotation || 0) : ''; };
  function setSelecting(on) {
    if (on && !ws.page) { toast(tx('app.addPagePhoto'), true); return; }
    $('photoFrame').classList.toggle('selecting', on);
    $('btnSelect').setAttribute('aria-pressed', on);
    if (!on) clearSel(); else if (!sel) toast(tx('app.dragPhotoAroundPartNeed'));
  }
  function clearSel() { sel = null; $('selBox').classList.add('hidden'); }
  function placeSel() {
    const box = $('selBox');
    if (!sel || sel.key !== selKey()) { clearSel(); return; }
    const f = $('photoFrame'), r = $('photoImg').getBoundingClientRect(), fr = f.getBoundingClientRect();
    const left = r.left - fr.left - f.clientLeft + f.scrollLeft + sel.x0 * r.width, top = r.top - fr.top - f.clientTop + f.scrollTop + sel.y0 * r.height;
    Object.assign(box.style, { left: left + 'px', top: top + 'px', width: (sel.x1 - sel.x0) * r.width + 'px', height: (sel.y1 - sel.y0) * r.height + 'px' });
    box.classList.remove('hidden');
    // the bar above the box at its right edge; below it when there is no room above; over its top when the box
    // fills the view; always inside the visible pane, however far the box runs out of it
    const bar = $('selBar'), b = box.getBoundingClientRect(), w = bar.offsetWidth, h = bar.offsetHeight, gap = 8;
    const view = { l: fr.left + f.clientLeft + gap, t: fr.top + f.clientTop + gap, r: fr.left + f.clientLeft + f.clientWidth - gap, b: fr.top + f.clientTop + f.clientHeight - gap };
    const x = Math.max(view.l, Math.min(b.right - w, view.r - w));
    const y = b.top - gap - h >= view.t ? b.top - gap - h : b.bottom + gap + h <= view.b ? b.bottom + gap : Math.max(view.t, b.top + gap);
    bar.style.left = x - b.left - box.clientLeft + 'px'; bar.style.top = y - b.top - box.clientTop + 'px';
  }
  function initSelect() {
    const f = $('photoFrame'), box = $('selBox');
    $('btnSelect').onclick = () => setSelecting(!f.classList.contains('selecting'));
    $('selCancel').onclick = clearSel;
    $('selCopy').onclick = copySel;
    $('selInsert').onclick = async () => {
      const w = sel.x1 - sel.x0, blob = await new Promise((res) => cutSel().then((c) => c.toBlob(res, 'image/jpeg', 0.92)));
      try { await insertFigure(blob, w); clearSel(); } catch (e) { toast(e.message, true); }
    };
    $('selBar').addEventListener('pointerdown', (e) => e.stopPropagation());
    f.addEventListener('pointerdown', (e) => {
      if (!f.classList.contains('selecting') || e.button !== 0) return;
      const r = $('photoImg').getBoundingClientRect();
      if (!r.width) return;
      e.preventDefault(); f.setPointerCapture(e.pointerId);
      const fx = (ev) => Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), fy = (ev) => Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      const x = fx(e), y = fy(e), moving = sel && box.contains(e.target), start = sel && { ...sel };
      if (!moving) sel = { key: selKey(), x0: x, y0: y, x1: x, y1: y };
      box.classList.add('moving');
      const drag = new AbortController(), signal = drag.signal;
      f.addEventListener('pointermove', (ev) => {
        if (moving) {  // the whole box, kept on the photo
          const dx = Math.min(1 - start.x1, Math.max(-start.x0, fx(ev) - x)), dy = Math.min(1 - start.y1, Math.max(-start.y0, fy(ev) - y));
          Object.assign(sel, { x0: start.x0 + dx, x1: start.x1 + dx, y0: start.y0 + dy, y1: start.y1 + dy });
        } else {
          Object.assign(sel, { x0: Math.min(x, fx(ev)), x1: Math.max(x, fx(ev)), y0: Math.min(y, fy(ev)), y1: Math.max(y, fy(ev)) });
        }
        placeSel();
      }, { signal });
      const up = () => {
        drag.abort(); box.classList.remove('moving');
        if ((sel.x1 - sel.x0) * r.width < 8 || (sel.y1 - sel.y0) * r.height < 8) clearSel(); else placeSel();  // a click, not a drag
      };
      f.addEventListener('pointerup', up, { signal }); f.addEventListener('pointercancel', up, { signal });
    });
    f.addEventListener('scroll', () => sel && placeSel(), { passive: true });  // keeps the bar's side right
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !f.classList.contains('selecting') || document.querySelector('dialog[open]')) return;
      if (sel) clearSel(); else setSelecting(false);
    });
  }
  // the part at the photo's full resolution (as shown: rotated), at most 3000 pixels on its long side
  async function cutSel() {
    const p = ws.page;
    const full = window.ImageEditor._render(await createImageBitmap($('photoImg')), { rot90: p.rotation || 0, fine: 0, bright: 100, contrast: 100, gray: false });
    const sx = sel.x0 * full.width, sy = sel.y0 * full.height, sw = (sel.x1 - sel.x0) * full.width, sh = (sel.y1 - sel.y0) * full.height;
    const k = Math.min(1, 3000 / Math.max(sw, sh)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
    c.getContext('2d').drawImage(full, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }
  function copySel() {
    if (!navigator.clipboard || !window.ClipboardItem) { toast(tx('app.browserDoesntAllowCopyingPictures'), true); return; }
    // the item is made now, with the click, and filled when the picture is ready (Safari needs it that way)
    const png = cutSel().then((c) => new Promise((res) => c.toBlob(res, 'image/png')));
    navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      .then(() => toast(tx('app.partCopiedPasteIntoText')), () => toast(tx('app.couldntCopy'), true));
  }
  function flagSelection() {
    const m = pe && pe.flagSelection('');
    if (!m) { toast(tx('app.selectTextEditor')); return; }
    ws.flush(); renderFlags(); ws.changed(); openNote(m, true);
  }

  // ------------------------------------------------------------------ export
  async function exportWord(quick) {
    if (!draft.pages.length) { toast(tx('app.addPhotosFirst'), true); return; }
    ws.flush();
    if (quick) {
      $('btnQuick').disabled = true;
      try { await readAllUnread(); } finally { $('btnQuick').disabled = false; }
    }
    const unread = draft.pages.filter((p) => !p.blocks).length;
    if (unread && !quick && !(await ask(tx('app.pagesArentReadYetWill', { n: unread }), { ok: tx('app.exportFile') }))) return;
    const tplId = $('templateSel').value;
    if (!tplId) { toast(tx('app.theresNoHeaderTemplateAdd'), true); return; }
    try {
      const fmt = $('formatSel').value || 'docx';
      const bytes = await (await fetch(`/api/templates/${tplId}/file`)).arrayBuffer();
      const out = await window.DocxExport.build(bytes, { pages: draft.pages.map((p) => ({ blocks: p.blocks || [] })) }, {
        JSZip: window.JSZip, date: isoToDMY($('draftDate').value), author: settings.author || draft.owner || tx('app.reviewer'),
        highlight: $('optHighlight').checked, pageBreaks: $('optPageBreaks').checked, fontSize: docFontSize(),
        headingSize: docFontSize() + 2, fontName: $('optFontName').value.trim(),
        // PDF and images cannot show Word comments, so notes print as numbered footnotes under the page
        notesAs: ['pdf', 'png', 'txt'].includes(fmt) && $('optMargin').checked ? 'footnotes' : 'comments',
        fetchImage: async (name) => new Uint8Array(await (await fetch(`/api/drafts/${draft.id}/images/${name}`)).arrayBuffer())
      });
      const name = (draft.name || tx('app.documentFallback')).replace(/[\\/:*?"<>|]+/g, '-');
      const docxBlob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      let saved;
      if (fmt === 'docx') {
        saved = await download(docxBlob, name + '.docx');
      } else {
        toast(tx('app.converting'));
        const fd = new FormData();
        fd.append('file', docxBlob, 'document.docx'); fd.append('format', fmt); fd.append('name', name);
        const res = await fetch('/api/convert', { method: 'POST', body: fd });
        if (!res.ok) { let m = tx('app.errorStatus', { status: res.status }); try { m = I18N.message(await res.json()) || m; } catch (e) { /* */ } throw new Error(m); }
        saved = await download(await res.blob(), filenameFrom(res, name + '.' + fmt));
      }
      if (saved === null) return;  // Save As cancelled
      const flags = draft.pages.reduce((n, p) => n + countFlags(p.blocks), 0);
      const open = (folder) => () => api('/api/saved/open', jsonOpts('POST', { path: saved, folder })).catch((e) => toast(e.message, true));
      toast(flags ? tx('app.fileExportedHighlightedSpotsNotes', { n: flags }) : tx('app.fileExported'), false,
        saved ? [[tx('app.openFile'), open(false)], [tx('app.showInFolder'), open(true)]] : []);
      if (ws.dirty) ws.save();
    } catch (e) { toast(tx('app.couldntExportFile', { error: e.message }), true); }
  }

  function fillFormats() {
    const sel = $('formatSel');
    if (FORMATS.length) sel.replaceChildren(...FORMATS.map((f) => el('option', { value: f.id, disabled: !f.available, title: f.available ? '' : tx('app.notAvailableServer') },
      f.available ? f.label : tx('app.readerNotAvailable', { name: f.label }))));
    const saved = store.get('format');
    if (saved && FORMATS.some((f) => f.id === saved && f.available)) sel.value = saved;
  }

  // The Windows program: Save As, in the folder saved to last; gives the path, or null when cancelled.
  // A browser downloads it (''), the phone too.
  async function download(blob, filename) {
    if (typeof appVersion === 'string') {
      const fd = new FormData(); fd.append('file', blob, filename); fd.append('name', filename);
      try { return (await api('/api/save-as', { method: 'POST', body: fd })).path; } catch (e) { if (e.status !== 404) throw e; }
    }
    const a = el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return '';
  }
  function filenameFrom(res, fallback) {
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
    return m ? decodeURIComponent(m[1]) : fallback;
  }

  // the keys that work, each with what it does: the app's own (below) and the text editor's (TipTap's StarterKit and
  // TextAlign, editor.js mount)
  const keys = () => [
    [tx('keys.save'), ['Ctrl', 'S']], [tx('keys.close'), ['Esc']], [tx('keys.zoom'), ['Ctrl', tx('keys.wheel')]],
    [tx('keys.bold'), ['Ctrl', 'B']], [tx('keys.italic'), ['Ctrl', 'I']], [tx('keys.underline'), ['Ctrl', 'U']],
    [tx('keys.strike'), ['Ctrl', 'Shift', 'S']], [tx('keys.undo'), ['Ctrl', 'Z']], [tx('keys.redo'), ['Ctrl', 'Y']],
    [tx('keys.heading'), ['Ctrl', 'Alt', '1 / 2 / 3']], [tx('keys.paragraph'), ['Ctrl', 'Alt', '0']],
    [tx('keys.bullets'), ['Ctrl', 'Shift', '8']], [tx('keys.numbers'), ['Ctrl', 'Shift', '7']],
    [tx('keys.align'), ['Ctrl', 'Shift', 'R / E / L / J']], [tx('keys.lineBreak'), ['Shift', 'Enter']], [tx('keys.thisList'), ['?']],
  ];
  function showKeys() {
    $('keysList').replaceChildren(...keys().flatMap(([what, ks]) => [
      el('dt', { dir: 'ltr' }, ...ks.flatMap((k, i) => (i ? [' + ', el('kbd', null, k)] : [el('kbd', null, k)]))), el('dd', null, what)]));
    $('dlgKeys').showModal();
  }

  // ------------------------------------------------------------------ templates & settings
  // the document's base text size in points (any size the user types; 14 when empty or out of range)
  const docFontSize = () => { const n = parseFloat($('optFont').value); return n >= 6 && n <= 72 ? n : 14; };

  function fillTemplateSelect() {
    $('templateSel').replaceChildren(...TEMPLATES.map((t) => el('option', { value: t.id }, t.name)),
      el('option', { value: '__add' }, tx('app.addNewTemplate')));
    if (draft) $('templateSel').value = draft.template || '';
    $('tplHead').textContent = tx('app.headerTemplates', { n: TEMPLATES.length });
    // the plain template ships with the program (it comes back at every start), so it is not offered for deleting
    $('tplList').replaceChildren(...TEMPLATES.map((t) => el('li', null, t.name, t.id === 'plain'
      ? el('span', { class: 'builtin' }, tx('app.builtIn'))
      : el('button', { type: 'button', class: 'btn ghost small danger', onclick: () => deleteTemplate(t) }, tx('app.delete')))));
  }
  async function reloadTemplates() {
    useTemplates(await api('/api/templates')); fillTemplateSelect();
  }
  // the add-template window; from the draft's template list the new template is chosen for the draft
  let tplForDraft = false;
  function openTemplateAdd(forDraft) {
    tplForDraft = forDraft;
    $('tplName').value = ''; $('tplFile').value = ''; $('tplFileName').textContent = tx('app.chooseFile');
    $('tplTokenWrap').classList.toggle('hidden', !TPL_ADMIN);
    $('dlgTpl').showModal(); $('tplName').focus();
  }
  async function addTemplate() {
    const f = $('tplFile').files[0], name = $('tplName').value.trim();
    if (!f || !name) { toast(tx('app.typeTemplatesNameChooseWord'), true); return; }
    const fd = new FormData(); fd.append('name', name); fd.append('file', f); fd.append('admin_token', $('tplToken').value);
    try {
      const t = await api('/api/templates', { method: 'POST', body: fd });
      $('dlgTpl').close(); await reloadTemplates(); toast(tx('app.templateAdded'));
      if (tplForDraft && draft) { draft.template = t.id; $('templateSel').value = t.id; ws.changed(); }
    } catch (e) { toast(e.message, true); }
  }
  async function deleteTemplate(t) {
    if (!(await ask(tx('app.deleteTemplate', { name: t.name }), { ok: tx('app.delete'), danger: true }))) return;
    try { await api(`/api/templates/${t.id}?admin_token=${encodeURIComponent($('tplToken').value)}`, { method: 'DELETE' }); await reloadTemplates(); }
    catch (e) { toast(e.message, true); }
  }
  // the interface language (js/i18n.js), kept on this device. The page loads again in it, once the open draft is
  // saved; the Windows program also keeps it for what shows before the page next time (server: /api/lang).
  function showLang() {
    $('setLang').replaceChildren(...I18N.languages().map((l) => el('button', {
      type: 'button', class: 'btn small', lang: l.code, dir: l.dir, translate: 'no', 'aria-pressed': String(l.code === I18N.lang()),
      onclick: () => setLang(l.code) }, l.name)));
  }
  async function setLang(lang) {
    if (lang === I18N.lang()) return;
    if (ws.dirty) await ws.save();
    if (ws.dirty) return;  // not saved: the page stays, and its save state says why
    I18N.set(lang);
    await api('/api/lang', jsonOpts('POST', { lang })).catch(() => {});  // a server or a phone has none: fine
    location.reload();
  }
  // light, dark or the system's: applied at once and kept on this device (js/theme.js)
  function showTheme() {
    document.querySelectorAll('#setTheme button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pick === DocTheme.pick())));
  }
  function openSettings() {
    showLang(); showTheme();
    $('setAuthor').value = settings.author; $('setClaude').value = settings.claudeKey;
    $('setGoogle').value = settings.googleKey; $('setRemember').checked = settings.remember;
    showPartsBox();
    showUpdateBox();
    // opened before the start-up check asked (it waits a moment): ask now
    if (appVersion === undefined) api('/api/update').then((st) => { appVersion = st.current; showUpdateBox(); }).catch(() => {});
    fillTemplateSelect(); $('dlgSettings').showModal();
  }
  function showUpdateBox() {
    $('updateBox').classList.toggle('hidden', !appVersion);
    if (!appVersion) return;
    $('updateInfo').textContent = tx('app.version', { version: appVersion });
    $('checkUpdateLabel').textContent = tx('app.checkUpdates');
    $('btnCheckUpdate').onclick = checkUpdateNow;
  }
  function saveSettings() {
    const keep = $('setRemember').checked;
    store.set('remember', keep ? '1' : '', true);
    store.set('author', $('setAuthor').value.trim(), true);
    store.set('claudeKey', $('setClaude').value.trim(), keep);
    store.set('googleKey', $('setGoogle').value.trim(), keep);
  }

  // ------------------------------------------------------------------ wiring
  function bindStatic() {
    $('brand').onclick = () => { location.hash = ''; };
    $('formNew').onsubmit = (e) => createDraft(e).catch((err) => toast(err.message, true));
    $('btnRefresh').onclick = loadDraftList;
    $('colFilter').addEventListener('input', (e) => setDraftFilter(e.target.dataset.col, e.target.value));
    $('colFilter').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); closeColFilter(true); } });
    $('btnBack').onclick = () => { location.hash = ''; };
    $('btnSettings').onclick = openSettings;
    // Settings save as they change, like the theme: closing never drops a typed name or key
    for (const id of ['setAuthor', 'setClaude', 'setGoogle']) $(id).addEventListener('input', saveSettings);
    $('setRemember').addEventListener('change', saveSettings);
    $('btnParts').onclick = () => { $('dlgSettings').close(); offerParts('nuqta'); };
    $('btnPhone').onclick = () => { refreshPhone(); $('dlgPhone').showModal(); };
    $('btnKeys').onclick = () => { $('dlgSettings').close(); showKeys(); };
    $('phoneStart').onclick = () => phoneAction('/api/remote/start');
    $('phoneStop').onclick = () => phoneAction('/api/remote/stop');
    $('copyUrl').onclick = () => copyText('phoneUrl');
    $('copyPw').onclick = () => copyText('phonePw');
    $('partsRetry').onclick = startParts;
    $('partsStop').onclick = () => api('/api/parts/stop', { method: 'POST' }).then(() => toast(tx('app.downloadStopped'))).catch((e) => toast(e.message, true));
    $('partsClose').onclick = () => $('partsBar').classList.add('hidden');
    $('partsRestart').onclick = async () => {
      if (draft && ws.dirty) await ws.save();
      $('partsRestart').disabled = true;
      api('/api/restart', { method: 'POST' }).catch((e) => { toast(e.message, true); $('partsRestart').disabled = false; });
    };
    // the browser's own "please fill out this field" speaks the browser's language, not the page's
    $('newName').addEventListener('invalid', (e) => e.target.setCustomValidity(e.target.validity.valueMissing ? tx('app.typeDocumentsName') : ''));
    $('newName').addEventListener('input', (e) => e.target.setCustomValidity(''));
    document.querySelectorAll('#setTheme button').forEach((b) => { b.onclick = () => { DocTheme.set(b.dataset.pick); showTheme(); }; });
    $('btnTplAdd').onclick = addTemplate;
    $('btnTplNew').onclick = () => openTemplateAdd(false);
    $('tplFile').onchange = () => { const f = $('tplFile').files[0]; $('tplFileName').textContent = f ? f.name : tx('app.chooseFile'); };
    // document font and size: remembered on this computer
    $('optFont').value = store.get('fontSize') || '14';
    $('optFontName').value = store.get('fontName') || '';
    $('optFont').onchange = () => store.set('fontSize', $('optFont').value, true);
    $('optFontName').onchange = () => store.set('fontName', $('optFontName').value.trim(), true);

    $('draftName').oninput = () => { draft.name = $('draftName').value; ws.changed(); };
    $('draftDate').onchange = () => { draft.date = $('draftDate').value; ws.changed(); };
    $('templateSel').onchange = () => {
      if ($('templateSel').value === '__add') { $('templateSel').value = draft.template || ''; openTemplateAdd(true); return; }
      draft.template = $('templateSel').value; ws.changed();
    };
    $('btnSave').onclick = () => ws.save();
    $('btnExport').onclick = () => exportWord(false);
    $('btnQuick').onclick = () => exportWord(true);

    $('fileAdd').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
    const pages = document.querySelector('.pages');
    pages.addEventListener('dragover', (e) => { e.preventDefault(); if (dragFrom == null) pages.classList.add('drag'); });
    pages.addEventListener('dragleave', () => pages.classList.remove('drag'));
    pages.addEventListener('drop', (e) => { e.preventDefault(); pages.classList.remove('drag'); if (e.dataTransfer.files.length) droppedFiles(e.dataTransfer).then(addFiles); });

    $('orderSel').value = store.get('order') || 'name';
    $('orderSel').onchange = () => store.set('order', $('orderSel').value, true);
    $('btnResort').onclick = resortPages;
    $('formatSel').onchange = () => store.set('format', $('formatSel').value, true);
    $('btnEditImg').onclick = () => editImage(ws.index);
    $('photoFrame').addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const z = $('zoom'); z.value = Math.max(+z.min, Math.min(+z.max, +z.value - Math.sign(e.deltaY) * 10)); applyPhotoTransform();
    }, { passive: false });
    $('rotL').onclick = () => rotate(-90);
    $('rotR').onclick = () => rotate(90);
    $('zoom').oninput = applyPhotoTransform;
    window.addEventListener('resize', applyPhotoTransform);

    $('engineSel').onchange = () => {  // remember only a real pick, so a later change of default still reaches the user
      const picked = ENGINES.find((e) => e.id === $('engineSel').value);
      if (picked && !picked.available && picked.installable) { fillEngineSelect(); offerParts(picked.id); return; }
      store.set('engine', $('engineSel').value, true);
      engineChanged();
    };
    $('modelSel').onchange = () => store.set('model', $('modelSel').value, true);
    $('langsSel').value = store.get('langs') || 'ara+eng';
    $('langsSel').onchange = () => store.set('langs', $('langsSel').value, true);
    $('btnRead').onclick = () => { setReadSheet(false); readPage(ws.index); };
    $('btnReadAll').onclick = () => { setReadSheet(false); readAllUnread(); };
    $('btnStopRead').onclick = stopReading;
    toolbar = window.DocEditor.toolbar($('fmtBar'), () => pe, {
      picture: insertPicture, pickImage, flag: flagSelection, engines: engineChoices, hasPage: () => !!ws.page,
      showLine: () => openLine(true), previewOn, togglePreview, slideOut, shutPop,
    }, $('editorScroll'));
    $('linePickLine').onclick = () => pickLine('line'); $('linePickPara').onclick = () => pickLine('para'); $('linePickRow').onclick = () => pickLine('row');
    $('lineReadBtn').onclick = rereadLine; $('lineUse').onclick = useLine; $('lineClose').onclick = closeLine;
    document.addEventListener('paste', pastePages);
    $('noteReadBtn').onclick = rereadNote;
    $('noteSuggest').onclick = () => { $('noteWord').value = $('noteSuggest').dataset.text; $('noteWord').focus(); };
    $('flagReread').onclick = rereadFlags;
    $('flagUseAll').onclick = useAllSuggestions;

    const ed = $('editor');
    // a flagged word is fixed in its panel: a click on it opens the panel and leaves the caret where it was
    ed.addEventListener('mousedown', (e) => { if (e.target.closest('mark.flag')) e.preventDefault(); });
    // any other click into the text (a caret, not a selection) shows that line on the photo
    ed.addEventListener('click', (e) => {
      const m = e.target.closest('mark.flag');
      if (m) openNote(m);
      else if (pe && previewOn() && document.getSelection().isCollapsed && !e.target.closest('figure')) {
        const pos = pe.posAt(e.clientX, e.clientY);
        if (pos != null) openLine(false, pos);
      }
    });
    $('noteSave').onclick = () => saveNote(false); $('noteRemove').onclick = () => saveNote(true); $('noteClose').onclick = closeNote;
    $('noteWord').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveNote(false); } });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && draft) { e.preventDefault(); ws.save(); }
      if (e.key === '?' && !e.target.closest('input, textarea, select, [contenteditable="true"]') && !document.querySelector('dialog[open]')) showKeys();
      if (e.key === 'Escape') {  // the window on top only: a list over a menu closes, the menu stays
        const top = topSheet(); if (!top) return;
        closeSheet(top);
        const d = top.closest('details');
        if (d && !top.classList.contains('tb-pop')) d.querySelector('summary').focus();
        else if (top.id === 'readBar') $('btnReadSheet').focus();
      }
    });

    // every window closes on a click outside it, like Esc (the press has to start outside too, so a text
    // selection dragged out of a field does not close it); the photo editor has its own, asking first when edited
    for (const d of document.querySelectorAll('dialog:not(#dlgImage)')) {
      let pressedOutside = false;
      const outside = (e) => { const r = d.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
      d.addEventListener('pointerdown', (e) => { pressedOutside = outside(e); });
      d.addEventListener('click', (e) => {
        if (pressedOutside && outside(e) && d.dispatchEvent(new Event('cancel', { cancelable: true }))) d.close();
        pressedOutside = false;
      });
    }

    // popovers: one open at a time, closed by a click anywhere outside them
    // looked up each time: the text toolbar adds its own (its phone sheets, editor.js)
    const pops = () => document.querySelectorAll('details.pop-wrap');
    document.addEventListener('toggle', (e) => {  // toggle does not bubble; this listens on the way down
      const d = e.target;
      if (!(d.matches && d.matches('details.pop-wrap') && d.open)) return;
      titleSheet(d.querySelector(':scope > .pop'), d.querySelector(':scope > summary'));
      slideIn(d.querySelector(':scope > .pop') || d);
      pops().forEach((o) => { if (o !== d && !o.contains(d)) shutPop(o); });  // one at a time
    }, true);
    const closePops = (e) => {
      if (e.target.closest && e.target.closest('#selSheet')) return;  // a list over a sheet: the sheet stays
      if (sheets()) {  // phones: the sheet on top closes, unless the tap is in it; the one under it stays
        const top = topSheet();
        if (top && !top.contains(e.target) && !(top.id === 'readBar' && e.target.closest('#btnReadSheet'))) closeSheet(top);
        return;
      }
      if (selFor) closeSelSheet(false);
      if (document.body.classList.contains('read-open') && !e.target.closest('#readBar, #btnReadSheet')) setReadSheet(false);
      pops().forEach((d) => { if (d.open && !d.contains(e.target)) shutPop(d); });
      if (colFilterFor && !e.target.closest('#colFilter, .filt')) closeColFilter(false);
      if (noteMark && !e.target.closest('#notePop, mark.flag, .flag-item')) closeNote();
      if (lineAt && !e.target.closest('#linePop')) closeLine();
    };
    // a sheet's dim (the body's ::after, app.css) closes when the finger lifts, not on the press: the press and the lift
    // are both on the dim, so the click they make goes to the body and nothing under it is pressed. (Not on "click":
    // iPhone Safari sends no click for a tap on the plain body.)
    const onDim = (e) => e.target === document.body && sheets();
    document.addEventListener('pointerdown', (e) => { if (!onDim(e)) closePops(e); });
    placeForPhone();
    window.addEventListener('resize', () => { placeForPhone(); if (!sheets()) { document.body.classList.remove('read-open'); closeSelSheet(false); } });
    initSelSheets();
    initSheetDrag();
    initLinePick();
    $('btnReadSheet').onclick = () => setReadSheet(!document.body.classList.contains('read-open'));
    document.addEventListener('pointerup', (e) => { if (onDim(e)) closePops(e); });

    $('btnPick').onclick = () => $('fileAdd').click();
    $('btnPickBig').onclick = () => $('fileAdd').click();
    const frame = $('photoFrame');  // an empty draft takes photos dropped on the photo area too
    frame.addEventListener('dragover', (e) => { if (!draft || draft.pages.length) return; e.preventDefault(); frame.classList.add('drag'); });
    frame.addEventListener('dragleave', () => frame.classList.remove('drag'));
    frame.addEventListener('drop', (e) => {
      frame.classList.remove('drag');
      if (!draft || draft.pages.length || !e.dataTransfer.files.length) return;
      e.preventDefault(); droppedFiles(e.dataTransfer).then(addFiles);
    });
    document.querySelectorAll('.pane-tabs [role=tab]').forEach((t) => { t.onclick = () => setPane(t.dataset.pane); });
    // the word panel follows its word while the text scrolls, and closes once the word is out of view
    // (and the line panel its line)
    $('editorScroll').addEventListener('scroll', () => {
      const box = $('editorScroll').getBoundingClientRect();
      const gone = (r) => r.bottom < box.top || r.top > box.bottom;
      if (noteMark) { if (gone(noteMark.getBoundingClientRect())) closeNote(); else placeNote(); }
      if (lineAt && pe) {
        const near = lineAt.t.line || lineAt.t.para;
        if (gone(near ? pe.rectOf(near.from, near.to) : pe.rectOf(lineAt.t.at, lineAt.t.at))) closeLine(); else placeLine();
      }
    }, { passive: true });
    window.addEventListener('resize', () => { placeNote(); placeLine(); });
    initSplitters();
    initCollapse();
    initPhotoPan(); initPhotoPinch();
    initSelect();
  }

  // drag the photo to move around it when it is zoomed in or taller than the pane (touch scrolls natively)
  function initPhotoPan() {
    const f = $('photoFrame');
    f.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0 || !f.classList.contains('can-pan') || f.classList.contains('selecting')) return;
      e.preventDefault();
      f.setPointerCapture(e.pointerId); f.classList.add('panning');
      const x0 = e.clientX, y0 = e.clientY, left0 = f.scrollLeft, top0 = f.scrollTop;
      const drag = new AbortController(), signal = drag.signal;
      // relative moves, so this works with right-to-left scroll positions too
      f.addEventListener('pointermove', (ev) => { f.scrollLeft = left0 - (ev.clientX - x0); f.scrollTop = top0 - (ev.clientY - y0); }, { signal });
      const up = () => { drag.abort(); f.classList.remove('panning'); };
      f.addEventListener('pointerup', up, { signal }); f.addEventListener('pointercancel', up, { signal });
    });
  }

  // Touch: two fingers zoom the photo (the zoom slider follows), about the point between them; one finger scrolls.
  // The page itself does not zoom (app.css touch-action; Safari's own gesture is stopped here).
  function initPhotoPinch() {
    const f = $('photoFrame'), z = $('zoom');
    let pinch = null;
    const span = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    f.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2 && !z.disabled && !f.classList.contains('selecting')) pinch = { d0: span(e.touches), z0: +z.value };
    }, { passive: true });
    f.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const next = Math.round(Math.max(+z.min, Math.min(+z.max, pinch.z0 * span(e.touches) / pinch.d0)));
      if (next === +z.value) return;
      const img = $('photoImg'), before = img.getBoundingClientRect(), r = next / +z.value;
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2, my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      z.value = next; applyPhotoTransform();
      // keep the spot between the fingers where it was (relative moves: right-to-left scrolling too)
      const after = img.getBoundingClientRect();
      f.scrollLeft += after.left + (mx - before.left) * r - mx;
      f.scrollTop += after.top + (my - before.top) * r - my;
    }, { passive: false });
    const end = (e) => { if (e.touches.length < 2) pinch = null; };
    f.addEventListener('touchend', end); f.addEventListener('touchcancel', end);
    f.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  // Drag (or arrow keys on) the bars between pages | photo | text and above the flags list.
  // Sizes go into --size-<pane> on the workspace and are remembered per browser.
  function initSplitters() {
    const ws = $('workspace');
    const rtl = getComputedStyle(ws).direction === 'rtl';
    let saved = {};
    try { saved = JSON.parse(store.get('panes') || '{}') || {}; } catch (e) { saved = {}; }
    const apply = (key, px) => { if (px) ws.style.setProperty('--size-' + key, px + 'px'); else ws.style.removeProperty('--size-' + key); };
    const persist = () => store.set('panes', JSON.stringify(saved), true);
    Object.entries(saved).forEach(([k, px]) => apply(k, px));
    ws.querySelectorAll('.splitter').forEach((sp) => {
      const key = sp.dataset.pane, target = $(sp.getAttribute('aria-controls'));
      const across = sp.getAttribute('aria-orientation') === 'vertical';  // vertical bar = resizes a width
      const size = () => { const r = target.getBoundingClientRect(); return across ? r.width : r.height; };
      const limits = () => key === 'pages' ? [140, 380]
        : key === 'photo' ? [260, Math.max(260, ws.clientWidth - $('panePages').offsetWidth - 340)]
        : [90, Math.max(90, $('paneText').clientHeight - 220)];  // flags list height
      const set = (px) => {
        const [lo, hi] = limits(); px = Math.round(Math.min(hi, Math.max(lo, px)));
        apply(key, px); saved[key] = px;
        sp.setAttribute('aria-valuemin', String(lo)); sp.setAttribute('aria-valuemax', String(hi)); sp.setAttribute('aria-valuenow', String(px));
        applyPhotoTransform();
      };
      sp.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); sp.setPointerCapture(e.pointerId);
        sp.classList.add('active'); document.body.classList.add('resizing', across ? 'cols' : 'rows');
        const s0 = size(), x0 = e.clientX, y0 = e.clientY;  // by delta, so the pane never jumps on grab
        // widths grow when the bar moves away from its pane; the flags list grows when its top bar moves up
        const delta = (ev) => across ? (rtl ? x0 - ev.clientX : ev.clientX - x0) : y0 - ev.clientY;
        const drag = new AbortController(), signal = drag.signal;
        const up = () => { drag.abort(); sp.classList.remove('active'); document.body.classList.remove('resizing', 'cols', 'rows'); persist(); };
        sp.addEventListener('pointermove', (ev) => set(s0 + delta(ev)), { signal });
        sp.addEventListener('pointerup', up, { signal }); sp.addEventListener('pointercancel', up, { signal });
      });
      sp.addEventListener('keydown', (e) => {
        const grow = across ? { ArrowLeft: rtl, ArrowRight: !rtl }[e.key] : { ArrowUp: true, ArrowDown: false }[e.key];
        if (grow === undefined) return;
        e.preventDefault(); set(size() + (grow ? 16 : -16)); persist();
      });
      sp.addEventListener('dblclick', () => { apply(key, 0); delete saved[key]; persist(); applyPhotoTransform(); });
    });
    $('flagsPanel').addEventListener('toggle', () => { $('flagSplit').hidden = !$('flagsPanel').open; });
    $('flagSplit').hidden = !$('flagsPanel').open;
  }

  // Wide screens: any pane folds into a thin labelled rail; one pane always stays open.
  const PANES = ['pages', 'photo', 'text'];
  const collapsed = () => ($('workspace').dataset.collapsed || '').split(' ').filter(Boolean);
  function setCollapsed(list) {
    closeNote();
    $('workspace').dataset.collapsed = list.join(' ');
    store.set('collapsed', list.join(' '), true);
    PANES.forEach((p) => {
      const btn = document.querySelector(`.pane-collapse[data-pane="${p}"]`);
      btn.disabled = list.length >= 2 && !list.includes(p);
      btn.title = btn.disabled ? tx('app.everySectionCantFoldedOnce') : btn.getAttribute('aria-label');
    });
    applyPhotoTransform();
  }
  function toggleCollapse(p) {
    const list = collapsed(), folding = !list.includes(p);
    setCollapsed(folding ? [...list, p] : list.filter((x) => x !== p));
    // keep keyboard focus on the same pane: its rail after folding, its fold button after opening
    document.querySelector(`${folding ? '.rail' : '.pane-collapse'}[data-pane="${p}"]`).focus();
  }
  function initCollapse() {
    document.querySelectorAll('.pane-collapse, .rail').forEach((b) => { b.onclick = () => toggleCollapse(b.dataset.pane); });
    setCollapsed((store.get('collapsed') || '').split(' ').filter((p) => PANES.includes(p)).slice(0, 2));
  }

  boot();
})();
