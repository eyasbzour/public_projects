// node --test web/js/
const test = require('node:test');
const assert = require('node:assert');
const Spots = require('./spots.js');

const page = (id) => ({ id, image: id + '.jpg', readImage: id + '.jpg' });
const flag = (text, box) => ({ text, box });

function reader(answers) {
  const asked = [];
  return { asked, read: async (p, engine, boxes) => { asked.push({ p, engine, boxes }); return boxes.map((b) => ({ text: answers[String(b)] })); } };
}

test('a page can be read again in spots only while its photo is the one read', () => {
  const s = Spots.create({ read: async () => [] });
  const p = page('a');
  assert.strictEqual(s.readable(p), true);
  p.image = 'a-edited.jpg';
  assert.strictEqual(s.readable(p), false);
  assert.strictEqual(s.readable({ image: 'b.jpg' }), false);  // never read
  assert.strictEqual(s.readable(null), false);
});

test('second readings are offered only where they say something else', async () => {
  const r = reader({ '1,1,2,2': 'الكتاب', '3,3,4,4': 'المرفق' });
  const s = Spots.create(r);
  const p = page('a'), same = flag('الكتاب', [1, 1, 2, 2]), other = flag('المرقق', [3, 3, 4, 4]), boxless = flag('ختم', null);
  await s.reread(p, 'nuqta', [same, other, boxless]);
  assert.deepStrictEqual(r.asked[0].boxes, [[1, 1, 2, 2], [3, 3, 4, 4]]);  // a flag without a box isn't sent
  assert.strictEqual(s.offer(p, same), null);
  assert.deepStrictEqual(s.offer(p, other), { engine: 'nuqta', text: 'المرفق' });
  assert.deepStrictEqual(s.pending(p, [same, other, boxless]).map((x) => x.text), ['المرفق']);
});

test('second readings stay with their page', async () => {
  const s = Spots.create(reader({ '1,1,2,2': 'نص' }));
  const a = page('a'), b = page('b'), f = flag('نض', [1, 1, 2, 2]);
  await s.reread(a, 'nuqta', [f]);
  assert.ok(s.offer(a, f));
  assert.strictEqual(s.offer(b, f), null);  // the same box on another page
  assert.strictEqual(s.offer(a, f), null);  // and the page left behind starts over
});

test('a reading that comes back after the page changed is not offered on the new page', async () => {
  let answer;
  const s = Spots.create({ read: () => new Promise((r) => { answer = r; }) });
  const a = page('a'), b = page('b'), f = flag('نض', [1, 1, 2, 2]);
  const out = s.reread(a, 'nuqta', [f]);
  s.offer(b, f);  // the reviewer moved on to page b
  answer([{ text: 'نص' }]);
  await out;
  assert.strictEqual(s.offer(b, f), null);
});

test('flags with no place on the photo are not sent at all', async () => {
  const r = reader({});
  const s = Spots.create(r);
  assert.deepStrictEqual(await s.reread(page('a'), 'nuqta', [flag('ختم', null)]), []);
  assert.strictEqual(r.asked.length, 0);
});
