// The readers' pages (tests/fixtures/pages.json, written from the server's layout code by
// server/tests/test_page_model.py) through the editor and the Word export: what the server writes, the browser reads.
// node --test web/js/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const JSZip = require('../vendor/jszip.min.js');
const { blocksToDoc, docToBlocks, segLists } = require('./blocks-doc.js');
const DocxExport = require('./docx-export.js');

const PAGES = JSON.parse(fs.readFileSync(path.join(__dirname, '../../tests/fixtures/pages.json'), 'utf8'));
// every note in a page, found without the page model's own walk
const notes = (x) => (Array.isArray(x) ? x.flatMap(notes) : x && typeof x === 'object'
  ? (typeof x.note === 'string' ? [x.note] : []).concat(Object.values(x).flatMap(notes)) : []);

// the same page written one way: plain runs side by side as one, a list item's missing level as 0, no bold on a
// table (it means nothing there); anything else that differs is lost or changed on the way
function canon(blocks) {
  const runs = (segs) => (segs || []).reduce((out, s) => {
    const last = out[out.length - 1];
    if (last && Object.keys(last).length === 1 && Object.keys(s).length === 1) last.s += s.s; else out.push({ ...s });
    return out;
  }, []);
  return JSON.parse(JSON.stringify(blocks)).map((b) => {
    if ((b.type === 'li' || b.type === 'ol') && b.level == null) b.level = 0;
    if (b.type === 'table') { delete b.bold; b.rows = b.rows.map((r) => r.map(runs)); } else b.segs = runs(b.segs);
    return b;
  });
}

for (const [name, blocks] of Object.entries(PAGES)) {
  test(`${name}: a page comes back from the editor as it went in`, () => {
    assert.deepStrictEqual(canon(docToBlocks(blocksToDoc(blocks))), canon(blocks));
  });
  test(`${name}: the walk over a page's text finds every flagged spot`, () => {
    const found = [...segLists(blocks)].flat().filter((s) => s.note != null).map((s) => s.note);
    assert.deepStrictEqual(found.sort(), notes(blocks).sort());
  });
}

test('the Word file has every page and every note as a comment', async () => {
  const tpl = fs.readFileSync(path.join(__dirname, '../../templates/plain.docx'));
  const draft = { pages: Object.values(PAGES).map((blocks) => ({ blocks })) };
  const zip = await JSZip.loadAsync(await DocxExport.build(tpl, draft, { JSZip, date: '23/11/2026' }));
  const doc = await zip.file('word/document.xml').async('string');
  const comments = await zip.file('word/comments.xml').async('string');
  assert.strictEqual((doc.match(/<w:br w:type="page"\/>/g) || []).length, Object.keys(PAGES).length - 1);
  for (const n of notes(Object.values(PAGES))) assert.ok(comments.includes(n.split('\n')[0]), n);
});
