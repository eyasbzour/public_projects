// Long lists scroll instead of growing: the drafts list ends at the window's bottom, what's new shows four changes.
// Adds thirty drafts and deletes them after. node cap-check.js [base]
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://localhost:8765';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++; };

// how many of a list's items are wholly in view, and whether the rest scroll
const inView = (box, items) => {
  const b = box.getBoundingClientRect(), its = [...box.querySelectorAll(items)];
  return { shown: its.filter((x) => x.getBoundingClientRect().bottom <= b.bottom + 1).length, all: its.length,
    scrolls: box.scrollHeight > box.clientHeight + 1, bottom: Math.round(b.bottom), win: innerHeight,
    // the screen itself: the page and the home view, neither scrolls
    page: document.documentElement.scrollHeight, home: (({ scrollHeight: s, clientHeight: c }) => s - c)(document.getElementById('viewHome')) };
};

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const errors = [], ids = [];
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', (e) => errors.push(e.message));
    const notes = Array.from({ length: 7 }, (_, k) => `- Change number ${k + 1}, long enough to wrap onto a second line on a phone screen`).join('\n');
    await page.route('**/api/update', (r) => r.fulfill({ json: { current: '1.0.5', checked: true, update: { version: '9.9.9', notes } } }));
    if (!ids.length) {
      for (let k = 0; k < 30; k++) ids.push((await (await page.request.post(BASE + '/api/drafts', { data: { name: `Cap check ${k + 1}`, owner: 'x' } })).json()).id);
    }
    await page.goto(BASE + '/'); await page.evaluate(() => localStorage.removeItem('ds.skipUpdate')); await page.reload();
    await page.waitForSelector('#draftList tbody tr');
    const d = await page.$eval('.draft-scroll', inView, 'tbody tr');
    // it ends where the home screen's bottom padding starts, so the page itself doesn't scroll
    const pad = await page.$eval('#viewHome', (h) => parseFloat(getComputedStyle(h).paddingBottom));
    check(`${w}px: the drafts list ends at the window's bottom and scrolls`, d.scrolls && Math.abs(d.win - pad - d.bottom) < 6 && d.page <= d.win + 1 && d.home <= 1, JSON.stringify({ ...d, pad }));
    await page.$eval('.draft-scroll', (b) => { b.scrollTop = b.scrollHeight; });
    const head = await page.$eval('.draft-scroll', (b) => { const t = b.querySelector('thead th').getBoundingClientRect(); return t.top - b.getBoundingClientRect().top; });
    check(`${w}px: its header stays on top while it scrolls`, Math.abs(head) < 2 || !(await page.isVisible('.draft-scroll thead')), `offset ${head}`);
    await page.waitForSelector('#updateBar:not(.hidden)', { timeout: 10000 });
    await page.click('#updateNotesBtn');
    const n = await page.$eval('#updateNotes', inView, 'li');
    check(`${w}px: what's new shows four changes and scrolls`, n.shown === 4 && n.scrolls, JSON.stringify(n));
    const after = await page.$eval('.draft-scroll', inView, 'tbody tr');
    // nothing is cut off under the bars; on a phone, with no room left for the list's least height, home scrolls a little
    check(`${w}px: with the update bar and its notes open nothing is cut off`, after.page <= after.win + 1 && (w < 700 || after.home <= 1), JSON.stringify(after));
    await page.close();
  }
  const page = await browser.newPage();
  for (const id of ids) await page.request.delete(`${BASE}/api/drafts/${id}`);
  check('no script errors', !errors.length, errors.join(' | '));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
