// The app's icon: the word حرف in Amiri on ink blue, as on the website. Renders icon.html to web/icon.png (the app's
// favicon and header mark, and what desktop/make_icon.py turns into docscan.ico) and docs/favicon.png (the website),
// and og.html to docs/og.png (the website's link preview card).
// Needs the browser checks' packages and Chrome: cd tests/browser && npm ci, then node ../../tools/icon/render.js
const { chromium } = require('../../tests/browser/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const open = async (b, file, width, height) => {
  const p = await b.newPage({ viewport: { width, height } });
  await p.goto('file:///' + path.join(__dirname, file).replace(/\\/g, '/'));
  await p.waitForLoadState('networkidle');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  return p;
};
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const icon = await open(b, 'icon.html', 512, 512);
  const out = path.join(root, 'web', 'icon.png');
  await icon.locator('.icon').screenshot({ path: out, omitBackground: true });
  fs.copyFileSync(out, path.join(root, 'docs', 'favicon.png'));
  const og = await open(b, 'og.html', 1200, 630);
  await og.locator('.og').screenshot({ path: path.join(root, 'docs', 'og.png') });
  await b.close();
  console.log('wrote web/icon.png, docs/favicon.png and docs/og.png');
})();
