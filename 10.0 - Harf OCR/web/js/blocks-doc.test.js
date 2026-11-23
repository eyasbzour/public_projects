// node --test web/js/
const test = require('node:test');
const assert = require('node:assert');
const { blocksToDoc, docToBlocks } = require('./blocks-doc.js');

test('blocks survive the trip through the editor document', () => {
  const blocks = [
    { type: 'h', bold: true, segs: [{ s: 'الموضوع' }], align: 'center' },
    { type: 'h', bold: true, segs: [{ s: 'عنوان رئيسي' }], level: 1 },
    { type: 'q', bold: false, segs: [{ s: 'نص مقتبس' }], box: [0.1, 0.5, 0.9, 0.55] },
    { type: 'p', bold: false, segs: [{ s: 'نص ' }, { s: 'عريض', b: true }, { s: ' و' }, { s: 'مشطوب', x: true, u: true },
      { s: ' ' }, { s: 'كلمة', note: 'غير مؤكدة', box: [0.1, 0.2, 0.3, 0.4] }, { s: '\nسطر ثان' },
      { s: ' أحمر', c: '#c00000' }, { s: ' مظلل', bg: '#fff2cc', sz: 16 }],
      box: [0.1, 0.2, 0.9, 0.26], lines: [[0.1, 0.2, 0.9, 0.22, 0], [0.4, 0.23, 0.9, 0.26, 18]] },
    { type: 'ol', bold: false, level: 0, segs: [{ s: 'أولاً' }] },
    { type: 'li', bold: false, level: 1, segs: [{ s: 'نقطة فرعية' }] },
    { type: 'ol', bold: false, level: 0, segs: [{ s: 'ثانياً' }], align: 'justify' },
    { type: 'ol', bold: false, level: 0, segs: [{ s: 'قائمة جديدة' }], restart: true },
    { type: 'table', borderless: true, rows: [[[{ s: 'الرقم: 245' }], [{ s: 'التاريخ' }]]] },
    { type: 'table', rows: [[[{ s: 'أ' }], [{ s: 'ب' }]]], cellBg: [['#ddebf7', null]], cellBoxes: [[[0.5, 0.1, 0.9, 0.15], null]] },
    { type: 'img', image: 'fig.jpg', w: 400, h: 200, wFrac: 0.4, align: 'end' },
    { type: 'p', bold: false, segs: [] },
  ];
  assert.deepStrictEqual(docToBlocks(blocksToDoc(blocks)), blocks);
});

test('nested and mixed lists build the right tree', () => {
  const doc = blocksToDoc([
    { type: 'li', level: 0, segs: [{ s: 'أ' }] },
    { type: 'li', level: 2, segs: [{ s: 'ب' }] },  // too deep: one level under its parent
    { type: 'ol', level: 0, segs: [{ s: 'ج' }] },  // other kind: a new list
  ]);
  assert.deepStrictEqual(doc.content.map((n) => n.type), ['bulletList', 'orderedList']);
  assert.strictEqual(doc.content[0].content[0].content[1].type, 'bulletList');
});

test('English (left-to-right) blocks keep their direction and alignment', () => {
  const blocks = [
    { type: 'p', bold: false, segs: [{ s: 'Dear Director,' }], align: 'start', dir: 'ltr' },
    { type: 'li', bold: false, level: 0, segs: [{ s: 'Replace the server' }], dir: 'ltr' },
    { type: 'table', rows: [[[{ s: 'Device' }], [{ s: 'Count' }]]], dir: 'ltr' },
    { type: 'p', bold: false, segs: [{ s: 'سطر عربي' }], align: 'start' },
  ];
  const doc = blocksToDoc(blocks);
  assert.strictEqual(doc.content[0].attrs.textAlign, 'left');   // start of an English line is the left side
  assert.strictEqual(doc.content[3].attrs.textAlign, 'right');
  assert.deepStrictEqual(docToBlocks(doc), blocks);
});

test('pasted colours and sizes are kept in one form', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'نص',
    marks: [{ type: 'textStyle', attrs: { color: 'rgb(192, 0, 0)', backgroundColor: '#FF0', fontSize: '18.6667px' } }] }] }] };
  assert.deepStrictEqual(docToBlocks(doc)[0].segs, [{ s: 'نص', c: '#c00000', bg: '#ffff00', sz: 14 }]);
});

test('old line types and block bold become formatting', () => {
  const back = docToBlocks(blocksToDoc([{ type: 'c', segs: [{ s: 'سطر بارز' }] }, { type: 'p', bold: true, segs: [{ s: 'كله عريض' }] }]));
  assert.deepStrictEqual(back, [
    { type: 'p', bold: false, segs: [{ s: 'سطر بارز', b: true }], align: 'center' },
    { type: 'p', bold: false, segs: [{ s: 'كله عريض', b: true }] },
  ]);
});

test('list styles, spacing and a wrapped picture survive the trip; a list item takes the side of its first letter', () => {
  const blocks = [
    { type: 'p', bold: false, segs: [{ s: 'فقرة' }], lh: 1.5, sb: 12, sa: 0 },
    { type: 'li', bold: false, level: 0, segs: [{ s: 'نقطة' }], ls: 'check' },
    { type: 'ol', bold: false, level: 0, segs: [{ s: 'أول' }], ls: 'hindi' },
    { type: 'ol', bold: false, level: 0, segs: [{ s: 'ثان' }], ls: 'hindi' },
    { type: 'img', image: 'a.jpg', w: 10, h: 10, wFrac: 0.33, wrap: 'square' },
  ];
  assert.deepStrictEqual(docToBlocks(blocksToDoc(blocks)), blocks);
  const doc = blocksToDoc([{ type: 'li', level: 0, segs: [{ s: '2026 PDF report' }] }, { type: 'li', level: 0, segs: [{ s: '12 ملف' }] }]);
  const items = doc.content[0].content;
  assert.deepStrictEqual(items.map((it) => it.attrs.dir), ['ltr', 'rtl']);
  assert.deepStrictEqual(docToBlocks(doc).map((b) => b.dir || null), ['ltr', null]);
});

test('a picture in a line, a framed free picture and a list item turned by hand survive the trip', () => {
  const blocks = [
    { type: 'p', bold: false, segs: [{ s: 'قبل ' }, { s: '', img: { image: 'i.jpg', w: 10, h: 5, wFrac: 0.1, border: 'double' } }, { s: ' بعد' }] },
    { type: 'img', image: 'b.jpg', w: 10, h: 10, wFrac: 0.4, wrap: 'behind', x: 0.25, y: -0.1, border: 'dashed' },
    { type: 'li', bold: false, level: 0, segs: [{ s: 'عربي في قائمة من اليسار' }], dir: 'ltr', fixedDir: true },
  ];
  assert.deepStrictEqual(docToBlocks(blocksToDoc(blocks)), blocks);
  assert.strictEqual(blocksToDoc(blocks).content[2].content[0].attrs.dir, 'ltr');  // the hand-set side, not the Arabic letters'
});

test('paragraph borders survive the trip', () => {
  const blocks = [{ type: 'p', bold: false, segs: [{ s: 'نص' }], bd: { top: 'single', bottom: 'single', left: 'single', right: 'single', between: 'single' } },
    { type: 'h', bold: true, segs: [{ s: 'عنوان' }], bd: { bottom: 'double' } }];
  assert.deepStrictEqual(docToBlocks(blocksToDoc(blocks)), blocks);
});
