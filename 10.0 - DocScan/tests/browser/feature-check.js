// Checks for: flag edit panel, picture insert, borders toggle, order row wrap, Word/PDF export.
// node feature-check.js <draftId> [base]
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const ID = process.argv[2];
const BASE = process.argv[3] || 'http://localhost:8765';
const OUT = path.join(__dirname, 'shots');
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/#/d/${ID}`);
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('#editor .ProseMirror p');

  // the two-sided header row renders as a borderless table
  check('header row is a borderless table', await page.$eval('#editor .ProseMirror table', (n) => n.classList.contains('borderless')));

  // flagged word: status line, photo spot, edit only the word
  const mark = page.locator('#editor mark.flag').nth(1);
  const before = await mark.textContent();
  await mark.click();
  await page.waitForFunction(() => !document.getElementById('noteCrop').classList.contains('hidden'), null, { timeout: 5000 }).catch(() => {});
  check('panel shows the note as one line', (await page.textContent('#noteStatus')).includes('غير مؤكدة')
    && await page.$eval('#noteText', (n) => n.classList.contains('hidden')));
  check('panel shows the spot on the photo', await page.$eval('#noteCrop', (n) => !n.classList.contains('hidden') && n.width > 50));
  check('word is ready to edit', await page.evaluate(() => document.activeElement.id === 'noteWord') && (await page.inputValue('#noteWord')) === before);
  await page.screenshot({ path: path.join(OUT, 'feat-panel.png') });
  await page.fill('#noteWord', 'وبعد'); await page.keyboard.press('Enter');
  const after = await page.locator('#editor mark.flag').nth(1).textContent();
  check('Enter saves only the word, flag stays', after === 'وبعد', `"${before}" -> "${after}"`);
  const flags0 = await page.locator('#editor mark.flag').count();
  await page.locator('#editor mark.flag').nth(1).click();
  await page.click('#noteRemove');
  check('"حفظ وإزالة التعليم" keeps the text, drops the flag', (await page.locator('#editor mark.flag').count()) === flags0 - 1
    && (await page.textContent('#editor')).includes('وبعد'));
  await page.locator('#editor mark.flag').first().click();
  await page.waitForTimeout(600);
  check('panel stays open after the click', await page.$eval('#notePop', (n) => !n.classList.contains('hidden')));
  check('no floating toolbar flashes up', await page.evaluate(() => document.querySelector('.tb-float').hidden && !document.activeElement.closest('#editor')));
  check('note is read-only text', await page.$eval('#noteText', (n) => n.classList.contains('hidden')) && !(await page.$('#noteEditBtn')));
  await page.click('#noteClose');
  // a word the user flags themselves asks for its note
  await page.locator('#editor .ProseMirror > p').nth(1).click();
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('#editor .ProseMirror > p')].map((p) => [...p.childNodes].find((c) => c.nodeType === 3 && c.length > 8)).find(Boolean);
    const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 5);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(150);
  await page.click('#fmtBar button[aria-label="تعليم النص المحدد كملاحظة"]');
  check('new flag asks for its note', await page.$eval('#noteText', (n) => !n.classList.contains('hidden')) && await page.evaluate(() => document.activeElement.id === 'noteText'));
  await page.fill('#noteText', 'ملاحظة مضافة يدوياً'); await page.click('#noteSave');

  // insert a picture after the 3rd block
  await page.locator('#editor .ProseMirror > *').nth(2).click();
  await page.click('#fmtBar button[aria-label^="إدراج جزء"]');
  await page.waitForSelector('#ieCropBox:not(.hidden)');
  check('picture picker opens with the crop frame', (await page.textContent('#ieSave')).includes('إدراج'));
  await page.click('#ieSave');
  await page.waitForSelector('#editor figure.fig img');
  const pos = await page.$$eval('#editor .ProseMirror > *', (n) => n.findIndex((b) => b.matches('figure')));
  check('picture lands after the block the cursor was in', pos === 3, `index ${pos}`);
  await page.waitForFunction(() => { const i = document.querySelector('#editor figure.fig img'); return i && i.complete && i.naturalWidth > 0; });

  // borders toggle on the header row (floating table tools)
  await page.locator('#editor .ProseMirror table td').first().click();
  await page.waitForFunction(() => { const b = document.querySelector('.tb-float button[aria-label="إظهار خطوط الجدول"]'); return b && !b.hidden; }, null, { timeout: 3000 });
  await page.click('.tb-float button[aria-label="إظهار خطوط الجدول"]');
  check('borders toggle turns the row into a ruled table', !(await page.$eval('#editor .ProseMirror table', (n) => n.classList.contains('borderless'))));
  await page.click('.tb-float button[aria-label="إظهار خطوط الجدول"]');
  await page.screenshot({ path: path.join(OUT, 'feat-editor.png') });

  // ordering row wraps in a narrow pages pane
  const sp = await (await page.$('.splitter[data-pane=pages]')).boundingBox();
  await page.mouse.move(sp.x + 4, sp.y + 300); await page.mouse.down(); await page.mouse.move(sp.x + 400, sp.y + 300, { steps: 5 }); await page.mouse.up();
  const ov = await page.$eval('.order-row', (r) => ({ pane: Math.round(document.querySelector('.pane.pages').clientWidth),
    over: [...r.querySelectorAll('select, button, .inline-field')].some((n) => n.getBoundingClientRect().left < r.getBoundingClientRect().left - 1) }));
  check('ordering row fits a narrow pane', !ov.over, `pane ${ov.pane}px`);
  await page.locator('.pane.pages').screenshot({ path: path.join(OUT, 'feat-order-narrow.png') });

  // export docx + pdf with the table, borderless row and picture
  await page.click('#btnSave'); await page.waitForFunction(() => document.getElementById('saveState').textContent === 'محفوظ');
  for (const f of ['docx', 'pdf']) {
    await page.selectOption('#formatSel', f);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.click('#btnExport')]);
    await dl.saveAs(path.join(__dirname, 'out', 'feat.' + f));
    check(`export ${f}`, fs.statSync(path.join(__dirname, 'out', 'feat.' + f)).size > 5000);
  }
  await page.evaluate(() => localStorage.clear());
  check('no page errors', errors.length === 0, errors.join('; '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(2); });
