// Flagged spots read again (spots.js): the second readings show under their flags, "use all" puts them in, they
// stay on their page, and a page whose photo changed can't be read in spots. Seeds its own two-page draft and answers
// /api/ocr-spots itself, so no reader is needed. node flags-check.js [base]
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:8765';
const IMG = path.join(__dirname, '..', 'english-letter.jpg');
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++; };
const flagged = (words) => [{ type: 'p', segs: words.flatMap(([s, k]) => [{ s, note: 'unsure', box: [0.1 * k, 0.1, 0.1 * k + 0.08, 0.14] }, { s: ' ' }]) }];

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const api = page.request;
  const d = await (await api.post(BASE + '/api/drafts', { data: { name: 'Flags check', owner: 'x' } })).json();
  try {
    const pages = [];
    for (const [n, words] of [[1, [['Dear', 1], ['Direktor', 2], ['repart', 3]]], [2, [['Direktor', 2]]], [3, [['Dear', 1]]]]) {
      const up = await (await api.post(`${BASE}/api/drafts/${d.id}/images`,
        { multipart: { file: { name: 'p.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(IMG) } } })).json();
      // page 3's photo was changed after it was read
      pages.push({ id: 'p' + n, image: up.name, file: `p${n}.jpg`, fileTime: 0, rotation: 0, blocks: flagged(words), readImage: n === 3 ? 'before.jpg' : up.name, readRot: 0, versions: [] });
    }
    const cur = await (await api.get(`${BASE}/api/drafts/${d.id}`)).json();
    await api.put(`${BASE}/api/drafts/${d.id}`, { data: { ...cur, pages } });

    await page.route('**/api/engines', async (r) => {
      const res = await r.fetch(); const j = await res.json();
      j.engines.forEach((e) => { if (e.id === 'tess-best') e.available = true; });
      await r.fulfill({ response: res, json: j });
    });
    const second = { Dear: 'Dear', Direktor: 'Director', repart: 'report' };
    let spotCalls = 0;
    await page.route('**/api/ocr-spots', async (r) => {
      spotCalls++;
      const boxes = JSON.parse(r.request().postDataBuffer().toString().match(/name="boxes"\r\n\r\n(.*)\r\n/)[1]);
      const byX = { 0.1: 'Dear', 0.2: 'Direktor', 0.3: 'repart' };
      await r.fulfill({ json: { results: boxes.map((b) => ({ text: second[byX[Math.round(b[0] * 10) / 10]] })), engine: 'tess-best', seconds: 0 } });
    });
    await page.goto(`${BASE}/#/d/${d.id}`); await page.waitForSelector('#editor .ProseMirror mark.flag');
    const text = () => page.textContent('#editor .ProseMirror');
    check('the flags are listed', (await page.textContent('#flagCount')) === '3');

    await page.click('#flagReread'); await page.waitForSelector('#flagList .flag-suggest');
    check('a second reading shows only where it differs', (await page.$$('#flagList .flag-suggest')).length === 2);
    check('"use all" is offered for two or more', await page.isVisible('#flagUseAll'));
    await page.click('#flagUseAll'); await page.waitForTimeout(300);
    check('"use all" puts them in the text', /Dear Director report/.test(await text()), await text());

    await page.locator('.page-item').nth(1).click(); await page.waitForTimeout(400);
    check('another page shows none of them', !(await page.$('#flagList .flag-suggest')));
    await page.locator('.page-item').nth(0).click(); await page.waitForTimeout(400);
    check('nor does the first one again (they were its own and it was left)', !(await page.$('#flagList .flag-suggest')));

    // a photo changed since it was read: no reading in spots until the page is read again
    await page.locator('.page-item').nth(2).click(); await page.waitForTimeout(400);
    check('a page whose photo changed offers no reading in spots', !(await page.isVisible('#flagTools')));
    check('the reader was asked once', spotCalls === 1, `asked ${spotCalls} times`);
    check('no script errors', !errors.length, errors.join(' | '));
  } finally {
    await api.delete(`${BASE}/api/drafts/${d.id}`);  // what it added, it deletes
    await browser.close();
  }
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
