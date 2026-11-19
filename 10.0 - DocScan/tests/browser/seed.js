// Seed realistic test drafts into a running DocScan. node seed.js [base]
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:8000';
const OUT = path.join(__dirname, 'seed'); fs.mkdirSync(OUT, { recursive: true });
const uid = () => Math.random().toString(36).slice(2, 10);
const clone = (x) => JSON.parse(JSON.stringify(x));

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
  await page.goto('file:///' + path.join(__dirname, 'seed-pages.html').replace(/\\/g, '/'));
  await page.waitForTimeout(500);  // fonts
  const shots = {};
  for (const [id, q] of [['letter', 90], ['report1', 90], ['report2', 90], ['photo', 68], ['borderless', 90]]) {
    shots[id] = path.join(OUT, id + '.jpg');
    await page.locator('#' + id).screenshot({ path: shots[id], type: 'jpeg', quality: q });
  }
  const api = page.request;
  const labels = Object.fromEntries((await (await api.get(BASE + '/api/engines')).json()).engines.map((e) => [e.id, e.label]));

  async function upload(draftId, file, name, when) {
    const r = await api.post(`${BASE}/api/drafts/${draftId}/images`,
      { multipart: { file: { name, mimeType: 'image/jpeg', buffer: fs.readFileSync(file) } } });
    if (!r.ok()) throw new Error('upload ' + r.status());
    return { id: uid(), image: (await r.json()).name, file: name, fileTime: when, rotation: 0, blocks: null, versions: [] };
  }
  async function read(draftId, p, engine) {
    const t = Date.now();
    const r = await api.post(BASE + '/api/ocr', { multipart: { draft_id: draftId, image: p.image, engine }, timeout: 600000 });
    const d = await r.json();
    if (!r.ok()) throw new Error(`${engine}: ${d.error || r.status()}`);
    p.versions.unshift({ id: uid(), label: labels[engine], at: Date.now() / 1000, blocks: clone(d.blocks) });
    p.blocks = clone(d.blocks); p.readWith = engine; p.readImage = p.image; p.readRot = 0;
    console.log(`  ${engine} read ${p.file} in ${((Date.now() - t) / 1000).toFixed(1)}s, ${d.blocks.length} blocks`);
  }
  // a reviewer's flag on the first block whose text contains `needle`
  function flag(p, needle, note) {
    for (const b of p.blocks) {
      const i = (b.segs || []).findIndex((s) => s.note == null && s.s.includes(needle));
      if (i < 0) continue;
      const s = b.segs[i].s, a = s.indexOf(needle);
      b.segs.splice(i, 1, ...[{ s: s.slice(0, a) }, { s: needle, note }, { s: s.slice(a + needle.length) }].filter((x) => x.s));
      return true;
    }
    console.log('  (flag anchor not found: ' + needle + ')');
    return false;
  }
  async function draft(name, owner, pages) {
    const d = await (await api.post(BASE + '/api/drafts', { data: { name, owner, date: '2026-11-18' } })).json();
    const built = await pages(d.id);
    const r = await api.put(`${BASE}/api/drafts/${d.id}`, { data: { ...d, pages: built } });
    if (!r.ok()) throw new Error('save ' + r.status());
    console.log(`draft "${name}": ${built.length} page(s), id ${d.id}`);
  }

  const day = (n) => new Date(2026, 10, n, 9, 30).getTime();

  await draft('كتاب تحديث أنظمة الأرشفة', 'قسم المراسلات', async (id) => {
    const p = await upload(id, shots.letter, 'IMG-20261110-WA0004.jpg', day(10));
    await read(id, p, 'paddle');
    await read(id, p, 'tess-best');  // the current text; PaddleOCR stays in the versions list
    flag(p, 'الموضوع', 'تأشيرة بخط اليد في الهامش: يُحال إلى قسم الحاسوب للمتابعة');
    return [p];
  });

  await draft('تقرير حالة أجهزة قسم الأرشيف', 'قسم الحاسوب', async (id) => {
    const p1 = await upload(id, shots.report1, 'تقرير الأجهزة 1.jpg', day(15));
    const p2 = await upload(id, shots.report2, 'تقرير الأجهزة 2.jpg', day(15) + 60000);
    await read(id, p1, 'paddle');
    await read(id, p2, 'easyocr');
    flag(p2, 'موافق', 'تأشيرة بخط اليد: موافق، يُدرج في خطة 2027');
    return [p1, p2];
  });

  await draft('تعميم مواعيد الدوام (صورة مائلة)', '', async (id) => [await upload(id, shots.photo, 'IMG-20261120-WA0011.jpg', day(20))]);

  await draft('مواعيد التدريب (جدول بلا خطوط)', 'قسم الأرشيف', async (id) => [await upload(id, shots.borderless, 'مواعيد التدريب.jpg', day(17))]);

  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
