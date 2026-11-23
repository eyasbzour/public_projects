// Second readings: a flagged word, all flagged spots (a line or paragraph: line-check.js). node reread-check.js <draftId> [base]
const { chromium } = require('playwright-core');
const path = require('path');
const ID = process.argv[2], BASE = process.argv[3] || 'http://localhost:8765';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/#/d/${ID}`); await page.waitForSelector('#editor .ProseMirror p');
  // word panel
  const mark = page.locator('#editor mark.flag[data-box]').first();
  await mark.click(); await page.waitForSelector('#notePop:not(.hidden)');
  check('word panel offers another reader', await page.isVisible('#noteReadBtn'));
  await page.selectOption('#noteEngine', 'tess-best');
  await page.click('#noteReadBtn');
  await page.waitForSelector('#noteSuggest:not(.hidden)', { timeout: 60000 });
  const sug = await page.getAttribute('#noteSuggest', 'data-text');
  check('its reading shows as a suggestion', sug !== null, JSON.stringify(sug));
  if (sug) { await page.click('#noteSuggest'); check('the suggestion fills the word field', (await page.inputValue('#noteWord')) === sug); }
  await page.screenshot({ path: path.join(__dirname, 'shots', 'reread-word.png') });
  await page.keyboard.press('Escape');
  // all flagged spots
  check('flags list has the re-read tool', await page.isVisible('#flagReread'));
  await page.selectOption('#flagEngine', 'tess-best');
  await page.click('#flagReread');
  await page.waitForSelector('.flag-suggest', { timeout: 120000 }).catch(() => {});
  const n = await page.$$eval('.flag-suggest', (x) => x.length);
  check('second readings show under the flagged spots', n > 0, `${n} suggestions`);
  if (n) {
    const want = (await page.textContent('.flag-suggest span')).replace(/^[^«]*«|»$/g, '');
    const before = await page.$$eval('#editor mark.flag', (m) => m.map((x) => x.textContent));
    await page.locator('.flag-suggest button').first().click();
    const after = await page.$$eval('#editor mark.flag', (m) => m.map((x) => x.textContent));
    check('using one puts its text in the page, flag kept', after.includes(want) && after.length === before.length, want);
  }
  await page.screenshot({ path: path.join(__dirname, 'shots', 'reread-flags.png') });
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.message.split('\n')[0]); process.exit(2); });
