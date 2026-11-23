// Going straight from one draft to another (back / forward, a link) keeps both intact.
//   node switch-check.js <draftA> <draftB> [base]   (two read drafts; A gets one typed word)
const { chromium } = require('playwright-core');
const ID_A = process.argv[2], ID_B = process.argv[3], BASE = process.argv[4] || 'http://localhost:8765';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };
const segsText = (segs) => (segs || []).map((s) => s.s).join('');
const text = (blocks) => (blocks || []).map((b) => (b.rows ? b.rows.map((r) => r.map(segsText).join(' | ')).join('\n') : segsText(b.segs))).join('\n');  // tables too

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const server = async (id) => (await (await page.request.get(`${BASE}/api/drafts/${id}`)).json()).pages[0].blocks;
  const b0 = await server(ID_B);

  await page.goto(`${BASE}/#/d/${ID_A}`); await page.waitForSelector('#editor .ProseMirror p');
  await page.evaluate(() => { const ed = document.querySelector('#editor').docEditor.editor; ed.commands.setTextSelection(1); ed.commands.insertContent('كلمةمضافة '); });
  await page.evaluate((id) => { location.hash = '#/d/' + id; }, ID_B);  // like the back button, without the home screen
  await page.waitForFunction((t) => document.querySelector('#editor .ProseMirror') && document.querySelector('#editor .ProseMirror').textContent.includes(t), text(b0).split('\n').find((l) => l.length > 8).slice(0, 8), { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);

  const shown = await page.$eval('#editor .ProseMirror', (n) => n.textContent);
  check('the second draft shows its own text', !shown.includes('كلمةمضافة') && shown.includes(text(b0).split('\n').find((l) => l.length > 8).slice(0, 8)));
  check('the first draft\'s typing was saved before leaving it', text(await server(ID_A)).includes('كلمةمضافة'));
  await page.waitForTimeout(4500);  // past an autosave
  check('the second draft is unchanged on the server', text(await server(ID_B)) === text(b0));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.message.split('\n')[0]); process.exit(2); });
