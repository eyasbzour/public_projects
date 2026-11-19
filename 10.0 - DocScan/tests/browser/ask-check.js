// The app's own confirm box replaces the browser's. node ask-check.js [base]
const { chromium } = require('playwright-core');
const path = require('path');
const BASE = process.argv[2] || 'http://localhost:8765';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const d = await (await page.request.post(BASE + '/api/drafts', { data: { name: 'ask check' } })).json();
  await page.goto(`${BASE}/#/d/${d.id}`); await page.waitForSelector('#fmtBar .tb');
  // the test photos e2e.js makes (run it first)
  if (!require('fs').existsSync(path.join(__dirname, 'out/letter.jpg'))) throw new Error('out/letter.jpg is missing: run e2e.js first');
  await page.setInputFiles('#fileAdd', [path.join(__dirname, 'out/letter.jpg'), path.join(__dirname, 'out/letter (1).jpg')]);
  await page.waitForFunction(() => document.querySelectorAll('.page-item').length === 2);
  const del = () => page.locator('.page-item').first().locator('button[aria-label="حذف الصفحة"]').click({ force: true });

  await del();
  await page.waitForSelector('#dlgAsk[open]');
  check('delete asks in the app dialog', (await page.textContent('#askText')).includes('حذف الصفحة 1'));
  check('cancel has focus for a delete', await page.evaluate(() => document.activeElement.id === 'askCancel'));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'ask-dialog.png') });
  await page.keyboard.press('Enter');  // Enter on the focused cancel button
  await page.waitForSelector('#dlgAsk', { state: 'hidden' });
  check('Enter cancels, page kept', (await page.locator('.page-item').count()) === 2);
  await del(); await page.waitForSelector('#dlgAsk[open]'); await page.keyboard.press('Escape'); await page.waitForSelector('#dlgAsk', { state: 'hidden' });
  check('Esc cancels', (await page.locator('.page-item').count()) === 2);
  await del(); await page.waitForSelector('#dlgAsk[open]'); await page.click('#askOk');
  await page.waitForFunction(() => document.querySelectorAll('.page-item').length === 1);
  check('OK deletes', true);
  await page.click('#btnResort'); await page.waitForSelector('#dlgAsk[open]');
  check('non-destructive question focuses OK', await page.evaluate(() => document.activeElement.id === 'askOk') && (await page.textContent('#askOk')) === 'رتّب');
  await page.click('#askCancel'); await page.waitForSelector('#dlgAsk', { state: 'hidden' });
  await page.emulateMedia({ colorScheme: 'dark' }); await del(); await page.waitForSelector('#dlgAsk[open]');
  await page.screenshot({ path: path.join(__dirname, 'shots', 'ask-dialog-dark.png') });
  await page.click('#askCancel'); await page.waitForSelector('#dlgAsk', { state: 'hidden' });
  check('no browser dialogs at all', native === 0, `native=${native}`);
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.request.delete(`${BASE}/api/drafts/${d.id}`);
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(2); });
