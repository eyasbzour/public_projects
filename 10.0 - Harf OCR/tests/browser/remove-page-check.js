// Deleting a page keeps every other page's text: the editor showed the deleted page, and used to write it into the
// page that took its place. Seeds its own three-page draft. node remove-page-check.js [base]
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:8765';
const IMG = path.join(__dirname, '..', 'english-letter.jpg');
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++; };
const para = (s) => [{ type: 'p', segs: [{ s }] }];

async function seed(api) {
  const d = await (await api.post(BASE + '/api/drafts', { data: { name: 'Remove page check', owner: 'x', date: '2026-11-23' } })).json();
  const pages = [];
  for (const text of ['first page', 'second page', 'third page']) {
    const up = await (await api.post(`${BASE}/api/drafts/${d.id}/images`,
      { multipart: { file: { name: 'p.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(IMG) } } })).json();
    pages.push({ id: text, image: up.name, file: text + '.jpg', fileTime: 0, rotation: 0, blocks: para(text), readImage: up.name, readRot: 0, versions: [] });
  }
  const cur = await (await api.get(`${BASE}/api/drafts/${d.id}`)).json();
  await api.put(`${BASE}/api/drafts/${d.id}`, { data: { ...cur, pages } });
  return d.id;
}

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const texts = async () => (await (await page.request.get(`${BASE}/api/drafts/${id}`)).json()).pages.map((p) => p.blocks[0].segs[0].s);
  const remove = async (k) => {
    await page.locator('.page-item').nth(k).locator('button.danger').first().click({ force: true });
    await page.click('#askOk');
    await page.click('#btnSave'); await page.waitForTimeout(800);
  };
  const ids = [];
  let id = await seed(page.request); ids.push(id);
  // delete the page being shown: the next page keeps its own text and is shown
  await page.goto(`${BASE}/#/d/${id}`); await page.waitForSelector('#editor .ProseMirror p');
  await remove(0);
  check('deleting the shown page leaves the others as they were', JSON.stringify(await texts()) === '["second page","third page"]', JSON.stringify(await texts()));
  check('the page after it is shown', (await page.textContent('#editor .ProseMirror')).includes('second page'));
  // delete a page above the shown one: the shown page stays shown and nothing moves
  id = await seed(page.request); ids.push(id);
  await page.goto(`${BASE}/#/d/${id}`); await page.waitForSelector('#editor .ProseMirror p');
  await page.locator('.page-item').nth(2).click(); await page.waitForTimeout(300);
  await remove(0);
  check('deleting a page above the shown one leaves the others as they were', JSON.stringify(await texts()) === '["second page","third page"]', JSON.stringify(await texts()));
  check('the shown page stays shown', (await page.textContent('#editor .ProseMirror')).includes('third page'));
  check('no script errors', !errors.length, errors.join(' | '));
  for (const d of ids) await page.request.delete(`${BASE}/api/drafts/${d}`);  // what it added, it deletes
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
