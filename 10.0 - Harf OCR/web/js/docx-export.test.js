// Run: node --test web/js/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const JSZip = require('../vendor/jszip.min.js');
const DocxExport = require('./docx-export.js');

test('plain template: flagged text becomes highlight + Word comment, date filled', async () => {
  const tpl = fs.readFileSync(path.join(__dirname, '../../templates/plain.docx'));
  const draft = { pages: [
    { blocks: [{ type: 'h', bold: true, segs: [{ s: 'الموضوع' }] },
               { type: 'p', segs: [{ s: 'نص ' }, { s: 'غامض', note: 'ختم فوق الكلمة' }] },
               { type: 'p', align: 'end', segs: [{ s: 'مدير الدائرة' }] }] },
    { blocks: [{ type: 'table', rows: [[[{ s: 'أ' }], [{ s: 'ب' }]]] }] }] };
  const zip = await JSZip.loadAsync(await DocxExport.build(tpl, draft, { JSZip, date: '12/11/2026' }));
  const read = (n) => zip.file(n).async('string');

  const doc = await read('word/document.xml');
  assert.match(doc, /<w:highlight w:val="yellow"\/>/);
  assert.match(doc, /<w:commentReference w:id="0"\/>/);
  assert.match(doc, /<w:br w:type="page"\/>/);
  assert.match(doc, /<w:tbl>/);
  assert.match(doc, /<w:jc w:val="end"\/>/);                 // alignment from the photo kept
  assert.match(doc, /<w:sectPr/);                       // template page setup kept
  assert.match(await read('word/comments.xml'), /ختم فوق الكلمة/);
  assert.match(await read('word/_rels/document.xml.rels'), /Target="comments.xml"/);
  assert.match(await read('[Content_Types].xml'), /\/word\/comments\.xml/);
  assert.match(await read('word/header1.xml'), /12\/11\/2026/);
  assert.ok(!Object.values(zip.files).some((f) => f.dir), 'no folder entries');
});

test('notesAs footnotes: notes print under the page for PDF / images', async () => {
  const tpl = fs.readFileSync(path.join(__dirname, '../../templates/plain.docx'));
  const draft = { pages: [{ blocks: [{ type: 'p', segs: [{ s: 'نص ' }, { s: 'غامض', note: 'ختم فوق الكلمة' }] }] }] };
  const zip = await JSZip.loadAsync(await DocxExport.build(tpl, draft, { JSZip, notesAs: 'footnotes' }));
  const read = (n) => zip.file(n).async('string');
  assert.match(await read('word/document.xml'), /<w:footnoteReference w:id="1"\/>/);
  assert.match(await read('word/footnotes.xml'), /ختم فوق الكلمة/);
  assert.match(await read('word/_rels/document.xml.rels'), /Target="footnotes.xml"/);
  assert.match(await read('[Content_Types].xml'), /\/word\/footnotes\.xml/);
  assert.equal(zip.file('word/comments.xml'), null);
});

test('borderless row and picture block', async () => {
  const tpl = fs.readFileSync(path.join(__dirname, '../../templates/plain.docx'));
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const draft = { pages: [{ blocks: [
    { type: 'table', borderless: true, rows: [[[{ s: 'الرقم: 245 / 2026' }], [{ s: 'التاريخ: 10/11/2026' }]]] },
    { type: 'img', image: 'abc.jpg', w: 400, h: 200, wFrac: 0.5 },
    { type: 'img', image: 'tall.jpg', w: 100, h: 900, wFrac: 0.9 }] }] };
  const asked = [];
  const zip = await JSZip.loadAsync(await DocxExport.build(tpl, draft, { JSZip, fetchImage: async (n) => { asked.push(n); return jpeg; } }));
  const doc = await zip.file('word/document.xml').async('string');
  assert.match(doc, /<w:insideV w:val="nil"\/>/);                 // no lines
  // last part at the end (left); the date is its own left-to-right run, so Word keeps 10/11/2026 in order
  assert.match(doc, /<w:jc w:val="end"\/><\/w:pPr><w:r><w:rPr><w:sz w:val="26"\/><w:szCs w:val="26"\/><w:rtl\/><\/w:rPr><w:t xml:space="preserve">التاريخ: <\/w:t><\/w:r>/);
  assert.match(doc, /<w:rPr><w:sz w:val="26"\/><w:szCs w:val="26"\/><\/w:rPr><w:t xml:space="preserve">10\/11\/2026<\/w:t>/);
  // "245 / 2026": two number runs, the " / " between them stays right to left (the photo's order)
  assert.match(doc, />245<\/w:t><\/w:r><w:r><w:rPr><w:sz w:val="26"\/><w:szCs w:val="26"\/><w:rtl\/><\/w:rPr><w:t xml:space="preserve"> \/ <\/w:t>/);
  assert.deepEqual(asked, ['abc.jpg', 'tall.jpg']);
  assert.match(doc, /r:embed="rIdDsImg1"/);
  const ext = [...doc.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)].map((m) => [+m[1], +m[2]]);
  // half of plain.docx's text width (11906 - 2 x 1417 twips), in EMU
  assert.equal(ext[0][0], Math.round(0.5 * (11906 - 2 * 1417) * 635));
  // taller than the page: scaled down to 85% of its text height (16838 - 2 x 1417 twips)
  assert.equal(ext[1][1], Math.round(0.85 * (16838 - 2 * 1417) * 635));
  assert.ok(zip.file('word/media/ds-img-1.jpeg'));
  assert.match(await zip.file('word/_rels/document.xml.rels').async('string'), /Target="media\/ds-img-1.jpeg"/);
  assert.match(await zip.file('[Content_Types].xml').async('string'), /Extension="jpeg"/);
});

