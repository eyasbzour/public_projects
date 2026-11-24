// node --test web/js/
const test = require('node:test');
const assert = require('node:assert');
const Workspace = require('./workspace.js');

const page = (text) => ({ id: text, blocks: [{ type: 'p', segs: [{ s: text }] }] });
const text = (p) => p.blocks[0].segs[0].s;
const texts = (ws) => ws.draft.pages.map(text);
// an editor showing a page: what the reader typed into it comes back from getBlocks()
const editor = (typed) => ({ getBlocks: () => [{ type: 'p', segs: [{ s: typed }] }] });

function open(pages, opts = {}) {
  const ws = Workspace.create({ delay: Infinity, save: async () => ({ version: 2, updated: 1 }), ...opts });
  ws.load({ id: 'd', version: 1, pages: pages.map(page) });
  return ws;
}

test('deleting the shown page leaves every other page its own text', () => {
  const ws = open(['one', 'two', 'three']);
  ws.bind(editor('one, edited'));
  ws.removePage(0);
  assert.deepStrictEqual(texts(ws), ['two', 'three']);
  assert.strictEqual(text(ws.page), 'two');
  ws.flush();  // nothing is bound to the deleted page any more
  assert.deepStrictEqual(texts(ws), ['two', 'three']);
});

test('deleting a page above the shown one keeps the shown page shown, with its edits', () => {
  const ws = open(['one', 'two', 'three']);
  ws.show(2); ws.bind(editor('three, edited'));
  ws.removePage(0);
  assert.deepStrictEqual(texts(ws), ['two', 'three, edited']);
  assert.strictEqual(ws.index, 1);
});

test('deleting the last page shows the one before; deleting all shows none', () => {
  const ws = open(['one', 'two']);
  ws.show(1); ws.removePage(1);
  assert.strictEqual(text(ws.page), 'one');
  ws.removePage(0);
  assert.strictEqual(ws.page, null); assert.strictEqual(ws.index, -1);
});

test('moving and sorting pages keep the shown page and its edits', () => {
  const ws = open(['c', 'a', 'b']);
  ws.bind(editor('c, edited'));
  ws.movePage(0, 2);
  assert.deepStrictEqual(texts(ws), ['a', 'b', 'c, edited']);
  assert.strictEqual(ws.index, 2);
  ws.sortPages((x, y) => (text(x) < text(y) ? -1 : 1));
  assert.strictEqual(text(ws.page), 'c, edited');
  assert.strictEqual(ws.movePage(0, 9), false);
});

test('showing another page first puts the editor\'s text back into its own page', () => {
  const ws = open(['one', 'two']);
  ws.bind(editor('one, edited'));
  ws.show(1);
  assert.deepStrictEqual(texts(ws), ['one, edited', 'two']);
  ws.flush();  // unbound: the second page keeps its text
  assert.strictEqual(text(ws.draft.pages[1]), 'two');
});

test('a page not read yet takes nothing from an editor', () => {
  const ws = open(['one']);
  ws.draft.pages[0].blocks = null;
  ws.bind(editor('stray'));
  ws.flush();
  assert.strictEqual(ws.draft.pages[0].blocks, null);
});

test('a save takes the new version; one refused leaves the draft unsaved and says why', async () => {
  let fail = null;
  const ws = open(['one'], { save: async () => { if (fail) throw fail; return { version: 7, updated: 5 }; }, onFail: (e) => { ws.failed = e; } });
  ws.changed();
  assert.strictEqual(ws.dirty, true);
  assert.strictEqual(await ws.save(), true);
  assert.strictEqual(ws.dirty, false); assert.strictEqual(ws.draft.version, 7);
  fail = Object.assign(new Error('conflict'), { status: 409 });
  ws.changed();
  assert.strictEqual(await ws.save(), false);
  assert.strictEqual(ws.dirty, true); assert.strictEqual(ws.error.status, 409); assert.strictEqual(ws.failed, fail);
});

test('an edit made while a save is out keeps the draft unsaved', async () => {
  let answer;
  const ws = open(['one'], { save: () => new Promise((r) => { answer = r; }) });
  ws.changed();
  const saving = ws.save();
  await null; ws.changed();
  answer({ version: 2, updated: 1 });
  await saving;
  assert.strictEqual(ws.dirty, true);
});

test('a save flushes the editor first and sends the whole draft', async () => {
  let sent;
  const ws = open(['one'], { save: async (d) => { sent = JSON.parse(JSON.stringify(d)); return { version: 2, updated: 1 }; } });
  ws.bind(editor('one, edited'));
  await ws.save();
  assert.strictEqual(sent.pages[0].blocks[0].segs[0].s, 'one, edited');
});

test('changes save themselves after the pause', async () => {
  let saves = 0;
  const ws = Workspace.create({ delay: 5, save: async () => { saves++; return { version: 2, updated: 1 }; } });
  ws.load({ id: 'd', version: 1, pages: [] });
  ws.changed(); ws.changed();
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(saves, 1);
});
