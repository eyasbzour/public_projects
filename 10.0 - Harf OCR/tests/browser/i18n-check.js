// The interface in each language (web/i18n/*.json), on a desktop and a phone screen: the page's lang and dir, no
// name left unfilled (ui.save), no Arabic on an English screen, nothing wider than the screen, no script errors.
// Seeds its own draft (English text, so any Arabic on an English screen is the interface's). Screenshots: shots/i18n-*.
// node i18n-check.js [base] [langs, comma separated]
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:8765';
const LANGS = (process.argv[3] || 'ar,en').split(',');
const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const IMG = path.join(__dirname, '..', 'english-letter.jpg');
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++; };

// what the screen shows (visible or not: dialogs and menus are in the page all along), and its attributes
function scan() {
  const NAME = /\b(?:app|ui|editor|photoEditor|signIn|server|reader|format|launcher|template|doc)\.[a-z][A-Za-z0-9]+\b/;
  const AR = /[\u0600-\u06ff]/;
  const own = (n) => n.closest('[lang]') && n.closest('[lang]') !== document.documentElement;  // a language's own name
  const names = [], arabic = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t; (t = walk.nextNode());) {
    const p = t.parentElement;
    if (!p || /^(SCRIPT|STYLE)$/.test(p.nodeName) || own(p)) continue;
    if (NAME.test(t.data)) names.push(t.data.trim().slice(0, 60));
    if (AR.test(t.data)) arabic.push(t.data.trim().slice(0, 60));
  }
  for (const n of document.querySelectorAll('[title],[aria-label],[placeholder],[alt],[data-short]')) {
    if (own(n)) continue;
    for (const a of ['title', 'aria-label', 'placeholder', 'alt', 'data-short']) {
      const v = n.getAttribute(a);
      if (!v) continue;
      if (NAME.test(v)) names.push(`${a}=${v.slice(0, 60)}`);
      if (AR.test(v)) arabic.push(`${a}=${v.slice(0, 60)}`);
    }
  }
  if (NAME.test(document.title)) names.push('title=' + document.title);
  if (AR.test(document.title)) arabic.push('title=' + document.title);
  return { names, arabic, lang: document.documentElement.lang, dir: document.documentElement.dir,
    wide: document.documentElement.scrollWidth - innerWidth };
}

