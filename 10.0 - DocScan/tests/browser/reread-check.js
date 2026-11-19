// Second readings: a flagged word, all flagged spots, a paragraph. node reread-check.js <draftId> [base]
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
  // a paragraph
  await page.locator('#editor .ProseMirror > p').nth(1).click();
  const btn = page.locator('#fmtBar button[aria-label="أعد قراءة الفقرة بقارئ آخر"]');
  check('paragraph re-read is enabled in a read paragraph', await page.waitForFunction(() => !document.querySelector('#fmtBar button[aria-label="أعد قراءة الفقرة بقارئ آخر"]').disabled, null, { timeout: 3000 }).then(() => true, () => false));
  await btn.click();
  await page.selectOption('.reread-pop select', 'tess-best'); await page.click('.reread-pop .btn.primary');
  await page.waitForSelector('.reread-pop .reread-text', { timeout: 60000 });
  const got = await page.textContent('.reread-pop .reread-text');
  await page.screenshot({ path: path.join(__dirname, 'shots', 'reread-para.png') });
  await page.click('.reread-pop .reread-out .btn');
  const now = await page.locator('#editor .ProseMirror > p').nth(1).textContent();
  check('the paragraph takes the new reading', now.replace(/\s+/g, '') === got.replace(/\s+/g, ''), `${got.slice(0, 40)}`);
  await page.locator('#editor .ProseMirror > p').nth(1).click(); await page.keyboard.press('Control+z');
  check('and undo brings the old text back', (await page.locator('#editor .ProseMirror > p').nth(1).textContent()) !== now);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.message.split('\n')[0]); process.exit(2); });
