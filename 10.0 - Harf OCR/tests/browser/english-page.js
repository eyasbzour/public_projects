// Renders an English test letter to english-letter.jpg (1240 x 1754, like the other test pages). node english-page.js
const { chromium } = require('playwright-core');
const path = require('path');
const html = `<!doctype html><html lang="en"><body style="margin:0;background:#fbfbf8">
<div style="width:1240px;height:1754px;box-sizing:border-box;padding:120px 115px;font:28px/1.6 Arial,sans-serif;color:#1d1d1b">
  <div style="display:flex;justify-content:space-between"><span>Ref: IT/245/2026</span><span>Date: 12/11/2026</span></div>
  <p style="margin:70px 0 20px">Dear Director of Electronic Services,</p>
  <p style="text-align:center;font-weight:bold;margin:40px 0">Subject: Archive System Upgrade</p>
  <p style="text-align:justify">We kindly ask you to provide the list of devices in the archive department, with the status of each device and the date of its last maintenance, so that we can prepare the upgrade plan for next year.</p>
  <p style="margin:30px 0 10px">Our recommendations:</p>
  <ul style="margin:0 0 30px">
    <li>Replace the archive server with a new one.</li>
    <li>Service both printers before the end of the year.</li>
    <li>Train the staff on the new archive system.</li>
  </ul>
  <table style="border-collapse:collapse;width:100%;margin:20px 0" border="1" cellpadding="12">
    <tr><th>Device</th><th>Count</th><th>Status</th></tr>
    <tr><td>Scanner</td><td>3</td><td>Working</td></tr>
    <tr><td>Laser printer</td><td>2</td><td>Needs service</td></tr>
  </table>
  <p style="margin-top:60px">Yours sincerely,</p>
  <p style="margin-top:10px">Head of IT Department</p>
</div></body></html>`;
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
  await page.setContent(html);
  await page.screenshot({ path: path.join(__dirname, '..', 'english-letter.jpg'), type: 'jpeg', quality: 90 });
  await browser.close();
})();
