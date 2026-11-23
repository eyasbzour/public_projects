// Word-like layout tools: bullets and numbering in one menu, a list item on the side of its first letter, line and
// paragraph spacing, a picture from a file, and a picture the text wraps around; all still there after a reload.
// node layout-check.js <draftId> [base]   (changes the draft: use a seeded test draft)
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
  const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 4000 }).then(() => true, () => false);
  const pm = '#editor .ProseMirror';

  // a new paragraph at the end to work in
  await page.evaluate(() => document.querySelector('#editor').docEditor.editor.commands.focus('end'));
  await page.keyboard.press('Enter');
  await page.keyboard.type('بند أول');

  // ---- one list menu
  check('one list button in place of two', (await page.$$('#fmtBar button[aria-label="قائمة نقطية"]')).length === 0 && await tb('التعداد النقطي والترقيم').count() === 1);
  await tb('التعداد النقطي والترقيم').click();
  check('the menu has the bullet and numbering libraries', (await page.$$eval('.tb-pop .ls-tile', (n) => n.length)) === 13);
  await page.click('.tb-pop .ls-tile[aria-label="علامة صح"]');
  check('a check-mark bullet list', await until(() => { const ul = document.querySelector('#editor .ProseMirror > ul[data-ls="check"]'); return ul && getComputedStyle(ul).listStyleType.includes('✓'); }));
  check('the list button shows the list is on', (await tb('التعداد النقطي والترقيم').getAttribute('aria-pressed')) === 'true');
  await tb('التعداد النقطي والترقيم').click();
  check('the menu marks the style in use', (await page.getAttribute('.tb-pop .ls-tile[aria-label="علامة صح"]', 'aria-pressed')) === 'true');
  await page.click('.tb-pop .ls-tile[aria-label="أرقام هندية"]');
  check('the same items become numbered in Arabic-Indic digits',
    await until(() => { const ol = document.querySelector('#editor .ProseMirror > ol[data-ls="hindi"]'); return ol && getComputedStyle(ol).listStyleType === 'arabic-indic'; }));
  check('the list button shows numbering', (await page.$eval('#fmtBar button[aria-label="التعداد النقطي والترقيم"] use', (u) => u.getAttribute('href'))).endsWith('list-numbers'));

  // ---- a list item on the side of its first letter
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.keyboard.type('English item, 2 words');
  const sides = () => page.$$eval(`${pm} > ol[data-ls="hindi"] > li`, (ns) => ns.map((li) => ({ dir: getComputedStyle(li).direction, ml: parseFloat(getComputedStyle(li).marginLeft), mr: parseFloat(getComputedStyle(li).marginRight) })));
  let s = await sides();
  check('an English item runs left to right, indented from the left', s.length === 2 && s[1].dir === 'ltr' && s[1].ml > 0 && s[1].mr === 0, JSON.stringify(s));
  check('the Arabic item stays right to left', s[0].dir === 'rtl' && s[0].mr > 0, JSON.stringify(s[0]));
  await page.keyboard.press('Home'); await page.keyboard.press('Shift+End'); await page.keyboard.type('بند ثان');
  s = await sides();
  check('typing Arabic over it turns it back', s[1].dir === 'rtl', JSON.stringify(s[1]));

  // ---- line and paragraph spacing, on a paragraph with no flagged word (a click on one opens its panel)
  const at = await page.$$eval(`${pm} > p`, (ns) => ns.findIndex((n) => n.textContent.trim().length > 20 && !n.querySelector('mark')));
  const para = `${pm} > p >> nth=${at}`;
  await page.click(para);
  await tb('تباعد الأسطر والفقرات').click();
  check('the spacing menu marks 1.25 as the usual', (await page.getAttribute('.tb-pop .menu-row:has-text("1.25")', 'aria-pressed')) === 'true');
  await page.click('.tb-pop .menu-row:has-text("2.0")');
  check('double line spacing', await until((k) => { const p = document.querySelectorAll('#editor .ProseMirror > p')[k]; return p.dataset.lh === '2' && Math.abs(parseFloat(getComputedStyle(p).lineHeight) / parseFloat(getComputedStyle(p).fontSize) - 3.2) < 0.05; }, at));
  await tb('تباعد الأسطر والفقرات').click();
  await page.click('.tb-pop .menu-row:has-text("إضافة مسافة قبل الفقرة")');
  check('space before the paragraph', await until((k) => document.querySelectorAll('#editor .ProseMirror > p')[k].dataset.sb === '12', at));
  await tb('تباعد الأسطر والفقرات').click();
  check('the menu now offers to take it away', await page.locator('.tb-pop .menu-row:has-text("إزالة المسافة قبل الفقرة")').count() === 1);
  await page.keyboard.press('Escape');

  // ---- any picture, from a file
  await page.click(para);
  const before = await page.$$eval(`${pm} figure.fig`, (n) => n.length);
  await tb('إدراج صورة').click();
  check('the picture menu has a file and a part of the page photo', await page.locator('.tb-pop .menu-row').count() === 2);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.tb-pop .menu-row:has-text("صورة من الجهاز")')]);
  await chooser.setFiles(path.join(__dirname, 'seed', 'letter.jpg'));
  check('a picture from a file goes into the text', await until((n) => document.querySelectorAll('#editor figure.fig').length === n + 1, before));

  // ---- the text wraps around it
  const fig = page.locator(`${pm} figure.fig >> nth=${before}`);
  await fig.locator('img').click();
  await page.locator('.tb-float button[aria-label="التفاف النص وحجم الصورة وإطارها"]').click();
  await page.click('.tb-pop .menu-row:has-text("مربّع")');
  check('Square: the picture floats at the start (right), the text beside it',
    await until((k) => { const f = document.querySelectorAll('#editor figure.fig')[k]; return f.dataset.wrap === 'square' && getComputedStyle(f).float === 'right'; }, before));
  await fig.locator('img').click();
  await page.locator('.tb-float button[aria-label="التفاف النص وحجم الصورة وإطارها"]').click();
  await page.click('.tb-pop .menu-chip:has-text("25%")');
  check('its width: a quarter of the page', await until((k) => document.querySelectorAll('#editor figure.fig')[k].style.width === '25%', before));
  await fig.locator('img').click();
  await page.locator('.tb-float button[aria-label="الصورة لليسار"]').click();
  check('to the left, it floats left', await until((k) => getComputedStyle(document.querySelectorAll('#editor figure.fig')[k]).float === 'left', before));

  // ---- all of it saved with the draft
  await page.click('#btnSave'); await page.waitForFunction(() => document.getElementById('saveState').textContent === 'محفوظ');
  await page.reload();
  await page.waitForSelector('#editor .ProseMirror p');
  const kept = await page.evaluate(([k, at]) => {
    const f = document.querySelectorAll('#editor figure.fig')[k], p = document.querySelectorAll('#editor .ProseMirror > p')[at];
    const ol = document.querySelector('#editor .ProseMirror > ol[data-ls="hindi"]');
    return { wrap: f && f.dataset.wrap, align: f && f.dataset.align, w: f && f.style.width, lh: p.dataset.lh, sb: p.dataset.sb, ol: !!ol };
  }, [before, at]);
  check('after a reload: wrap, side, width, spacing and the list style', kept.wrap === 'square' && kept.align === 'end' && kept.w === '25%' && kept.lh === '2' && kept.sb === '12' && kept.ol, JSON.stringify(kept));

  // ---- paragraph borders, as Word's Borders button
  const bpara = `${pm} > p >> nth=${at}`;
  await page.click(bpara);
  const bmenu = async (row) => { await tb('حدود الفقرة').click(); await page.click(`.tb-pop :is(.menu-row, .menu-chip):has-text("${row}")`); };
  await bmenu('حد سفلي');
  const pb = (k) => page.$eval(bpara, (p, k) => { const c = getComputedStyle(p); return [c.borderTopStyle, c.borderBottomStyle, c.borderLeftStyle, c.borderRightStyle][k]; }, k);
  check('a bottom border', await pb(1) === 'solid' && await pb(0) === 'none');
  await bmenu('مزدوج');
  check('the line style applies to the borders it has', await pb(1) === 'double');
  await bmenu('حد سفلي');
  check('the bottom border again takes it away', await pb(1) === 'none');
  // two paragraphs next to each other selected: one box around both
  const two = await page.$$eval(`${pm} > p`, (ns) => ns.findIndex((n, i) => ns[i + 1] && n.nextElementSibling === ns[i + 1] && n.textContent.trim() && ns[i + 1].textContent.trim()));
  await page.evaluate((k) => {
    const pe = document.querySelector('#editor').docEditor, ps = document.querySelectorAll('#editor .ProseMirror > p');
    const v = pe.editor.view, a = v.posAtDOM(ps[k], 0), b = v.posAtDOM(ps[k + 1], ps[k + 1].childNodes.length);
    pe.editor.commands.setTextSelection({ from: a, to: b });
  }, two);
  await bmenu('الحدود الخارجية');
  const box2 = await page.evaluate((k) => {
    const ps = document.querySelectorAll('#editor .ProseMirror > p'), a = getComputedStyle(ps[k]), b = getComputedStyle(ps[k + 1]);
    return { aTop: a.borderTopStyle, aBottom: a.borderBottomStyle, bTop: b.borderTopStyle, bBottom: b.borderBottomStyle, gap: ps[k + 1].getBoundingClientRect().top - ps[k].getBoundingClientRect().bottom };
  }, two);
  check('Outside Borders: one box around both paragraphs', box2.aTop === 'double' && box2.aBottom === 'none' && box2.bTop === 'none' && box2.bBottom === 'double' && Math.abs(box2.gap) < 1, JSON.stringify(box2));
  await bmenu('كل الحدود');
  check('All Borders: a line between them too', await page.evaluate((k) => getComputedStyle(document.querySelectorAll('#editor .ProseMirror > p')[k + 1]).borderTopStyle, two) === 'double');
  await bmenu('بلا حدود');
  check('No Border takes them all away', await page.evaluate((k) => [...document.querySelectorAll('#editor .ProseMirror > p')].slice(k, k + 2).every((p) => !p.dataset.bd), two));
  await bmenu('حد علوي');

  // ---- the direction button moves a list item's marker to the other side, and that sticks
  await page.click(`${pm} > ol[data-ls="hindi"] > li >> nth=0`);
  await tb('اتجاه الفقرة: من اليسار (إنجليزي) أو من اليمين').click();
  const liDir = () => page.$eval(`${pm} > ol[data-ls="hindi"] > li`, (li) => ({ dir: getComputedStyle(li).direction, ml: parseFloat(getComputedStyle(li).marginLeft) }));
  let ld = await liDir();
  check('the direction button turns an Arabic list item left to right, its marker on the left', ld.dir === 'ltr' && ld.ml > 0, JSON.stringify(ld));
  await page.keyboard.type('ي');
  check('typing in it keeps the side chosen by hand', (await liDir()).dir === 'ltr');
  await tb('اتجاه الفقرة: من اليسار (إنجليزي) أو من اليمين').click();
  check('and back', (await liDir()).dir === 'rtl');

  // ---- every layout option: in the line, a border, resizing, behind the text
  const wrapMenu = async (row) => {
    await page.locator('.tb-float button[aria-label="التفاف النص وحجم الصورة وإطارها"]').click();
    await page.click(`.tb-pop :is(.menu-row, .menu-chip):has-text("${row}")`);
  };
  check('the wrap menu has all the layout options of Word', await (async () => {
    await page.locator(`${pm} figure.fig >> nth=${before}`).locator('img').click();
    await page.locator('.tb-float button[aria-label="التفاف النص وحجم الصورة وإطارها"]').click();
    const n = await page.locator('.tb-pop .menu-row').count(), c = await page.locator('.tb-pop .menu-chip').count();
    await page.keyboard.press('Escape'); return n === 7 && c === 5 + 6;
  })());
  const nFig = await page.$$eval(`${pm} figure.fig`, (n) => n.length);
  await page.locator(`${pm} figure.fig >> nth=${before}`).locator('img').click();
  await wrapMenu('في السطر مع النص');
  check('In Line with Text: the picture goes into a paragraph, among its words',
    await until((n) => document.querySelectorAll('#editor figure.fig').length === n - 1 && !!document.querySelector('#editor .ProseMirror p span.fig-inline'), nFig));
  await wrapMenu('خط مزدوج');
  check('a double border', await until(() => getComputedStyle(document.querySelector('#editor span.fig-inline img')).borderTopStyle === 'double'));
  await page.locator(`${pm} span.fig-inline img`).click();  // selected: its handles show
  const w0 = await page.$eval(`${pm} span.fig-inline`, (n) => n.getBoundingClientRect().width);
  const hd = await page.$eval(`${pm} span.fig-inline .fig-handle[data-side="right"]`, (h) => { const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(hd.x, hd.y); await page.mouse.down(); await page.mouse.move(hd.x + 80, hd.y, { steps: 6 }); await page.mouse.up();
  const w1 = await page.$eval(`${pm} span.fig-inline`, (n) => n.getBoundingClientRect().width);
  check('dragging its corner handle makes it bigger', w1 > w0 + 50, `${Math.round(w0)} -> ${Math.round(w1)}`);
  await page.locator(`${pm} span.fig-inline img`).click();
  await wrapMenu('خلف النص');
  check('Behind Text: a picture of its own again, under the text', await until(() => { const f = document.querySelector('#editor figure.fig[data-wrap="behind"]'); return f && getComputedStyle(f.querySelector('.fig-box')).zIndex === '-1'; }));
  // in front of the text it can be taken anywhere (behind it, a click on its text goes to the text, as in Word)
  await page.evaluate(() => { const f = document.querySelector('#editor figure.fig[data-wrap="behind"]'); const pe = document.querySelector('#editor').docEditor; pe.editor.commands.setNodeSelection(pe.editor.view.posAtDOM(f, 0)); });
  await wrapMenu('أمام النص');
  check('In Front of Text: over the text', await until(() => { const f = document.querySelector('#editor figure.fig[data-wrap="front"]'); return f && getComputedStyle(f.querySelector('.fig-box')).zIndex === '2'; }));
  const box = () => page.$eval(`${pm} figure.fig[data-wrap="front"] .fig-box`, (b) => {  // on the page, not the screen: a reload scrolls elsewhere
    const r = b.getBoundingClientRect(), d = b.closest('.ProseMirror').getBoundingClientRect();
    return { x: r.x - d.x, y: r.y - d.y, w: r.width, h: r.height, sx: r.x, sy: r.y };
  });
  await page.$eval(`${pm} figure.fig[data-wrap="front"] .fig-box`, (b) => b.scrollIntoView({ block: 'center' }));
  const b0 = await box();
  await page.mouse.move(b0.sx + b0.w / 2, b0.sy + b0.h / 2); await page.mouse.down();
  await page.mouse.move(b0.sx + b0.w / 2 - 90, b0.sy + b0.h / 2 + 40, { steps: 8 }); await page.mouse.up();
  const b1 = await box();
  check('dragged anywhere on the page', Math.abs(b1.x - (b0.x - 90)) < 3 && Math.abs(b1.y - (b0.y + 40)) < 3, JSON.stringify({ b0, b1 }));
  await page.click('#btnSave'); await page.waitForFunction(() => document.getElementById('saveState').textContent === 'محفوظ');
  await page.reload(); await page.waitForSelector('#editor .ProseMirror p');
  const b2 = await box();
  check('after a reload it is where it was dropped, the same size, framed', Math.abs(b2.x - b1.x) < 3 && Math.abs(b2.y - b1.y) < 3 && Math.abs(b2.w - b1.w) < 3
    && await page.$eval(`${pm} figure.fig[data-wrap="front"] img`, (i) => getComputedStyle(i).borderTopStyle === 'double'), JSON.stringify(b2));

  // ---- cropping, as in Word: drag the frame's left edge in, then end it; the picture keeps its scale
  const front = `${pm} figure.fig[data-wrap="front"]`;
  await page.$eval(`${front} .fig-box`, (b) => b.scrollIntoView({ block: 'center' }));
  await page.locator(`${front} img`).click();
  const before0 = await box();
  await page.locator('.tb-float button[aria-label="قص الصورة"]').click();
  check('Crop shows the frame to drag', await until(() => !!document.querySelector('#editor .fig-box.cropping .crop-frame')));
  const lh = await page.$eval(`${front} .crop-handle[data-edge="l"]`, (h) => { const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(lh.x, lh.y); await page.mouse.down(); await page.mouse.move(lh.x + before0.w * 0.3, lh.y, { steps: 6 }); await page.mouse.up();
  await page.locator('.tb-float button[aria-label="قص الصورة"]').click();
  const after0 = await box();
  check('cropped: 30% less wide, the same height, its left part gone', await until(() => !!document.querySelector('#editor .fig-box.cropped'))
    && Math.abs(after0.w - before0.w * 0.7) < 4 && Math.abs(after0.h - before0.h) < 4, JSON.stringify({ before0, after0 }));
  await page.click('#btnSave'); await page.waitForFunction(() => document.getElementById('saveState').textContent === 'محفوظ');
  await page.reload(); await page.waitForSelector('#editor .ProseMirror p');
  const kept0 = await box();
  check('the crop is kept after a reload', Math.abs(kept0.w - after0.w) < 4 && Math.abs(kept0.h - after0.h) < 4, JSON.stringify(kept0));

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.message); process.exit(2); });
