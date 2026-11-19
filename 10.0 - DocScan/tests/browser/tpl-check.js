// Template list "add new", document font/size fields, size box not cut off. node tpl-check.js <draftId> [base]
const { chromium } = require('playwright-core');
const path = require('path');
const ID = process.argv[2], BASE = process.argv[3] || 'http://localhost:8765';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/#/d/${ID}`); await page.waitForSelector('#editor .ProseMirror p');
  const sizeBox = await page.$eval('#fmtBar .tb-size', (i) => i.scrollWidth <= i.clientWidth + 1);
  check('toolbar size box shows its placeholder in full', sizeBox);
  await page.click('#outPop summary');
  check('font size is a box with 14 by default', (await page.inputValue('#optFont')) === '14' && (await page.getAttribute('#optFont', 'type')) === 'number');
  await page.fill('#optFont', '15.5'); await page.dispatchEvent('#optFont', 'change');
  await page.fill('#optFontName', 'Simplified Arabic'); await page.dispatchEvent('#optFontName', 'change');
  await page.screenshot({ path: path.join(__dirname, 'shots', 'options-pop.png') });
  await page.reload(); await page.waitForSelector('#editor .ProseMirror p');
  check('font and size are remembered', (await page.inputValue('#optFont')) === '15.5' && (await page.inputValue('#optFontName')) === 'Simplified Arabic');
  const before = await page.inputValue('#templateSel');
  check('template list ends with "add new"', (await page.$eval('#templateSel', (s) => s.options[s.options.length - 1].textContent)).includes('إضافة قالب جديد'));
  await page.click('#outPop summary');
  await page.selectOption('#templateSel', '__add');
  check('choosing it opens the add window and keeps the current template', await page.isVisible('#dlgTpl') && (await page.inputValue('#templateSel')) === before);
  await page.fill('#tplName', 'قالب تجريبي');
  await page.setInputFiles('#tplFile', path.join(__dirname, '..', 'blank.docx'));
  check('chosen file name shows on the Arabic file button', (await page.textContent('#tplFileName')) === 'blank.docx');
  await page.screenshot({ path: path.join(__dirname, 'shots', 'tpl-dialog.png') });
  await page.click('#btnTplAdd');
  await page.waitForFunction(() => !document.getElementById('dlgTpl').open, null, { timeout: 5000 }).catch(() => {});
  const chosen = await page.$eval('#templateSel', (s) => s.options[s.selectedIndex].textContent);
  check('the new template is added and chosen for the draft', chosen === 'قالب تجريبي', chosen);
  const tpls = await (await page.request.get(`${BASE}/api/templates`)).json();
  const mine = tpls.templates.find((t) => t.name === 'قالب تجريبي');
  if (mine) await page.request.delete(`${BASE}/api/templates/${mine.id}`);  // clean up the test copy
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); process.exit(fails ? 1 : 0);
})();
