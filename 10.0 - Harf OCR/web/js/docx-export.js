/*
 * Builds the final Word file from a draft, inside a chosen header template.
 * The template keeps its header, footer, page setup and styles; its body is replaced.
 * Flagged text is highlighted and becomes a Word comment, or a numbered footnote (opts.notesAs) for PDF / images.
 * Works in the browser (window.DocxExport) and in Node (require) for testing.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DocxExport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
  var COMMENTS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
  var FOOTNOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
  var FOOTNOTES_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
  var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
  var NUMBERING_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
  var NUMBERING_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
  var R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  var A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      // characters that are illegal in XML 1.0
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
  }

  function isoNow() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); }

  function makeBuilder(opts) {
    var images = [];
    var textWidth = opts.textWidth || 9000;    // twips between the template's side margins
    var textHeight = opts.textHeight || 12000;  // and between its top and bottom margins
    var comments = [];
    var footnotes = [];  // opts.notesAs === 'footnotes': notes print under the page (PDF / images)
    var size = Math.round((opts.fontSize || 13) * 2);
    var headSize = Math.round((opts.headingSize || 15) * 2);
    var author = opts.author || 'مراجع';

    // document font (opts.fontName) on every run; empty = the template's own font
    var font = opts.fontName ? esc(opts.fontName) : '';
    var hexVal = function (c) { return String(c).replace('#', '').toUpperCase(); };

    // f: { b, i, u, x (strike), c (colour), bg (background), sz (half-points), hl (flag highlight) }
    function rPr(f, rtl) {
      return '<w:rPr>' + (font ? '<w:rFonts w:ascii="' + font + '" w:hAnsi="' + font + '" w:cs="' + font + '"/>' : '') +
        (f.b ? '<w:b/><w:bCs/>' : '') + (f.i ? '<w:i/><w:iCs/>' : '') + (f.x ? '<w:strike/>' : '') +
        (f.c ? '<w:color w:val="' + hexVal(f.c) + '"/>' : '') +
        '<w:sz w:val="' + f.sz + '"/><w:szCs w:val="' + f.sz + '"/>' +
        (f.hl ? '<w:highlight w:val="yellow"/>' : '') + (f.u ? '<w:u w:val="single"/>' : '') +
        (f.bg && !f.hl ? '<w:shd w:val="clear" w:color="auto" w:fill="' + hexVal(f.bg) + '"/>' : '') +
        (rtl ? '<w:rtl/>' : '') + '</w:rPr>';
    }
    // Word lays out everything in a <w:rtl/> run right to left, digits too: "10/11/2026" in an Arabic
    // line came out as 2026/11/10. Latin words and numbers (with their / . : - inside) get their own
    // left-to-right runs, as Word itself saves mixed text; spaces between numbers stay right to left,
    // so "245 / 2026" keeps the photo's order.
    var LTR = /[A-Za-z][A-Za-z ]*[A-Za-z]|[A-Za-z0-9](?:[A-Za-z0-9./:,\-]*[A-Za-z0-9])?/g;

    var rtlBlock = true;  // false while writing a left-to-right (English) block
    function line(text, f) {
      if (!text) return '';
      var one = function (t, rtl) { return '<w:r>' + rPr(f, rtl) + '<w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>'; };
      if (!rtlBlock) return one(text, false);
      var out = '', pos = 0, m;
      LTR.lastIndex = 0;
      while ((m = LTR.exec(text))) {
        if (m.index > pos) out += one(text.slice(pos, m.index), true);
        out += one(m[0], false);
        pos = m.index + m[0].length;
      }
      return pos < text.length ? out + one(text.slice(pos), true) : out;
    }
    // "\n" in the text is a line break inside the paragraph (Shift+Enter in the editor)
    function run(text, f) {
      if (!text) return '';
      return String(text).split('\n').map(function (part) { return line(part, f); }).join('<w:r><w:br/></w:r>');
    }

    // base: the paragraph's own formatting ({ b, sz, c }), each seg adds its own
    function segsXml(segs, base) {
      var out = '';
      (segs || []).forEach(function (sg) {
        if (sg.img) { out += drawing(sg.img, null); return; }  // a picture in the line
        var text = sg.s || '';
        var f = { b: sg.b || base.b, i: sg.i, u: sg.u, x: sg.x, c: sg.c || base.c, bg: sg.bg, sz: sg.sz ? Math.round(sg.sz * 2) : base.sz };
        var flagged = sg.note != null && sg.note !== '';
        if (flagged) f.hl = opts.highlight !== false;
        if (flagged && opts.notesAs === 'footnotes') {
          footnotes.push({ id: footnotes.length + 1, note: sg.note });
          out += run(text, f) +
            '<w:r><w:rPr><w:vertAlign w:val="superscript"/><w:rtl/></w:rPr><w:footnoteReference w:id="' + footnotes.length + '"/></w:r>';
        } else if (flagged) {  // comments
          var id = comments.length;
          comments.push({ id: id, note: sg.note });
          out += '<w:commentRangeStart w:id="' + id + '"/>' + run(text, f) + '<w:commentRangeEnd w:id="' + id + '"/>' +
            '<w:r><w:rPr><w:rtl/></w:rPr><w:commentReference w:id="' + id + '"/></w:r>';
        } else {
          out += run(text, f);
        }
      });
      return out;
    }

    // a paragraph's borders (blocks-doc.js bd) as Word's: [w:val, w:sz in eighths of a point]
    var PARA_LINES = { single: ['single', 4], thick: ['single', 18], double: ['double', 4], dashed: ['dashed', 4], dotted: ['dotted', 4] };
    function pBdr(bd) {
      if (!bd) return '';
      var one = function (tag, s, space) {
        var v = PARA_LINES[s];
        return v ? '<w:' + tag + ' w:val="' + v[0] + '" w:sz="' + v[1] + '" w:space="' + space + '" w:color="auto"/>' : '';
      };
      // in a right-to-left paragraph Word's left and right are the page's own, as the editor draws them
      var x = one('top', bd.top, 1) + one('left', bd.left, 4) + one('bottom', bd.bottom, 1) + one('right', bd.right, 4) + one('between', bd.between, 1);
      return x ? '<w:pBdr>' + x + '</w:pBdr>' : '';
    }
    // o: { bold, size, color, keepNext, before, after, line, align, indent, hanging, indBoth, num: { id, lvl }, lit, outline, bd }
    // (lit: a list number written as text)
    // (line: Word's line spacing in 240ths of a line)
    function para(segs, o) {
      o = o || {};
      var anchor = floating; floating = '';  // a picture the text wraps around sits in the paragraph after it
      var ind = o.num ? '' : o.indent ? '<w:ind w:start="' + o.indent + '" w:hanging="' + (o.hanging || 0) + '"/>'
        : o.indBoth ? '<w:ind w:start="' + o.indBoth + '" w:end="' + o.indBoth + '"/>' : '';
      var pPr = '<w:pPr>' + (o.keepNext ? '<w:keepNext/>' : '') +
        (o.num ? '<w:numPr><w:ilvl w:val="' + o.num.lvl + '"/><w:numId w:val="' + o.num.id + '"/></w:numPr>' : '') + pBdr(o.bd) + (rtlBlock ? '<w:bidi/>' : '') +
        '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 120 : o.after) + '" w:line="' + (o.line || 300) + '" w:lineRule="auto"/>' +
        ind + '<w:jc w:val="' + (o.align || 'both') + '"/>' + (o.outline != null ? '<w:outlineLvl w:val="' + o.outline + '"/>' : '') + '</w:pPr>';
      var lit = o.lit ? '<w:r>' + rPr({ b: o.bold, sz: o.size || size }, true) + '<w:t>' + esc(o.lit) + '</w:t><w:tab/></w:r>' : '';
      return '<w:p>' + pPr + anchor + lit + segsXml(segs, { b: o.bold, sz: o.size || size, c: o.color }) + '</w:p>';
    }
    // a wrapped picture with no paragraph after it (the end of a page, or a table or picture next) gets its own
    var floating = '';
    function flush() { return floating ? para([], { after: 0 }) : ''; }

    // ---- Word lists: a definition for each list style in use (blocks-doc.js ls; the plain bullets go • ◦ ▪ by level).
    // One bullet list per style; every numbered list gets its own instance, so it starts again at 1 (or at its
    // block's start); a nested numbered list in a style of its own gets one too, ended by the item above it.
    // Word has no numbering in Arabic-Indic digits (its hindiNumbers are Devanagari), so those lists write their
    // numbers into the text, with a list's hanging indent: { lit: 'NN.', lvl }
    var nums = [];          // { id, abs, lvl, start }
    var abstracts = [];     // { id, bullet, ls }
    var bulletNums = {}, olRuns = [];  // olRuns[lvl]: { id, ls }, the numbered list in progress at that level
    function newNum(bullet, ls, lvl, start) {
      var a = abstracts.filter(function (x) { return x.bullet === bullet && x.ls === ls; })[0];
      if (!a) { a = { id: 9001 + abstracts.length, bullet: bullet, ls: ls }; abstracts.push(a); }
      var id = 9100 + nums.length;
      nums.push({ id: id, abs: a.id, lvl: lvl, start: start });
      return id;
    }
    function listNum(bk) {
      var lvl = Math.max(0, Math.min(8, bk.level || 0)), ls = bk.ls || '';
      if (bk.type === 'li') {
        olRuns.length = Math.min(olRuns.length, lvl);  // it ends the numbered lists at its level and below
        if (!bulletNums[ls]) bulletNums[ls] = newNum(true, ls, 0, 0);
        return { id: bulletNums[ls], lvl: lvl };
      }
      olRuns.length = Math.min(olRuns.length, lvl + 1);
      var r = olRuns[lvl], top = olRuns[0];
      // a nested list in the style of the list above it is that list's next level (Word starts it again at 1)
      if (!r && lvl > 0 && top && top.ls === ls && ls !== 'hindi') r = olRuns[lvl] = top;
      if (!r || r.ls !== ls || (lvl === 0 && bk.restart)) {
        r = olRuns[lvl] = ls === 'hindi' ? { n: (bk.start || 1) - 1, ls: ls } : { id: newNum(false, ls, lvl, bk.start || 1), ls: ls };
      }
      if (ls === 'hindi') return { lit: String(++r.n).replace(/[0-9]/g, function (d) { return String.fromCharCode(0x660 + +d); }) + '.', lvl: lvl };
      return { id: r.id, lvl: lvl };
    }
    var BULLETS = ['•', '◦', '▪'];
    var BULLET_STYLE = { circle: '○', square: '■', diamond: '◆', arrow: '➢', check: '✓' };
    var NUMBER_STYLE = { '': ['decimal', '.'], 'alpha-ar': ['arabicAlpha', '.'], paren: ['decimal', ')'],
      lower: ['lowerLetter', '.'], upper: ['upperLetter', '.'], roman: ['lowerRoman', '.'] };
    function numberingParts() {
      var lvls = function (a) {
        var x = '';
        for (var l = 0; l < 9; l++) {
          var fmt = a.bullet ? ['bullet', BULLET_STYLE[a.ls] || BULLETS[l % 3]] : (NUMBER_STYLE[a.ls] || NUMBER_STYLE['']);
          var text = a.bullet ? fmt[1] : '%' + (l + 1) + fmt[1];
          x += '<w:lvl w:ilvl="' + l + '"><w:start w:val="1"/><w:numFmt w:val="' + fmt[0] + '"/>' +
            '<w:lvlText w:val="' + esc(text) + '"/><w:lvlJc w:val="left"/>' +
            '<w:pPr><w:ind w:start="' + (720 * (l + 1)) + '" w:hanging="360"/></w:pPr>' +
            (BULLET_STYLE[a.ls] ? '<w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol" w:cs="Segoe UI Symbol"/></w:rPr>' : '') + '</w:lvl>';
        }
        return x;
      };
      return {
        abstracts: abstracts.map(function (a) {
          return '<w:abstractNum w:abstractNumId="' + a.id + '"><w:multiLevelType w:val="hybridMultilevel"/>' + lvls(a) + '</w:abstractNum>';
        }).join(''),
        nums: nums.map(function (n) {
          return '<w:num w:numId="' + n.id + '"><w:abstractNumId w:val="' + n.abs + '"/>' +
            (n.start ? '<w:lvlOverride w:ilvl="' + n.lvl + '"><w:startOverride w:val="' + n.start + '"/></w:lvlOverride>' : '') + '</w:num>';
        }).join(''),
      };
    }

    // bk.borderless: parts of one text row (e.g. "الرقم ... التاريخ"): no lines, first part at the start
    // (right), last at the end (left), any middle part centred, as on the photo
    function table(bk) {
      var rows = bk.rows || [], open = !!bk.borderless;
      var cols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0) || 1;
      var colW = Math.floor(textWidth / cols);
      var b = function (n) { return open ? '<w:' + n + ' w:val="nil"/>' : '<w:' + n + ' w:val="single" w:sz="4" w:space="0" w:color="808080"/>'; };
      var x = '<w:tbl><w:tblPr>' + (rtlBlock ? '<w:bidiVisual/>' : '') + '<w:tblW w:w="5000" w:type="pct"/><w:tblBorders>' +
        b('top') + b('left') + b('bottom') + b('right') + b('insideH') + b('insideV') +
        '</w:tblBorders><w:tblLayout w:type="autofit"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>';
      for (var c = 0; c < cols; c++) x += '<w:gridCol w:w="' + colW + '"/>';
      x += '</w:tblGrid>';
      rows.forEach(function (r, ri) {
        x += '<w:tr>';
        for (var c = 0; c < cols; c++) {
          // a data table (ruled, or bk.lineless: printed without lines) aligns cells to the start, header bold
          var grid = !open || bk.lineless;
          var al = grid ? 'start' : c === 0 ? 'start' : c === cols - 1 ? 'end' : 'center';
          var fill = bk.cellBg && bk.cellBg[ri] && bk.cellBg[ri][c];
          x += '<w:tc><w:tcPr><w:tcW w:w="' + colW + '" w:type="dxa"/>' +
            (fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + hexVal(fill) + '"/>' : '') + '</w:tcPr>' +
            para(r[c] || [], { bold: bk.bold || (grid && ri === 0), after: 40, align: al }) + '</w:tc>';
        }
        x += '</w:tr>';
      });
      return x + '</w:tbl>' + para([], { after: 60 });
    }

    // bk = { image, w, h, wFrac (share of the page width on the photo), align, wrap, x, y }; the bytes are added in build().
    // A wrapped picture (blocks-doc.js wrap) is anchored in the next paragraph; any other stands in a paragraph of its own
    var POLYGON = '<wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="0" y="21600"/><wp:lineTo x="21600" y="21600"/>' +
      '<wp:lineTo x="21600" y="0"/><wp:lineTo x="0" y="0"/></wp:wrapPolygon>';
    var WRAPS = { square: '<wp:wrapSquare wrapText="bothSides"/>', tight: '<wp:wrapTight wrapText="bothSides">' + POLYGON + '</wp:wrapTight>',
      through: '<wp:wrapThrough wrapText="bothSides">' + POLYGON + '</wp:wrapThrough>', behind: '<wp:wrapNone/>', front: '<wp:wrapNone/>' };
    // a picture's border (blocks-doc.js border), black as editor.js draws it: [width in EMU, compound, dash]
    var LINES = {};
    [['single', 9525, 'sng', 'solid'], ['thick', 28575, 'sng', 'solid'], ['double', 38100, 'dbl', 'solid'], ['dashed', 19050, 'sng', 'dash'],
      ['dotted', 19050, 'sng', 'sysDot']].forEach(function (l) {
      LINES[l[0]] = '<a:ln w="' + l[1] + '" cmpd="' + l[2] + '"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="' + l[3] + '"/></a:ln>';
    });
    function picture(bk) {
      var free = bk.wrap === 'behind' || bk.wrap === 'front';
      if (free || (WRAPS[bk.wrap] && bk.align !== 'center')) { floating += drawing(bk, bk.wrap); return ''; }
      return '<w:p><w:pPr><w:bidi/><w:spacing w:before="60" w:after="120"/><w:jc w:val="' + (bk.align || 'center') + '"/></w:pPr>' + drawing(bk, null) + '</w:p>';
    }
    // a run with the picture: in the line (wrap null) or anchored with that wrap
    function drawing(bk, wrap) {
      var n = images.length + 1, rid = 'rIdDsImg' + n, id = 9000 + n;
      images.push({ rid: rid, name: bk.image, part: 'media/ds-img-' + n + '.jpeg' });
      var cx = Math.round(Math.min(1, bk.wFrac || 0.5) * textWidth * 635);  // twips -> EMU
      // a cropped picture: what is left of it, at its width (Word's srcRect cuts the rest, in thousandths of a percent)
      var cr = bk.crop || {}, kw = 1 - (cr.l || 0) - (cr.r || 0), kh = 1 - (cr.t || 0) - (cr.b || 0);
      var cy = Math.round(cx * (bk.h || 1) * kh / ((bk.w || 1) * kw));
      var src = bk.crop ? '<a:srcRect l="' + Math.round((cr.l || 0) * 1e5) + '" t="' + Math.round((cr.t || 0) * 1e5) + '" r="' + Math.round((cr.r || 0) * 1e5) +
        '" b="' + Math.round((cr.b || 0) * 1e5) + '"/>' : '';
      var maxH = 0.85 * textHeight * 635;  // taller than a page would push it, and the lines kept with it, to the next page
      if (cy > maxH) { cx = Math.round(cx * maxH / cy); cy = Math.round(maxH); }
      var ext = 'cx="' + cx + '" cy="' + cy + '"';
      var graphic = '<wp:docPr id="' + id + '" name="Picture ' + n + '"/>' +
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="' + A_NS + '" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
        '<a:graphic xmlns:a="' + A_NS + '"><a:graphicData uri="' + PIC_NS + '"><pic:pic xmlns:pic="' + PIC_NS + '">' +
        '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + esc(bk.image) + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip xmlns:r="' + R_NS + '" r:embed="' + rid + '"/>' + src + '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext ' + ext + '/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' + (LINES[bk.border] || '') + '</pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic>';
      if (!wrap) {
        return '<w:r><w:drawing><wp:inline xmlns:wp="' + WP_NS + '" distT="0" distB="0" distL="0" distR="0"><wp:extent ' + ext + '/>' + graphic +
          '</wp:inline></w:drawing></w:r>';
      }
      // a free picture sits at its x, y from the text's left edge and its paragraph; a wrapped one at its side of the
      // page (the start of these right-to-left pages is the right margin), 0.15 inch from the text
      var free = wrap === 'behind' || wrap === 'front', emu = function (f) { return Math.round((f || 0) * textWidth * 635); };
      var gap = free ? '0' : '137160';
      return '<w:r><w:drawing><wp:anchor xmlns:wp="' + WP_NS + '" distT="' + (free ? 0 : 45720) + '" distB="' + (free ? 0 : 45720) + '" distL="' + gap + '" distR="' + gap + '"' +
        ' simplePos="0" relativeHeight="' + (251659264 + n) + '" behindDoc="' + (wrap === 'behind' ? 1 : 0) + '" locked="0" layoutInCell="1" allowOverlap="1">' +
        '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin">' +
        (free ? '<wp:posOffset>' + emu(bk.x) + '</wp:posOffset>' : '<wp:align>' + (bk.align === 'end' ? 'left' : 'right') + '</wp:align>') + '</wp:positionH>' +
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>' + (free ? emu(bk.y) : 0) + '</wp:posOffset></wp:positionV>' +
        '<wp:extent ' + ext + '/><wp:effectExtent l="0" t="0" r="0" b="0"/>' + WRAPS[wrap] + graphic + '</wp:anchor></w:drawing></w:r>';
    }

    function block(bk) {
      var lead = bk.type === 'table' || bk.type === 'img' ? flush() : '';  // a wrapped picture needs a paragraph to sit in
      rtlBlock = bk.dir !== 'ltr';  // Word's start / end follow the paragraph's direction by themselves
      var al = bk.align === 'justify' ? 'both' : bk.align || null;
      if (bk.type !== 'li' && bk.type !== 'ol') olRuns = [];  // anything else ends a numbered list
      return lead + blockXml(bk, al);
    }
    // the block's own spacing (lh, sb, sa) over the kind's
    function spaced(bk, o) {
      if (bk.lh) o.line = Math.round(240 * bk.lh);
      if (bk.sb != null) o.before = Math.round(bk.sb * 20);
      if (bk.sa != null) o.after = Math.round(bk.sa * 20);
      if (bk.bd) o.bd = bk.bd;
      return o;
    }
    function blockXml(bk, al) {
      switch (bk.type) {
        case 'h': {  // three heading levels, as Word's navigation pane sees them
          var lvl = Math.max(1, Math.min(3, bk.level || 2));
          var hs = lvl === 1 ? headSize + 6 : lvl === 2 ? headSize : size + 2;
          return para(bk.segs, spaced(bk, { bold: true, size: hs, keepNext: true, before: 120, after: 120, align: al || 'start', outline: lvl - 1 }));
        }
        case 'q': return para(bk.segs, spaced(bk, { bold: bk.bold, color: '404040', indBoth: 720, align: al || 'both' }));
        case 'c': return para(bk.segs, spaced(bk, { bold: bk.bold !== false, align: al || 'center' }));
        case 'li': case 'ol': {
          var nm = listNum(bk);
          var lo = nm.lit ? { lit: nm.lit, indent: 720 * (nm.lvl + 1), hanging: 360 } : { num: nm };
          return para(bk.segs, spaced(bk, Object.assign(lo, { bold: bk.bold, after: 60, align: al || 'start' })));
        }
        case 'table': return table(bk);
        case 'img': return picture(bk);
        default: return para(bk.segs, spaced(bk, { bold: bk.bold, align: al || 'both' }));
      }
    }

    function commentsXml() {
      var date = isoNow();
      var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="' + W_NS + '">';
      comments.forEach(function (c) {
        var lines = String(c.note).split(/\n/);
        x += '<w:comment w:id="' + c.id + '" w:author="' + esc(author) + '" w:date="' + date + '" w:initials="' + esc(author.slice(0, 2)) + '">';
        lines.forEach(function (ln) {
          x += '<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">' + esc(ln) + '</w:t></w:r></w:p>';
        });
        x += '</w:comment>';
      });
      return x + '</w:comments>';
    }

    function footnotesXml() {
      // ids -1 and 0 are the separators Word expects (and Word-made templates reference in settings.xml)
      var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes xmlns:w="' + W_NS + '">' +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';
      footnotes.forEach(function (f) {
        x += '<w:footnote w:id="' + f.id + '">';
        String(f.note).split(/\n/).forEach(function (ln, k) {
          x += '<w:p><w:pPr><w:bidi/><w:spacing w:after="0"/></w:pPr>' +
            (k === 0 ? '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>' : '') +
            '<w:r><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/><w:rtl/></w:rPr><w:t xml:space="preserve">' + (k === 0 ? ' ' : '') + esc(ln) + '</w:t></w:r></w:p>';
        });
        x += '</w:footnote>';
      });
      return x + '</w:footnotes>';
    }

    return { block: block, para: para, flush: flush, comments: comments, commentsXml: commentsXml, footnotes: footnotes, footnotesXml: footnotesXml, images: images,
      nums: nums, numberingParts: numberingParts };
  }

  function bodyXml(draft, opts, B) {
    var out = '';
    var pages = draft.pages || [];
    pages.forEach(function (pg, i) {
      if (i > 0 && opts.pageBreaks !== false) out += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      (pg.blocks || []).forEach(function (bk) { out += B.block(bk); });
      out += B.flush();  // a wrapped picture stays on its page
    });
    if (!out) out = B.para([]);
    return out;
  }

  /**
   * @param {ArrayBuffer|Uint8Array} templateBytes  the header template .docx
   * @param {object} draft  { pages: [{ blocks: [...] }] }
   * @param {object} opts   { JSZip, date, author, highlight, pageBreaks, fontSize, headingSize, fontName, notesAs: 'comments' | 'footnotes',
   *                          fetchImage: async (name) => bytes, needed when a page has picture blocks }
   * @returns {Promise<Uint8Array>}
   */
  async function build(templateBytes, draft, opts) {
    opts = opts || {};
    var JSZip = opts.JSZip || (typeof window !== 'undefined' && window.JSZip);
    var zip = await JSZip.loadAsync(templateBytes);

    var docPath = 'word/document.xml';
    var doc = await zip.file(docPath).async('string');
    var bStart = doc.indexOf('<w:body>');
    var bEnd = doc.lastIndexOf('</w:body>');
    if (bStart < 0 || bEnd < 0) throw new Error('Template has no document body');
    var body = doc.slice(bStart + 8, bEnd);
    var secIdx = body.lastIndexOf('<w:sectPr');
    var sectPr = secIdx >= 0 ? body.slice(secIdx) : '';
    var twips = function (re) { var m = sectPr.match(re); return m ? +m[1] : 0; };
    var textWidth = twips(/<w:pgSz\b[^>]*\bw:w="(\d+)"/) - twips(/<w:pgMar\b[^>]*\bw:(?:left|start)="(\d+)"/) -
      twips(/<w:pgMar\b[^>]*\bw:(?:right|end)="(\d+)"/);
    var textHeight = twips(/<w:pgSz\b[^>]*\bw:h="(\d+)"/) - twips(/<w:pgMar\b[^>]*\bw:top="(\d+)"/) - twips(/<w:pgMar\b[^>]*\bw:bottom="(\d+)"/);
    var B = makeBuilder(Object.assign({}, opts, { textWidth: textWidth > 0 ? textWidth : 9000, textHeight: textHeight > 0 ? textHeight : 12000 }));
    doc = doc.slice(0, bStart + 8) + bodyXml(draft, opts, B) + sectPr + doc.slice(bEnd);
    zip.file(docPath, doc);

    // fill {{DATE}} in headers and footers
    var parts = Object.keys(zip.files).filter(function (n) { return /^word\/(header|footer)\d*\.xml$/.test(n); });
    for (var i = 0; i < parts.length; i++) {
      var xml = await zip.file(parts[i]).async('string');
      if (xml.indexOf('{{DATE}}') >= 0) zip.file(parts[i], xml.split('{{DATE}}').join(esc(opts.date || '')));
    }

    // comments part (always rewritten: the template's old body, and its comments, are gone)
    var relsPath = 'word/_rels/document.xml.rels';
    var rels = await zip.file(relsPath).async('string');
    var ctPath = '[Content_Types].xml';
    var ct = await zip.file(ctPath).async('string');
    function addPart(name, xml, relType, ctType, relId) {
      zip.file('word/' + name, xml);
      if (rels.indexOf(relType + '"') < 0) rels = rels.replace('</Relationships>', '<Relationship Id="' + relId + '" Type="' + relType + '" Target="' + name + '"/></Relationships>');
      if (ct.indexOf('/word/' + name) < 0) ct = ct.replace('</Types>', '<Override PartName="/word/' + name + '" ContentType="' + ctType + '"/></Types>');
    }
    if (B.comments.length) addPart('comments.xml', B.commentsXml(), COMMENTS_REL, COMMENTS_CT, 'rIdDsComments');
    else if (zip.file('word/comments.xml')) zip.file('word/comments.xml', B.commentsXml());
    if (B.footnotes.length) addPart('footnotes.xml', B.footnotesXml(), FOOTNOTES_REL, FOOTNOTES_CT, 'rIdDsFootnotes');
    // lists: add our two definitions to the template's numbering part (all definitions first, then the instances)
    if (B.nums.length) {
      var np = B.numberingParts(), numPath = 'word/numbering.xml';
      var nx = zip.file(numPath) ? await zip.file(numPath).async('string')
        : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="' + W_NS + '"></w:numbering>';
      var firstNum = nx.search(/<w:num\s/);
      nx = firstNum >= 0 ? nx.slice(0, firstNum) + np.abstracts + nx.slice(firstNum) : nx.replace('</w:numbering>', np.abstracts + '</w:numbering>');
      var tail = nx.indexOf('<w:numIdMacAtCleanup');
      nx = tail >= 0 ? nx.slice(0, tail) + np.nums + nx.slice(tail) : nx.replace('</w:numbering>', np.nums + '</w:numbering>');
      addPart('numbering.xml', nx, NUMBERING_REL, NUMBERING_CT, 'rIdDsNumbering');
    }
    // pictures: opts.fetchImage(name) gives the bytes of a picture stored with the draft
    for (var k = 0; k < B.images.length; k++) {
      var im = B.images[k];
      zip.file('word/' + im.part, await opts.fetchImage(im.name));
      rels = rels.replace('</Relationships>', '<Relationship Id="' + im.rid + '" Type="' + IMAGE_REL + '" Target="' + im.part + '"/></Relationships>');
    }
    if (B.images.length && !/<Default [^>]*Extension="jpeg"/i.test(ct)) {
      ct = ct.replace('</Types>', '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>');
    }
    zip.file(relsPath, rels);
    zip.file(ctPath, ct);

    // drop folder entries: some cloud services refuse .docx files that contain them
    Object.keys(zip.files).forEach(function (n) { if (zip.files[n].dir) delete zip.files[n]; });

    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  return { build: build };
});
