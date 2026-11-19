// An inserted picture can be selected and removed (mouse and keyboard). node img-remove-check.js <draftId> [base]
const { chromium } = require('playwright-core');
const ID = process.argv[2], BASE = process.argv[3] || 'http://localhost:8765';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/#/d/${ID}`);
  await page.waitForSelector('#editor .ProseMirror p');
  const pics = () => page.$$eval('#editor figure.fig', (n) => n.length);
  const insert = async () => {
    await page.locator('#editor .ProseMirror > p').first().click();
    await page.click('#fmtBar button[aria-label^="إدراج جزء"]'); await page.waitForSelector('#ieCropBox:not(.hidden)');
    const n = await pics(); await page.click('#ieSave');
    await page.waitForFunction((n) => document.querySelectorAll('#editor figure.fig').length > n, n);
  };

  await insert();
  const n0 = await pics();
  await page.click('#editor figure.fig img');
  const toolsShown = await page.waitForFunction(() => { const b = document.querySelector('.tb-float button[aria-label="حذف الصورة"]'); return b && !b.hidden; },
    null, { timeout: 2000 }).then(() => true, () => false);
  check('clicking the picture shows its tools', toolsShown);
  if (toolsShown) await page.click('.tb-float button[aria-label="حذف الصورة"]');
  check('trash removes the picture', (await pics()) === n0 - 1);

  await insert();
  const n1 = await pics();
  await page.click('#editor figure.fig img');
  await page.keyboard.press('Delete');
  check('Delete key removes the selected picture', (await pics()) === n1 - 1);

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
