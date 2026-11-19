// Interaction checks for the redesigned workspace. node ui-check.js <draftId> [base]
const { chromium } = require('playwright-core');
const path = require('path');
const id = process.argv[2], BASE = process.argv[3] || 'http://localhost:8765';
const OUT = path.join(__dirname, 'shots');
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/#/d/${id}`);
  await page.evaluate(() => localStorage.removeItem('ds.panes'));
  await page.reload(); await page.waitForSelector('#editor .ProseMirror p');
  const width = (sel) => page.$eval(sel, (n) => Math.round(n.getBoundingClientRect().width));

  // splitters: drag pages bar 80px to the left (RTL: widens the pages pane)
  const w0 = await width('.pane.pages');
  const sp = await page.$('.splitter[data-pane=pages]'); const b = await sp.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + 300); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 - 80, b.y + 300, { steps: 6 }); await page.mouse.up();
  const w1 = await width('.pane.pages');
  check('drag widens pages pane', Math.abs(w1 - w0 - 80) <= 2, `${w0} -> ${w1}`);
  const p0 = await width('.pane.photo');
  const sp2 = await page.$('.splitter[data-pane=photo]'); const b2 = await sp2.boundingBox();
  await page.mouse.move(b2.x + 4, b2.y + 300); await page.mouse.down();
  await page.mouse.move(b2.x + 4 - 120, b2.y + 300, { steps: 6 }); await page.mouse.up();
  const p1 = await width('.pane.photo');
  check('drag widens photo pane', Math.abs(p1 - p0 - 120) <= 2, `${p0} -> ${p1}`);
  await page.focus('.splitter[data-pane=pages]'); await page.keyboard.press('ArrowRight');
  check('arrow key narrows by 16', Math.abs((await width('.pane.pages')) - (w1 - 16)) <= 2);
  await page.reload(); await page.waitForSelector('#editor .ProseMirror p');
  check('widths persist after reload', Math.abs((await width('.pane.photo')) - p1) <= 2);
  await page.dblclick('.splitter[data-pane=photo]');
  check('double-click resets', await page.$eval('#workspace', (n) => n.style.getPropertyValue('--size-photo') === ''));
  check('no horizontal overflow (desktop)', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // flags list height: drag its top bar up 100px, then arrow keys
  const fh = () => page.$eval('#flagsPanel', (n) => Math.round(n.getBoundingClientRect().height));
  const h0 = await fh(); const fb = await (await page.$('#flagSplit')).boundingBox();
  await page.mouse.move(fb.x + 200, fb.y + fb.height / 2); await page.mouse.down();
  await page.mouse.move(fb.x + 200, fb.y + fb.height / 2 - 100, { steps: 6 }); await page.mouse.up();
  const h1 = await fh();
  check('drag up makes flags list taller', Math.abs(h1 - h0 - 100) <= 2, `${h0} -> ${h1}`);
  await page.focus('#flagSplit'); await page.keyboard.press('ArrowDown');
  check('ArrowDown shrinks flags list by 16', Math.abs((await fh()) - (h1 - 16)) <= 2);
  await page.click('#flagsPanel > summary');
  check('flags bar hides when the list is closed', await page.waitForFunction(() => document.getElementById('flagSplit').hidden, null, { timeout: 2000 }).then(() => true, () => false));
  await page.click('#flagsPanel > summary');
  await page.dblclick('#flagSplit');

  // folding panes into rails
  const total = await width('#workspace');
  await page.click('.pane-collapse[data-pane=pages]');
  check('pages folds to a rail', (await width('.pane.pages')) <= 46 && await page.$eval('.rail[data-pane=pages]', (n) => document.activeElement === n));
  await page.click('.pane-collapse[data-pane=photo]');
  check('photo folds, text fills the rest', (await width('.pane.photo')) <= 46 && (await width('.editor-pane')) > total - 120);
  check('last open pane cannot fold', await page.$eval('.pane-collapse[data-pane=text]', (n) => n.disabled));
  check('photo/pages splitters hidden while folded', await page.$$eval('.workspace > .splitter', (s) => s.every((n) => getComputedStyle(n).visibility === 'hidden')));
  await page.screenshot({ path: path.join(OUT, 'check-folded.png') });
  await page.reload(); await page.waitForSelector('#editor .ProseMirror p');
  check('folded state persists', (await page.$eval('#workspace', (n) => n.dataset.collapsed)) === 'pages photo');
  await page.click('.rail[data-pane=photo]');
  check('rail reopens photo', (await width('.pane.photo')) > 200 && await page.$eval('.pane-collapse[data-pane=photo]', (n) => document.activeElement === n));
  await page.click('.pane-collapse[data-pane=text]');
  check('text folds, photo fills', (await width('.editor-pane')) <= 46 && (await width('.pane.photo')) > total - 200);
  await page.screenshot({ path: path.join(OUT, 'check-photo-only.png') });
  await page.click('.rail[data-pane=text]'); await page.click('.rail[data-pane=pages]');
  check('all panes open again', (await page.$eval('#workspace', (n) => n.dataset.collapsed)) === '');

  // popovers close on outside click and Esc
  await page.selectOption('#engineSel', 'tess-best');  // an engine with reading options
  await page.click('#outPop summary');
  check('popover opens', await page.$eval('#outPop', (d) => d.open));
  await page.click('#readPop summary');
  check('opening another closes the first', !(await page.$eval('#outPop', (d) => d.open)) && await page.$eval('#readPop', (d) => d.open));
  await page.mouse.click(700, 600);
  check('outside click closes', !(await page.$eval('#readPop', (d) => d.open)));
  await page.click('#outPop summary'); await page.keyboard.press('Escape');
  check('Esc closes', !(await page.$eval('#outPop', (d) => d.open)));

  // formatting toolbar + alignment
  // a paragraph with plain text, clicked on that text (a flagged word opens its own panel instead)
  const pick = await page.$$eval('#editor .ProseMirror > p', (ps) => {
    for (let i = 1; i < ps.length; i++) {
      const w = document.createTreeWalker(ps[i], NodeFilter.SHOW_TEXT); let t;
      while ((t = w.nextNode())) if (!t.parentElement.closest('mark') && t.nodeValue.trim().length > 4) {
        const r = document.createRange(); r.setStart(t, 1); r.setEnd(t, 2); const b = r.getBoundingClientRect();
        return { i, x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }
    }
    return { i: 2, x: 0, y: 0 };
  });
  const para = page.locator('#editor .ProseMirror > p').nth(pick.i);
  await page.mouse.click(pick.x, pick.y); await page.waitForTimeout(250);
  check('formatting toolbar is there', (await page.$$eval('#fmtBar .tb', (n) => n.length)) > 15);
  await page.screenshot({ path: path.join(OUT, 'check-toolbar.png') });
  await page.click('#fmtBar button[aria-label="محاذاة لليسار"]');
  check('align button sets the alignment', (await para.evaluate((n) => n.style.textAlign)) === 'left');
  const aligned = await page.$$eval('#editor .ProseMirror [style*="text-align"]', (n) => n.map((x) => x.style.textAlign + ':' + x.textContent.trim().slice(0, 18)));
  console.log('     OCR alignment:', aligned.join(' | '));

  // note popover closes on outside click
  await page.click('#editor mark.flag');
  check('note opens on flag click', await page.$eval('#notePop', (n) => !n.classList.contains('hidden')));
  await page.mouse.click(1000, 500);
  check('note closes on outside click', await page.$eval('#notePop', (n) => n.classList.contains('hidden')));

  // phone: tabs, no sideways scroll
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  check('no horizontal overflow (phone)', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    await page.evaluate(() => `${document.documentElement.scrollWidth}/${innerWidth}`));
  await page.click('.pane-tabs [data-pane=photo]');
  check('photo tab shows photo pane only', await page.evaluate(() => getComputedStyle(document.querySelector('.pane.photo')).display === 'flex'
    && getComputedStyle(document.querySelector('.editor-pane')).display === 'none'));
  await page.screenshot({ path: path.join(OUT, 'check-phone-photo.png') });
  await page.click('.pane-tabs [data-pane=pages]');
  await page.screenshot({ path: path.join(OUT, 'check-phone-pages.png') });
  await page.click('.pane-tabs [data-pane=text]');
  await page.screenshot({ path: path.join(OUT, 'check-phone-text.png') });

  // leave the demo draft unmodified
  await page.evaluate(() => localStorage.clear());
  check('no page errors', errors.length === 0, errors.join('; '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(2); });
