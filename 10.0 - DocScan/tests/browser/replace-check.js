// Every way text gets replaced: a flagged word fixed in its panel (kept, unflagged, emptied), one suggestion and
// all suggestions from another reader, and a line or paragraph replaced by a reading (pe.replaceRange).
//   node replace-check.js <draftId with a read page> [base]
const { chromium } = require('playwright-core');
const path = require('path');
const ID = process.argv[2], BASE = process.argv[3] || 'http://localhost:8765';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };
const B = [0.1, 0.1, 0.2, 0.12];

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/#/d/${ID}`); await page.waitForSelector('#editor .ProseMirror p');
  const pe = 'document.querySelector("#editor").docEditor';

  // 1. all suggestions at once, on the page's own flags (a real second reading)
  await page.selectOption('#flagEngine', 'tess-best');
  await page.click('#flagReread');
  await page.waitForSelector('.flag-suggest', { timeout: 120000 }).catch(() => {});
  const wanted = await page.$$eval('#flagList li', (li) => li.map((x) => {
    const s = x.querySelector('.flag-suggest span'); return s ? s.textContent.replace(/^[^«]*«|»$/g, '') : null;
  }));
  const pending = wanted.filter(Boolean).length;
  if (await page.isVisible('#flagUseAll')) {
    const before = await page.$$eval('#editor mark.flag', (m) => m.map((x) => x.textContent));
    await page.click('#flagUseAll');
    const after = await page.$$eval('#editor mark.flag', (m) => m.map((x) => x.textContent));
    await page.evaluate(() => document.querySelector('#editor').docEditor.focus());  // the user clicks back into the text
    const right = after.filter((t, i) => (wanted[i] ? t === wanted[i] : t === before[i])).length;
    check('using all suggestions puts each reading in its own flag', after.length === before.length && right === after.length, `${right}/${after.length}, ${pending} suggestions`);
    await page.keyboard.press('Control+z');
    const undone = await page.$$eval('#editor mark.flag', (m) => m.map((x) => x.textContent));
    check('one undo takes them all back', JSON.stringify(undone) === JSON.stringify(before));
  } else check('(fewer than 2 suggestions: "use all" not offered)', true, `${pending}`);

  // 2. controlled text for the edge cases
  await page.evaluate((B) => {
    const blocks = [
      { type: 'p', bold: false, segs: [{ s: 'الكتاب رقم ' }, { s: '٢٤٥', note: 'رقم غير مؤكد', box: B }, { s: ' بتاريخ ' }, { s: 'اليوم', note: 'كلمة', box: B }, { s: ' والسلام' }] },
      { type: 'p', bold: true, segs: [{ s: 'نص عريض ' }, { s: 'كلمه', note: 'إملاء', box: B }, { s: ' هنا' }] },
      { type: 'p', bold: false, segs: [{ s: 'أول ' }, { s: 'زائدة', note: 'زائدة', box: B }, { s: ' آخر' }] },
      { type: 'p', bold: false, segs: [{ s: 'بداية', note: 'أول', box: B }, { s: ' وسط ' }, { s: 'نهاية', note: 'آخر', box: B }] },
      { type: 'p', bold: false, segs: [{ s: 'قبل ' }, { s: 'حذف', note: 'آخر الفقرة', box: B }] },
      { type: 'p', bold: true, box: [0.1, 0.3, 0.9, 0.36], lines: [[0.1, 0.3, 0.9, 0.32, 0], [0.1, 0.33, 0.9, 0.36, 12]], segs: [{ s: 'السطر الأول السطر الثاني' }] },
      { type: 'table', rows: [[[{ s: 'خلية' }], [{ s: 'خانه', note: 'خلية', box: B }]]], cellBoxes: [[[0.5, 0.5, 0.9, 0.55], [0.1, 0.5, 0.5, 0.55]]] },
    ];
    document.querySelector('#editor').docEditor.editor.commands.setContent(window.BlocksDoc.blocksToDoc(blocks), { emitUpdate: true });
  }, B);
  await page.waitForTimeout(400);
  const P = (k) => page.locator('#editor .ProseMirror > p').nth(k);
  const text = (k) => P(k).textContent();
  const fix = async (word, to, how = 'save') => {
    await page.locator('#editor mark.flag', { hasText: word }).first().click();
    await page.waitForSelector('#notePop:not(.hidden)');
    await page.fill('#noteWord', to);
    await page.click(how === 'unflag' ? '#noteRemove' : '#noteSave');
    await page.waitForTimeout(100);
  };

  await fix('٢٤٥', '245/2026');
  check('a fixed word takes the new text, the rest of the line kept', (await text(0)) === 'الكتاب رقم 245/2026 بتاريخ اليوم والسلام', await text(0));
  check('and stays flagged with its note', await page.$eval('#editor mark.flag', (m) => m.textContent === '245/2026' && m.dataset.note === 'رقم غير مؤكد'));
  await fix('اليوم', 'الأحد', 'unflag');
  check('"save and remove" keeps the new text and drops the flag', (await text(0)).includes('بتاريخ الأحد والسلام') && !(await P(0).locator('mark.flag', { hasText: 'الأحد' }).count()));
  check('the other flag in that line is untouched', (await P(0).locator('mark.flag').count()) === 1);
  await fix('كلمه', 'كلمة');
  check('a word fixed in a bold line stays bold', await P(1).locator('mark.flag', { hasText: 'كلمة' }).evaluate((m) => !!m.closest('strong') || !!m.querySelector('strong')));
  await fix('زائدة', '');
  check('an emptied word is deleted without leaving two spaces', (await text(2)) === 'أول آخر', JSON.stringify(await text(2)));
  await fix('بداية', 'مطلع');
  await fix('نهاية', 'خاتمة');
  check('flags at the start and the end of a line are replaced in place', (await text(3)) === 'مطلع وسط خاتمة', await text(3));
  await fix('حذف', '');
  check('an emptied last word leaves no space behind', (await text(4)) === 'قبل', JSON.stringify(await text(4)));
  await fix('خانه', 'خانة');
  check('a flagged word in a table cell is fixed in its cell', (await page.$$eval('#editor td', (t) => t.map((x) => x.textContent))).join('|') === 'خلية|خانة');
  await page.keyboard.press('Control+z');
  check('undo brings the cell word back', (await page.$$eval('#editor td', (t) => t.map((x) => x.textContent))).join('|') === 'خلية|خانه');

  // 3. a line of a bold paragraph replaced by a reading keeps the paragraph's look
  const kept = await page.evaluate((pe) => {
    const api = eval(pe), ed = api.editor;
    let at = null;
    ed.state.doc.descendants((n, pos) => { if (n.attrs && n.attrs.lines && at == null) at = pos + 1 + 14; });
    const t = api.readTarget(at);
    const ok = api.replaceRange(t.line.from, t.line.to, t.line.text, [{ s: 'السطر ' }, { s: 'الجديد', note: 'من القارئ', box: [0.1, 0.33, 0.3, 0.36] }]);
    const p = [...document.querySelectorAll('#editor .ProseMirror > p')].find((x) => x.dataset.lines || x.textContent.includes('الجديد'));
    return { ok, line: t.line.text, text: p.textContent, bold: [...p.querySelectorAll('mark.flag')].every((m) => m.closest('strong') || m.querySelector('strong')) && !!p.querySelector('strong'),
      plain: [...p.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).length };
  }, pe);
  check('the second line was the one replaced', kept.ok && kept.line === 'السطر الثاني' && kept.text === 'السطر الأول السطر الجديد', JSON.stringify(kept));
  check('the new text keeps the paragraph bold', kept.bold && kept.plain === 0, JSON.stringify(kept));
  await page.keyboard.press('Control+z');

  await page.screenshot({ path: path.join(__dirname, 'shots', 'replace.png') });
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.message.split('\n')[0]); process.exit(2); });
