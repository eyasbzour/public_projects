// Every panel and popup: nothing sticks out of it, it closes on an outside click. node pop-check.js <draftId> [base]
const { chromium } = require('playwright-core');
const path = require('path');
const ID = process.argv[2], BASE = process.argv[3] || 'http://localhost:8765';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };
const overflow = (sel) => (s) => {
  const box = document.querySelector(s); if (!box) return ['missing'];
  const b = box.getBoundingClientRect();
  return [...box.querySelectorAll('*')].filter((n) => n.offsetParent && !n.closest('datalist')).filter((n) => {
    const r = n.getBoundingClientRect(); return r.width && (r.left < b.left - 1 || r.right > b.right + 1);
  }).map((n) => n.tagName + '#' + (n.id || n.className));
};
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    await page.goto(`${BASE}/#/d/${ID}`); await page.waitForSelector('#editor .ProseMirror p');
    const open = async (summary, pop, name) => {
      await page.click(summary); await page.waitForTimeout(250);
      const out = await page.evaluate(overflow(), pop);
      check(`${scheme}: ${name} keeps its fields inside`, out.length === 0, out.join(' '));
      if (scheme === 'light' || name === 'options') await page.screenshot({ path: path.join(__dirname, 'shots', `pop-${name}-${scheme}.png`), clip: await page.$eval(pop, (n) => { const r = n.getBoundingClientRect(); return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 }; }) });
      await page.mouse.click(700, 860);
      check(`${scheme}: ${name} closes on an outside click`, !(await page.$eval(summary.replace(' summary', ''), (d) => d.open)));
    };
    await open('#outPop summary', '#outPop .pop', 'options');
    await page.selectOption('#engineSel', 'tess-best');
    await open('#readPop summary', '#readPop .pop', 'reading');
    await open('#verPop summary', '#verPop .pop', 'versions');
    // the windows close on a click outside too
    for (const [btn, dlg] of [['#btnSettings', '#dlgSettings']]) {
      await page.click(btn); await page.waitForSelector(dlg + '[open]');
      await page.mouse.click(20, 880);
      check(`${scheme}: ${dlg} closes on an outside click`, !(await page.$eval(dlg, (d) => d.open)));
    }
    await page.close();
  }
  await browser.close(); process.exit(fails ? 1 : 0);
})();
