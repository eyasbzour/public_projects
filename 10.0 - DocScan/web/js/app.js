/* DocScan web app: drafts, page reading, review editor, Word export. */
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
  function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), isErr ? 7000 : 3500);
  }
  async function api(path, opts = {}) {
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-json */ }
    if (!res.ok) {
      const err = new Error((data && (data.error || data.detail)) || ('خطأ ' + res.status));
      err.status = res.status; err.data = data; throw err;
    }
    return data;
  }
  // The app's own confirm / message box, in place of the browser's confirm() and alert().
  // Resolves true for OK. A destructive question focuses "إلغاء", so Enter never deletes by accident.
  // OK, Cancel and Esc answer the open question at once. The dialog's "close" event comes a moment
  // later, and would answer the next question instead if one was asked straight after.
  let askAnswer = null;
  function ask(message, { ok = 'متابعة', danger = false, cancel = true } = {}) {
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
  const fmtTime = (s) => new Date(s * 1000).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });
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
  let draft = null;          // the open draft
  let current = 0;           // index of the page being shown
  let dirty = false, saving = false, saveTimer = null;
  const busyPages = new Set();

  // ------------------------------------------------------------------ boot
  // the Windows program checks GitHub for a newer version at start (server/updater.py); a quiet bar offers it
  async function checkUpdate(tries = 4) {
    let st;
    try { st = await api('/api/update'); } catch (e) { return; }  // offline or an older server: nothing to show
    if (!st.checked && tries > 0) { setTimeout(() => checkUpdate(tries - 1), 4000); return; }
    if (!st.update || store.get('skipUpdate') === st.update.version) return;
    $('updateText').textContent = `يتوفر إصدار جديد من البرنامج (${st.update.version}).`;
    $('updateBar').classList.remove('hidden');
    $('updateLater').onclick = () => { $('updateBar').classList.add('hidden'); store.set('skipUpdate', st.update.version); };
    $('btnUpdate').onclick = async () => {
      if (!(await ask(`سيُنزَّل الإصدار ${st.update.version} ويُثبَّت، ثم يُفتح البرنامج من جديد. يُحفظ عملك أولاً.`, { ok: 'تحديث' }))) return;
      if (draft && dirty) await saveDraft();
      $('btnUpdate').disabled = true; $('updateText').textContent = 'جارٍ تنزيل التحديث… سيُغلق البرنامج ويُفتح من جديد.';
      try { await api('/api/update/install', { method: 'POST' }); } catch (e) { toast(e.message, true); $('btnUpdate').disabled = false; }
    };
  }

  async function boot() {
    if (matchMedia('(max-width: 899px)').matches) $('flagsPanel').open = false;  // small screens: give the text the room
    bindStatic();
    try {
      const [eng, tpl, fmt] = await Promise.all([api('/api/engines'), api('/api/templates'), api('/api/formats')]);
      FORMATS = fmt.formats;
      ENGINES = eng.engines; CLAUDE_MODELS = eng.claudeModels;
      TEMPLATES = tpl.templates; TPL_ADMIN = tpl.adminRequired;
    } catch (e) { toast('تعذر الاتصال بالخادم: ' + e.message, true); }
    fillEngineSelect(); fillTemplateSelect(); fillFormats();
    $('newOwner').value = settings.author;
    route();
    setTimeout(() => checkUpdate(), 2500);
    window.addEventListener('hashchange', route);
  }

  function route() {
    const m = location.hash.match(/^#\/d\/([a-f0-9]{32})$/);
    if (m) openDraft(m[1]); else showHome();
  }

  // ------------------------------------------------------------------ home
  async function showHome() {
    if (draft && dirty) await saveDraft();
    destroyEditor();
    draft = null;
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
      box.replaceChildren(el('p', { class: 'muted draft-none' }, 'تعذر تحميل المسودات: ' + e.message,
        el('button', { type: 'button', class: 'btn ghost small', onclick: loadDraftList }, 'أعد المحاولة')));
    }
  }

  // Columns: [key, title, searchable]. A title click sorts (again flips: text أ to ي first, numbers and dates
  // largest/newest first); the funnel beside it, or a double-click on the title, searches that column.
  const DRAFT_COLS = [['name', 'الوثيقة', true], ['owner', 'بواسطة', true], ['pages', 'الصفحات', true], ['updated', 'آخر تعديل', false]];
  // kept for this visit only: a filter left on from an earlier day would look like lost drafts
  const draftFilter = { name: '', owner: '', pages: '' };
  const matchesFilter = (d) => (!draftFilter.name || searchable(d.name).includes(searchable(draftFilter.name)))
    && (!draftFilter.owner || searchable(d.owner).includes(searchable(draftFilter.owner)))
    && (draftFilter.pages === '' || d.pages === Number(draftFilter.pages));
  const pagesText = (n) => (n === 0 ? 'بلا صفحات' : n === 1 ? 'صفحة واحدة' : n === 2 ? 'صفحتان' : n <= 10 ? n + ' صفحات' : n + ' صفحة');
  let sortBeforeClick = null;

  function sortDraftsBy(k, e) {
    if (e.detail > 1) return;  // the second click of a double-click: that opens the search instead
    const [key, dir] = (store.get('draftSort') || 'updated:desc').split(':');
    sortBeforeClick = store.get('draftSort');
    const flip = k === key ? (dir === 'asc' ? 'desc' : 'asc') : (k === 'name' || k === 'owner' ? 'asc' : 'desc');
    store.set('draftSort', k + ':' + flip, true);
    renderDraftList();
  }

  function renderDraftList() {
    const box = $('draftList');
    let table = box.querySelector('table');
    if (!table) {  // the header is built once, so both clicks of a double-click land on the same button
      const head = DRAFT_COLS.map(([k, label, canSearch]) => el('th', { dataset: { k } }, el('div', { class: 'th-in' },
        el('button', { type: 'button', class: 'sort', onclick: (e) => sortDraftsBy(k, e),
          ondblclick: () => { if (!canSearch) return; store.set('draftSort', sortBeforeClick, true); renderDraftList(); openColFilter(k); } }),
        canSearch ? el('button', { type: 'button', class: 'filt btn ghost small icon-only', title: 'ابحث في عمود ' + label,
          'aria-label': 'ابحث في عمود ' + label, 'aria-expanded': 'false',
          onclick: () => (colFilterFor === k ? closeColFilter(true) : openColFilter(k)) }, icon('magnifying-glass')) : null)));
      table = el('table', null, el('thead', null, el('tr', null, head, el('th', null))), el('tbody'));
      box.replaceChildren(table, el('p', { class: 'muted draft-none hidden', id: 'draftNone' }, 'لا توجد مسودة تطابق البحث.',
        el('button', { type: 'button', class: 'btn ghost small', onclick: clearDraftFilters }, 'مسح البحث')));
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
    const cmp = (a, b) => (text ? (a[key] || '').localeCompare(b[key] || '', 'ar') : a[key] - b[key]) * (dir === 'asc' ? 1 : -1);
    const shown = draftItems.filter(matchesFilter).sort(cmp);
    // whole row opens the draft; the name link (keyboard) and the delete button handle their own clicks
    table.tBodies[0].replaceChildren(...shown.map((d) => el('tr', { class: 'open-row',
      onclick: (e) => { if (!e.target.closest('a, button')) location.hash = '#/d/' + d.id; } },
      el('td', null, el('a', { href: '#/d/' + d.id }, d.name || 'بدون اسم'),
        el('span', { class: 'sub' }, [d.owner, pagesText(d.pages)].filter(Boolean).join('، '))),
      el('td', null, d.owner || ''),
      el('td', { class: 'num' }, String(d.pages)),
      el('td', null, fmtTime(d.updated)),
      el('td', { class: 'act' }, iconBtn('trash', 'حذف ' + (d.name || 'المسودة'), () => deleteDraft(d), 'btn ghost small icon-only danger')))));
    $('draftNone').classList.toggle('hidden', shown.length > 0);

    const active = DRAFT_COLS.filter(([k, , s]) => s && draftFilter[k] !== '');
    $('draftCount').textContent = active.length ? `${shown.length} من ${draftItems.length}` : String(draftItems.length);
    $('draftFilters').replaceChildren(...active.map(([k, label]) => el('button', { type: 'button', class: 'chip',
      'aria-label': `إلغاء البحث في ${label}: ${draftFilter[k]}`, onclick: () => setDraftFilter(k, '') }, `${label}: ${draftFilter[k]}`, icon('x'))),
    active.length > 1 ? el('button', { type: 'button', class: 'btn ghost small', onclick: clearDraftFilters }, 'مسح الكل') : '');
    $('draftFilters').classList.toggle('hidden', !active.length);
  }

  function setDraftFilter(k, v) { draftFilter[k] = v.trim(); renderDraftList(); }
  function clearDraftFilters() { for (const k in draftFilter) draftFilter[k] = ''; closeColFilter(false); renderDraftList(); }

  let colFilterFor = null;  // which column's search panel is open
  function openColFilter(k) {
    closeColFilter(false);
    const pop = $('colFilter'), th = $('draftList').querySelector(`th[data-k="${k}"]`);
    colFilterFor = k;
    pop.dataset.col = k;
    for (const inp of pop.querySelectorAll('input')) inp.value = draftFilter[inp.dataset.col];
    pop.classList.remove('hidden');
    // under the header, its right edge on the header's (the page is right to left), kept inside the list
    const area = pop.offsetParent.getBoundingClientRect(), r = th.getBoundingClientRect();
    pop.style.top = (r.bottom - area.top + 4) + 'px';
    pop.style.right = Math.max(0, Math.min(area.right - r.right, area.width - pop.offsetWidth)) + 'px';
    th.querySelector('.filt').setAttribute('aria-expanded', 'true');
    pop.querySelector(`input[data-col="${k}"]`).focus();
  }
  function closeColFilter(refocus) {
    if (!colFilterFor) return;
    const b = $('draftList').querySelector(`th[data-k="${colFilterFor}"] .filt`);
    colFilterFor = null;
    $('colFilter').classList.add('hidden');
    if (b) { b.setAttribute('aria-expanded', 'false'); if (refocus) b.focus(); }
  }

  // Arabic spellings vary (أحمد / احمد, رسالة / رساله, harakat), so both sides are compared in one plain form
  const searchable = (s) => (s || '').toLowerCase().replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

  const firstRun = () => el('div', { class: 'first-run' }, el('h3', null, 'لا توجد مسودات بعد'),
    el('ol', null, [
      ['images', 'أضف صور الصفحات', 'من الهاتف أو واتساب، بالترتيب الصحيح.'],
      ['scan', 'اقرأ النص', 'بمحرك مجاني على الخادم، أو بالذكاء الاصطناعي بمفتاحك.'],
      ['flag', 'راجع وأنتج الملف', 'المواضع غير الواضحة تُظلَّل مع ملاحظة، ثم يخرج الملف بالترويسة.']
    ].map(([ic, t, s]) => el('li', null, icon(ic), el('div', null, el('b', null, t), el('span', { class: 'muted' }, s))))));

  async function deleteDraft(d) {
    if (!(await ask(`حذف المسودة "${d.name}" وصورها نهائياً؟`, { ok: 'حذف', danger: true }))) return;
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
    // straight from another draft (back / forward, a link): save it and close its editor first, as going home
    // does; its editor left open would copy its text into the new draft's first page
    if (draft && dirty) await saveDraft();
    destroyEditor();
    try { draft = await api('/api/drafts/' + id); }
    catch (e) { toast('تعذر فتح المسودة: ' + e.message, true); location.hash = ''; return; }
    dirty = false; current = 0;
    $('viewHome').classList.add('hidden'); $('viewDraft').classList.remove('hidden');
    document.body.classList.add('in-draft');
    $('draftName').value = draft.name || '';
    $('draftDate').value = draft.date || todayISO();
    if (!draft.template && TEMPLATES[0]) draft.template = TEMPLATES[0].id;
    $('templateSel').value = draft.template || '';
    setSaveState();
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

  function markDirty() {
    dirty = true; setSaveState();
    clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 4000);
  }
  function setSaveState(text) {
    const s = $('saveState');
    s.textContent = text || (saving ? 'جارٍ الحفظ…' : dirty ? 'تغييرات غير محفوظة' : 'محفوظ');
    s.classList.toggle('dirty', dirty);
  }

  async function saveDraft() {
    if (!draft || saving) return;
    clearTimeout(saveTimer);
    syncEditor();
    saving = true; setSaveState();
    try {
      const r = await api('/api/drafts/' + draft.id, jsonOpts('PUT', draft));
      draft.version = r.version; draft.updated = r.updated; dirty = false;
    } catch (e) {
      if (e.status === 409) toast('عدّل شخص آخر هذه المسودة في نفس الوقت. انسخ تعديلاتك ثم أعد فتحها.', true);
      else toast('تعذر الحفظ: ' + e.message, true);
    } finally { saving = false; setSaveState(); }
  }

  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ------------------------------------------------------------------ pages
  function renderPages() {
    updateStage();
    const list = $('pageList');
    list.replaceChildren(...draft.pages.map((p, i) => {
      const flags = countFlags(p.blocks);
      const [stCls, stIcon, stText] = busyPages.has(p.id) ? ['busy', 'circle-notch', 'جارٍ القراءة']
        : p.blocks ? ['read', 'check-circle', 'مقروءة'] : ['', 'circle', 'لم تُقرأ'];
      return el('li', { class: 'page-item' + (i === current ? ' active' : ''), draggable: 'true', title: p.file || '', tabindex: '0',
          'aria-current': i === current ? 'true' : null, 'aria-label': `صفحة ${i + 1}، ${stText}` + (flags ? `، ${flags} مواضع معلَّمة` : ''),
          onclick: () => showPage(i), ondblclick: () => editImage(i),
          onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); showPage(i); } },
          ondragstart: (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-page', String(i)); },
          ondragover: (e) => { if (dragFrom != null) { e.preventDefault(); e.currentTarget.classList.add('drop-target'); } },
          ondragleave: (e) => e.currentTarget.classList.remove('drop-target'),
          ondrop: (e) => { if (dragFrom == null) return; e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('drop-target'); movePageTo(dragFrom, i); dragFrom = null; },
          ondragend: () => { dragFrom = null; } },
        el('div', { class: 'thumb' }, el('img', { src: imgUrl(p), alt: 'صفحة ' + (i + 1), loading: 'lazy', draggable: 'false',
          class: (p.rotation || 0) % 180 ? 'sideways' : '', style: `transform: rotate(${p.rotation || 0}deg)` })),
        el('div', { class: 'page-meta' },
          el('span', { class: 'num' }, String(i + 1)),
          el('span', { class: 'state ' + stCls }, icon(stIcon), stText),
          flags ? el('span', { class: 'pill', title: 'مواضع معلَّمة' }, String(flags)) : null),
        el('div', { class: 'page-actions' },
          iconBtn('pencil-simple', 'تحرير الصورة', () => editImage(i)),
          iconBtn('arrow-clockwise', 'تدوير', () => rotatePage(i, 90)),
          iconBtn('caret-up', 'نقل لأعلى', () => movePage(i, -1)),
          iconBtn('caret-down', 'نقل لأسفل', () => movePage(i, 1)),
          iconBtn('trash', 'حذف الصفحة', () => removePage(i), 'danger')));
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
    syncEditor();
    let added = 0;
    for (const it of items) {
      const fd = new FormData(); fd.append('file', it.f);
      try {
        const r = await api(`/api/drafts/${draft.id}/images`, { method: 'POST', body: fd });
        draft.pages.push({ id: uid(), image: r.name, file: it.file, fileTime: it.fileTime, rotation: 0, blocks: null, versions: [] });
        added++; renderPages();
      } catch (e) { toast(`تعذر رفع ${it.file}: ${e.message}`, true); }
    }
    if (added) { markDirty(); if (draft.pages.length === added) showPage(0); }
    return added;
  }

  async function resortPages() {
    if (orderMode() === 'picked') { toast('اختر طريقة ترتيب أولاً.'); return; }
    if (!(await ask('إعادة ترتيب كل الصفحات حسب الطريقة المختارة؟', { ok: 'رتّب' }))) return;
    syncEditor();
    const cur = draft.pages[current];
    const cmp = ORDERERS[orderMode()];
    draft.pages = draft.pages.map((p, k) => ({ p, k })).sort((a, b) => cmp(a.p, b.p) || a.k - b.k).map((x) => x.p);
    current = Math.max(0, draft.pages.indexOf(cur));
    renderPages(); showPage(current); markDirty();
  }

  function rotatePage(i, delta) {
    const p = draft.pages[i]; if (!p) return;
    p.rotation = ((p.rotation || 0) + delta + 360) % 360;
    renderPages(); markDirty();
    if (i === current) applyPhotoTransform();
    if (p.blocks) toast('دُوِّرت الصورة. أعد قراءة الصفحة إذا كانت القراءة السابقة سيئة.');
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
    renderPages(); if (i === current) showPage(i); markDirty();
    toast(draft.pages[i].blocks ? 'حُفظت الصورة. أعد قراءة الصفحة لتستفيد من التعديل.' : 'حُفظت الصورة.');
  }

  // drag a page thumbnail onto another to move it there
  let dragFrom = null;
  function movePageTo(from, to) {
    if (from === to || from == null || to == null) return;
    syncEditor();
    const cur = draft.pages[current];
    const [p] = draft.pages.splice(from, 1);
    draft.pages.splice(to, 0, p);
    current = draft.pages.indexOf(cur);
    renderPages(); markDirty();
  }

  function movePage(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= draft.pages.length) return;
    syncEditor();
    [draft.pages[i], draft.pages[j]] = [draft.pages[j], draft.pages[i]];
    if (current === i) current = j; else if (current === j) current = i;
    renderPages(); markDirty();
  }

  async function removePage(i) {
    if (!(await ask(`حذف الصفحة ${i + 1} من المسودة؟`, { ok: 'حذف', danger: true }))) return;
    syncEditor();
    draft.pages.splice(i, 1);
    if (current >= draft.pages.length) current = Math.max(0, draft.pages.length - 1);
    renderPages(); showPage(current); markDirty();
  }

  function showPage(i) {
    syncEditor();
    if (i !== current) suggestions.clear();  // second readings belong to their page
    current = i;
    const p = draft.pages[i];
    document.querySelectorAll('.page-item').forEach((n, k) => {
      n.classList.toggle('active', k === i);
      if (k === i) n.setAttribute('aria-current', 'true'); else n.removeAttribute('aria-current');
    });
    if (!p) {
      $('photoImg').removeAttribute('src'); $('photoLabel').textContent = '';
      destroyEditor();
      $('editor').replaceChildren(el('div', { class: 'empty-hint' }, 'أضف صور الصفحات أولاً، ثم اقرأها لتظهر هنا.'));
      renderFlags(); fillVersions(); updateReadState(); if (toolbar) toolbar.update(); return;  // also clears the last draft's status
    }
    $('photoImg').src = imgUrl(p);
    // the file name in its own direction box, and what follows its last Arabic word ("1.jpg") left to right,
    // so "تقرير 1.jpg" does not show as "jpg.1 تقرير"
    const name = p.file && p.file.replace(/[^\u0600-\u06FF\s][^\u0600-\u06FF]*$/, (tail) => '\u2066' + tail + '\u2069');
    $('photoLabel').replaceChildren(`صفحة ${i + 1} من ${draft.pages.length}`, ...(name ? [' · ', el('bdi', {}, name)] : []));
    applyPhotoTransform();
    renderEditor(); fillVersions(); updateReadState();
  }

  function applyPhotoTransform() {
    const p = draft && draft.pages[current]; if (!p) return;
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
    const fitted = () => { fit(); frame.classList.toggle('can-pan', frame.scrollWidth > frame.clientWidth + 1 || frame.scrollHeight > frame.clientHeight + 1); };
    if (img.complete && img.naturalWidth) fitted(); else img.onload = fitted;
  }

  function rotate(delta) { rotatePage(current, delta); }

  // ------------------------------------------------------------------ engines & reading
  function fillEngineSelect() {
    const sel = $('engineSel');
    const groups = { free: el('optgroup', { label: 'مجاني (على الخادم)' }), ai: el('optgroup', { label: 'ذكاء اصطناعي (يحتاج مفتاحاً)' }) };
    for (const e of ENGINES) {
      groups[e.group].append(el('option', { value: e.id, disabled: !e.available, title: e.reason || '' },
        e.label + (e.available ? '' : ' (غير متاح)')));
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
    $('cleanupWrap').classList.toggle('hidden', !id.startsWith('tess-'));  // the server only cleans up for Tesseract
    $('langsWrap').classList.toggle('hidden', !id.startsWith('tess-'));
    $('modelWrap').classList.toggle('hidden', id !== 'claude');
    $('skipWrap').classList.toggle('hidden', id !== 'claude');
    // every reader has the page direction now; Tesseract also its clean-up and language
  }
  const engineLabel = (id) => (ENGINES.find((e) => e.id === id) || {}).label || id;

  function keyFor(engineId) {
    const e = ENGINES.find((x) => x.id === engineId);
    if (!e || !e.key) return '';
    return e.key === 'claude' ? settings.claudeKey : settings.googleKey;
  }

  async function readPage(i, opts = {}) {
    const p = draft.pages[i]; if (!p || busyPages.has(p.id)) return false;
    const engine = opts.engine || $('engineSel').value;
    const e = ENGINES.find((x) => x.id === engine);
    if (!e || !e.available) { toast('هذا المحرك غير متاح على الخادم.', true); return false; }
    const key = keyFor(engine);
    if (e.key && !key && !e.serverKey) {
      toast(e.key === 'claude' ? 'أدخل مفتاح Claude في الإعدادات أولاً.' : 'أدخل مفتاح Google Vision في الإعدادات أولاً.', true);
      $('dlgSettings').showModal(); return false;
    }
    if (i === current) syncEditor();
    if (p.blocks && hasEdits(p) && !opts.silent &&
        !(await ask('للصفحة نص سابق. ستُعرض القراءة الجديدة بدلاً منه، ويبقى النص السابق في قائمة "النسخ" لتعود إليه.', { ok: 'اقرأ من جديد' }))) return false;
    const fd = new FormData();
    fd.append('draft_id', draft.id); fd.append('image', p.image); fd.append('engine', engine);
    fd.append('rotation', String(p.rotation || 0)); fd.append('cleanup', $('cleanupSel').value);
    fd.append('model', $('modelSel').value); fd.append('skip_letterhead', $('skipLetterhead').checked ? 'true' : 'false');
    fd.append('langs', $('langsSel').value); fd.append('direction', $('dirSel').value);
    if (key) fd.append('api_key', key);
    busyPages.add(p.id); renderPages(); updateReadState();
    try {
      const r = await api('/api/ocr', { method: 'POST', body: fd });
      if (p.blocks) pushVersion(p, p.readWith ? engineLabel(p.readWith) + ' (بعد التعديل)' : 'نسخة سابقة', p.blocks);
      pushVersion(p, engineLabel(engine), r.blocks);
      p.blocks = clone(r.blocks); p.readWith = engine; p.readImage = p.image; p.readRot = p.rotation || 0;
      busyPages.delete(p.id);
      if (i === current) { renderEditor(); fillVersions(); }
      markDirty(); renderPages(); updateReadState(`تمت القراءة في ${r.seconds} ث`);
      return true;
    } catch (err) {
      busyPages.delete(p.id); renderPages(); updateReadState();
      toast(`صفحة ${i + 1}: ${err.message}`, true);
      return false;
    }
  }

  async function readAllUnread() {
    const todo = draft.pages.map((p, i) => i).filter((i) => !draft.pages[i].blocks);
    if (!todo.length) { toast('كل الصفحات مقروءة.'); return true; }
    let ok = true;
    for (const i of todo) {
      updateReadState(`جارٍ قراءة صفحة ${i + 1}…`);
      ok = (await readPage(i, { silent: true })) && ok;
    }
    updateReadState();
    return ok;
  }

  // add photos -> read -> produce: only the next step is the green button; tools that need a page wait for one
  function updateStage() {
    if (!draft) return;
    const pages = draft.pages.length, p = draft.pages[current];
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
    const p = draft && draft.pages[current];
    const busy = p && busyPages.has(p.id);
    updateStage();
    $('btnRead').disabled = !p || busy;
    $('readState').textContent = text || (busy ? 'جارٍ القراءة…' : p && p.readWith ? 'قُرئت بـ ' + engineLabel(p.readWith) : '');
  }

  function pushVersion(p, label, blocks) {
    p.versions = p.versions || [];
    p.versions.unshift({ id: uid(), label, at: Date.now() / 1000, blocks: clone(blocks) });
    p.versions = p.versions.slice(0, 8);
  }
  function hasEdits(p) { return p.blocks && p.blocks.length; }
  const clone = (x) => JSON.parse(JSON.stringify(x));

  function fillVersions() {
    const p = draft && draft.pages[current];
    const vs = (p && p.versions) || [];
    $('verList').replaceChildren(...(vs.length ? vs.map((v) => el('li', null,
      el('span', null, v.label, el('small', { class: 'muted' }, fmtTime(v.at))),
      el('span', { class: 'ver-acts' },
        el('button', { type: 'button', class: 'btn ghost small', onclick: () => useVersion(v) }, 'استخدام'),
        iconBtn('trash', 'حذف هذه النسخة', () => deleteVersion(v), 'btn ghost small icon-only danger'))))
      : [el('li', { class: 'muted' }, 'لا توجد نسخ سابقة لهذه الصفحة.')]));
  }
  async function deleteVersion(v) {
    const p = draft.pages[current];
    if (!(await ask(`حذف النسخة "${v.label}"؟ لا يمكن التراجع عن ذلك.`, { ok: 'حذف', danger: true }))) return;
    p.versions = (p.versions || []).filter((x) => x.id !== v.id);
    fillVersions(); markDirty();
  }
  async function useVersion(v) {
    const p = draft.pages[current];
    $('verPop').open = false;
    if (!(await ask('سيحل نص هذه النسخة محل النص الحالي في المحرر، ويُحفظ الحالي كنسخة.', { ok: 'استخدم النسخة' }))) return;
    syncEditor();
    pushVersion(p, 'قبل الاسترجاع', p.blocks || []);
    p.blocks = clone(v.blocks); renderEditor(); fillVersions(); markDirty();
  }

  // ------------------------------------------------------------------ a second opinion on spots of the page
  // Flagged words and paragraphs remember where they sit on the photo that was read; another engine can read
  // just those spots again (/api/ocr-spots).
  const engineChoices = () => {
    const p = draft && draft.pages[current];
    const usable = ENGINES.filter((e) => e.available);
    const pick = (usable.find((e) => p && e.id !== p.readWith && e.group === 'free') || usable[0] || {}).id;
    return usable.map((e) => [e.id, e.label, e.id === pick]);
  };
  function fillEngineChoices(sel) {
    sel.replaceChildren(...engineChoices().map(([id, label, on]) => el('option', { value: id, selected: on }, label)));
  }
  async function readSpots(engine, boxes) {
    const p = draft.pages[current];
    if (!p || p.readImage !== p.image) throw new Error('تغيّرت صورة الصفحة بعد قراءتها؛ اقرأ الصفحة من جديد أولاً.');
    const key = keyFor(engine), e = ENGINES.find((x) => x.id === engine) || {};
    if (e.key && !key && !e.serverKey) throw new Error('أدخل مفتاح هذا القارئ في الإعدادات أولاً.');
    const fd = new FormData();
    fd.append('draft_id', draft.id); fd.append('image', p.readImage); fd.append('engine', engine);
    fd.append('boxes', JSON.stringify(boxes)); fd.append('rotation', String(p.readRot || 0));
    fd.append('cleanup', $('cleanupSel').value); fd.append('langs', $('langsSel').value); fd.append('model', $('modelSel').value);
    if (key) fd.append('api_key', key);
    return (await api('/api/ocr-spots', { method: 'POST', body: fd })).results;
  }
  const markBox = (m) => (m && m.dataset.box ? m.dataset.box.split(',').map(Number) : null);

  // ------------------------------------------------------------------ editor (web/js/editor.js)
  let pe = null;        // the current page's editor
  let toolbar = null;   // the formatting toolbar, working on pe
  let flagTimer = 0;
  function destroyEditor() {
    if (pe) { pe.destroy(); pe = null; }
    closeNote(); closeLine();
  }
  function renderEditor() {
    const p = draft.pages[current];
    destroyEditor();
    const host = $('editor');
    host.replaceChildren();
    if (!p.blocks) {
      host.append(el('div', { class: 'empty-hint' }, 'لم تُقرأ هذه الصفحة بعد. اختر المحرك واضغط "اقرأ الصفحة"، أو ',
        el('button', { type: 'button', class: 'btn small', onclick: () => { p.blocks = []; markDirty(); renderEditor(); if (pe) pe.chain().run(); } }, 'ابدأ الكتابة')));
    } else {
      pe = window.DocEditor.mount(host, p.blocks, {
        src: (name) => `/api/drafts/${draft.id}/images/${name}`,
        onChange: () => {
          markDirty(); closeLine();  // its line may have moved or changed
          clearTimeout(flagTimer);
          flagTimer = setTimeout(() => { syncEditor(); renderFlags(); renderPages(); }, 250);
        },
        onState: () => { if (toolbar) toolbar.update(); },
        onPasteImage: pasteIntoText,
      });
    }
    renderFlags();
    if (toolbar) toolbar.update();
  }

  /** Copy the editor's text back into the current page's blocks. */
  function syncEditor() {
    if (!draft || !pe) return;
    const p = draft.pages[current];
    if (p && p.blocks) p.blocks = pe.getBlocks();
  }

  // ------------------------------------------------------------------ flags / notes
  function countFlags(blocks) {
    let n = 0;
    for (const b of blocks || []) {
      if (b.type === 'table') (b.rows || []).forEach((r) => r.forEach((c) => (c || []).forEach((s) => { if (s.note != null) n++; })));
      else (b.segs || []).forEach((s) => { if (s.note != null) n++; });
    }
    return n;
  }

  // "قراءة غير مؤكدة (درجة الثقة 22%)، قارن مع الصورة الأصلية" said the same long sentence under every word
  const shortNote = (note) => {
    const m = /غير مؤكدة \(درجة الثقة (\d+)%\)/.exec(note || '');
    return m ? `غير مؤكدة، ${m[1]}%` : note || 'بلا ملاحظة';
  };

  // second readings of flagged spots, by their photo box: { engine, text }
  const suggestions = new Map();
  function renderFlags() {
    const marks = [...document.querySelectorAll('#editor mark.flag')];
    $('flagCount').textContent = String(marks.length);
    const p = draft && draft.pages[current];
    const readable = marks.filter((m) => markBox(m));
    $('flagTools').classList.toggle('hidden', !readable.length || !p || p.readImage !== p.image);
    if (readable.length && !$('flagEngine').options.length) fillEngineChoices($('flagEngine'));
    let pending = 0;
    $('flagList').replaceChildren(...(marks.length ? marks.map((m) => {
      const s = suggestions.get(String(markBox(m)));
      if (s && s.text && s.text !== m.textContent) pending++;
      return el('li', null,
        el('button', { type: 'button', class: 'flag-item', title: m.dataset.note || '', onclick: () => { m.scrollIntoView({ block: 'center' }); openNote(m); } },
          el('b', null, (m.textContent || '').slice(0, 60) || '(بدون نص)'), el('span', { class: 'why' }, shortNote(m.dataset.note))),
        s && s.text && s.text !== m.textContent ? el('div', { class: 'flag-suggest' },
          el('span', null, `${engineLabel(s.engine)}: «${s.text}»`),
          el('button', { type: 'button', class: 'btn ghost small', onclick: () => useSuggestion(m, s) }, 'استخدام')) : null);
    }) : [el('li', { class: 'flags-empty' }, 'لا مواضع معلَّمة في هذه الصفحة. حدد نصاً واضغط "تعليم" لإضافة واحد.')]));
    $('flagUseAll').classList.toggle('hidden', pending < 2);
  }
  // a second reading replaces the flagged text; the flag stays until the reviewer removes it
  function useSuggestion(m, s) {
    if (!pe || !s.text) return;
    pe.replaceFlag(m, s.text, {});
    syncEditor(); renderFlags(); renderPages(); markDirty();
  }
  function useAllSuggestions() {
    if (!pe) return;
    const items = [...document.querySelectorAll('#editor mark.flag')].map((m) => ({ el: m, s: suggestions.get(String(markBox(m))) }))
      .filter((x) => x.s && x.s.text && x.s.text !== x.el.textContent).map((x) => ({ el: x.el, text: x.s.text }));
    pe.replaceFlags(items);
    syncEditor(); renderFlags(); renderPages(); markDirty();
  }
  async function rereadFlags() {
    const marks = [...document.querySelectorAll('#editor mark.flag')].filter((m) => markBox(m));
    if (!marks.length) return;
    const engine = $('flagEngine').value, btn = $('flagReread');
    btn.disabled = true; updateReadState(`جارٍ قراءة ${marks.length} موضعاً بـ ${engineLabel(engine)}…`);
    try {
      const res = await readSpots(engine, marks.map(markBox));
      res.forEach((r, i) => suggestions.set(String(markBox(marks[i])), { engine, text: r.text }));
      renderFlags();
      updateReadState(`قُرئت المواضع بـ ${engineLabel(engine)}: الاقتراحات تحت كل موضع`);
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
    $('noteStatus').textContent = note ? shortNote(note) + (shortNote(note) !== note ? '. قارنها بالصورة أدناه' : '') : 'لا ملاحظة بعد';
    $('noteStatus').title = note;
    $('noteText').value = note;
    $('noteWord').value = mark.textContent;
    setNoteEditing(!!editNote || !note);
    const pop = $('notePop');
    const p = draft.pages[current];
    const canRead = !!(markBox(mark) && p && p.readImage === p.image);
    $('noteReread').classList.toggle('hidden', !canRead);
    $('noteSuggest').classList.add('hidden');
    if (canRead) fillEngineChoices($('noteEngine'));
    const known = suggestions.get(String(markBox(mark)));
    if (known) showSuggestion(known);
    pop.classList.remove('hidden');
    placeNote();
    showCrop(mark);  // async; the panel is placed again once the picture has a size
    const f = editNote || !note ? $('noteText') : $('noteWord'); f.focus(); f.select();
  }
  function placeNote() {
    if (!noteMark) return;
    const pop = $('notePop'), r = noteMark.getBoundingClientRect();
    const below = r.bottom + 8, fits = below + pop.offsetHeight < window.innerHeight - 10;
    pop.style.top = Math.max(10, fits ? below : r.top - pop.offsetHeight - 8) + 'px';
    pop.style.left = Math.max(10, Math.min(window.innerWidth - pop.offsetWidth - 10, r.left)) + 'px';
  }
  function setNoteEditing(on) { $('noteText').classList.toggle('hidden', !on); }
  function showSuggestion(s) {
    const b = $('noteSuggest');
    b.dataset.text = s.text;
    b.textContent = `${engineLabel(s.engine)} قرأها: «${s.text || 'بلا نص'}». اضغط لوضعها في الحقل`;
    b.disabled = !s.text;
    b.classList.remove('hidden');
    placeNote();
  }
  async function rereadNote() {
    const mark = noteMark, engine = $('noteEngine').value;
    $('noteReadBtn').disabled = true;
    try {
      const [r] = await readSpots(engine, [markBox(mark)]);
      const s = { engine, text: r.text };
      suggestions.set(String(markBox(mark)), s);
      if (noteMark === mark) showSuggestion(s);
      renderFlags();
    } catch (e) { toast(e.message, true); }
    $('noteReadBtn').disabled = false;
  }
  function closeNote() {
    $('notePop').classList.add('hidden');
    if (noteMark) noteMark.classList.remove('focus');
    noteMark = null;
  }
  // unflag: the word is checked, keep the (edited) text and remove the highlight and note
  function saveNote(unflag) {
    if (!noteMark || !pe) return;
    const text = $('noteWord').value.replace(/\s+/g, ' ').trim();  // an emptied word is deleted
    const note = $('noteText').classList.contains('hidden') ? null : ($('noteText').value.trim() || 'راجع هذا الموضع');
    pe.replaceFlag(noteMark, text, { unflag, note });
    closeNote(); syncEditor(); renderFlags(); renderPages(); markDirty();
    pe.focus();  // back in the text, so Ctrl+Z undoes it
  }

  // a spot of the page photo (a flagged word, a line, a paragraph), when the reading recorded it (free
  // engines) and the photo is still the one that was read. lineH: the height of one photo line there (a
  // fraction of the page); with it the text is drawn big enough to read, and wider than the panel scrolls.
  let cropSrc = { key: '', canvas: null };
  async function drawCrop(cv, box, still, lineH) {
    cv.classList.add('hidden');
    const p = draft.pages[current];
    if (!box || !p || p.readImage !== p.image) return false;
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
  // the click preview can be turned off from the toolbar (remembered on this computer)
  const previewOn = () => store.get('linePreview') !== 'off';
  function togglePreview() {
    const on = !previewOn();
    store.set('linePreview', on ? '' : 'off', true);
    if (!on) closeLine();
    toast(on ? 'تظهر صورة السطر عند النقر في النص.' : 'أُوقفت معاينة السطر عند النقر. زر "أعد القراءة" يعرضه متى شئت.');
  }
  function openLine(asked, pos) {
    const t = pe && pe.readTarget(pos), p = draft && draft.pages[current];
    const stale = !p || p.readImage !== p.image;
    if (!t || (!asked && (!t.box || stale))) { closeLine(); return; }
    closeNote();
    const why = !t.box ? 'لا يُعرف موضع هذا النص في الصورة: قُرئت الصفحة قبل هذه الميزة، أو بقارئ ذكاء اصطناعي، أو كُتب النص يدوياً. أعد قراءة الصفحة بقارئ مجاني ليظهر موضعه.'
      : stale ? 'تغيّرت صورة الصفحة بعد قراءتها. اقرأ الصفحة من جديد ليظهر موضع النص.' : '';
    const can = ['line', 'para', 'row'].filter((k) => t[k]);
    lineAt = { t, which: can.includes(lineWhich) ? lineWhich : t.line ? 'line' : 'para', result: null };
    $('lineWhy').textContent = why;
    $('lineWhy').classList.toggle('hidden', !why);
    $('lineBody').classList.toggle('hidden', !!why);
    $('lineWhich').classList.toggle('hidden', !!why || can.length < 2);
    $('linePickLine').classList.toggle('hidden', !t.line);
    $('linePickRow').classList.toggle('hidden', !t.row);
    $('linePickPara').textContent = t.cell ? 'الخلية' : 'الفقرة';
    $('linePop').classList.remove('hidden');
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
    $('linePickLine').textContent = at.t.line && at.t.line.count > 1 ? `الأسطر (${at.t.line.count})` : 'السطر';
    for (const k of ['line', 'para', 'row']) $('linePick' + k[0].toUpperCase() + k.slice(1)).setAttribute('aria-pressed', String(at.which === k));
    $('lineResult').classList.add('hidden');
    at.result = null;
    const wrap = $('lineCrop').parentElement;
    wrap.dir = at.t.ltr ? 'ltr' : 'rtl';  // scrolled to where the line starts
    wrap.classList.remove('hidden');      // its width sizes the picture
    drawCrop($('lineCrop'), tg.box, () => lineAt === at && at.t[at.which] === tg, tg.lineH).then((ok) => {
      wrap.classList.toggle('hidden', !ok);
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
    const below = r.bottom + 8, fits = below + h < window.innerHeight - 10;
    pop.style.top = Math.max(10, fits ? below : r.top - h - 8) + 'px';
    pop.style.left = Math.max(10, Math.min(window.innerWidth - w - 10, r.right - w)) + 'px';
  }
  async function rereadLine() {
    const at = lineAt; if (!at) return;
    const tg = at.t[at.which], engine = $('lineEngine').value, btn = $('lineReadBtn');
    btn.disabled = true; $('lineUse').disabled = true;
    $('lineText').textContent = `جارٍ القراءة بـ ${engineLabel(engine)}…`;
    $('lineResult').classList.remove('hidden'); placeLine();
    try {
      const [r] = await readSpots(engine, [tg.box]);
      if (lineAt !== at || at.t[at.which] !== tg) return;  // closed, or switched to the other one meanwhile
      at.result = { tg, segs: r.segs || [], text: (r.text || '').trim() };
      const same = at.result.text === tg.text.trim();
      $('lineText').textContent = at.result.text ? `${engineLabel(engine)}: «${at.result.text}»${same ? ' (مطابق للنص الحالي)' : ''}` : `لم يقرأ ${engineLabel(engine)} نصاً هنا.`;
      if (tg.readOnly && at.result.text) $('lineText').textContent += ' قراءة الصف للمقارنة فقط؛ اقرأ الخلية نفسها لتستبدلها.';
      $('lineUse').textContent = at.which === 'para' ? (at.t.cell ? 'استبدال الخلية' : 'استبدال الفقرة') : tg.count > 1 ? 'استبدال الأسطر' : 'استبدال السطر';
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
    if (!pe.replaceRange(r.tg.from, r.tg.to, r.tg.text, r.segs)) { toast('تغيّر النص منذ القراءة. اقرأه من جديد.', true); return; }
    closeLine(); syncEditor(); renderFlags(); renderPages(); markDirty();
    pe.focus();
  }
  function closeLine() {
    lineAt = null;
    $('linePop').classList.add('hidden');
  }

  // a picture on the clipboard pasted into the text goes in as a picture of the document, after the line
  // the cursor is in; pasted anywhere else in a draft, it is a new page
  async function pasteIntoText(files) {
    for (const f of files) {
      const fd = new FormData(); fd.append('file', f, f.name || 'pasted.png');
      try {
        const r = await api(`/api/drafts/${draft.id}/images`, { method: 'POST', body: fd });
        if (!pe) return;
        // a screenshot about 1000 px wide fills the page width; a small one stays small
        pe.insertBlock({ type: 'figure', attrs: { image: r.name, w: r.width, h: r.height, wFrac: +Math.max(0.1, Math.min(1, r.width / 1000)).toFixed(3), align: null } });
      } catch (e) { toast(`تعذر لصق الصورة: ${e.message}`, true); return; }
    }
    toast(files.length > 1 ? 'أُلصقت الصور في النص.' : 'أُلصقت الصورة في النص. اضغطها لتغيير محاذاتها أو حذفها.');
  }
  function pastePages(e) {
    if (!draft || !document.body.classList.contains('in-draft')) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
    const d = e.clipboardData;
    if (!d || (d.getData('text/plain') || '').trim()) return;
    const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    const files = [...(d.files || [])].filter((f) => f.type.startsWith('image/'))
      .map((f, k) => new File([f], `ملصقة-${stamp}${k ? '-' + (k + 1) : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type, lastModified: Date.now() }));
    if (!files.length) return;
    e.preventDefault();
    addFiles(files).then((n) => { if (n) toast(n > 1 ? `أُضيفت ${n} صفحات من الحافظة.` : 'أُضيفت الصورة صفحةً جديدة.'); });
  }

  // pick an area of the page photo (logo, chart, signature) and put it after the block the cursor is in
  function insertPicture() {
    const p = draft.pages[current];
    if (!p) { toast('أضف صورة الصفحة أولاً.', true); return; }
    window.ImageEditor.open({
      src: imgUrl(p), rotation: p.rotation || 0, pick: true,
      onSave: async (blob, crop) => {
        const fd = new FormData(); fd.append('file', blob, 'figure.jpg');
        const r = await api(`/api/drafts/${draft.id}/images`, { method: 'POST', body: fd });
        if (!pe) { p.blocks = p.blocks || []; renderEditor(); }
        pe.insertBlock({ type: 'figure', attrs: { image: r.name, w: r.width, h: r.height, wFrac: +crop.w.toFixed(3), align: null } });
        toast('أُدرجت الصورة. اضغطها لتغيير محاذاتها أو حذفها.');
      }
    });
  }
  function flagSelection() {
    const m = pe && pe.flagSelection('');
    if (!m) { toast('حدد نصاً في المحرر أولاً.'); return; }
    syncEditor(); renderFlags(); markDirty(); openNote(m, true);
  }

  // ------------------------------------------------------------------ export
  async function exportWord(quick) {
    if (!draft.pages.length) { toast('أضف صور الصفحات أولاً.', true); return; }
    syncEditor();
    if (quick) {
      $('btnQuick').disabled = true;
      try { await readAllUnread(); } finally { $('btnQuick').disabled = false; }
    }
    const unread = draft.pages.filter((p) => !p.blocks).length;
    if (unread && !quick && !(await ask(`${unread} صفحة لم تُقرأ بعد وستكون فارغة في الملف.`, { ok: 'أنتج الملف' }))) return;
    const tplId = $('templateSel').value;
    if (!tplId) { toast('لا يوجد قالب ترويسة. أضف قالباً من الإعدادات.', true); return; }
    try {
      const fmt = $('formatSel').value || 'docx';
      const bytes = await (await fetch(`/api/templates/${tplId}/file`)).arrayBuffer();
      const out = await window.DocxExport.build(bytes, { pages: draft.pages.map((p) => ({ blocks: p.blocks || [] })) }, {
        JSZip: window.JSZip, date: isoToDMY($('draftDate').value), author: settings.author || draft.owner || 'مراجع',
        highlight: $('optHighlight').checked, pageBreaks: $('optPageBreaks').checked, fontSize: docFontSize(),
        headingSize: docFontSize() + 2, fontName: $('optFontName').value.trim(),
        // PDF and images cannot show Word comments, so notes print as numbered footnotes under the page
        notesAs: ['pdf', 'png', 'txt'].includes(fmt) && $('optMargin').checked ? 'footnotes' : 'comments',
        fetchImage: async (name) => new Uint8Array(await (await fetch(`/api/drafts/${draft.id}/images/${name}`)).arrayBuffer())
      });
      const name = (draft.name || 'وثيقة').replace(/[\\/:*?"<>|]+/g, '-');
      const docxBlob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      if (fmt === 'docx') {
        download(docxBlob, name + '.docx');
      } else {
        toast('جارٍ التحويل…');
        const fd = new FormData();
        fd.append('file', docxBlob, 'document.docx'); fd.append('format', fmt); fd.append('name', name);
        const res = await fetch('/api/convert', { method: 'POST', body: fd });
        if (!res.ok) { let m = 'خطأ ' + res.status; try { m = (await res.json()).error || m; } catch (e) { /* */ } throw new Error(m); }
        download(await res.blob(), filenameFrom(res, name + '.' + fmt));
      }
      const flags = draft.pages.reduce((n, p) => n + countFlags(p.blocks), 0);
      toast(flags ? `تم إنتاج الملف، وفيه ${flags} موضعاً مظللاً مع ملاحظات للمراجعة.` : 'تم إنتاج الملف.');
      if (dirty) saveDraft();
    } catch (e) { toast('تعذر إنتاج الملف: ' + e.message, true); }
  }

  function fillFormats() {
    const sel = $('formatSel');
    if (FORMATS.length) sel.replaceChildren(...FORMATS.map((f) => el('option', { value: f.id, disabled: !f.available, title: f.available ? '' : 'غير متاح على الخادم' },
      f.label + (f.available ? '' : ' (غير متاح)'))));
    const saved = store.get('format');
    if (saved && FORMATS.some((f) => f.id === saved && f.available)) sel.value = saved;
  }

  function download(blob, filename) {
    const a = el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function filenameFrom(res, fallback) {
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
    return m ? decodeURIComponent(m[1]) : fallback;
  }

  // ------------------------------------------------------------------ templates & settings
  // the document's base text size in points (any size the user types; 14 when empty or out of range)
  const docFontSize = () => { const n = parseFloat($('optFont').value); return n >= 6 && n <= 72 ? n : 14; };

  function fillTemplateSelect() {
    $('templateSel').replaceChildren(...TEMPLATES.map((t) => el('option', { value: t.id }, t.name)),
      el('option', { value: '__add' }, '+ إضافة قالب جديد…'));
    if (draft) $('templateSel').value = draft.template || '';
    $('tplList').replaceChildren(...TEMPLATES.map((t) => el('li', null, t.name,
      el('button', { type: 'button', class: 'btn ghost small danger', onclick: () => deleteTemplate(t) }, 'حذف'))));
  }
  async function reloadTemplates() {
    const tpl = await api('/api/templates'); TEMPLATES = tpl.templates; TPL_ADMIN = tpl.adminRequired; fillTemplateSelect();
  }
  // the add-template window; from the draft's template list the new template is chosen for the draft
  let tplForDraft = false;
  function openTemplateAdd(forDraft) {
    tplForDraft = forDraft;
    $('tplName').value = ''; $('tplFile').value = ''; $('tplFileName').textContent = 'اختر الملف';
    $('tplTokenWrap').classList.toggle('hidden', !TPL_ADMIN);
    $('dlgTpl').showModal(); $('tplName').focus();
  }
  async function addTemplate() {
    const f = $('tplFile').files[0], name = $('tplName').value.trim();
    if (!f || !name) { toast('اكتب اسم القالب واختر ملف Word.', true); return; }
    const fd = new FormData(); fd.append('name', name); fd.append('file', f); fd.append('admin_token', $('tplToken').value);
    try {
      const t = await api('/api/templates', { method: 'POST', body: fd });
      $('dlgTpl').close(); await reloadTemplates(); toast('أضيف القالب.');
      if (tplForDraft && draft) { draft.template = t.id; $('templateSel').value = t.id; markDirty(); }
    } catch (e) { toast(e.message, true); }
  }
  async function deleteTemplate(t) {
    if (!(await ask(`حذف قالب "${t.name}"؟`, { ok: 'حذف', danger: true }))) return;
    try { await api(`/api/templates/${t.id}?admin_token=${encodeURIComponent($('tplToken').value)}`, { method: 'DELETE' }); await reloadTemplates(); }
    catch (e) { toast(e.message, true); }
  }
  // light, dark or the system's: applied at once and kept on this device (js/theme.js)
  function showTheme() {
    document.querySelectorAll('#setTheme button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pick === DocTheme.pick())));
  }
  function openSettings() {
    showTheme();
    $('setAuthor').value = settings.author; $('setClaude').value = settings.claudeKey;
    $('setGoogle').value = settings.googleKey; $('setRemember').checked = settings.remember;
    fillTemplateSelect(); $('dlgSettings').showModal();
  }
  function saveSettings() {
    const keep = $('setRemember').checked;
    store.set('remember', keep ? '1' : '', true);
    store.set('author', $('setAuthor').value.trim(), true);
    store.set('claudeKey', $('setClaude').value.trim(), keep);
    store.set('googleKey', $('setGoogle').value.trim(), keep);
    toast('حُفظت الإعدادات.');
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
    $('btnSettingsSave').onclick = saveSettings;
    document.querySelectorAll('#setTheme button').forEach((b) => { b.onclick = () => { DocTheme.set(b.dataset.pick); showTheme(); }; });
    $('btnTplAdd').onclick = addTemplate;
    $('btnTplNew').onclick = () => openTemplateAdd(false);
    $('tplFile').onchange = () => { const f = $('tplFile').files[0]; $('tplFileName').textContent = f ? f.name : 'اختر الملف'; };
    // document font and size: remembered on this computer
    $('optFont').value = store.get('fontSize') || '14';
    $('optFontName').value = store.get('fontName') || '';
    $('optFont').onchange = () => store.set('fontSize', $('optFont').value, true);
    $('optFontName').onchange = () => store.set('fontName', $('optFontName').value.trim(), true);

    $('draftName').oninput = () => { draft.name = $('draftName').value; markDirty(); };
    $('draftDate').onchange = () => { draft.date = $('draftDate').value; markDirty(); };
    $('templateSel').onchange = () => {
      if ($('templateSel').value === '__add') { $('templateSel').value = draft.template || ''; openTemplateAdd(true); return; }
      draft.template = $('templateSel').value; markDirty();
    };
    $('btnSave').onclick = saveDraft;
    $('btnExport').onclick = () => exportWord(false);
    $('btnQuick').onclick = () => exportWord(true);

    $('fileAdd').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
    const pages = document.querySelector('.pages');
    pages.addEventListener('dragover', (e) => { e.preventDefault(); if (dragFrom == null) pages.classList.add('drag'); });
    pages.addEventListener('dragleave', () => pages.classList.remove('drag'));
    pages.addEventListener('drop', (e) => { e.preventDefault(); pages.classList.remove('drag'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

    $('orderSel').value = store.get('order') || 'name';
    $('orderSel').onchange = () => store.set('order', $('orderSel').value, true);
    $('btnResort').onclick = resortPages;
    $('formatSel').onchange = () => store.set('format', $('formatSel').value, true);
    $('btnEditImg').onclick = () => editImage(current);
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
      store.set('engine', $('engineSel').value, true);
      engineChanged();
    };
    $('modelSel').onchange = () => store.set('model', $('modelSel').value, true);
    $('langsSel').value = store.get('langs') || 'ara+eng';
    $('langsSel').onchange = () => store.set('langs', $('langsSel').value, true);
    $('btnRead').onclick = () => readPage(current);
    $('btnReadAll').onclick = () => readAllUnread();
    toolbar = window.DocEditor.toolbar($('fmtBar'), () => pe, {
      picture: insertPicture, flag: flagSelection, engines: engineChoices, hasPage: () => !!(draft && draft.pages[current]),
      showLine: () => openLine(true), previewOn, togglePreview,
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && draft) { e.preventDefault(); saveDraft(); }
      if (e.key === 'Escape') {
        closeNote(); closeLine(); closeColFilter(true);
        document.querySelectorAll('details.pop-wrap[open]').forEach((d) => { d.open = false; d.querySelector('summary').focus(); });
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
    const pops = [...document.querySelectorAll('details.pop-wrap')];
    pops.forEach((d) => d.addEventListener('toggle', () => { if (d.open) pops.forEach((o) => { if (o !== d) o.open = false; }); }));
    document.addEventListener('pointerdown', (e) => {
      pops.forEach((d) => { if (d.open && !d.contains(e.target)) d.open = false; });
      if (colFilterFor && !e.target.closest('#colFilter, .filt')) closeColFilter(false);
      if (noteMark && !e.target.closest('#notePop, mark.flag, .flag-item')) closeNote();
      if (lineAt && !e.target.closest('#linePop')) closeLine();
    });

    $('btnPick').onclick = () => $('fileAdd').click();
    $('btnPickBig').onclick = () => $('fileAdd').click();
    const frame = $('photoFrame');  // an empty draft takes photos dropped on the photo area too
    frame.addEventListener('dragover', (e) => { if (!draft || draft.pages.length) return; e.preventDefault(); frame.classList.add('drag'); });
    frame.addEventListener('dragleave', () => frame.classList.remove('drag'));
    frame.addEventListener('drop', (e) => {
      frame.classList.remove('drag');
      if (!draft || draft.pages.length || !e.dataTransfer.files.length) return;
      e.preventDefault(); addFiles(e.dataTransfer.files);
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
    initPhotoPan();
  }

  // drag the photo to move around it when it is zoomed in or taller than the pane (touch scrolls natively)
  function initPhotoPan() {
    const f = $('photoFrame');
    f.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0 || !f.classList.contains('can-pan')) return;
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
      btn.title = btn.disabled ? 'لا يمكن طي كل الأقسام' : btn.getAttribute('aria-label');
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
