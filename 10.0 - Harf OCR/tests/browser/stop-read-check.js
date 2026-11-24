// Stop reading ends a reading in progress (one page, or "read unread pages"), and an update that has started can't
// be put off with "later" and shows how far its download is. The server's replies are held back here, so no reader or update is needed.
// node stop-read-check.js [base]
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:8765';
const IMG = path.join(__dirname, '..', 'english-letter.jpg');
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++; };

async function seed(api) {
  const d = await (await api.post(BASE + '/api/drafts', { data: { name: 'Stop reading check', owner: 'x', date: '2026-11-23' } })).json();
  const pages = [];
  for (const n of [1, 2]) {
    const up = await (await api.post(`${BASE}/api/drafts/${d.id}/images`,
      { multipart: { file: { name: 'p.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(IMG) } } })).json();
    pages.push({ id: 'p' + n, image: up.name, file: `p${n}.jpg`, fileTime: 0, rotation: 0, versions: [] });
  }
  const cur = await (await api.get(`${BASE}/api/drafts/${d.id}`)).json();
  await api.put(`${BASE}/api/drafts/${d.id}`, { data: { ...cur, pages } });
  return d.id;
}

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  // a reader that is there, and readings that never come back until stopped
  await page.route('**/api/engines', async (r) => {
    const res = await r.fetch(); const j = await res.json();
    j.engines.forEach((e) => { if (e.id === 'tess-best') e.available = true; });
    j.default = 'tess-best';
    await r.fulfill({ response: res, json: j });
  });
  let reads = 0;
  await page.route('**/api/ocr', () => { reads++; });  // held: never answered
  const id = await seed(page.request);
  await page.goto(`${BASE}/#/d/${id}`); await page.waitForSelector('#btnRead');
  await page.selectOption('#engineSel', 'tess-best');
  const stopShown = () => page.$eval('#btnStopRead', (b) => !b.classList.contains('hidden'));

  check('no stop button while nothing is read', !(await stopShown()));
  await page.click('#btnRead'); await page.waitForTimeout(300);
  check('stop shows while a page is read', await stopShown());
  await page.click('#btnStopRead'); await page.waitForTimeout(300);
  check('stopping ends the reading', !(await stopShown()) && !(await page.isDisabled('#btnRead')));
  check('the page stays unread', await page.$eval('#editor', (e) => !e.querySelector('.ProseMirror')) && !(await page.$('.page-item .busy')));

  reads = 0;
  await page.click('#btnReadAll'); await page.waitForTimeout(300);
  await page.click('#btnStopRead'); await page.waitForTimeout(600);
  check('stopping "read unread pages" reads no further page', reads === 1, `reads ${reads}`);
  check('nothing left reading', !(await stopShown()) && !(await page.$('.page-item .busy')));

  // the update bar: "later" can't hide an update that is installing
  // the download as the server would report it: idle, then half way, then the installer running
  const MB = 1 << 20;
  let install = { state: 'idle', done: 0, total: 0, error: '' };
  const update = { version: '9.9.9', notes: '' };
  await page.route('**/api/update', (r) => r.fulfill({ json: { current: '1.0.5', checked: true, update, install } }));
  await page.route('**/api/update/install', (r) => {
    install = { state: 'downloading', done: 125 * MB, total: 250 * MB, error: '' };
    r.fulfill({ json: { current: '1.0.5', checked: true, update, install } });
  });
  await page.evaluate(() => localStorage.removeItem('ds.skipUpdate'));
  await page.reload(); await page.waitForSelector('#updateBar:not(.hidden)', { timeout: 10000 });
  check('later works before updating', !(await page.isDisabled('#updateLater')));
  await page.click('#btnUpdate'); await page.click('#askOk'); await page.waitForTimeout(300);
  check('later is disabled once the update starts', await page.isDisabled('#updateLater') && await page.isDisabled('#btnUpdate'));
  await page.waitForTimeout(800);
  check('the download shows how far it is', await page.isVisible('#updateProg')
    && Math.abs(await page.$eval('#updateProg', (e) => e.value) - 0.5) < 0.01
    && /125.*250/.test(await page.textContent('#updateText')), await page.textContent('#updateText'));
  install = { state: 'installing', done: 250 * MB, total: 250 * MB, error: '' };
  await page.waitForTimeout(800);
  check('then it says the installer runs', !(await page.$eval('#updateProg', (e) => e.hasAttribute('value')))
    && !/125/.test(await page.textContent('#updateText')));
  check('no script errors', !errors.length, errors.join(' | '));
  await page.request.delete(`${BASE}/api/drafts/${id}`);
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
