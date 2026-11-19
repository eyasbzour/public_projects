// A line or paragraph of the text: its spot on the photo when clicked, reading it again, replacing only that
// text, line places that follow edits, text with no place, and pictures pasted from the clipboard.
//   node line-check.js <draftId with a PaddleOCR page> [base]
const { chromium } = require('playwright-core');
const path = require('path');
const ID = process.argv[2], BASE = process.argv[3] || 'http://localhost:8765';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/#/d/${ID}`); await page.waitForSelector('#editor .ProseMirror p');

  // the first paragraph whose lines the reading recorded, and the screen point of a place in its text
  const para = page.locator('#editor .ProseMirror p[data-lines]').first();
  check('a read paragraph records its lines', (await para.count()) === 1);
  const info = () => para.evaluate((p) => ({ text: p.textContent, lines: JSON.parse(p.dataset.lines) }));
  const pointAt = (offset) => para.evaluate((p, off) => {
    const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let n, left = off;
    while ((n = w.nextNode())) { if (left <= n.length) break; left -= n.length; }
    const r = document.createRange(); r.setStart(n, Math.min(left, n.length)); r.setEnd(n, Math.min(left + 1, n.length));
    const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, offset);
  const clickAt = async (offset) => { const pt = await pointAt(offset); await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(150); };
  const target = () => page.evaluate(() => { const t = window.__pe().readTarget(); return t && { line: t.line && t.line.text, para: t.para && t.para.text }; });
  await page.evaluate(() => { window.__pe = () => document.querySelector('#editor').docEditor; });

  let { text, lines } = await info();
  const lineText = (k, t = text, ls = lines) => t.slice(ls[k][4], k + 1 < ls.length ? ls[k + 1][4] - 1 : t.length);
  // 1. a click in the second line shows that line on the photo, and changes nothing in the draft
  const saved0 = await page.textContent('#saveState');
  await clickAt(lines[1][4] + 3);
  check('a click alone leaves the draft unchanged', (await page.textContent('#saveState')) === saved0, saved0);
  check('a click into the text opens the line panel', await page.isVisible('#linePop'));
  check('it offers the line and the paragraph', await page.isVisible('#linePickLine') && await page.isVisible('#linePickPara'));
  const crop = async () => page.$eval('#lineCrop', (c) => ({ w: c.offsetWidth, h: c.offsetHeight, shown: !c.classList.contains('hidden') }));
  await page.waitForFunction(() => !document.querySelector('#lineCrop').classList.contains('hidden'), null, { timeout: 5000 }).catch(() => {});
  const c1 = await crop();
  check('the line\'s spot on the photo is shown, at a readable size', c1.shown && c1.h >= 30 && c1.h < 110, JSON.stringify(c1));
  const lineNow = (await target()).line;
  check('the line is the one clicked', norm(lineNow) === norm(lineText(1)), `«${norm(lineNow).slice(0, 40)}»`);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'line-panel.png') });
  await page.click('#linePickPara');
  await page.waitForTimeout(300);
  const c2 = await crop();
  check('the paragraph shows more of the photo', c2.shown && c2.h > c1.h, `${c1.h} -> ${c2.h}`);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'line-panel-para.png') });
  await page.click('#linePickLine');

  // 2. reading the line again replaces only that line
  await page.selectOption('#lineEngine', 'tess-best');
  await page.click('#lineReadBtn');
  await page.waitForFunction(() => /«/.test(document.querySelector('#lineText').textContent) || /لم يقرأ/.test(document.querySelector('#lineText').textContent), null, { timeout: 60000 });
  const shown = await page.textContent('#lineText');
  const got = (shown.match(/«(.*)»/) || [])[1] || '';
  check('the other reader\'s reading of the line is shown', !!got, `«${got.slice(0, 50)}»`);
  const before = await info();
  const canUse = !(await page.isDisabled('#lineUse'));
  if (canUse) {
    await page.click('#lineUse');
    const after = await info();
    const head = before.text.slice(0, before.lines[1][4]), tail = before.lines.length > 2 ? before.text.slice(before.lines[2][4] - 1) : '';
    check('replacing the line keeps the text before it', after.text.startsWith(head));
    check('and the text after it', after.text.endsWith(tail));
    check('and puts the reading in its place', norm(after.text.slice(head.length, after.text.length - tail.length)) === norm(got),
      `«${norm(after.text.slice(head.length, after.text.length - tail.length)).slice(0, 40)}»`);
    check('the panel closes after replacing', !(await page.isVisible('#linePop')));
    if (after.lines.length > 2) check('the next line starts where it should after the new text', after.text.slice(after.lines[2][4]).startsWith(before.text.slice(before.lines[2][4])));
    await para.click(); await page.keyboard.press('Control+z'); await page.waitForTimeout(100);
    check('undo brings the line back', (await info()).text === before.text);
  } else check('(the reading matched the line, nothing to replace)', true);
  ({ text, lines } = await info());

  // 3. line places follow edits: type at the start of the paragraph, then the second line is still the second line
  await clickAt(0);
  await page.keyboard.press('Escape');
  const caretToStart = await para.evaluate((p) => { const s = window.getSelection(), r = document.createRange(); const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); const n = w.nextNode(); r.setStart(n, 0); r.collapse(true); s.removeAllRanges(); s.addRange(r); return true; });
  await page.waitForTimeout(150);
  await page.keyboard.type('كلمة مضافة ');
  const typed = await info();
  check('typing changes the paragraph', typed.text.startsWith('كلمة مضافة '), `«${typed.text.slice(0, 20)}»`);
  check('and the lines after move with it', lineText(1, typed.text, typed.lines) === lineText(1), `«${lineText(1, typed.text, typed.lines).slice(0, 30)}»`);
  await clickAt(typed.lines[1][4] + 3);
  check('clicking the second line still shows the second line', norm((await target()).line) === norm(lineText(1)));
  await page.keyboard.press('Escape');
  for (let k = 0; k < 3; k++) await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);

  // 4. a paragraph replaced whole, and the safety check when the text changed since the reading
  const guard = await page.evaluate(() => {
    const pe = window.__pe(), t = pe.readTarget();
    return { stale: pe.replaceRange(t.para.from, t.para.to, t.para.text + 'x', [{ s: 'لا' }]), text: document.querySelector('#editor p[data-lines]').textContent };
  });
  check('a replacement for text that has changed since is refused', guard.stale === false && guard.text === text);
  const whole = await page.evaluate(() => {
    const pe = window.__pe(); const t = pe.readTarget(pe.posAt(...(() => { const r = document.querySelector('#editor p[data-lines]').getBoundingClientRect(); return [r.right - 20, r.top + 8]; })()));
    const ok = pe.replaceRange(t.para.from, t.para.to, t.para.text, [{ s: 'نص ' }, { s: 'جديد', note: 'ملاحظة', box: [0.1, 0.1, 0.2, 0.12] }, { s: ' للفقرة' }]);
    const p = document.querySelector('#editor .ProseMirror').children[[...document.querySelector('#editor .ProseMirror').children].findIndex((n) => n.textContent.startsWith('نص جديد'))];
    return { ok, text: p && p.textContent, flag: p && p.querySelector('mark.flag') && p.querySelector('mark.flag').dataset.box };
  });
  check('a paragraph replaced whole takes the reading, flags and their spots too', whole.ok && whole.text === 'نص جديد للفقرة' && whole.flag === '0.1,0.1,0.2,0.12', JSON.stringify(whole));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(100);

  // 5. Enter splits a paragraph: the new half has no place on the photo
  await clickAt(lines[1][4]); await page.keyboard.press('Escape');
  const split = await page.evaluate(() => {
    const pe = window.__pe(); const ed = pe.editor; const t = pe.readTarget();
    ed.commands.setTextSelection(t.line.from); ed.commands.splitBlock();
    const ps = [...document.querySelectorAll('#editor .ProseMirror > p')];
    const k = ps.findIndex((p) => p.dataset.lines);
    return { first: !!ps[k].dataset.box, second: !!(ps[k + 1] && ps[k + 1].dataset.box) };
  });
  check('after Enter the first half keeps its place and the new half has none', split.first && !split.second, JSON.stringify(split));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(100);

  // 6. text with no place on the photo: a click shows nothing, the toolbar button says why
  await page.evaluate(() => { const ed = window.__pe().editor; ed.commands.setTextSelection(ed.state.doc.content.size - 1); ed.commands.insertContent('<p>نص كُتب يدوياً</p>'); });
  const typedP = page.locator('#editor .ProseMirror > p', { hasText: 'نص كُتب يدوياً' });
  await typedP.click(); await page.waitForTimeout(150);
  check('a click in typed text opens nothing', !(await page.isVisible('#linePop')));
  await page.click('#fmtBar button[aria-label="السطر في صورة الصفحة، وقراءته بقارئ آخر"]');
  check('the toolbar button explains why there is nothing to show', await page.isVisible('#lineWhy') && /لا يُعرف موضع/.test(await page.textContent('#lineWhy')));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'line-none.png') });
  await page.keyboard.press('Escape');
  check('Escape closes it', !(await page.isVisible('#linePop')));
  await page.keyboard.press('Control+z');

  // 7. pictures from the clipboard
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 120; const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, 400, 120); g.fillStyle = '#14532d'; g.fillRect(20, 20, 160, 80);  // transparent around it
    return c.toDataURL('image/png');
  });
  const paste = (sel, withText) => page.evaluate(async ({ sel, png, withText }) => {
    const blob = await (await fetch(png)).blob();
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    if (withText) dt.setData('text/plain', withText);
    document.querySelector(sel).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { sel, png, withText });
  const figs = () => page.$$eval('#editor figure.fig', (f) => f.length);
  const f0 = await figs();
  await para.click(); await page.keyboard.press('Escape');
  await paste('#editor .ProseMirror');
  await page.waitForFunction((n) => document.querySelectorAll('#editor figure.fig').length > n, f0, { timeout: 10000 }).catch(() => {});
  check('a picture pasted into the text goes in as a picture', (await figs()) === f0 + 1);
  const corner = await page.evaluate(async () => {
    const img = [...document.querySelectorAll('#editor figure.fig img')].pop(); await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
    return [...c.getContext('2d').getImageData(2, 2, 1, 1).data].slice(0, 3);
  });
  check('its transparent parts come out white, not black', corner.every((v) => v > 240), JSON.stringify(corner));
  await page.keyboard.press('Control+z');
  const t0 = (await para.textContent());
  await para.click(); await page.keyboard.press('Escape');
  await paste('#editor .ProseMirror', 'نص من وورد');
  await page.waitForTimeout(300);
  check('text copied with a picture of it (from Word) pastes as text', (await figs()) === f0 && (await page.textContent('#editor .ProseMirror')).includes('نص من وورد'));
  await page.keyboard.press('Control+z');
  const pages0 = await page.$$eval('.page-item', (x) => x.length);
  await paste('#photoFrame');
  await page.waitForFunction((n) => document.querySelectorAll('.page-item').length > n, pages0, { timeout: 10000 }).catch(() => {});
  check('a picture pasted outside the text becomes a new page', (await page.$$eval('.page-item', (x) => x.length)) === pages0 + 1);
  // the real clipboard and Ctrl+V
  await page.evaluate(async (png) => { const b = await (await fetch(png)).blob(); await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); }, png).catch((e) => console.log('  (clipboard write:', e.message, ')'));
  await para.click(); await page.keyboard.press('Escape');
  const f1 = await figs();
  await page.keyboard.press('Control+v');
  await page.waitForFunction((n) => document.querySelectorAll('#editor figure.fig').length > n, f1, { timeout: 8000 }).catch(() => {});
  check('Ctrl+V with a copied picture puts it in the text', (await figs()) === f1 + 1);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'paste.png') });

  // 8. tables: a cell shows its own spot, the row can be shown and read but only a cell is replaced
  const cell = page.locator('#editor .ProseMirror table td p[data-box]').filter({ hasText: /\S/ }).nth(1);
  check('table cells know their place on the photo', (await cell.count()) === 1);
  await cell.click(); await page.waitForTimeout(150);
  check('a click in a cell opens the panel', await page.isVisible('#linePop'));
  check('it offers the cell and its row', (await page.textContent('#linePickPara')) === 'الخلية' && await page.isVisible('#linePickRow') && !(await page.isVisible('#linePickLine')));
  await page.waitForFunction(() => !document.querySelector('#lineCrop').classList.contains('hidden'), null, { timeout: 5000 }).catch(() => {});
  const cc = await crop();
  check('the cell\'s spot on the photo is shown', cc.shown && cc.h > 20, JSON.stringify(cc));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'line-cell.png') });
  await page.click('#linePickRow'); await page.waitForTimeout(300);
  const rc = await crop();
  check('the row shows a wider spot', rc.shown && rc.w > cc.w, `${cc.w} -> ${rc.w}`);
  await page.selectOption('#lineEngine', 'tess-best'); await page.click('#lineReadBtn');
  await page.waitForFunction(() => /«|لم يقرأ/.test(document.querySelector('#lineText').textContent), null, { timeout: 60000 });
  check('a row can be read to compare, not replaced', !(await page.isVisible('#lineUse')));
  await page.click('#linePickPara'); await page.click('#lineReadBtn');
  await page.waitForFunction(() => /«|لم يقرأ/.test(document.querySelector('#lineText').textContent), null, { timeout: 60000 });
  const cellText = (await page.textContent('#lineText').then((x) => (x.match(/«(.*)»/) || [])[1])) || '';
  const otherCells = await page.$$eval('#editor table td', (t) => t.map((x) => x.textContent));
  const cellBefore = await cell.textContent();
  if (cellText && !(await page.isDisabled('#lineUse'))) {
    await page.click('#lineUse');
    const now = await page.$$eval('#editor table td', (t) => t.map((x) => x.textContent));
    const changed = now.map((x, i) => x !== otherCells[i]).filter(Boolean).length;
    check('replacing a cell changes only that cell', changed === 1 && now.includes(cellText), `${cellBefore} -> ${cellText}`);
    await page.keyboard.press('Control+z');
  } else check('(the cell reading matched, nothing to replace)', true, `«${cellText}»`);

  // 9. the click preview turned off and on from the toolbar, remembered after a reload
  const eye = '#fmtBar button[aria-label="معاينة السطر من الصورة عند النقر"]';
  check('the preview switch is on at first', (await page.getAttribute(eye, 'aria-pressed')) === 'true');
  await page.click(eye);
  check('one press turns it off', (await page.getAttribute(eye, 'aria-pressed')) === 'false');
  await clickAt(lines[1][4] + 3);
  check('with it off a click shows nothing', !(await page.isVisible('#linePop')));
  await page.click('#fmtBar button[aria-label="السطر في صورة الصفحة، وقراءته بقارئ آخر"]');
  check('the button still shows the line when asked', await page.isVisible('#linePop') && !(await page.isVisible('#lineWhy')));
  await page.keyboard.press('Escape');
  await page.reload(); await page.waitForSelector('#editor .ProseMirror p');
  check('off is remembered after a reload', (await page.getAttribute(eye, 'aria-pressed')) === 'false');
  await page.click(eye);
  await clickAt(lines[1][4] + 3);
  check('turned back on, a click shows the line again', await page.isVisible('#linePop'));

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.message.split('\n')[0]); process.exit(2); });
