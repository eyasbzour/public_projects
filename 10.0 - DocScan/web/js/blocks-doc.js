/*
 * The page model <-> the text editor's document.
 *
 * The page model ("blocks") is what the readers produce, what drafts store and what the Word export reads:
 *   { type: 'p' | 'h' | 'q' | 'c' | 'li' | 'ol' | 'table' | 'img', segs, align?, level?, start?, restart?, bold? }
 *   segs: [{ s, note?, box?, b?, i?, u?, x?, c?, bg?, sz? }]   b bold, i italic, u underline, x strikethrough,
 *         c text colour and bg background ('#rrggbb'), sz size in points; note = flagged
 *   align: 'start' | 'center' | 'end' | 'justify' (start is the side the text starts from: right, or left when dir is 'ltr')
 *   dir: 'ltr' for left-to-right (English) blocks; right to left otherwise
 *   h: heading, level 1-3 (2 when missing); q: quoted paragraph; c: centred bold line (older readings)
 *   li / ol: bullet / numbered list item, level 0.. (nesting); start: number of the first item; restart: a new
 *   numbered list right after another one.  table: rows of cells (each cell is segs), cellBg: the cells' fill
 *   colours in the same shape (only when some cell has one); cellBoxes: each cell's spot on the photo, the same way.
 *   img: a picture.
 * The editor's document is Tiptap / ProseMirror JSON (paragraph, heading, bulletList, orderedList, table, figure).
 * Works in the browser (window.BlocksDoc) and in Node (require) for testing.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BlocksDoc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // the editor stores the side (right / left); the model stores where the text starts, which depends on direction
  var TO_EDITOR = { start: 'right', center: 'center', end: 'left', justify: 'justify' };
  var FROM_EDITOR = { right: 'start', center: 'center', left: 'end', justify: 'justify' };
  var TO_EDITOR_LTR = { start: 'left', center: 'center', end: 'right', justify: 'justify' };
  var FROM_EDITOR_LTR = { left: 'start', center: 'center', right: 'end', justify: 'justify' };
  var FORMAT = [['b', 'bold'], ['i', 'italic'], ['u', 'underline'], ['x', 'strike']];
  var STYLE = ['c', 'bg', 'sz'];  // colour, background, size: one textStyle mark in the editor

  // '#abc', 'rgb(1, 2, 3)' -> '#aabbcc'; anything else -> null
  function hex(v) {
    if (!v) return null;
    var m = String(v).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) return '#' + (m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]).toLowerCase();
    m = String(v).match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
    return m ? '#' + [m[1], m[2], m[3]].map(function (n) { return (+n).toString(16).padStart(2, '0'); }).join('') : null;
  }
  // '14pt' / '18.67px' -> points
  function points(v) {
    var m = String(v || '').match(/^([\d.]+)(pt|px)?$/);
    if (!m) return null;
    var n = m[2] === 'px' ? +m[1] * 0.75 : +m[1];
    return n > 0 ? Math.round(n * 2) / 2 : null;
  }

  // ------------------------------------------------------------------ blocks -> editor
  function inline(segs, bold) {
    var out = [];
    (segs || []).forEach(function (sg) {
      var marks = [];
      FORMAT.forEach(function (f) { if (sg[f[0]] || (f[0] === 'b' && bold)) marks.push({ type: f[1] }); });
      if (sg.c || sg.bg || sg.sz) {
        marks.push({ type: 'textStyle', attrs: { color: sg.c || null, backgroundColor: sg.bg || null, fontSize: sg.sz ? sg.sz + 'pt' : null } });
      }
      if (sg.note != null) marks.push({ type: 'flag', attrs: { note: sg.note, box: sg.box || null } });
      String(sg.s || '').split('\n').forEach(function (part, k) {
        if (k) out.push({ type: 'hardBreak' });
        if (part) out.push(marks.length ? { type: 'text', text: part, marks: marks } : { type: 'text', text: part });
      });
    });
    return out;
  }

  function textNode(type, b, segs, bold, extra) {
    var n = { type: type, attrs: Object.assign({ textAlign: (b.dir === 'ltr' ? TO_EDITOR_LTR : TO_EDITOR)[b.align] || null }, extra || {}) };
    if (b.box) n.attrs.box = b.box;  // where it sits on the photo, to read it again with another engine
    if (b.lines) n.attrs.lines = b.lines;  // and each of its lines: [x0, y0, x1, y1, where its text starts]
    if (b.dir === 'ltr') n.attrs.dir = 'ltr';
    var content = inline(segs, bold);
    if (content.length) n.content = content;
    return n;
  }

  // consecutive li / ol blocks -> nested bulletList / orderedList nodes
  function lists(items) {
    var root = [], stack = [];
    items.forEach(function (b) {
      var type = b.type === 'ol' ? 'orderedList' : 'bulletList';
      var lvl = Math.max(0, Math.min(b.level || 0, stack.length));  // at most one level deeper than the last
      while (stack.length > lvl + 1) stack.pop();
      if (stack.length === lvl + 1 && (stack[lvl].type !== type || (lvl === 0 && b.restart))) stack.pop();
      if (stack.length === lvl) {
        var list = { type: type, content: [] };
        if (type === 'orderedList') list.attrs = { start: b.start || 1 };
        if (b.dir === 'ltr') list.attrs = Object.assign(list.attrs || {}, { dir: 'ltr' });
        if (lvl === 0) root.push(list);
        else { var parent = stack[lvl - 1].content; parent[parent.length - 1].content.push(list); }
        stack.push(list);
      }
      stack[lvl].content.push({ type: 'listItem', content: [textNode('paragraph', b, b.segs, b.bold)] });
    });
    return root;
  }

  function blocksToDoc(blocks) {
    var out = [], run = [];
    var flush = function () { if (run.length) { out.push.apply(out, lists(run)); run = []; } };
    (blocks || []).forEach(function (b) {
      if (b.type === 'li' || b.type === 'ol') { run.push(b); return; }
      flush();
      if (b.type === 'h') out.push(textNode('heading', b, b.segs, false, { level: Math.max(1, Math.min(3, b.level || 2)) }));
      else if (b.type === 'q') out.push({ type: 'blockquote', content: [textNode('paragraph', b, b.segs, b.bold)] });  // dir on its paragraph
      else if (b.type === 'c') out.push(textNode('paragraph', Object.assign({}, b, { align: b.align || 'center' }), b.segs, b.bold !== false));
      else if (b.type === 'table') {
        var rows = b.rows && b.rows.length ? b.rows : [[[]]];
        var cols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
        out.push({ type: 'table', attrs: { borderless: !!b.borderless, lineless: !!b.lineless, dir: b.dir === 'ltr' ? 'ltr' : null }, content: rows.map(function (r, ri) {
          var cells = [];
          for (var c = 0; c < cols; c++) {
            var fill = b.cellBg && b.cellBg[ri] && b.cellBg[ri][c];
            var place = b.cellBoxes && b.cellBoxes[ri] && b.cellBoxes[ri][c];  // the cell's spot on the photo, on its paragraph
            cells.push({ type: 'tableCell', attrs: { backgroundColor: fill || null }, content: [textNode('paragraph', { dir: b.dir, box: place || null }, r[c] || [], b.bold)] });
          }
          return { type: 'tableRow', content: cells };
        }) });
      } else if (b.type === 'img') {
        out.push({ type: 'figure', attrs: { image: b.image, w: b.w || 0, h: b.h || 0, wFrac: b.wFrac || 0.5, align: b.align || null } });
      } else out.push(textNode('paragraph', b, b.segs, b.bold));
    });
    flush();
    if (!out.length) out.push({ type: 'paragraph' });
    return { type: 'doc', content: out };
  }

  // ------------------------------------------------------------------ editor -> blocks
  function sameFormat(a, b) {
    return FORMAT.every(function (f) { return !a[f[0]] === !b[f[0]]; }) && STYLE.every(function (k) { return a[k] === b[k]; });
  }
  // a flagged word stays one seg (one Word comment) even if part of it got another format
  function pushSeg(segs, sg) {
    var last = segs[segs.length - 1];
    if (last && last.note == null && sg.note == null && sameFormat(last, sg)) last.s += sg.s;
    else if (last && last.note != null && sg.note === last.note && String(sg.box) === String(last.box)) last.s += sg.s;
    else segs.push(sg);
  }

  function segsOf(content) {
    var segs = [];
    (content || []).forEach(function (n) {
      if (n.type === 'hardBreak') { pushSeg(segs, { s: '\n' }); return; }
      if (n.type !== 'text' || !n.text) return;
      var sg = { s: n.text };
      (n.marks || []).forEach(function (m) {
        FORMAT.forEach(function (f) { if (m.type === f[1]) sg[f[0]] = true; });
        if (m.type === 'textStyle' && m.attrs) {
          var c = hex(m.attrs.color), bg = hex(m.attrs.backgroundColor), sz = points(m.attrs.fontSize);
          if (c) sg.c = c;
          if (bg) sg.bg = bg;
          if (sz) sg.sz = sz;
        }
        if (m.type === 'flag') {
          sg.note = (m.attrs && m.attrs.note) || '';
          if (m.attrs && m.attrs.box) sg.box = m.attrs.box;
        }
      });
      pushSeg(segs, sg);
    });
    return segs;
  }

  // the cell's or list item's paragraphs, one line each
  function linesOf(nodes) {
    var segs = [];
    (nodes || []).filter(function (n) { return n.type === 'paragraph' || n.type === 'heading'; }).forEach(function (p, k) {
      if (k) pushSeg(segs, { s: '\n' });
      segsOf(p.content).forEach(function (sg) { pushSeg(segs, sg); });
    });
    return segs;
  }

  function withAlign(b, node) {
    var ltr = node && node.attrs && node.attrs.dir === 'ltr';
    var a = node && node.attrs && (ltr ? FROM_EDITOR_LTR : FROM_EDITOR)[node.attrs.textAlign];
    if (a) b.align = a;
    if (node && node.attrs && node.attrs.box) b.box = node.attrs.box;
    if (node && node.attrs && node.attrs.lines) b.lines = node.attrs.lines;
    if (ltr) b.dir = 'ltr';
    return b;
  }

  function docToBlocks(doc) {
    var out = [], prevList = null;
    var list = function (node, level, restart) {
      var type = node.type === 'orderedList' ? 'ol' : 'li';
      (node.content || []).forEach(function (item, k) {
        var paras = (item.content || []).filter(function (c) { return c.type === 'paragraph' || c.type === 'heading'; });
        var b = withAlign({ type: type, bold: false, level: level, segs: linesOf(item.content) }, paras[0]);
        if (k === 0 && type === 'ol' && node.attrs && node.attrs.start > 1) b.start = node.attrs.start;
        if (k === 0 && restart) b.restart = true;
        out.push(b);
        (item.content || []).forEach(function (c) {
          if (c.type === 'bulletList' || c.type === 'orderedList') list(c, level + 1, false);
        });
      });
    };
    ((doc && doc.content) || []).forEach(function (n) {
      if (n.type === 'bulletList' || n.type === 'orderedList') {
        list(n, 0, prevList === n.type);  // two lists of one kind in a row stay two lists
        prevList = n.type;
        return;
      }
      prevList = null;
      if (n.type === 'heading') {
        var h = withAlign({ type: 'h', bold: true, segs: segsOf(n.content) }, n);
        if (n.attrs && n.attrs.level && n.attrs.level !== 2) h.level = n.attrs.level;
        out.push(h);
      } else if (n.type === 'blockquote') {
        var inner = (n.content || []).filter(function (c) { return c.type === 'paragraph' || c.type === 'heading'; });
        out.push(withAlign({ type: 'q', bold: false, segs: linesOf(n.content) }, inner[0]));
      }
      else if (n.type === 'paragraph') out.push(withAlign({ type: 'p', bold: false, segs: segsOf(n.content) }, n));
      else if (n.type === 'figure') {
        var a = n.attrs || {}, img = { type: 'img', image: a.image, w: a.w, h: a.h, wFrac: a.wFrac };
        if (a.align) img.align = a.align;
        out.push(img);
      } else if (n.type === 'table') {
        var fills = [], anyFill = false, places = [], anyPlace = false;
        var t = { type: 'table', rows: (n.content || []).map(function (row) {
          var cells = [], rowFill = [], rowPlace = [];
          (row.content || []).forEach(function (cell) {
            var fill = hex(cell.attrs && cell.attrs.backgroundColor);
            var first = (cell.content || [])[0], place = (first && first.attrs && first.attrs.box) || null;
            anyFill = anyFill || !!fill; anyPlace = anyPlace || !!place;
            cells.push(linesOf(cell.content)); rowFill.push(fill); rowPlace.push(place);
            for (var k = 1; k < ((cell.attrs && cell.attrs.colspan) || 1); k++) { cells.push([]); rowFill.push(fill); rowPlace.push(null); }  // keep the grid square
          });
          fills.push(rowFill); places.push(rowPlace);
          return cells;
        }) };
        if (anyFill) t.cellBg = fills;
        if (anyPlace) t.cellBoxes = places;
        if (n.attrs && n.attrs.borderless) t.borderless = true;
        if (n.attrs && n.attrs.dir === 'ltr') t.dir = 'ltr';
        if (n.attrs && n.attrs.lineless) t.lineless = true;
        out.push(t);
      }
    });
    return out;
  }

  return { blocksToDoc: blocksToDoc, docToBlocks: docToBlocks, segsToInline: inline };
});