test('lists, formatting, colours, headings, quote and cell fill reach Word', async () => {
  const blocks = [
    { type: 'h', level: 1, segs: [{ s: 'رئيسي' }] },
    { type: 'p', segs: [{ s: 'أ', b: true, i: true, u: true, x: true, c: '#c00000', bg: '#fff2cc', sz: 18 }, { s: 'سطر\nثان' }] },
    { type: 'li', level: 0, segs: [{ s: 'نقطة' }] }, { type: 'li', level: 1, segs: [{ s: 'فرعية' }] },
    { type: 'ol', level: 0, segs: [{ s: 'أول' }] }, { type: 'p', segs: [{ s: 'فاصل' }] }, { type: 'ol', level: 0, segs: [{ s: 'جديد' }] },
    { type: 'q', segs: [{ s: 'اقتباس' }] },
    { type: 'table', rows: [[[{ s: 'خلية' }]]], cellBg: [['#ddebf7']] },
  ];
  const tpl = fs.readFileSync(path.join(__dirname, '../../templates/plain.docx'));
  const zip = await JSZip.loadAsync(await DocxExport.build(tpl, { pages: [{ blocks }] }, { JSZip, fontName: 'Simplified Arabic' }));
  const doc = await zip.file('word/document.xml').async('string');
  for (const bit of ['<w:outlineLvl w:val="0"/>', '<w:i/>', '<w:u w:val="single"/>', '<w:strike/>', '<w:color w:val="C00000"/>',
    'w:fill="FFF2CC"', '<w:sz w:val="36"/>', '<w:br/>', 'w:fill="DDEBF7"', 'w:ascii="Simplified Arabic"', 'w:end="720"']) {
    assert.ok(doc.includes(bit), 'missing ' + bit);
  }
  const ids = [...doc.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
  assert.strictEqual(ids.length, 4);
  assert.strictEqual(ids[0], ids[1]);   // bullet and its sub-item share the bullet list
  assert.notStrictEqual(ids[2], ids[3]);  // a paragraph between numbered items starts a new numbered list
  const num = await zip.file('word/numbering.xml').async('string');
  assert.ok(num.includes('w:abstractNumId="9001"') && num.includes('<w:startOverride w:val="1"/>'));
  assert.ok((await zip.file('[Content_Types].xml').async('string')).includes('/word/numbering.xml'));
});

test('list styles, line spacing and a picture the text wraps around reach Word', async () => {
  const tpl = fs.readFileSync(path.join(__dirname, '../../templates/plain.docx'));
  const blocks = [
    { type: 'img', image: 'a.jpg', w: 400, h: 300, wFrac: 0.33, wrap: 'square' },
    { type: 'p', segs: [{ s: 'نص حول الصورة' }], lh: 2, sb: 12, sa: 0 },
    { type: 'li', level: 0, segs: [{ s: 'صح' }], ls: 'check' },
    { type: 'ol', level: 0, segs: [{ s: 'أول' }], ls: 'hindi' },
    { type: 'ol', level: 1, segs: [{ s: 'فرعي' }], ls: 'alpha-ar' },
    { type: 'ol', level: 0, segs: [{ s: 'ثان' }], ls: 'hindi' },
    { type: 'img', image: 'b.jpg', w: 400, h: 300, wFrac: 0.5, wrap: 'square', align: 'end' },
  ];
  const zip = await JSZip.loadAsync(await DocxExport.build(tpl, { pages: [{ blocks }] }, { JSZip, fetchImage: async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }));
  const doc = await zip.file('word/document.xml').async('string');
  const paras = doc.split('<w:p>');
  const first = paras.find((x) => x.includes('<wp:anchor'));
  assert.ok(first.includes('نص حول الصورة') && first.includes('<wp:align>right</wp:align>') && first.includes('<wp:wrapSquare'));  // in the next paragraph
  assert.ok(doc.includes('w:before="240" w:after="0" w:line="480"'));
  assert.ok(doc.includes('<wp:align>left</wp:align>'), 'the last picture, with no paragraph after it, still goes in');
  // Arabic-Indic numbers are written into the text (Word's own are Devanagari), and go on after the nested list
  assert.ok(doc.includes('<w:t>١.</w:t><w:tab/>') && doc.includes('<w:t>٢.</w:t><w:tab/>'));
  assert.ok(doc.includes('<w:ind w:start="720" w:hanging="360"/>'));
  assert.strictEqual([...doc.matchAll(/<w:numId w:val="(\d+)"\/>/g)].length, 2);  // the check bullet and the nested letters
  const num = await zip.file('word/numbering.xml').async('string');
  for (const bit of ['w:val="arabicAlpha"', '<w:lvlText w:val="✓"/>', 'w:ascii="Segoe UI Symbol"']) assert.ok(num.includes(bit), 'missing ' + bit);
});

test("Word's layout options, picture borders and a picture in a line reach Word", async () => {
  const tpl = fs.readFileSync(path.join(__dirname, '../../templates/plain.docx'));
  const blocks = [
    { type: 'p', segs: [{ s: 'قبل ' }, { s: '', img: { image: 'i.jpg', w: 10, h: 5, wFrac: 0.1, border: 'double' } }, { s: ' بعد' }] },
    { type: 'img', image: 'b.jpg', w: 10, h: 10, wFrac: 0.4, wrap: 'behind', x: 0.25, y: 0.5 },
    { type: 'p', segs: [{ s: 'نص' }] },
    { type: 'img', image: 't.jpg', w: 10, h: 10, wFrac: 0.3, wrap: 'tight', border: 'dashed' },
    { type: 'p', segs: [{ s: 'نص' }] },
  ];
  const zip = await JSZip.loadAsync(await DocxExport.build(tpl, { pages: [{ blocks }] }, { JSZip, fetchImage: async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }));
  const doc = await zip.file('word/document.xml').async('string');
  const first = doc.split('<w:p>').find((x) => x.includes('قبل'));
  assert.ok(first.includes('<wp:inline') && first.includes('cmpd="dbl"'), 'the picture inside the line, framed');
  const tw = 11906 - 2 * 1417;
  assert.ok(doc.includes('behindDoc="1"') && doc.includes('<wp:wrapNone/>') && doc.includes('<wp:posOffset>' + Math.round(0.25 * tw * 635) + '</wp:posOffset>'));
  assert.ok(doc.includes('<wp:posOffset>' + Math.round(0.5 * tw * 635) + '</wp:posOffset>'));
  assert.ok(doc.includes('<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon') && doc.includes('<a:prstDash val="dash"/>'));
});

test('paragraph borders reach Word', async () => {
  const tpl = fs.readFileSync(path.join(__dirname, '../../templates/plain.docx'));
  const blocks = [{ type: 'p', segs: [{ s: 'نص' }], bd: { bottom: 'double', left: 'thick', between: 'dashed' } }];
  const zip = await JSZip.loadAsync(await DocxExport.build(tpl, { pages: [{ blocks }] }, { JSZip }));
  const doc = await zip.file('word/document.xml').async('string');
  assert.ok(doc.includes('<w:pBdr><w:left w:val="single" w:sz="18" w:space="4" w:color="auto"/><w:bottom w:val="double" w:sz="4" w:space="1" w:color="auto"/>' +
    '<w:between w:val="dashed" w:sz="4" w:space="1" w:color="auto"/></w:pBdr><w:bidi/>'));
});
