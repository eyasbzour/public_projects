// The rich text editor: formatting, lists over several lines, tables, pictures, flags, versions, saving.
// node editor-check.js <draftId> [base]   (changes the draft: use a seeded test draft)
const { chromium } = require('playwright-core');
const path = require('path');
const ID = process.argv[2], BASE = process.argv[3] || 'http://localhost:8765';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/#/d/${ID}`);
  await page.waitForSelector('#editor .ProseMirror p');
  const tb = (label) => page.locator(`#fmtBar button[aria-label="${label}"]`);
  const fl = (label) => page.locator(`.tb-float button[aria-label="${label}"]`);  // the floating bar
  const paras = page.locator('#editor .ProseMirror > p');
  const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 3000 }).then(() => true, () => false);
  const shown = (label) => until((l) => { const b = document.querySelector(`.tb-float button[aria-label="${l}"]`); return b && !b.hidden && b.offsetParent; }, label);
  const hidden = (label) => until((l) => { const b = document.querySelector(`.tb-float button[aria-label="${l}"]`); return !b || b.hidden || !b.offsetParent; }, label);
  // the screen point of character `at` in the first plain (unflagged) text of an element
  const charPoint = (loc, at) => loc.evaluate((n, at) => {
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (!t.parentElement.closest('mark') && t.nodeValue.trim().length > at + 2 ? 1 : 3) });
    const t = w.nextNode(); const r = document.createRange(); r.setStart(t, at); r.setEnd(t, at + 1);
    const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, at);

  // a click on plain text of an element, never on a flagged word (that opens its panel and keeps the caret where it was)
  const clickText = async (loc) => { const pt = await charPoint(loc, 1); await page.mouse.click(pt.x, pt.y); };

  // select the 2nd and 3rd plain paragraphs with the keyboard, then make them a bullet list
  // two paragraphs in a row with plain text, after the first (a handwriting or stamp marker has none)
  const [i1, i2] = await paras.evaluateAll((ns) => {
    const plain = (n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode())) if (!t.parentElement.closest('mark') && t.nodeValue.trim().length > 6) return true; return false; };
    for (let i = 1; i + 1 < ns.length; i++) if (plain(ns[i]) && plain(ns[i + 1])) return [i, i + 1];
    return [1, 2];
  });
  const a = await charPoint(paras.nth(i1), 1), b = await charPoint(paras.nth(i2), 3);
  const want = await paras.evaluateAll((ns, [i1, i2]) => [ns[i1].textContent.slice(0, 12), ns[i2].textContent.slice(0, 12)], [i1, i2]);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
  await tb('قائمة نقطية').click();
  const items = await page.$$eval('#editor .ProseMirror > ul > li', (n) => n.length);
  const got = await page.$$eval('#editor .ProseMirror > ul > li', (n) => n.map((x) => x.textContent.slice(0, 12)));
  check('mouse: lines dragged over become one bullet list', items === 2, JSON.stringify({ want, got }));
  check('bullet button shows as on', (await tb('قائمة نقطية').getAttribute('aria-pressed')) === 'true');
  await tb('قائمة مرقمة').click();
  check('the same lines switch to a numbered list', (await page.$$eval('#editor .ProseMirror > ol > li', (n) => n.length)) === items);
  // indent the second item under the first
  await page.locator('#editor .ProseMirror > ol > li').nth(1).click();
  await tb('زيادة المسافة البادئة').click();
  check('indent nests an item', (await page.$$eval('#editor .ProseMirror ol ol > li', (n) => n.length)) === 1);
  await page.keyboard.press('Shift+Tab');
  check('Shift+Tab takes it back out', (await page.$$eval('#editor .ProseMirror ol ol', (n) => n.length)) === 0);

  // the main toolbar never changes height while working (no jumping text)
  const barH = await page.$eval('#fmtBar', (b) => b.offsetHeight);

  // bold, strike, italic, underline on a selection
  const p = paras.nth(0);
  await clickText(p); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
  await tb('عريض').click(); await tb('يتوسطه خط').click();
  await page.keyboard.press('Control+i'); await page.keyboard.press('Control+u');
  const fmt = await p.evaluate((n) => ['strong', 's', 'em', 'u'].filter((t) => n.querySelector(t)));
  check('selected text shows the floating text tools', await shown('مائل'));
  check('bold, strike, italic, underline (buttons and keys)', fmt.length === 4, fmt.join());
  await tb('إزالة التنسيق (يبقى التعليم)').click();
  check('clear formatting removes them', (await p.evaluate((n) => n.querySelectorAll('strong, s, em, u').length)) === 0);
  check('clear formatting keeps flags', (await page.$$eval('#editor mark.flag', (n) => n.length)) > 0);
  await page.keyboard.press('Control+z');
  check('undo brings the formatting back', (await p.evaluate((n) => n.querySelectorAll('strong, s, em, u').length)) > 0);

  // alignment and heading
  await tb('توسيط').click();
  check('centre alignment', (await p.evaluate((n) => n.style.textAlign)) === 'center');
  const h1 = await page.$$eval('#editor .ProseMirror > h1', (n) => n.length);
  await page.selectOption('#fmtBar select', 'h1');
  check('line type: main heading', (await page.$$eval('#editor .ProseMirror > h1', (n) => n.length)) === h1 + 1);
  await page.selectOption('#fmtBar select', 'q');
  check('line type: quote', (await page.$$eval('#editor .ProseMirror > blockquote', (n) => n.length)) === 1);
  await page.selectOption('#fmtBar select', 'p');
  check('line type: back to a paragraph', (await page.$$eval('#editor .ProseMirror > blockquote', (n) => n.length)) === 0);

  // tables: the context tools appear in a table and change it
  await page.keyboard.press('End'); await page.waitForTimeout(150);  // drop the selection: its floating bar may sit over the table
  await page.locator('#editor .ProseMirror table td').first().click();
  check('table tools appear inside a table (mouse click into a cell)', await shown('إضافة صف'));
  check('table tools float above the table', await page.evaluate(() => {
    const f = document.querySelector('.tb-float').getBoundingClientRect(), t = document.querySelector('#editor .ProseMirror table').getBoundingClientRect();
    return f.bottom <= t.top + 2;
  }));
  const rows0 = await page.$$eval('#editor .ProseMirror table tr', (n) => n.length);
  await fl('إضافة صف').click();
  check('+ row adds a row', (await page.$$eval('#editor .ProseMirror table tr', (n) => n.length)) === rows0 + 1);
  await fl('حذف الصف').click();
  check('- row removes it', (await page.$$eval('#editor .ProseMirror table tr', (n) => n.length)) === rows0);
  const cols = await page.$$eval('#editor .ProseMirror table tr:first-child td', (n) => n.length);
  check('- column disabled only when one column is left', (await fl('حذف العمود').isDisabled()) === (cols < 2));
  await clickText(paras.nth(0));
  check('table tools hide outside the table', await hidden('إضافة صف'));

  // flags: the word panel still fixes just the word
  const mark = page.locator('#editor mark.flag').first();
  await mark.click(); await page.waitForSelector('#notePop:not(.hidden)');
  await page.fill('#noteWord', 'كلمة مصححة'); await page.click('#noteSave');
  check('word panel fixes the flagged word', (await page.locator('#editor mark.flag').first().textContent()) === 'كلمة مصححة');
  // new flag from a selection
  const w = await charPoint(paras.nth(0), 2);
  await page.mouse.dblclick(w.x, w.y);
  const f0 = await page.$$eval('#editor mark.flag', (n) => n.length);
  await page.locator('#fmtBar button[aria-label="تعليم النص المحدد كملاحظة"]').click();
  await page.waitForSelector('#notePop:not(.hidden)');
  await page.fill('#noteText', 'ملاحظة جديدة'); await page.click('#noteSave');
  check('a selection becomes a new flag with its note', (await page.$$eval('#editor mark.flag', (n) => n.length)) === f0 + 1
    && (await page.$$eval('#editor mark.flag', (n) => n.some((m) => m.dataset.note === 'ملاحظة جديدة'))));

  // pictures: inserted after the line, selected by a click, deleted
  await clickText(paras.nth(0));
  await page.locator('#fmtBar button[aria-label^="إدراج جزء"]').click();
  await page.waitForSelector('#ieCropBox:not(.hidden)'); await page.click('#ieSave');
  await page.waitForSelector('#editor figure.fig img');
  check('picture lands right after the line the cursor was in', await page.evaluate(() => {
    const f = document.querySelector('#editor figure.fig'); return f.previousElementSibling && f.previousElementSibling.tagName === 'P';
  }));
  await page.click('#editor figure.fig img');
  await until(() => true);
  check('clicking the picture selects it', await page.$eval('#editor figure.fig', (f) => f.classList.contains('ProseMirror-selectednode')));
  await fl('الصورة في الوسط').click(); await fl('الصورة لليسار').click();
  await until(() => document.querySelector('#editor figure.fig').dataset.align === 'end');
  check('alignment applies to the picture', (await page.$eval('#editor figure.fig', (f) => f.dataset.align)) === 'end');
  await shown('حذف الصورة'); await fl('حذف الصورة').click();
  await until(() => !document.querySelector('#editor figure.fig'));
  check('picture delete button removes it', (await page.$$eval('#editor figure.fig', (n) => n.length)) === 0);

  check('main toolbar kept its height throughout', (await page.$eval('#fmtBar', (b) => b.offsetHeight)) === barH);

  // colours, size, table size picker, cell fill
  const p0 = paras.nth(0);
  await clickText(p0); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End'); await page.waitForTimeout(150);
  await tb('لون النص').click(); await page.click('.tb-pop button[aria-label="أحمر"]');
  check('text colour from the palette', await p0.evaluate((n) => [...n.querySelectorAll('span[style]')].some((s) => s.style.color === 'rgb(255, 0, 0)')));
  await tb('لون خلفية النص').click(); await page.click('.tb-pop button[aria-label="أصفر باهت"]');
  check('text background from the palette', await p0.evaluate((n) => [...n.querySelectorAll('span[style]')].some((s) => s.style.backgroundColor === 'rgb(255, 242, 204)')));
  await page.fill('#fmtBar .tb-size', '18'); await page.press('#fmtBar .tb-size', 'Enter');
  check('typed text size', await p0.evaluate((n) => [...n.querySelectorAll('span[style]')].some((s) => s.style.fontSize === '18pt')));
  const tables0 = await page.$$eval('#editor .ProseMirror table', (n) => n.length);
  await clickText(p0);
  await tb('إدراج جدول').click();
  await page.hover('.tbl-grid button[data-r="3"][data-c="4"]');
  check('size picker shows rows x columns', (await page.textContent('.grid-label')) === '3 صفوف × 4 أعمدة');
  await page.click('.tbl-grid button[data-r="3"][data-c="4"]');
  const shape = () => page.$$eval('#editor .ProseMirror table', (ts) => ts.map((t) => `${t.rows.length}x${t.rows[0].cells.length}`));
  check('grid inserts a 3 x 4 table', (await shape()).includes('3x4') && (await shape()).length === tables0 + 1, JSON.stringify(await shape()));
  await tb('إدراج جدول').click();
  await page.fill('.grid-custom label:nth-child(1) input', '2'); await page.fill('.grid-custom label:nth-child(2) input', '5');
  await page.click('.grid-custom button');
  check('custom rows and columns insert a 2 x 5 table', (await shape()).includes('2x5'));
  await page.locator('#editor .ProseMirror table').filter({ has: page.locator('tr:nth-child(3)') }).last().locator('td').first().click();
  await shown('لون تعبئة الخلايا'); await fl('لون تعبئة الخلايا').click(); await page.click('.tb-pop button[aria-label="أزرق باهت"]');
  check('cell fill colour', (await page.$$eval('#editor .ProseMirror td[data-bg]', (n) => n.length)) === 1);

  // saved to the server with formatting and lists
  await page.keyboard.press('Control+s'); await page.waitForTimeout(800);
  const saved = await (await page.request.get(`${BASE}/api/drafts/${ID}`)).json();
  const bl = saved.pages[0].blocks;
  check('saved: numbered list items', bl.filter((b) => b.type === 'ol').length === items, JSON.stringify(bl.filter((b) => b.type === 'ol').map((b) => b.level)));
  check('saved: formatting on the text', bl.some((b) => (b.segs || []).some((s) => s.b || s.x || s.i || s.u)));
  check('saved: colours, size and cell fill', bl.some((b) => (b.segs || []).some((s) => s.c === '#ff0000' && s.bg === '#fff2cc' && s.sz === 18))
    && bl.some((b) => b.type === 'table' && b.cellBg));
  check('saved: flags keep their box', bl.some((b) => (b.segs || []).some((s) => s.note != null && s.box)));
  await page.reload(); await page.waitForSelector('#editor .ProseMirror ol');
  check('reload shows the same list', (await page.$$eval('#editor .ProseMirror > ol > li', (n) => n.length)) === items);

  // versions: listed in the popover, one can be deleted
  await page.click('#verPop summary');
  const v0 = await page.$$eval('#verList li', (n) => n.length);
  await page.locator('#verList button[aria-label="حذف هذه النسخة"]').first().click();
  await page.click('#askOk');
  check('a version can be deleted', (await page.$$eval('#verList li', (n) => n.length)) === v0 - 1 || (v0 === 1));

  await page.keyboard.press('Escape'); await page.reload(); await page.waitForSelector('#editor .ProseMirror p');
  // keyboard: Shift+Down over two more lines, numbered, then undo
  const olItems = () => page.$$eval('#editor .ProseMirror ol > li', (n) => n.length);
  const before = await olItems();
  await page.locator('#editor .ProseMirror > p').last().click(); await page.keyboard.press('Control+End');
  for (const t of ['سطر أول', 'سطر ثان', 'سطر ثالث']) { await page.keyboard.press('Enter'); await page.keyboard.type(t); }
  await page.keyboard.press('Shift+ArrowUp'); await page.keyboard.press('Shift+ArrowUp'); await page.keyboard.press('Shift+Home');
  await page.waitForTimeout(150);  // the editor reads a keyboard selection on the next tick, as a person never outruns
  await page.keyboard.press('Control+Shift+7');
  const added = (await olItems()) - before;
  check('keyboard: typed lines selected with Shift+Up become a numbered list (Ctrl+Shift+7)', added === 3, `${added} new items`);
  await page.keyboard.press('Control+z');
  check('undo turns them back into lines', (await olItems()) === before);

  await page.screenshot({ path: path.join(__dirname, 'shots', 'editor-check.png') });
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.message.split('\n')[0]); process.exit(2); });
