// Photo pane: drag to pan, header wraps when narrow. node photo-check.js <draftId> [base]
const { chromium } = require('playwright-core');
const path = require('path');
const ID = process.argv[2], BASE = process.argv[3] || 'http://localhost:8765';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/#/d/${ID}`); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('#editor .ProseMirror p');
  await page.$eval('#zoom', (z) => { z.value = 250; z.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(300);
  check('zoomed photo shows the grab cursor', await page.$eval('#photoFrame', (f) => f.classList.contains('can-pan') && getComputedStyle(f).cursor === 'grab'));
  const s0 = await page.$eval('#photoFrame', (f) => [f.scrollLeft, f.scrollTop]);
  const b = await (await page.$('#photoFrame')).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2 - 200, { steps: 8 }); await page.mouse.up();
  const s1 = await page.$eval('#photoFrame', (f) => [f.scrollLeft, f.scrollTop]);
  check('dragging moves around the photo', Math.round(s0[0] - s1[0]) === 120 && Math.round(s1[1] - s0[1]) === 200, `scroll ${s0} -> ${s1}`);
  // narrow the photo pane to its minimum
  const sp = await (await page.$('.splitter[data-pane=photo]')).boundingBox();
  await page.mouse.move(sp.x + 4, sp.y + 300); await page.mouse.down(); await page.mouse.move(sp.x + 700, sp.y + 300, { steps: 6 }); await page.mouse.up();
  const r = await page.$eval('.photo .pane-head', (h) => {
    const hb = h.getBoundingClientRect();
    const out = [...h.children].filter((c) => { const cb = c.getBoundingClientRect(); return cb.left < hb.left - 1 || cb.right > hb.right + 1; });
    return { width: Math.round(hb.width), rows: new Set([...h.children].map((c) => Math.round(c.getBoundingClientRect().top))).size, out: out.map((c) => c.id || c.className) };
  });
  check('photo header fits a narrow pane', r.out.length === 0, `width ${r.width}px, ${r.rows} rows, outside: ${r.out.join(',') || 'none'}`);
  await page.locator('.pane.photo').screenshot({ path: path.join(__dirname, 'shots', 'photo-narrow.png'), clip: undefined });
  await page.evaluate(() => localStorage.clear());
  check('no page errors', errors.length === 0, errors.join('; '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(2); });
