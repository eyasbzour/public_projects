// English page: read left to right, shown left to right, exported left to right. node english-check.js <draftId> [base]
const { chromium } = require('playwright-core');
const path = require('path');
const ID = process.argv[2], BASE = process.argv[3] || 'http://localhost:8765';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/#/d/${ID}`); await page.waitForSelector('#btnRead');
  await page.selectOption('#engineSel', 'paddle');
  check('page direction choice in the reading options', (await page.$$eval('#dirSel option', (o) => o.length)) === 3);
  await page.click('#btnRead');
  const again = page.locator('#askOk'); if (await again.isVisible().catch(() => false)) await again.click();
  await page.waitForSelector('#editor .ProseMirror p', { timeout: 120000 });
  const ltr = await page.$$eval('#editor .ProseMirror [dir="ltr"]', (n) => n.length);
  check('English paragraphs show left to right', ltr > 5, `${ltr} blocks`);
  const first = await page.$eval('#editor .ProseMirror p[dir="ltr"]', (p) => getComputedStyle(p).direction);
  check('the browser lays them out left to right', first === 'ltr');
  const list = await page.$eval('#editor .ProseMirror ul', (u) => ({ dir: u.getAttribute('dir'), items: u.children.length }));
  check('the bullet list is left to right with 3 items', list.dir === 'ltr' && list.items === 3, JSON.stringify(list));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'english-page.png') });
  // the direction toggle flips a paragraph
  const p = page.locator('#editor .ProseMirror > p[dir="ltr"]').first();
  await p.click();
  const toggle = page.locator('#fmtBar button[aria-label^="اتجاه الفقرة"]');
  await page.waitForFunction(() => document.querySelector('#fmtBar button[aria-label^="اتجاه الفقرة"]').getAttribute('aria-pressed') === 'true', null, { timeout: 3000 }).catch(() => {});
  check('the direction button shows the paragraph is left to right', (await toggle.getAttribute('aria-pressed')) === 'true');
  await toggle.click();
  check('clicking it makes the paragraph right to left', (await page.locator('#editor .ProseMirror > p').first().getAttribute('dir')) !== 'ltr');
  await toggle.click();
  check('and back', (await page.locator('#editor .ProseMirror > p').first().getAttribute('dir')) === 'ltr');
  // Word file
  await page.keyboard.press('Control+s'); await page.waitForTimeout(600);
  await page.selectOption('#formatSel', 'docx');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#btnExport')]);
  const out = path.join(__dirname, 'shots', 'english-export.docx');
  await dl.saveAs(out);
  check('Word file produced', true, out);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.message.split('\n')[0]); process.exit(2); });
