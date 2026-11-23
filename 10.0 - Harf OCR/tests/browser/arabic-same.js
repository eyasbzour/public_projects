// The Arabic interface looks the same on two servers (before and after a change): screenshots of each screen, desktop
// and phone, from both, side by side in shots/same-<screen>-{a,b}.png for a pixel comparison.
// node arabic-same.js <base a> <base b> <draftId>
const { chromium } = require('playwright-core');
const path = require('path');
const [A, B, id] = process.argv.slice(2);
const OUT = path.join(__dirname, 'shots');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  for (const [base, tag] of [[A, 'a'], [B, 'b']]) {
    for (const [vw, vh] of [[1440, 900], [390, 844]]) {
      const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
      await ctx.addInitScript(() => { try { localStorage.setItem('ds.lang', 'ar'); localStorage.setItem('ds.theme', 'light'); } catch (e) { /* */ } });
      const page = await ctx.newPage();
      const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, `same-${vw}-${name}-${tag}.png`) }); };
      await page.goto(base + '/'); await shot('home');
      await page.evaluate(() => document.getElementById('btnSettings').click()); await shot('settings');
      await page.goto(`${base}/#/d/${id}`); await page.waitForSelector('#editor .ProseMirror p'); await shot('draft');
      await page.evaluate(() => document.getElementById('btnEditImg').click()); await shot('photo-editor');
      await page.goto(base + '/phone.html'); await shot('sign-in');
      await ctx.close();
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
