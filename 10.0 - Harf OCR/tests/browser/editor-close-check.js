// Image editor closes on outside click / Esc, asking first when edited. node editor-close-check.js <draftId> [base]
const { chromium } = require('playwright-core');
const ID = process.argv[2], BASE = process.argv[3] || 'http://localhost:8765';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/#/d/${ID}`); await page.waitForSelector('#editor .ProseMirror p');
  const isOpen = () => page.$eval('#dlgImage', (d) => d.open);
  const outside = async () => { const r = await page.$eval('#dlgImage', (d) => { const b = d.getBoundingClientRect(); return { x: b.left - 10, y: b.top + 40 }; });
    await page.mouse.click(Math.max(2, r.x), r.y); await page.waitForTimeout(200); };
  // unchanged: an outside click just closes
  await page.click('#btnEditImg'); await page.waitForSelector('#dlgImage[open]'); await page.waitForTimeout(300);
  await outside();
  check('outside click closes an unedited editor', !(await isOpen()));
  // edited: outside click asks; cancel keeps it open, confirm closes
  await page.click('#btnEditImg'); await page.waitForSelector('#dlgImage[open]'); await page.waitForTimeout(300);
  await page.click('#ieRotR');
  await outside();
  check('outside click with edits asks first', await page.$eval('#dlgAsk', (d) => d.open) && await isOpen());
  await page.click('#askCancel'); await page.waitForTimeout(150);
  check('"إلغاء" keeps the editor and its edits', await isOpen());
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check('Esc with edits asks too', await page.$eval('#dlgAsk', (d) => d.open));
  await page.click('#askOk'); await page.waitForTimeout(200);
  check('discarding closes the editor', !(await isOpen()));
  // a crop drag that ends outside the editor does not close it
  await page.click('#btnEditImg'); await page.waitForSelector('#dlgImage[open]'); await page.waitForTimeout(300);
  await page.click('#ieCrop'); await page.waitForTimeout(200);
  const cb = await (await page.$('#ieCropBox')).boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2); await page.mouse.down();
  await page.mouse.move(5, cb.y + cb.height / 2, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
  check('crop drag ending outside keeps the editor open', await isOpen() && !(await page.$eval('#dlgAsk', (d) => d.open)));
  await page.click('#ieCancel');
  check('no page errors', errors.length === 0, errors.join('; '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(2); });
