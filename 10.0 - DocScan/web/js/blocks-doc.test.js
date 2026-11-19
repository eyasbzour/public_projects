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
