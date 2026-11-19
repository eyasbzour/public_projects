// Drafts table: column search, filter tags, double-click, sorting, phone layout. node search-check.js [base]
// Expects the main app's drafts (one draft per name).
const { chromium } = require('playwright-core');
const path = require('path');
const BASE = process.argv[2] || 'http://localhost:8000';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/#/`);
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('#draftList tbody tr');
  const names = () => page.$$eval('#draftList tbody tr', (rs) => rs.map((r) => r.querySelector('a').textContent));
  const total = (await names()).length;
  const popOpen = () => page.$eval('#colFilter', (n) => !n.classList.contains('hidden'));
  const sortState = () => page.$$eval('#draftList th[aria-sort]', (t) => t.map((x) => x.dataset.k + ':' + x.getAttribute('aria-sort')).join());

  check('no search box above the table', !(await page.$('#draftSearch')));
  check('count shows all', (await page.textContent('#draftCount')) === String(total));

  // funnel opens the panel under its header, typing filters, a tag shows it
  await page.click('th[data-k=name] .filt');
  check('funnel opens the panel', await popOpen() && await page.evaluate(() => document.activeElement.dataset.col === 'name'));
  const under = await page.evaluate(() => { const p = document.getElementById('colFilter').getBoundingClientRect(), t = document.querySelector('th[data-k=name]').getBoundingClientRect(); return p.top >= t.bottom && Math.abs(p.right - t.right) < 2; });
  check('panel sits under its column', under);
  check('desktop panel shows one field', (await page.$$eval('#colFilter .field', (f) => f.filter((x) => x.offsetParent).length)) === 1);
  await page.keyboard.type('انظمه');  // no hamza, ه for ة
  const hits = await names();  // the seed makes this letter once each run: every match is it
  check('spelling variants match', hits.length > 0 && hits.every((n) => n === 'كتاب تحديث أنظمة الأرشفة'), JSON.stringify(hits.slice(0, 3)));
  check('count shows matches of all', (await page.textContent('#draftCount')) === `${hits.length} من ${total}`);
  check('tag shows the filter', (await page.textContent('#draftFilters .chip')).includes('الوثيقة: انظمه'));
  check('funnel marked active', await page.$eval('th[data-k=name] .filt', (b) => b.classList.contains('on')));
  await page.keyboard.press('Escape');
  check('Esc closes and returns to the funnel', !(await popOpen()) && await page.evaluate(() => document.activeElement.matches('th[data-k=name] .filt')));
  await page.click('#draftFilters .chip');
  check('tag x removes the filter', (await names()).length === total && await page.$eval('#draftFilters', (n) => n.classList.contains('hidden')));

  // pages: exact number; two filters give "clear all"
  await page.click('th[data-k=pages] .filt');
  await page.fill('#colFilter input[data-col=pages]', '2');
  const twoPages = await page.$$eval('#draftList tbody tr', (rs) => rs.map((r) => r.cells[2].textContent));
  check('pages filter is exact', twoPages.length > 0 && twoPages.every((p) => p === '2'), JSON.stringify(twoPages));
  await page.mouse.click(1300, 120);  // outside
  check('outside click closes the panel', !(await popOpen()));
  await page.click('th[data-k=owner] .filt'); await page.keyboard.type('zzz');
  check('no match message with a clear button', await page.isVisible('#draftNone') && await page.isVisible('#draftNone button'));
  check('two filters show clear all', await page.isVisible('#draftFilters >> text=مسح الكل'));
  await page.click('#draftNone button');
  check('clear brings everything back', (await names()).length === total && !(await popOpen()));

  // double-click a title opens its search and leaves the sort as it was
  const before = await sortState();
  await page.dblclick('th[data-k=owner] .sort');
  check('double-click opens that column', await popOpen() && await page.$eval('#colFilter', (n) => n.dataset.col === 'owner'));
  check('double-click does not change the sort', (await sortState()) === before, `${before} -> ${await sortState()}`);
  await page.keyboard.press('Escape');

  // sorting still works and is remembered
  await page.click('th[data-k=name] .sort');
  const n1 = await names();
  check('name sorts أ to ي', n1.join('|') === [...n1].sort((a, b) => a.localeCompare(b, 'ar')).join('|'));
  await page.click('th[data-k=name] .sort');
  check('second click reverses', (await names()).join('|') === [...n1].reverse().join('|'));
  check('sort keeps focus on the title', await page.evaluate(() => document.activeElement.matches('th[data-k=name] .sort')));
  await page.reload(); await page.waitForSelector('#draftList tbody tr');
  check('sort remembered', (await sortState()) === 'name:descending');
  check('inactive columns show a faint arrow', await page.$eval('th[data-k=pages] .sort .i', (i) => i.classList.contains('idle')));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'table-desktop.png'), clip: { x: 200, y: 320, width: 1040, height: 340 } });

  // phone: hidden columns under the name, panel offers all three fields, 44px targets
  await page.setViewportSize({ width: 375, height: 800 });
  check('person and pages under the name', await page.$eval('#draftList tbody tr td .sub', (s) => !!s.offsetParent && s.textContent.length > 0));
  await page.click('th[data-k=name] .filt');
  check('phone panel shows all fields', (await page.$$eval('#colFilter .field', (f) => f.filter((x) => x.offsetParent).length)) === 3);
  const small = await page.$$eval('.drafts button', (bs) => bs.filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect()).filter((r) => r.height < 44).length);
  check('phone targets at least 44px', small === 0, `${small} smaller`);
  check('no sideways scroll on phone', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.waitForTimeout(400); await page.screenshot({ path: path.join(__dirname, 'shots', 'table-phone.png') });

  await page.setViewportSize({ width: 1440, height: 900 }); await page.keyboard.press('Escape');
  await page.click('#draftList tbody tr >> nth=0'); await page.waitForSelector('#engineSel option', { state: 'attached' });
  check('default engine is PaddleOCR', (await page.inputValue('#engineSel')) === 'paddle');
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
