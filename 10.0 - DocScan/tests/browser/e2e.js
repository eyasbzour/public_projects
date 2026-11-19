// End-to-end run in real Chrome against a running DocScan: node e2e.js http://localhost:8765
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:8765';
const OUT = path.join(__dirname, 'out');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const log = (...a) => console.log('[e2e]', ...a);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  // 1. render two synthetic photographed pages (Chrome shapes Arabic correctly)
  const shot = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
  await shot.goto('file:///' + path.join(__dirname, 'page.html').replace(/\\/g, '/'));
  await shot.locator('.page').screenshot({ path: path.join(OUT, 'letter.jpg'), type: 'jpeg', quality: 85 });
  await shot.locator('.page').screenshot({ path: path.join(OUT, 'letter (1).jpg'), type: 'jpeg', quality: 85 });
  await shot.close();

  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const eng = await (await page.request.get(BASE + '/api/engines')).json();
  const fmt = await (await page.request.get(BASE + '/api/formats')).json();
  const tpl = await (await page.request.get(BASE + '/api/templates')).json();
  log('engines', eng.engines.map((e) => `${e.id}:${e.available ? 'ok' : 'no'}`).join(' '));
  log('formats', fmt.formats.map((f) => `${f.id}:${f.available ? 'ok' : 'no'}`).join(' '));
  log('templates', tpl.templates.map((t) => t.id).join(' '));

  // 2. new draft with an Arabic name
  await page.goto(BASE + '/');
  await page.fill('#newName', 'اختبار التحويل');
  await page.click('#formNew button[type=submit]');
  await page.waitForURL(/#\/d\/[a-f0-9]{32}$/);
  const draftId = page.url().split('/').pop();
  log('draft', draftId);

  // 3. upload (picked in reverse to check name ordering puts "letter" before "letter (1)")
  await page.setInputFiles('#fileAdd', [path.join(OUT, 'letter (1).jpg'), path.join(OUT, 'letter.jpg')]);
  await page.waitForFunction(() => document.querySelectorAll('.page-item').length === 2);
  log('order', await page.$$eval('.page-item', (n) => n.map((x) => x.title).join(' | ')));

  // 4. read all with Tesseract standard
  await page.selectOption('#engineSel', 'tess-standard');
  const t0 = Date.now();
  await page.click('#btnReadAll');
  await page.waitForFunction(() => document.querySelectorAll('.page-item .state.read').length === 2, null, { timeout: 180000 });
  log('read 2 pages in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  const text = await page.$$eval('#editor .ProseMirror > *', (n) => n.map((x) => x.textContent).join('\n'));
  log('page 1 text:\n' + text.slice(0, 600));
  log('auto flags on page 1:', await page.textContent('#flagCount'));

  // 5. flag a selection by hand
  await page.locator('#editor .ProseMirror > p').nth(1).click();
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('#editor .ProseMirror > p')].map((p) => [...p.childNodes].find((c) => c.nodeType === 3 && c.length > 8)).find(Boolean);
    const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 5);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(150);
  await page.click('#fmtBar button[aria-label="تعليم النص المحدد كملاحظة"]');
  await page.fill('#noteText', 'ملاحظة اختبار يدوية');
  await page.click('#noteSave');
  await page.click('#btnSave');
  await page.waitForFunction(() => document.getElementById('saveState').textContent === 'محفوظ');
  log('saved; flags now', await page.textContent('#flagCount'));

  // 6. export in each format, record the file name Chrome picks
  for (const f of ['docx', 'pdf', 'png', 'odt', 'txt']) {
    await page.selectOption('#formatSel', f);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.click('#btnExport')]);
    const name = dl.suggestedFilename();
    const dest = path.join(OUT, 'export-' + f + path.extname(name));
    await dl.saveAs(dest);
    log(`export ${f}: suggested="${name}" bytes=${fs.statSync(dest).size}`);
  }

  // 7. reopen: edits persisted?
  await page.goto(BASE + '/');
  await page.goto(BASE + '/#/d/' + draftId);
  await page.waitForSelector('#editor .ProseMirror p');
  log('after reopen flags', await page.textContent('#flagCount'));

  // 8. clean up
  await page.request.delete(BASE + '/api/drafts/' + draftId);
  log('browser errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('[e2e] FAILED', e); process.exit(1); });