async function seed(api) {
  const d = await (await api.post(BASE + '/api/drafts', { data: { name: 'Letter to the institute', owner: 'Reviewer', date: '2026-11-22' } })).json();
  const up = await (await api.post(`${BASE}/api/drafts/${d.id}/images`,
    { multipart: { file: { name: 'letter.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(IMG) } } })).json();
  const cur = await (await api.get(`${BASE}/api/drafts/${d.id}`)).json();
  const blocks = [{ type: 'p', segs: [{ s: 'Dear Director, ' }, { s: 'the report', note: 'Check this word' }, { s: ' is attached.' }] }];
  cur.pages = [{ id: 'p1', image: up.name, file: 'letter.jpg', fileTime: 0, rotation: 0, blocks, readWith: 'paddle', readImage: up.name,
    readRot: 0, versions: [{ id: 'v1', label: { engine: 'paddle' }, at: Date.now() / 1000, blocks }, { id: 'v0', label: { kind: 'restore' }, at: 1, blocks }] }];
  const r = await api.put(`${BASE}/api/drafts/${d.id}`, { data: cur });
  if (!r.ok()) throw new Error('seed: ' + r.status());
  return d.id;
}

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const id = await seed((await browser.newContext()).request);
  for (const lang of LANGS) {
    for (const [vw, vh] of [[1440, 900], [390, 844]]) {
      const tag = `${lang}-${vw}`;
      const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
      await ctx.addInitScript((l) => { try { localStorage.setItem('ds.lang', l); } catch (e) { /* */ } }, lang);
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      const dir = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'i18n', `${lang}.json`), 'utf8'))._meta.dir;
      const look = async (screen) => {
        const s = await page.evaluate(scan);
        check(`${tag} ${screen}: lang and dir`, s.lang === lang && s.dir === dir, `${s.lang} ${s.dir}`);
        check(`${tag} ${screen}: every name filled in`, !s.names.length, JSON.stringify(s.names.slice(0, 6)));
        if (lang !== 'ar') check(`${tag} ${screen}: no Arabic`, !s.arabic.length, JSON.stringify(s.arabic.slice(0, 6)));
        check(`${tag} ${screen}: nothing wider than the screen`, s.wide <= 0, `${s.wide}px`);
        await page.screenshot({ path: path.join(OUT, `i18n-${tag}-${screen}.png`) });
      };
      const open = async (dlg, how) => { await page.evaluate(how); await page.waitForSelector(`#${dlg}[open]`); };
      const close = (dlg) => page.evaluate((d) => document.getElementById(d).close(), dlg);

      await page.goto(BASE + '/'); await page.waitForSelector('#draftsList tr, #draftsList li, .draft-row', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(400);
      await look('home');
      await open('dlgSettings', () => document.getElementById('btnSettings').click()); await page.waitForTimeout(200);
      await look('settings');
      const langs = await page.$$eval('#setLang button', (bs) => bs.map((b) => [b.lang, b.getAttribute('aria-pressed')]));
      check(`${tag} settings: a button per language, the current one pressed`,
        langs.length >= 2 && langs.every(([l, p]) => (p === 'true') === (l === lang)), JSON.stringify(langs));
      await open('dlgTpl', () => document.getElementById('btnTplNew').click()); await look('template');
      if (vw === 1440) {
        // adding a template loads the list again: the built-in one's name is put in the language there too
        await page.fill('#tplName', `Check ${lang}`);
        await page.setInputFiles('#tplFile', path.join(__dirname, '..', 'blank.docx'));
        await page.click('#btnTplAdd'); await page.waitForTimeout(800);
        const names = await page.$$eval('#templateSel option, #tplList li', (ns) => ns.map((n) => n.textContent.trim()));
        for (const tpl of (await (await page.request.get(BASE + '/api/templates')).json()).templates) {
          if (tpl.id !== 'plain') await page.request.delete(`${BASE}/api/templates/${tpl.id}`);
        }
        check(`${tag} templates after adding one: named in the language`,
          names.length > 1 && !names.some((n) => n.includes('[object') || /\btemplate\./.test(n))
          && (lang !== 'en' || names.some((n) => n.startsWith('No header'))), JSON.stringify(names));
      }
      await close('dlgTpl'); await close('dlgSettings');
      await open('dlgPhone', () => { document.getElementById('dlgPhone').showModal(); }); await look('phone'); await close('dlgPhone');

      await page.goto(`${BASE}/#/d/${id}`); await page.waitForSelector('#editor .ProseMirror p'); await page.waitForTimeout(600);
      await look('draft');
      await page.evaluate(() => { const s = document.querySelector('#outPop summary'); if (s) s.click(); }); await page.waitForTimeout(150);
      await look('export-menu');
      await page.evaluate(() => { const s = document.querySelector('#outPop'); if (s) s.open = false; });
      const ver = await page.$eval('#verList', (n) => n.textContent);
      check(`${tag} draft: versions named in the language`, lang === 'en' ? /PaddleOCR/.test(ver) && /Before restoring/.test(ver) : /قبل الاسترجاع|قبل/.test(ver), ver.slice(0, 80));
      await open('dlgImage', () => document.getElementById('btnEditImg').click()); await page.waitForTimeout(300); await look('photo-editor'); await close('dlgImage');
      await open('dlgAsk', () => document.querySelector('#pageList [data-act=delete], #pageList button.danger, .thumb .danger')?.click());
      await look('ask'); await close('dlgAsk');

      await page.goto(BASE + '/phone.html'); await page.waitForTimeout(300);
      await look('sign-in');
      check(`${tag}: no script errors`, !errors.length, errors.join(' | '));
      await ctx.close();
    }
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
