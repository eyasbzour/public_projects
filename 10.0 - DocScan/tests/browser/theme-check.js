// Settings > المظهر: light, dark or the system's choice, kept across a reload and following the system live.
//   node theme-check.js [base]
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://localhost:8765';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const pick = async (label) => { await page.click(`#setTheme button:text-is("${label}")`); await page.waitForTimeout(100); };
  const pressed = () => page.$eval('#setTheme [aria-pressed="true"]', (b) => b.textContent);

  await page.goto(BASE + '/#/'); await page.waitForSelector('#draftList');
  check('follows the system at first (light)', (await theme()) === 'light');
  const lightBg = await bg();
  await page.click('#btnSettings');
  check('settings shows "حسب النظام"', (await pressed()) === 'حسب النظام');
  await pick('داكن');
  check('dark applies at once', (await theme()) === 'dark' && (await bg()) !== lightBg);
  await page.reload(); await page.waitForSelector('#draftList');
  check('dark is kept after a reload', (await theme()) === 'dark');
  await page.click('#btnSettings');
  check('settings shows "داكن" after the reload', (await pressed()) === 'داكن');
  await pick('فاتح');
  await page.emulateMedia({ colorScheme: 'dark' });
  check('light stays light when the system turns dark', (await theme()) === 'light');
  await pick('حسب النظام');
  check('system: dark while the system is dark', (await theme()) === 'dark');
  await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(100);
  check('system: follows the system back to light live', (await theme()) === 'light');
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.message.split('\n')[0]); process.exit(2); });
