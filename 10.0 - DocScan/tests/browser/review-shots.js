// Screenshots + measurements of every screen for the design review. node review-shots.js <draftId> [base]
// Per screen: text under WCAG AA contrast, click targets under 24px (44px on phones), text under 12px, sideways overflow.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const ID = process.argv[2], BASE = process.argv[3] || 'http://localhost:8765';
const OUT = path.join(__dirname, 'shots', 'review');
fs.mkdirSync(OUT, { recursive: true });

const audit = (minTarget) => {
  const toRgb = (c) => { const x = document.createElement('canvas').getContext('2d'); x.fillStyle = '#000'; x.fillStyle = c; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const bgOf = (n) => { while (n && n.nodeType === 1) { const s = getComputedStyle(n); const c = toRgb(s.backgroundColor); if (c[3] > 200) return c; n = n.parentElement; } return toRgb(getComputedStyle(document.body).backgroundColor); };
  const visible = (n) => { const r = n.getBoundingClientRect(); const s = getComputedStyle(n); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && +s.opacity > 0.05 && r.bottom > 0 && r.top < innerHeight; };
  const label = (n) => (n.getAttribute('aria-label') || n.textContent || n.id || n.tagName).trim().replace(/\s+/g, ' ').slice(0, 28);
  const low = [], small = [], tiny = [];
  const seen = new Set();
  for (const n of document.querySelectorAll('body *')) {
    if (!visible(n) || n.closest('svg, canvas, .photo-frame, .thumb, .note-crop, .fig')) continue;
    const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
    const s = getComputedStyle(n);
    if (own) {
      const fs = parseFloat(s.fontSize), bold = +s.fontWeight >= 700;
      const ratio = (() => { const a = lum(toRgb(s.color)), b = lum(bgOf(n)); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); })();
      const need = fs >= 24 || (bold && fs >= 18.66) ? 3 : 4.5;
      if (ratio < need && !n.closest('[disabled], :disabled')) low.push(`${label(n)} ${ratio.toFixed(2)}`);
      if (fs < 12) tiny.push(`${label(n)} ${fs}px`);
    }
    if (n.matches('button, a[href], select, input:not([type=hidden]), summary, [role=tab], [role=separator], [tabindex="0"]') && !seen.has(n)) {
      seen.add(n);
      const r = n.getBoundingClientRect();
      if (n.matches('input[type=range], input[type=checkbox], [role=separator]')) continue;  // own conventions
      if (r.width < minTarget || r.height < minTarget) small.push(`${label(n)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  return { lowContrast: low, smallTargets: small, tinyText: tiny, overflowX: document.documentElement.scrollWidth > innerWidth };
};

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const report = {};
  const shot = async (page, name, minTarget = 24) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    report[name] = await page.evaluate(audit, minTarget);
  };
  const open = async (opts, hash) => {
    const page = await browser.newPage(opts);
    page.on('pageerror', (e) => { (report.errors = report.errors || []).push(e.message); });
    await page.goto(`${BASE}/${hash}`);
    await page.evaluate(() => localStorage.clear()); await page.reload();
    return page;
  };

  for (const [scheme, suffix] of [['light', ''], ['dark', '-dark']]) {
    const page = await open({ viewport: { width: 1440, height: 900 }, colorScheme: scheme }, '#/');
    await page.waitForSelector('#draftList tbody tr');
    await shot(page, '01-home' + suffix);
    await page.goto(`${BASE}/#/d/${ID}`); await page.waitForSelector('#editor .ProseMirror p');
    await shot(page, '02-workspace' + suffix);
    if (scheme === 'light') {
      await page.locator('#editor mark.flag').first().click(); await page.waitForSelector('#notePop:not(.hidden)');
      await shot(page, '03-word-panel');
      await page.keyboard.press('Escape');
      await page.click('#outPop summary'); await shot(page, '04-options-pop'); await page.click('#outPop summary');
      await page.selectOption('#engineSel', 'tess-best'); await page.click('#readPop summary'); await shot(page, '05-read-pop'); await page.click('#readPop summary');
      await page.selectOption('#engineSel', 'paddle');
      await page.locator('#editor .ProseMirror td').first().click(); await shot(page, '06-table-focus');
      await page.click('#panePages .pane-collapse'); await shot(page, '07-pages-folded'); await page.click('#panePages .rail');
      await page.click('#btnEditImg'); await page.waitForSelector('#dlgImage[open]'); await shot(page, '08-image-editor');
      await page.click('#ieCancel'); await page.waitForTimeout(300);
      await page.click('#btnSettings'); await page.waitForSelector('#dlgSettings[open]'); await shot(page, '09-settings');
      await page.keyboard.press('Escape');
      await page.click('#btnBack'); await page.waitForSelector('#draftList tbody tr');
      await page.locator('#draftList tbody tr .act button').first().click(); await page.waitForSelector('#dlgAsk[open]');
      await shot(page, '10-ask-dialog'); await page.click('#askCancel');
      // empty states: a new draft, and the home with no drafts
      await page.fill('#newName', 'مسودة فارغة للمراجعة'); await page.click('#formNew button[type=submit]');
      await page.waitForSelector('#dropHint'); await shot(page, '11-empty-draft');
      const emptyId = page.url().split('/d/')[1];
      await page.request.delete(`${BASE}/api/drafts/${emptyId}`);
      await page.route('**/api/drafts', (r) => r.request().method() === 'GET' ? r.fulfill({ json: { drafts: [] } }) : r.continue());
      await page.goto(`${BASE}/#/`); await page.waitForSelector('.first-run'); await shot(page, '12-first-run');
    }
    await page.close();
  }

  const phone = await open({ viewport: { width: 375, height: 800 }, hasTouch: true, isMobile: true }, '#/');
  await phone.waitForSelector('#draftList tbody tr'); await shot(phone, '20-phone-home', 44);
  await phone.goto(`${BASE}/#/d/${ID}`); await phone.waitForSelector('#editor .ProseMirror p'); await shot(phone, '21-phone-text', 44);
  await phone.click('.pane-tabs [data-pane=photo]'); await shot(phone, '22-phone-photo', 44);
  await phone.click('.pane-tabs [data-pane=pages]'); await shot(phone, '23-phone-pages', 44);
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(report, null, 1));
  for (const [k, v] of Object.entries(report)) {
    if (k === 'errors') { console.log('PAGE ERRORS', v); continue; }
    console.log(`${k}: low contrast ${v.lowContrast.length}, small targets ${v.smallTargets.length}, tiny text ${v.tinyText.length}, overflow ${v.overflowX}`);
  }
})();
