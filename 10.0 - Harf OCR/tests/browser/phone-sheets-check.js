// Phones: Settings and the other windows are bottom sheets, every sheet has a grabber and closes when pulled down,
// and the text's new tools (borders, spacing, lists, a picture's wrap and crop) work there.
// node phone-sheets-check.js <draftId> [base] [shotsDir]   (changes the draft: use a seeded test draft)
const { chromium } = require('playwright-core');
const path = require('path');
const ID = process.argv[2], BASE = process.argv[3] || 'http://localhost:8765', SHOTS = process.argv[4];
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 4000 }).then(() => true, () => false);
  const shot = (name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, 'phone-' + name + '.png') }) : null);
  // a finger pulling down from y0 to y1
  const pull = async (x, y0, y1, steps = 10) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * i / steps }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const rect = (sel) => page.$eval(sel, (n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom }; });
  const grabber = (sel) => page.$eval(sel, (n) => getComputedStyle(n, '::before').content !== 'none' && getComputedStyle(n, '::before').width === '36px');

  // ---- Settings: a sheet from the bottom, the full width, a grabber; pulled down, it closes
  await page.goto(`${BASE}/`);
  await page.waitForSelector('#btnSettings');
  await page.tap('#btnSettings');
  await until(() => document.getElementById('dlgSettings').open);
  await page.waitForTimeout(500);
  let r = await rect('#dlgSettings');
  check('Settings opens as a bottom sheet', Math.abs(r.b - 844) < 2 && Math.abs(r.w - 390) < 2 && r.y > 30, JSON.stringify(r));
  check('with a grabber', await grabber('#dlgSettings'));
  await shot('settings');
  await pull(195, r.y + 12, r.y + 300);
  check('pulled down by its top, it closes', await until(() => !document.getElementById('dlgSettings').open));
  await page.tap('#btnSettings'); await until(() => document.getElementById('dlgSettings').open); await page.waitForTimeout(500);
  r = await rect('#dlgSettings');
  await pull(195, r.y + 12, r.y + 40);
  await page.waitForTimeout(400);
  check('a short pull springs back', await page.$eval('#dlgSettings', (d) => d.open && !d.style.transform));
  await page.tap('#dlgSettings .dlg-actions .btn');

  // ---- the text: the paragraph sheet, borders and spacing
  await page.goto(`${BASE}/#/d/${ID}`);
  await page.waitForSelector('#editor .ProseMirror p');
  await page.tap('.pane-tabs button:has-text("النص")');
  await page.evaluate(() => {  // the cursor in a plain paragraph
    const pe = document.querySelector('#editor').docEditor, ps = [...document.querySelectorAll('#editor .ProseMirror > p')];
    const p = ps.find((n) => n.textContent.trim().length > 20 && !n.querySelector('mark'));
    pe.editor.commands.setTextSelection(pe.editor.view.posAtDOM(p, 0) + 2);
  });
  await page.tap('summary[aria-label="الفقرة"]');
  await page.waitForTimeout(500);
  const sheet = 'details.tb-sheet[open] > .pop';
  check('the paragraph sheet has a grabber', await grabber(sheet));
  check('it has the list, spacing and borders buttons', await page.$$eval(`${sheet} button`, (bs) => ['التعداد النقطي والترقيم', 'تباعد الأسطر والفقرات', 'حدود الفقرة']
    .every((l) => bs.some((b) => b.getAttribute('aria-label') === l))));
  await shot('paragraph');
  await page.tap(`${sheet} button[aria-label="حدود الفقرة"]`);
  await page.waitForTimeout(500);
  r = await rect('.tb-pop');
  check('the borders menu is a sheet too, with a grabber', Math.abs(r.b - 844) < 2 && await grabber('.tb-pop'), JSON.stringify(r));
  await shot('borders');
  await page.tap('.tb-pop .menu-row:has-text("الحدود الخارجية")');
  check('a box around the paragraph', await until(() => [...document.querySelectorAll('#editor .ProseMirror > p')].some((p) => getComputedStyle(p).borderTopStyle === 'solid' && getComputedStyle(p).borderLeftStyle === 'solid')));
  await page.tap('summary[aria-label="الفقرة"]'); await page.waitForTimeout(500);
  r = await rect(sheet);
  await pull(195, r.y + 10, r.y + 260);
  check('the paragraph sheet closes when pulled down', await until(() => !document.querySelector('details.tb-sheet[open]')));

  // ---- a picture: its tools above it, crop with a finger
  await page.tap('summary[aria-label="إدراج والسطر"]'); await page.waitForTimeout(400);
  await page.tap('details.tb-sheet[open] button[aria-label="إدراج صورة"]'); await page.waitForTimeout(400);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.tap('.tb-pop .menu-row:has-text("صورة من الجهاز")')]);
  await chooser.setFiles(path.join(__dirname, 'seed', 'letter.jpg'));
  check('a picture from the phone goes into the text', await until(() => !!document.querySelector('#editor figure.fig')));
  const fig = page.locator('#editor figure.fig img').last();
  await fig.scrollIntoViewIfNeeded();
  await fig.tap();
  check('tapped, its tools show', await until(() => { const b = document.querySelector('.tb-float button[aria-label="قص الصورة"]'); return b && !b.hidden && b.offsetParent; }));
  check('its resize handles are finger-sized', (await page.$eval('#editor .ProseMirror-selectednode .fig-handle', (h) => h.getBoundingClientRect().width)) >= 20);
  await shot('picture');
  await page.tap('.tb-float button[aria-label="قص الصورة"]');
  check('Crop shows the frame', await until(() => !!document.querySelector('#editor .fig-box.cropping')));
  await shot('crop');
  await page.tap('.tb-float button[aria-label="قص الصورة"]');
  check('and ends', await until(() => !document.querySelector('#editor .fig-box.cropping')));
  await page.tap('.tb-float button[aria-label="التفاف النص وحجم الصورة وإطارها"]'); await page.waitForTimeout(500);
  r = await rect('.tb-pop');
  check('the wrap menu is a sheet that fits the screen', r.y >= 0 && Math.abs(r.b - 844) < 2, JSON.stringify(r));
  await shot('wrap');

  // ---- the line preview: a part of it picked with a finger and put in the text
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await page.evaluate(() => {
    const pe = document.querySelector('#editor').docEditor, p = document.querySelector('#editor .ProseMirror p[data-lines]');
    pe.editor.commands.setTextSelection(pe.editor.view.posAtDOM(p, 0) + 2);
  });
  const figs0 = await page.locator('#editor figure.fig').count();
  await page.tap('summary[aria-label="إدراج والسطر"]'); await page.waitForTimeout(400);
  await page.tap('details.tb-sheet[open] button[aria-label="السطر في صورة الصفحة، وقراءته بقارئ آخر"]');
  check('the line preview opens as a sheet', await until(() => { const c = document.getElementById('lineCrop'); return c && !c.classList.contains('hidden') && document.getElementById('linePop').getBoundingClientRect().bottom > 840; }));
  await page.waitForTimeout(500);
  await page.tap('#linePickPart');
  const c = await page.$eval('#lineCrop', (n) => { const a = n.getBoundingClientRect(), b = n.closest('.line-crop').getBoundingClientRect();
    return { x0: Math.max(a.x, b.x) + 8, y0: Math.max(a.y, b.y) + 4, x1: Math.min(a.right, b.right) - 8, y1: Math.min(a.bottom, b.bottom) - 4 }; });
  const top0 = (await rect('#linePop')).y;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x0, y: c.y0 }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x0 + (c.x1 - c.x0) * i / 8, y: c.y0 + (c.y1 - c.y0) * i / 8 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check('a finger draws the box, and the sheet stays put', await page.isVisible('#lineBox') && Math.abs((await rect('#linePop')).y - top0) < 2);
  await shot('line-pick');
  await page.tap('#linePickInsert');
  check('the part goes into the text', await until((n) => document.querySelectorAll('#editor figure.fig').length === n + 1, figs0), await page.evaluate(() => JSON.stringify({ toast: (document.querySelector('.toast') || {}).textContent, pop: !document.getElementById('linePop').classList.contains('hidden'), figs: document.querySelectorAll('#editor figure, #editor .fig').length, inCell: !!document.querySelector("#editor td figure, #editor th figure") })));

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.message); process.exit(2); });
