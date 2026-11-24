/*
 * The page text editor: Tiptap / ProseMirror (web/vendor/tiptap.min.js, built by tools/editor) plus the app's
 * own pieces: flagged words (<mark class="flag"> with the note and the spot on the photo), pictures cut from
 * the page, and tables that remember whether the page printed them with lines.
 *   DocEditor.mount(el, blocks, { src, onChange, onState, onPasteImage }) -> page editor
 *   DocEditor.toolbar(bar, () => current page editor, { picture, flag, engines, hasPage, showLine, previewOn, togglePreview }, floatHost)
 * The page model (blocks) <-> editor document conversion lives in blocks-doc.js.
 */
(function () {
  'use strict';
  const T = window.Tiptap;

  const Flag = T.Mark.create({
    name: 'flag',
    inclusive: false,  // typing right after a flagged word is not part of it
    priority: 1100,    // outermost mark: a flagged word stays one <mark> even when part of it is bold
    addAttributes() {
      return {
        note: { default: '', parseHTML: (el) => el.getAttribute('data-note') || '', renderHTML: (a) => ({ 'data-note': a.note, title: a.note }) },
        box: {
          default: null,
          parseHTML: (el) => (el.dataset.box ? el.dataset.box.split(',').map(Number) : null),
          renderHTML: (a) => (a.box ? { 'data-box': a.box.join(',') } : {}),
        },
      };
    },
    parseHTML() { return [{ tag: 'mark.flag' }]; },
    renderHTML({ HTMLAttributes }) { return ['mark', T.mergeAttributes({ class: 'flag' }, HTMLAttributes), 0]; },
  });

  // a picture (cut from the page photo, pasted or from a file); wFrac = its share of the page width.
  // wrap, as Word's Layout Options: 'square' | 'tight' | 'through' (the text flows around it, on its side; with
  // rectangular pictures the three look alike), 'behind' | 'front' (anywhere on the page, at x, y: fractions of the
  // page width from the text's left edge and from where the picture is in the text; dragged with the mouse), or none:
  // it stands on its own lines (Word's "Top and Bottom"). "In Line with Text" is a picture inside a line (InlineImage).
  const SIDE_WRAPS = ['square', 'tight', 'through'], FREE_WRAPS = ['behind', 'front'];
  // a picture's border, as Word's Picture Border (blocks-doc.js border); the same lines go to Word (docx-export.js)
  const BORDERS = { single: '1px solid', thick: '3px solid', double: '4px double', dashed: '1.5px dashed', dotted: '2px dotted' };
  const picAttrs = (wide) => {
    const data = (name, num) => ({
      default: num ? 0 : null,
      parseHTML: (el) => (num ? +el.getAttribute('data-' + name) || 0 : el.getAttribute('data-' + name) || null),
      renderHTML: () => ({}),
    });
    // crop: { l, t, r, b }, the share of the picture cut off each side (Word's Crop), or null
    const a = { image: data('image'), w: data('w', true), h: data('h', true), wFrac: data('wfrac', true), border: data('border'), crop: { default: null, renderHTML: () => ({}) } };
    return wide ? Object.assign(a, { align: data('align'), wrap: data('wrap'), x: data('x', true), y: data('y', true) }) : a;
  };
  const pct = (a) => Math.round(Math.min(1, a.wFrac || 0.5) * 1000) / 10 + '%';

  // How a picture is drawn in the page, a block one (Figure) or one in a line (InlineImage): a box with the picture
  // and two handles on its lower corners that resize it, as in Word (its height follows); a free one (behind or in
  // front of the text) is dragged anywhere by the picture itself. Cropping (dom.toggleCrop) shows the whole picture
  // with a frame over the part kept, whose edges and corners are dragged in; it ends with the button, Enter or Esc,
  // or when the picture is no longer selected, and the picture keeps its scale (it gets smaller, as in Word).
  const SIDES = ['l', 't', 'r', 'b'];
  const cropOf = (a) => Object.assign({ l: 0, t: 0, r: 0, b: 0 }, a.crop || {});
  const cut = (c) => SIDES.some((k) => c[k] > 0.001);
  function pictureView(src, inline) {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement(inline ? 'span' : 'figure'); dom.className = inline ? 'fig-inline' : 'fig';
      const box = document.createElement('span'); box.className = 'fig-box';
      const img = document.createElement('img'); img.alt = inline ? tx('editor.pictureLine') : tx('editor.insertedPicture'); img.draggable = false;
      const handles = ['left', 'right'].map((side) => {
        const h = document.createElement('span'); h.className = 'fig-handle'; h.dataset.side = side; h.title = tx('editor.dragResizePicture');
        return h;
      });
      const frame = document.createElement('span'); frame.className = 'crop-frame';
      ['l', 'r', 't', 'b', 'lt', 'rt', 'lb', 'rb'].forEach((e) => {
        const h = document.createElement('span'); h.className = 'crop-handle'; h.dataset.edge = e; frame.append(h);
      });
      box.append(img, frame, ...handles); dom.append(box);
      let cur = node, crop = null;  // crop: { l, t, r, b } while cropping
      const free = () => !inline && FREE_WRAPS.includes(cur.attrs.wrap);
      const side = () => !inline && SIDE_WRAPS.includes(cur.attrs.wrap) && cur.attrs.align !== 'center';  // a centred picture has no side
      // the width goes on the outer element when it is the one in the text's flow (beside the text, or in a line)
      const width = (w) => { const out = side() || inline; (out ? dom : box).style.width = w; (out ? box : dom).style.width = out ? '100%' : ''; };
      const place = (x, y) => { box.style.left = free() ? (x * 100).toFixed(2) + '%' : ''; box.style.marginTop = free() ? (y * 100).toFixed(2) + '%' : ''; };
      const paint = () => {
        const a = cur.attrs;
        Object.assign(dom.dataset, { image: a.image, w: a.w, h: a.h, wfrac: a.wFrac });
        if (!inline) Object.assign(dom.dataset, { align: a.align || '', wrap: side() ? 'square' : free() ? a.wrap : '' });
        if (img.getAttribute('src') !== src(a.image)) img.src = src(a.image);
        img.style.border = BORDERS[a.border] ? BORDERS[a.border] + ' #000' : '';
        dom.classList.toggle('framed', !!BORDERS[a.border]);
        const c = crop || cropOf(a), sized = a.w > 0 && a.h > 0;
        box.classList.toggle('cropping', !!crop);
        box.classList.toggle('cropped', !crop && sized && cut(c));
        if (crop) {  // the whole picture, at the scale it is shown, and the frame over the part kept
          box.style.aspectRatio = sized ? a.w + ' / ' + a.h : '';
          Object.assign(img.style, { position: '', left: '', top: '', width: '' });
          Object.assign(frame.style, { left: c.l * 100 + '%', top: c.t * 100 + '%', right: c.r * 100 + '%', bottom: c.b * 100 + '%' });
          width(Math.min(1, a.wFrac || 0.5) / Math.max(0.05, 1 - c.l - c.r) * 100 + '%');
        } else {
          const kw = 1 - c.l - c.r, kh = 1 - c.t - c.b, on = sized && cut(c);
          box.style.aspectRatio = on ? a.w * kw + ' / ' + a.h * kh : '';
          Object.assign(img.style, on ? { position: 'absolute', width: 100 / kw + '%', left: -c.l / kw * 100 + '%', top: -c.t / kh * 100 + '%' }
            : { position: '', left: '', top: '', width: '' });
          width(pct(a));
        }
        place(a.x, a.y);  // a margin's % is of the width, as y is
      };
      paint();
      const at = () => (typeof getPos === 'function' ? getPos() : null);
      const done = (attrs) => {
        const pos = at(); if (pos == null) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, null, Object.assign({}, cur.attrs, attrs)));
        editor.commands.setNodeSelection(pos);
      };
      // a drag with the pointer captured: move(dx, dy) as it goes, end() when let go
      const drag = (e, move, end) => {
        e.preventDefault(); e.stopPropagation();
        const pos = at(); if (pos != null) editor.commands.setNodeSelection(pos);
        editor.view.focus();  // the default (which focuses the text) was prevented; the picture's tools need it
        const x0 = e.clientX, y0 = e.clientY, t = e.currentTarget;
        t.setPointerCapture(e.pointerId);
        const mv = (ev) => move(ev.clientX - x0, ev.clientY - y0);
        const up = () => { t.removeEventListener('pointermove', mv); t.removeEventListener('pointerup', up); t.removeEventListener('pointercancel', up); end(); };
        t.addEventListener('pointermove', mv); t.addEventListener('pointerup', up); t.addEventListener('pointercancel', up);
      };
      handles.forEach((h) => h.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const W = (side() ? dom.parentElement : dom.parentElement || dom).clientWidth || 1;
        const ref = side() || inline ? W : dom.clientWidth || W;  // what the width is a share of
        const w0 = box.getBoundingClientRect().width, a = cur.attrs, grow = h.dataset.side === 'right' ? 1 : -1;
        let frac = a.wFrac, x = a.x;
        drag(e, (dx) => {
          const w = Math.max(24, Math.min(ref, w0 + grow * dx));
          frac = +(w / ref).toFixed(3);
          if (free() && grow < 0) x = a.x + (w0 - w) / ref;  // the right edge stays where it is
          width((frac * 100).toFixed(1) + '%'); place(x, a.y);
        }, () => { if (frac !== a.wFrac) done(free() ? { wFrac: frac, x: +x.toFixed(4) } : { wFrac: frac }); });
      }));
      // cropping: an edge or a corner takes its sides in or out, as a share of the whole picture
      frame.addEventListener('pointerdown', (e) => {
        const h = e.target.closest('.crop-handle');
        if (!crop || !h || e.button !== 0) return;
        const bw = box.clientWidth || 1, bh = box.clientHeight || 1, c0 = Object.assign({}, crop), edge = h.dataset.edge;
        drag(e, (dx, dy) => {
          const c = Object.assign({}, c0), fx = dx / bw, fy = dy / bh;
          if (edge.includes('l')) c.l = c0.l + fx;
          if (edge.includes('r')) c.r = c0.r - fx;
          if (edge.includes('t')) c.t = c0.t + fy;
          if (edge.includes('b')) c.b = c0.b - fy;
          SIDES.forEach((k) => { c[k] = Math.max(0, c[k]); });
          if (c.l + c.r > 0.95) { if (edge.includes('l')) c.l = 0.95 - c.r; else c.r = 0.95 - c.l; }
          if (c.t + c.b > 0.95) { if (edge.includes('t')) c.t = 0.95 - c.b; else c.b = 0.95 - c.t; }
          crop = c;
          Object.assign(frame.style, { left: c.l * 100 + '%', top: c.t * 100 + '%', right: c.r * 100 + '%', bottom: c.b * 100 + '%' });
        }, () => {});
      });
      const endCrop = () => {
        if (!crop) return;
        const a = cur.attrs, old = cropOf(a), c = crop, k = (x) => +x.toFixed(4);
        crop = null;
        const keep = Math.max(0.05, 1 - c.l - c.r) / Math.max(0.05, 1 - old.l - old.r);  // the same scale: narrower by what was cut
        const same = SIDES.every((s) => Math.abs(c[s] - old[s]) < 0.0005);
        if (same) { paint(); return; }
        done({ crop: cut(c) ? { l: k(c.l), t: k(c.t), r: k(c.r), b: k(c.b) } : null, wFrac: +Math.max(0.02, (a.wFrac || 0.5) * keep).toFixed(3) });
      };
      dom.toggleCrop = () => {
        if (crop) { endCrop(); return; }
        if (!(cur.attrs.w > 0 && cur.attrs.h > 0)) return;
        crop = cropOf(cur.attrs);
        paint();
      };
      dom.cropping = () => !!crop;
      // behind or in front of the text: drag it anywhere, as in Word
      img.addEventListener('pointerdown', (e) => {
        if (!free() || crop || e.button !== 0) return;
        const W = dom.clientWidth || 1, a = cur.attrs, w = Math.min(1, a.wFrac || 0.5);
        let nx = a.x, ny = a.y;
        drag(e, (dx, dy) => {
          nx = Math.max(-w / 2, Math.min(1 - w / 2, a.x + dx / W));
          ny = Math.max(-3, Math.min(3, a.y + dy / W));
          place(nx, ny);
        }, () => { if (nx !== a.x || ny !== a.y) done({ x: +nx.toFixed(4), y: +ny.toFixed(4) }); });
      });
      return {
        dom,
        update(n) { if (n.type !== cur.type) return false; cur = n; paint(); return true; },
        selectNode() { dom.classList.add('ProseMirror-selectednode'); },
        // a crop in progress ends with the selection (after this update: no new step in the middle of one)
        deselectNode() { dom.classList.remove('ProseMirror-selectednode'); if (crop) setTimeout(endCrop); },
        // the handles, a picture being cropped and a free one move by their own drag, not the editor's (which moves
        // it in the text)
        stopEvent: (e) => /^(pointer|mouse|drag)/.test(e.type) && (free() || !!crop || !!(e.target.closest && e.target.closest('.fig-handle'))),
        ignoreMutation: () => true,
      };
    };
  }

  const Figure = T.Node.create({
    name: 'figure',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addOptions() { return { src: (name) => name }; },
    addAttributes() { return picAttrs(true); },
    parseHTML() { return [{ tag: 'figure.fig' }]; },
    // the HTML of a copied picture; on the page it is drawn by pictureView
    renderHTML({ node }) {
      const a = node.attrs;
      return ['figure', { class: 'fig', 'data-image': a.image, 'data-w': a.w, 'data-h': a.h, 'data-wfrac': a.wFrac, 'data-align': a.align || '',
        'data-wrap': a.wrap || '', 'data-x': a.x, 'data-y': a.y, 'data-border': a.border || '' },
        ['img', { src: this.options.src(a.image), alt: tx('editor.insertedPicture'), draggable: 'false', style: 'width:' + pct(a) }]];
    },
    addNodeView() { return pictureView(this.options.src, false); },
  });

  // Word's "In Line with Text": a picture inside a line of text, which moves with it and can be dragged to any
  // place in a sentence
  const InlineImage = T.Node.create({
    name: 'inlineImage',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: true,
    addOptions() { return { src: (name) => name }; },
    addAttributes() { return picAttrs(false); },
    parseHTML() { return [{ tag: 'img.fig-inline' }]; },
    renderHTML({ node }) {
      const a = node.attrs;
      return ['img', { class: 'fig-inline', src: this.options.src(a.image), alt: tx('editor.pictureLine'), 'data-image': a.image, 'data-w': a.w, 'data-h': a.h,
        'data-wfrac': a.wFrac, 'data-border': a.border || '', style: 'width:' + pct(a) }];
    },
    addNodeView() { return pictureView(this.options.src, true); },
  });

  // borderless: a text row kept apart in parts ("الرقم ... التاريخ"); lineless: a data table printed without lines
  const Table = T.Table.extend({
    addAttributes() {
      const flag = (name) => ({ default: false, parseHTML: (el) => el.classList.contains(name), renderHTML: (a) => (a[name] ? { class: name } : {}) });
      return Object.assign({}, this.parent && this.parent(), { borderless: flag('borderless'), lineless: flag('lineless') });
    },
  }).configure({ resizable: false });

  // a cell's fill colour (Word: cell shading)
  const TableCell = T.TableCell.extend({
    addAttributes() {
      return Object.assign({}, this.parent && this.parent(), {
        backgroundColor: {
          default: null,
          parseHTML: (el) => el.getAttribute('data-bg') || el.style.backgroundColor || null,
          renderHTML: (a) => (a.backgroundColor ? { 'data-bg': a.backgroundColor, style: 'background-color:' + a.backgroundColor } : {}),
        },
      });
    },
  });

  // a paragraph's place on the photo (fractions), from the reading; read it again with another engine.
  // dir "ltr": an English paragraph, list or table on these right-to-left pages
  const BlockBox = T.Extension.create({
    name: 'blockBox',
    addGlobalAttributes() {
      // the half after Enter is new text: it has no place on the photo
      return [{ types: ['paragraph', 'heading'], attributes: { box: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => (el.dataset.box ? el.dataset.box.split(',').map(Number) : null),
        renderHTML: (a) => (a.box ? { 'data-box': a.box.join(',') } : {}),
      }, lines: {  // each line: [x0, y0, x1, y1, where its text starts in the paragraph]
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => { try { return el.dataset.lines ? JSON.parse(el.dataset.lines) : null; } catch (e) { return null; } },
        renderHTML: (a) => (a.lines ? { 'data-lines': JSON.stringify(a.lines) } : {}),
      } } }, { types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'table'], attributes: { dir: {
        default: null,
        parseHTML: (el) => (el.getAttribute('dir') === 'ltr' ? 'ltr' : null),
        renderHTML: (a) => (a.dir === 'ltr' ? { dir: 'ltr' } : {}),
      } } }, { types: ['paragraph', 'heading'], attributes: {
        // line spacing as Word counts it (1 = single); the page shows Word's usual 1.25 at its own 2
        lineHeight: { default: null, parseHTML: (el) => +el.dataset.lh || null,
          renderHTML: (a) => (a.lineHeight ? { 'data-lh': a.lineHeight, style: 'line-height:' + (1.6 * a.lineHeight).toFixed(2) } : {}) },
        // space before / after the paragraph, in points (none: the page's usual)
        spaceBefore: { default: null, parseHTML: (el) => (el.dataset.sb != null ? +el.dataset.sb : null),
          renderHTML: (a) => (a.spaceBefore != null ? { 'data-sb': a.spaceBefore, style: 'margin-top:' + a.spaceBefore + 'pt' } : {}) },
        spaceAfter: { default: null, parseHTML: (el) => (el.dataset.sa != null ? +el.dataset.sa : null),
          renderHTML: (a) => (a.spaceAfter != null ? { 'data-sa': a.spaceAfter, style: 'margin-bottom:' + a.spaceAfter + 'pt' } : {}) },
        // Word's paragraph borders: { top, bottom, left, right, between } each a line style (BORDERS); paragraphs in a
        // row with the same borders are one box (the plugin below), with a line between them when 'between' is set
        borders: { default: null,
          parseHTML: (el) => { try { return el.dataset.bd ? JSON.parse(el.dataset.bd) : null; } catch (e) { return null; } },
          renderHTML: (a) => {
            const b = a.borders;
            if (!b) return {};
            const line = (s) => BORDERS[s] + ' currentColor';
            const css = ['top', 'bottom', 'left', 'right'].filter((k) => BORDERS[b[k]])
              .map((k) => 'border-' + k + ':' + line(b[k]) + ';padding-' + k + ':' + (k === 'top' || k === 'bottom' ? '.15em' : '.4em'));
            if (BORDERS[b.between]) css.push('--bd-between:' + line(b.between));
            return { 'data-bd': JSON.stringify(b), style: css.join(';') };
          } },
      } }, { types: ['bulletList', 'orderedList'], attributes: { listStyle: {  // blocks-doc.js ls
        default: null,
        parseHTML: (el) => el.dataset.ls || null,
        renderHTML: (a) => (a.listStyle ? { 'data-ls': a.listStyle } : {}),
      } } }, { types: ['listItem'], attributes: { fixedDir: {  // its side was set by hand: its first letter no longer decides
        default: false,
        parseHTML: (el) => el.hasAttribute('data-fixed-dir'),
        renderHTML: (a) => (a.fixedDir ? { 'data-fixed-dir': '' } : {}),
      }, dir: {  // its side, from its own first letter (the plugin below)
        default: null,
        parseHTML: (el) => (['ltr', 'rtl'].includes(el.getAttribute('dir')) ? el.getAttribute('dir') : null),
        renderHTML: (a) => (a.dir ? { dir: a.dir } : {}),
      } } }];
    },
    // where each line starts follows the text as it is edited, so the line read again is still that line
    // (text typed right at a line's start belongs to that line)
    addProseMirrorPlugins() {
      return [new T.Plugin({
        appendTransaction(trs, before, after) {
          if (!trs.some((t) => t.docChanged)) return null;
          const map = (pos) => trs.reduce((p, t) => t.mapping.map(p, -1), pos);
          let tr = null;
          // Enter in the middle of a paragraph copies its attributes to the second half (keepOnSplit only
          // covers Enter at the end): the same place twice means a split, and only the first half keeps it
          const seen = new Set();
          after.doc.descendants((node, pos) => {
            if (!node.isTextblock) return true;
            const b = node.attrs.box;
            if (b && seen.has(b)) {
              tr = tr || after.tr;
              tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { box: null, lines: null }));
            } else if (b) seen.add(b);
            return false;
          });
          before.doc.descendants((node, pos) => {
            if (!node.isTextblock) return true;
            const ls = node.attrs.lines;
            if (!ls) return false;
            const $n = after.doc.resolve(Math.min(map(pos + 1), after.doc.content.size));
            const p = $n.parent;
            if (p.attrs.lines !== ls) return false;  // that paragraph is gone, or already updated
            const start = $n.start(), size = p.content.size;
            const moved = ls.map((l) => l.slice(0, 4).concat(Math.max(0, map(pos + 1 + l[4]) - start)));
            // lines whose text went away (deleted, or moved into the next paragraph by Enter) leave, and the
            // paragraph's place shrinks to the lines it still has
            const kept = moved.filter((l, k) => k === 0 || l[4] < size);
            if (kept.length < moved.length) {
              tr = tr || after.tr;
              const box = [Math.min(...kept.map((l) => l[0])), Math.min(...kept.map((l) => l[1])), Math.max(...kept.map((l) => l[2])), Math.max(...kept.map((l) => l[3]))];
              tr.setNodeMarkup($n.before(), null, Object.assign({}, p.attrs, { box, lines: kept.length > 1 ? kept : null }));
            } else if (moved.some((l, k) => l[4] !== ls[k][4])) {
              tr = tr || after.tr;
              tr.setNodeMarkup($n.before(), null, Object.assign({}, p.attrs, { lines: moved }));
            }
            return false;
          });
          return tr;
        },
      }), new T.Plugin({
        // paragraphs in a row with the same borders are one box, as in Word: no line where they meet (or the
        // 'between' line), and no gap
        props: {
          decorations(state) {
            const decos = [];
            const walk = (node, start) => {
              let prev = null;
              node.forEach((child, offset) => {
                const at = start + offset, key = child.attrs && child.attrs.borders ? JSON.stringify(child.attrs.borders) : null;
                if (key && prev && prev.key === key) {
                  decos.push(T.Decoration.node(prev.at, prev.at + prev.node.nodeSize, { class: 'bd-joined' }),
                    T.Decoration.node(at, at + child.nodeSize, { class: 'bd-join' }));
                }
                if (!child.isTextblock && !child.isAtom && child.childCount) walk(child, at + 1);
                prev = { key, at, node: child };
              });
            };
            walk(state.doc, 0);
            return T.DecorationSet.create(state.doc, decos);
          },
        },
      }), new T.Plugin({
        // a list item starts on the side of its first letter, as a Word paragraph does: an English item left to
        // right on an Arabic page, its marker on the left; an item with no letter yet, or one whose side was set by
        // hand (the direction button), keeps the side it has
        appendTransaction(trs, before, after) {
          if (!trs.some((t) => t.docChanged)) return null;
          let tr = null;
          after.doc.descendants((node, pos) => {
            if (node.type.name !== 'listItem') return !node.isTextblock;
            if (node.attrs.fixedDir) return true;
            const first = node.firstChild;
            const side = first && first.isTextblock ? window.BlocksDoc.startDir(first.textContent) : null;
            if (!side) return true;
            if (node.attrs.dir !== side) { tr = tr || after.tr; tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { dir: side })); }
            const pdir = side === 'ltr' ? 'ltr' : null;
            if (first.attrs.dir !== pdir) { tr = tr || after.tr; tr.setNodeMarkup(pos + 1, null, Object.assign({}, first.attrs, { dir: pdir })); }
            return true;  // and the lists inside it
          });
          return tr;
        },
      })];
    },
  });

  // an image on the clipboard (a screenshot, a copied picture); copying text from Word also puts a picture of
  // it there, so text on the clipboard wins
  function pastedImages(e) {
    const d = e.clipboardData;
    if (!d || (d.getData('text/plain') || '').trim()) return [];
    return [...(d.files || [])].filter((f) => f.type.startsWith('image/'));
  }

  function mount(el, blocks, opts) {
    const state = () => opts.onState && opts.onState();
    const editor = new T.Editor({
      element: el,
      extensions: [
        // no trailingNode: it added an empty paragraph after a last heading or table on the first click, so merely
        // clicking marked the draft changed and the Word file got a stray paragraph (the gap cursor still types there)
        T.StarterKit.configure({ heading: { levels: [1, 2, 3] }, code: false, codeBlock: false, horizontalRule: false, link: false, trailingNode: false }),
        T.TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['right', 'center', 'left', 'justify'] }),
        Table, T.TableRow, T.TableHeader, TableCell,
        T.TextStyle, T.Color, T.BackgroundColor, T.FontSize,
        Figure.configure({ src: opts.src }), InlineImage.configure({ src: opts.src }),
        Flag, BlockBox,
      ],
      content: window.BlocksDoc.blocksToDoc(blocks),
      editorProps: {
        attributes: { dir: 'rtl', class: 'doc', spellcheck: 'false', role: 'textbox', 'aria-multiline': 'true', 'aria-label': tx('editor.pageText') },
        // Enter or Esc ends cropping a picture (editor.js pictureView)
        handleKeyDown: (view, e) => {
          if ((e.key === 'Enter' || e.key === 'Escape') && el.docEditor && el.docEditor.cropping()) { el.docEditor.cropPicture(); return true; }
          return false;
        },
        handlePaste: (view, e) => {
          const files = pastedImages(e);
          if (!files.length || !opts.onPasteImage) return false;
          opts.onPasteImage(files);
          return true;
        },
      },
      onUpdate: () => opts.onChange && opts.onChange(),
      onTransaction: state,
      onFocus: state,
      onBlur: state,
    });

    const figureSelected = () => editor.isActive('figure');
    // a command chain with the editor focused now, not a frame later: Tiptap's own focus waits a frame when the
    // editor lost focus (to a palette or the table picker), and a click in the size box within that frame had its
    // typing land in the text, over the selection
    const focused = () => { if (!editor.view.hasFocus()) editor.view.focus(); return editor.chain().focus(); };
    // the document range of a flagged word's <mark>, or null once it is gone from the page
    const flagRange = (markEl) => {
      try {
        const from = editor.view.posAtDOM(markEl, 0), to = editor.view.posAtDOM(markEl, markEl.childNodes.length);
        return markEl.isConnected && from >= 0 && to >= from ? { from, to } : null;
      } catch (e) { return null; }
    };
    // new text for from..to in tr, in the look of the text it replaces; no text deletes the word and one of the
    // spaces around it, so "a word b" becomes "a b", not "a  b"
    const fixFlag = (tr, from, to, text, o) => {
      const doc = tr.doc, node = doc.nodeAt(from), old = node ? node.marks : [];
      const flag = old.find((m) => m.type.name === 'flag');
      const marks = old.filter((m) => m.type.name !== 'flag');
      if (!o.unflag && flag) marks.push(doc.type.schema.marks.flag.create(Object.assign({}, flag.attrs, o.note != null ? { note: o.note } : {})));
      if (text) { tr.replaceWith(from, to, doc.type.schema.text(text, marks)); return; }
      const $a = doc.resolve(from), start = $a.start(), end = $a.end();
      const before = from > start ? doc.textBetween(from - 1, from) : '', after = to < end ? doc.textBetween(to, to + 1) : '';
      if (after === ' ' && (before === ' ' || from === start)) to++;
      else if (before === ' ' && to === end) from--;
      tr.delete(from, to);
    };
    const api = {
      editor,
      getBlocks: () => window.BlocksDoc.docToBlocks(editor.getJSON()),
      destroy: () => editor.destroy(),
      chain: focused,

      // a new block (table, picture) goes after the block the cursor is in, not into the middle of a line
      insertBlock(json) {
        const sel = editor.state.selection;
        const pos = sel.$from.depth ? sel.$from.after(1) : sel.to;
        focused().insertContentAt(pos, json).run();
      },

      // side: 'right' | 'center' | 'left' | 'justify', as the buttons show it (pictures sit on right-to-left pages)
      align(side) {
        if (figureSelected()) {
          const a = { right: null, center: 'center', left: 'end' }[side];
          focused().updateAttributes('figure', { align: a }).run();
        } else if (editor.isActive({ textAlign: side })) focused().unsetTextAlign().run();
        else focused().setTextAlign(side).run();
      },
      alignActive(side) {
        if (figureSelected()) return ({ start: 'right', center: 'center', end: 'left' })[editor.getAttributes('figure').align || 'start'] === side;
        return editor.isActive({ textAlign: side });
      },

      // the list the cursor is in: { depth, node, kind: 'bullet' | 'number', style }, or null
      listAt() {
        const { $from } = editor.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d);
          if (n.type.name === 'bulletList' || n.type.name === 'orderedList') return { depth: d, node: n, kind: n.type.name === 'bulletList' ? 'bullet' : 'number', style: n.attrs.listStyle || null };
        }
        return null;
      },
      // Word's bullets and numbering in one: kind 'bullet' | 'number' with a style (null: the plain one), or no
      // kind to end the list; the style is the list's at the cursor's level, as in Word
      setList(kind, style) {
        const at = this.listAt();
        const toggle = (k) => focused()[k === 'bullet' ? 'toggleBulletList' : 'toggleOrderedList']().run();
        if (!kind) { if (at) toggle(at.kind); return; }
        if (!at || at.kind !== kind) toggle(kind);
        const now = this.listAt();
        if (!now || (now.node.attrs.listStyle || null) === (style || null)) return;
        const st = editor.state;
        editor.view.dispatch(st.tr.setNodeMarkup(st.selection.$from.before(now.depth), null, Object.assign({}, now.node.attrs, { listStyle: style || null })));
        editor.view.focus();
      },
      canList() { return !figureSelected() && (!!this.listAt() || editor.can().toggleBulletList()); },

      // the paragraph at the cursor's spacing: { lineHeight, spaceBefore, spaceAfter } (null: the usual)
      spacing() {
        const p = editor.state.selection.$from.parent;
        return p.isTextblock ? { lineHeight: p.attrs.lineHeight || null, spaceBefore: p.attrs.spaceBefore, spaceAfter: p.attrs.spaceAfter } : null;
      },
      // for every paragraph and heading in the selection
      setSpacing(attrs) {
        const st = editor.state, tr = st.tr, { from, to } = st.selection;
        st.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, attrs));
        });
        editor.view.dispatch(tr);
        editor.view.focus();
      },

      // the paragraphs in the selection: their borders as Word's Borders button sets them. kind: 'top' | 'bottom' |
      // 'left' | 'right' (on, or off when every paragraph has it), 'outside' (a box), 'all' (a box and lines between),
      // 'none', or 'style' (the lines they have, in this style)
      borders() { const p = editor.state.selection.$from.parent; return p.isTextblock ? p.attrs.borders || null : null; },
      setBorders(kind, style) {
        const st = editor.state, tr = st.tr, { from, to } = st.selection, nodes = [];
        st.doc.nodesBetween(from, to, (n, pos) => {
          if (n.type.name === 'paragraph' || n.type.name === 'heading') { nodes.push([n, pos]); return false; }
          return true;
        });
        const every = (side) => nodes.every(([n]) => n.attrs.borders && n.attrs.borders[side]);
        const off = ['top', 'bottom', 'left', 'right'].includes(kind) && every(kind);
        nodes.forEach(([n, pos]) => {
          let b = Object.assign({}, n.attrs.borders || {});
          if (kind === 'none') b = {};
          else if (kind === 'outside' || kind === 'all') {
            ['top', 'bottom', 'left', 'right'].forEach((k) => { b[k] = style; });
            if (kind === 'all') b.between = style; else delete b.between;
          } else if (kind === 'style') Object.keys(b).forEach((k) => { b[k] = style; });
          else if (off) delete b[kind];
          else b[kind] = style;
          tr.setNodeMarkup(pos, null, Object.assign({}, n.attrs, { borders: Object.keys(b).length ? b : null }));
        });
        editor.view.dispatch(tr);
        editor.view.focus();
      },

      // the selected picture's wrap ('inline' for a picture in a line, the Figure wraps, or null) and width (wFrac)
      figure() {
        if (editor.isActive('inlineImage')) return Object.assign({}, editor.getAttributes('inlineImage'), { wrap: 'inline' });
        return figureSelected() ? editor.getAttributes('figure') : null;
      },
      // { wrap } and / or { wFrac } for the selected picture; into a line and out of it, it becomes the other node
      setFigure(attrs) {
        const st = editor.state, sel = st.selection, node = sel.node;
        if (!node || !['figure', 'inlineImage'].includes(node.type.name)) return;
        const pic = { image: node.attrs.image, w: node.attrs.w, h: node.attrs.h, wFrac: attrs.wFrac || node.attrs.wFrac,
          border: 'border' in attrs ? attrs.border : node.attrs.border, crop: node.attrs.crop };
        const select = (tr, pos) => { editor.view.dispatch(tr); editor.commands.setNodeSelection(pos); editor.view.focus(); };
        if (node.type.name === 'inlineImage') {
          if (!('wrap' in attrs) || attrs.wrap === 'inline') { focused().updateAttributes('inlineImage', { wFrac: pic.wFrac, border: pic.border }).run(); return; }
          // out of the line: a picture of its own right after the paragraph it was in
          const at = sel.$from.after();
          const fig = st.schema.nodes.figure.create(Object.assign(pic, { wrap: attrs.wrap }, this.freePlace(attrs.wrap, pic.wFrac, null)));
          select(st.tr.insert(at, fig).delete(sel.from, sel.to), at - (sel.to - sel.from));
          return;
        }
        if (attrs.wrap === 'inline') {
          // into the text: at the start of the paragraph after it, or in a line of its own
          const img = st.schema.nodes.inlineImage.create(pic), next = st.doc.resolve(sel.to).nodeAfter;
          const tr = next && next.type.name === 'paragraph' ? st.tr.insert(sel.to + 1, img).delete(sel.from, sel.to)
            : st.tr.replaceWith(sel.from, sel.to, st.schema.nodes.paragraph.create(null, img));
          select(tr, sel.from + 1);
          return;
        }
        const a = node.attrs, upd = Object.assign({}, attrs);
        if (SIDE_WRAPS.includes(attrs.wrap) && a.align === 'center') upd.align = null;
        if (FREE_WRAPS.includes(attrs.wrap) && !FREE_WRAPS.includes(a.wrap)) Object.assign(upd, this.freePlace(attrs.wrap, pic.wFrac, a.align));
        focused().updateAttributes('figure', upd).run();
      },
      // Word's Crop for the selected picture: on, and off again (which keeps the crop)
      cropPicture() {
        const dom = editor.view.nodeDOM(editor.state.selection.from);
        if (dom && dom.toggleCrop) dom.toggleCrop();
        editor.view.focus();
      },
      cropping() { const dom = figureSelected() || editor.isActive('inlineImage') ? editor.view.nodeDOM(editor.state.selection.from) : null; return !!(dom && dom.cropping && dom.cropping()); },
      // where a picture turned free (behind or in front of the text) starts: where it stood, at the top
      freePlace(wrap, wFrac, align) {
        if (!FREE_WRAPS.includes(wrap)) return {};
        const w = Math.min(1, wFrac || 0.5);
        return { x: +(align === 'end' ? 0 : align === 'center' ? (1 - w) / 2 : 1 - w).toFixed(4), y: 0 };
      },

      // left to right (English) or right to left, for the paragraphs, lists and tables in the selection
      isLtr() {  // the nearest side set: a list item's 'rtl' counts, inside a left-to-right list
        const { $from } = editor.state.selection;
        for (let d = $from.depth; d > 0; d--) { const dir = $from.node(d).attrs.dir; if (dir) return dir === 'ltr'; }
        return false;
      },
      toggleDir() {
        const to = this.isLtr() ? null : 'ltr';
        const st = editor.state, tr = st.tr, { from, to: end } = st.selection;
        const types = ['paragraph', 'heading', 'bulletList', 'orderedList', 'table', 'listItem'];
        // a list item keeps the side set by hand, its marker moving with it
        const set = (n, pos) => tr.setNodeMarkup(pos, null, Object.assign({}, n.attrs,
          n.type.name === 'listItem' ? { dir: to || 'rtl', fixedDir: true } : { dir: to }));
        st.doc.nodesBetween(from, end, (node, pos) => { if (types.includes(node.type.name)) set(node, pos); });
        const { $from } = st.selection;  // and the list item, list or table the cursor is in
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d);
          if (types.includes(n.type.name) && d < $from.depth) set(n, $from.before(d));
        }
        editor.view.dispatch(tr);
        editor.commands.focus();
      },

      // mark the selected text as flagged; returns its <mark> so the app can open the word panel
      flagSelection(note) {
        const { from, to, empty } = editor.state.selection;
        if (empty || figureSelected()) return null;
        focused().setMark('flag', { note: note || '', box: null }).setTextSelection(to).run();
        const view = editor.view;
        return [...view.dom.querySelectorAll('mark.flag')].find((m) => {
          try { const at = view.posAtDOM(m, 0); return at >= from && at < to; } catch (e) { return false; }
        }) || null;
      },

      // fix a flagged word from its panel: new text, keep or drop the flag, optionally a new note
      replaceFlag(markEl, text, o) {
        const r = flagRange(markEl);
        if (!r) return false;
        const tr = editor.state.tr;
        fixFlag(tr, r.from, r.to, text, o);
        editor.view.dispatch(tr);
        return true;
      },
      // several flagged words at once ([{ el, text }], e.g. every suggestion): all places are found first and
      // changed from the end in one step, so each lands in its own flag and one undo takes them all back
      replaceFlags(items) {
        const todo = items.map((it) => Object.assign({ text: it.text }, flagRange(it.el))).filter((r) => r.from != null).sort((a, b) => b.from - a.from);
        if (!todo.length) return 0;
        const tr = editor.state.tr;
        todo.forEach((r) => fixFlag(tr, r.from, r.to, r.text, {}));
        editor.view.dispatch(tr);
        return todo.length;
      },

      // what the cursor is in, to show its spot on the photo and read it again: null outside text, else
      // { box, para, line }. para and line are { box, from, to, text }; line is the photo line(s) under the
      // cursor or the selection, when the reading recorded the paragraph's lines
      // pos: a place clicked (posAt), in place of the selection, which a click updates only a moment later
      readTarget(pos) {
        const st = editor.state, sel = pos == null ? st.selection : null;
        const $from = sel ? sel.$from : st.doc.resolve(pos), $to = sel ? sel.$to : $from, empty = sel ? sel.empty : true;
        const p = $from.parent;
        if (!p.isTextblock) return null;
        const start = $from.start(), size = p.content.size;
        const part = (box, a, b) => ({ box, from: start + a, to: start + b, text: st.doc.textBetween(start + a, start + b, ' ', ' ') });
        const ls = p.attrs.box && p.attrs.lines;
        const height = (pick) => pick.reduce((s, l) => s + l[3] - l[1], 0) / pick.length;  // one photo line's
        let ltr = false;
        for (let d = $from.depth; d > 0; d--) if ($from.node(d).attrs.dir === 'ltr') ltr = true;
        const out = { box: p.attrs.box || null, at: $from.pos, ltr, line: null,
          para: p.attrs.box ? Object.assign(part(p.attrs.box, 0, size), { lineH: ls ? height(ls) : p.attrs.box[3] - p.attrs.box[1] }) : null };
        if (ls && ls.length > 1) {
          const at = (k) => Math.min(size, ls[k][4]);
          const a = $from.parentOffset, b = empty || !$to.sameParent($from) ? a : $to.parentOffset;
          let first = 0, last;
          while (first + 1 < ls.length && at(first + 1) <= a) first++;
          for (last = first; last + 1 < ls.length && at(last + 1) < b; last++);
          const end = last + 1 < ls.length ? Math.max(at(last), at(last + 1) - 1) : size;  // not the space before the next line
          const pick = ls.slice(first, last + 1);
          const box = [Math.min(...pick.map((l) => l[0])), Math.min(...pick.map((l) => l[1])), Math.max(...pick.map((l) => l[2])), Math.max(...pick.map((l) => l[3]))];
          const line = part(box, at(first), end);
          if (line.text.trim()) out.line = Object.assign(line, { count: pick.length, lineH: height(pick) });
        }
        // in a table the paragraph is a cell, and its whole row can be shown and read too (not replaced:
        // one reading of a row does not say which words go in which cell)
        for (let d = $from.depth - 1; d > 0; d--) {
          const row = $from.node(d);
          if (row.type.name !== 'tableRow') continue;
          out.cell = true;
          const boxes = [];
          row.forEach((c) => { const f = c.firstChild; if (f && f.attrs.box) boxes.push(f.attrs.box); });
          if (out.para && boxes.length > 1) {
            const box = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
            out.row = { box, from: $from.start(d), to: $from.end(d), text: st.doc.textBetween($from.start(d), $from.end(d), ' | ', ' '), lineH: box[3] - box[1], readOnly: true };
          }
          break;
        }
        return out;
      },
      // replace from..to with a reading, only while it still holds the text that was read
      replaceRange(from, to, expected, segs) {
        const st = editor.state;
        if (to > st.doc.content.size || st.doc.textBetween(from, to, ' ', ' ') !== expected) return false;
        // the reading comes as plain text: it takes the look (bold, colour, size) of the text it replaces
        const look = ((st.doc.nodeAt(from) || {}).marks || []).filter((m) => m.type.name !== 'flag');
        const nodes = window.BlocksDoc.segsToInline(segs).map((j) => st.schema.nodeFromJSON(j))
          .map((n) => (n.isText && look.length ? n.mark(look.reduce((set, m) => m.addToSet(set), n.marks)) : n));
        editor.view.dispatch(st.tr.replaceWith(from, to, nodes));
        return true;
      },
      focus() { editor.view.focus(); },
      posAt(x, y) { const r = editor.view.posAtCoords({ left: x, top: y }); return r ? r.pos : null; },
      // screen rectangle of the text from..to (to place a panel next to it)
      rectOf(from, to) {
        const v = editor.view, a = v.coordsAtPos(from), b = v.coordsAtPos(to);
        const dom = v.domAtPos(from).node, block = (dom.nodeType === 1 ? dom : dom.parentElement).closest('p, h1, h2, h3, li') || v.dom;
        const r = block.getBoundingClientRect();
        return { top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), left: r.left, right: r.right };
      },

      toggleTableLines() {
        const lined = !editor.getAttributes('table').borderless;
        // hiding the lines keeps a data table a data table (lineless); borderless alone is the "parts" row layout
        focused().updateAttributes('table', lined ? { borderless: true, lineless: true } : { borderless: false, lineless: false }).run();
      },
    };
    el.docEditor = api;  // for the browser checks (tests/browser)
    return api;
  }

  // ------------------------------------------------------------------ toolbar
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // right, center and left are places on the paper: on screen they keep that order, left on the left, whichever way
  // the toolbar reads. Given left to right; a right-to-left toolbar lays out from the right, so it gets them reversed.
  const physical = (leftToRight) => (document.documentElement.dir === 'rtl' ? leftToRight.slice().reverse() : leftToRight);
  function icon(name) {
    const s = document.createElementNS(SVG_NS, 'svg'); s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(SVG_NS, 'use'); u.setAttribute('href', 'vendor/icons.svg#' + name); s.append(u); return s;
  }

  /**
   * Builds the formatting toolbar into `bar`. get() returns the current page editor (or null when the page
   * has no text yet); actions: { picture(), flag() } for the app's own tools. floatHost: the scrolling box around
   * the page, where a small floating bar shows the tools for what the user is working on (selected text, the
   * table the cursor is in, a selected picture) right above it, like Word's mini toolbar.
   */
  function toolbar(bar, get, actions, floatHost) {
    const items = [];  // { node, on?(pe), enabled?(pe), show?(pe) }
    const group = (cls, parent) => {
      const g = document.createElement('div'); g.className = 'tb-group' + (cls ? ' ' + cls : ''); g.setAttribute('role', 'group');
      (parent || bar).append(g); return g;
    };
    const button = (g, o) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tb' + (o.text ? ' tb-text' : '') + (o.cls ? ' ' + o.cls : '');
      b.title = o.label + (o.keys ? ' (' + o.keys + ')' : ''); b.setAttribute('aria-label', o.label);
      if (o.icon) b.append(icon(o.icon));
      if (o.text) b.append(document.createTextNode(o.text));
      if (o.on) b.setAttribute('aria-pressed', 'false');
      b.addEventListener('mousedown', (e) => e.preventDefault());  // keep the text selection
      b.addEventListener('click', () => { const pe = get(); if (pe || o.always) o.run(pe); });
      g.append(b);
      items.push({ node: b, on: o.on, enabled: o.enabled, show: o.show, always: o.always, iconOf: o.iconOf });
      return b;
    };
    const can = (pe, fn) => { try { return fn(pe.editor.can().chain().focus()).run(); } catch (e) { return false; } };

    // small panels under a toolbar button (colours, table size); one at a time, closed by Esc or a click elsewhere
    // phones (app.css --phone-ui): one row where like tools share a menu (a sheet); panels come up as sheets too
    const phone = () => getComputedStyle(document.documentElement).getPropertyValue('--phone-ui').trim() === '1';
    let open = null;
    const closePop = () => {
      if (!open) return;
      const { pop, btn } = open; open = null;
      btn.setAttribute('aria-expanded', 'false');
      if (actions.slideOut) actions.slideOut(pop, () => pop.remove()); else pop.remove();
    };
    const popover = (btn, build, always) => {
      btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => {
        const again = open && open.btn === btn;
        closePop();
        if (again || (!get() && !always)) return;
        const pop = document.createElement('div');
        pop.className = 'tb-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', btn.getAttribute('aria-label'));
        const title = document.createElement('h4'); title.className = 'sheet-title'; title.textContent = btn.getAttribute('aria-label');
        pop.append(title);  // shown on phones, where the panel is a sheet (app.css)
        build(pop);
        document.body.append(pop);
        if (!phone()) {
          // under the button, or over it when there is more room there; a long menu scrolls inside the window
          const r = btn.getBoundingClientRect(), below = innerHeight - r.bottom - 12, above = r.top - 12;
          const up = pop.offsetHeight > below && above > below;
          pop.style.maxHeight = (up ? above : below) + 'px';
          pop.style.top = (up ? Math.max(8, r.top - 4 - pop.offsetHeight) : r.bottom + 4) + 'px';
          pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8)) + 'px';
        }
        btn.setAttribute('aria-expanded', 'true');
        open = { btn, pop };
        pop.addEventListener('sheet-close', (e) => { if (open && open.pop === pop) { closePop(); if (e.detail && e.detail.refocus) btn.focus(); } });  // app.js closeSheet
        const first = pop.querySelector('button, input'); if (first) first.focus({ preventScroll: true });
      });
    };
    // phones: app.js closes the sheet on top (this panel, or the list over it) on a tap beside it or on its dim
    document.addEventListener('pointerdown', (e) => { if (open && !phone() && !open.pop.contains(e.target) && !open.btn.contains(e.target)) closePop(); });
    // Esc closes this panel only: the sheet it came from stays (app.js would close the next one down)
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { const b = open.btn; closePop(); b.focus(); e.stopImmediatePropagation(); } });

    // Word's standard colours and their light tints
    const COLORS = [['#c00000', tx('editor.darkRed')], ['#ff0000', tx('editor.red')], ['#ffc000', tx('editor.orange')], ['#ffff00', tx('editor.yellow')], ['#92d050', tx('editor.lightGreen')],
      ['#00b050', tx('editor.green')], ['#00b0f0', tx('editor.lightBlue')], ['#0070c0', tx('editor.blue')], ['#002060', tx('editor.navy')], ['#7030a0', tx('editor.purple')],
      ['#000000', tx('editor.black')], ['#404040', tx('editor.darkGray')], ['#7f7f7f', tx('editor.gray')], ['#bfbfbf', tx('editor.lightGray')], ['#f2f2f2', tx('editor.faintGray')],
      ['#fce4d6', tx('editor.lightPeach')], ['#fff2cc', tx('editor.paleYellow')], ['#e2efda', tx('editor.paleGreen')], ['#ddebf7', tx('editor.paleBlue')], ['#ede7f6', tx('editor.palePurple')]];
    const palette = (noneLabel, apply) => (pop) => {
      const done = (c) => { apply(get(), c); closePop(); closeDrops(); };
      const none = document.createElement('button');
      none.type = 'button'; none.className = 'pal-none'; none.textContent = noneLabel;
      none.addEventListener('click', () => done(null));
      const grid = document.createElement('div'); grid.className = 'pal-grid';
      COLORS.forEach(([c, name]) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'pal-swatch'; b.style.background = c; b.title = name; b.setAttribute('aria-label', name);
        b.addEventListener('click', () => done(c));
        grid.append(b);
      });
      const more = document.createElement('label'); more.className = 'pal-more';
      const pick = document.createElement('input'); pick.type = 'color'; pick.value = '#0070c0';
      pick.addEventListener('change', () => done(pick.value));
      more.append(document.createTextNode(tx('editor.moreColors')), pick);
      pop.append(none, grid, more);
    };

    const style = group();
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', tx('editor.style')); sel.title = tx('editor.style');
    [['p', tx('editor.paragraph')], ['h1', tx('editor.heading1')], ['h2', tx('editor.heading2')], ['h3', tx('editor.heading3')], ['q', tx('editor.quote')]].forEach(([v, l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l; sel.append(o);
    });
    sel.addEventListener('change', () => {
      const pe = get(); if (!pe) return;
      let c = pe.chain();
      if (pe.editor.isActive('blockquote') && sel.value !== 'q') c = c.unsetBlockquote();
      if (sel.value === 'q') c = c.setParagraph().setBlockquote();
      else if (sel.value === 'p') c = c.setParagraph();
      else c = c.setHeading({ level: +sel.value.slice(1) });
      c.run();
    });
    style.append(sel);
    // text size in points: a plain list of Word's sizes ("تلقائي": the document's own size); a size the text
    // already has that is not in the list (a pasted 15) shows as one more choice
    const SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
    const size = document.createElement('select');
    size.className = 'tb-size'; size.title = tx('editor.sizeSelectedTextPt'); size.setAttribute('aria-label', tx('editor.sizeSelectedTextPoints'));
    const sizeOpt = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; };
    const sizeList = (extra) => size.replaceChildren(sizeOpt('', tx('editor.automatic')),
      ...SIZES.concat(extra && !SIZES.includes(+extra) ? [+extra] : []).sort((x, y) => x - y).map((n) => sizeOpt(String(n), String(n))));
    sizeList();
    size.addEventListener('change', () => {
      const pe = get(); if (!pe) return;
      const n = parseFloat(size.value);
      if (n >= 6 && n <= 96) pe.chain().setFontSize(n + 'pt').run(); else pe.chain().unsetFontSize().run();
    });
    style.append(size);
    items.push({ node: size, enabled: (pe) => !pe.editor.isActive('figure'), value: (pe) => {
      const m = String(pe.editor.getAttributes('textStyle').fontSize || '').match(/^([\d.]+)(pt|px)?$/);
      const v = m ? String(m[2] === 'px' ? Math.round(+m[1] * 1.5) / 2 : +m[1]) : '';
      if (v && ![...size.options].some((o) => o.value === v)) sizeList(v);
      return v;
    } });
    items.push({ node: sel, enabled: (pe) => !pe.editor.isActive('figure'), value: (pe) => {
      if (pe.editor.isActive('blockquote')) return 'q';
      const h = [1, 2, 3].find((l) => pe.editor.isActive('heading', { level: l }));
      return h ? 'h' + h : 'p';
    } });

    const fmt = group();
    [['text-b', tx('editor.bold'), 'Ctrl+B', 'bold'], ['text-italic', tx('editor.italic'), 'Ctrl+I', 'italic'], ['text-underline', tx('editor.underline'), 'Ctrl+U', 'underline'],
      ['text-strikethrough', tx('editor.strikethrough'), 'Ctrl+Shift+S', 'strike']].forEach(([ic, label, keys, mark]) => {
      const cap = mark[0].toUpperCase() + mark.slice(1);
      button(fmt, { icon: ic, label, keys, run: (pe) => pe.chain()['toggle' + cap]().run(), on: (pe) => pe.editor.isActive(mark),
        enabled: (pe) => can(pe, (c) => c['toggle' + cap]()) });
    });
    popover(button(fmt, { icon: 'text-a-underline', label: tx('editor.textColor'), run: () => {} }),
      palette(tx('editor.automaticBlack'), (pe, c) => (c ? pe.chain().setColor(c) : pe.chain().unsetColor()).run()));
    popover(button(fmt, { icon: 'highlighter', label: tx('editor.highlightColor'), run: () => {} }),
      palette(tx('editor.noColor'), (pe, c) => (c ? pe.chain().setBackgroundColor(c) : pe.chain().unsetBackgroundColor()).run()));
    button(fmt, { icon: 'eraser', label: tx('editor.clearFormattingFlagsStay'), run: (pe) => pe.chain().unsetBold().unsetItalic().unsetUnderline().unsetStrike()
      .unsetColor().unsetBackgroundColor().unsetFontSize().run() });

    // a menu of rows (line spacing, wrap): [label, chosen?, run]; a row with no run is a heading, and
    // ['chips', [[label, chosen, run], ...]] a row of small buttons (a picture's width, its border)
    const menu = (pop, rows) => {
      const m = document.createElement('div'); m.className = 'tb-menu';
      rows.forEach(([label, chosen, run]) => {
        if (label === 'chips') {
          const c = document.createElement('div'); c.className = 'menu-chips';
          chosen.forEach(([l, on, go]) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'menu-chip' + (on ? ' on' : ''); b.textContent = l; b.setAttribute('aria-pressed', String(!!on));
            b.addEventListener('click', () => { go(get()); closePop(); closeDrops(); });
            c.append(b);
          });
          m.append(c);
          return;
        }
        if (!run) { const h = document.createElement('h5'); h.textContent = label; m.append(h); return; }
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'menu-row' + (chosen ? ' on' : ''); b.setAttribute('aria-pressed', String(!!chosen));
        b.append(icon('check'), document.createTextNode(label));
        b.addEventListener('click', () => { run(get()); closePop(); closeDrops(); });
        m.append(b);
      });
      pop.append(m);
    };

    // Word's bullet and numbering libraries in one menu: each tile shows three lines of the list
    const BULLETS = [[null, '•', tx('editor.dot')], ['circle', '○', tx('editor.circle')], ['square', '■', tx('editor.square')], ['diamond', '◆', tx('editor.diamond')], ['arrow', '➢', tx('editor.arrow')], ['check', '✓', tx('editor.checkMark')]];
    const NUMBERS = [[null, ['1.', '2.', '3.'], tx('editor.numbers')], ['hindi', ['١.', '٢.', '٣.'], tx('editor.easternArabicNumerals')], ['alpha-ar', ['أ.', 'ب.', 'ت.'], tx('editor.arabicLetters')],
      ['paren', ['1)', '2)', '3)'], tx('editor.numbersParenthesis')], ['lower', ['a.', 'b.', 'c.'], tx('editor.lowercaseLatinLetters')], ['upper', ['A.', 'B.', 'C.'], tx('editor.uppercaseLatinLetters')],
      ['roman', ['i.', 'ii.', 'iii.'], tx('editor.romanNumerals')]];
    const listMenu = (pop) => {
      const at = get().listAt();
      const lib = (name, kind, styles) => {
        const grid = document.createElement('div'); grid.className = 'ls-grid';
        styles.forEach(([style, marks, label]) => {
          const b = document.createElement('button');
          const on = !!at && at.kind === kind && at.style === style;
          b.type = 'button'; b.className = 'ls-tile' + (on ? ' on' : ''); b.title = label; b.setAttribute('aria-label', label); b.setAttribute('aria-pressed', String(on));
          [0, 1, 2].forEach((k) => {
            const r = document.createElement('span'); r.className = 'ls-row';
            const mk = document.createElement('span'); mk.className = 'ls-mk'; mk.textContent = Array.isArray(marks) ? marks[k] : marks;
            const bar = document.createElement('span'); bar.className = 'ls-bar';
            r.append(mk, bar); b.append(r);
          });
          b.addEventListener('click', () => { get().setList(kind, style); closePop(); closeDrops(); });
          grid.append(b);
        });
        const h = document.createElement('h5'); h.textContent = name;
        pop.append(h, grid);
      };
      lib(tx('editor.bullets'), 'bullet', BULLETS);
      lib(tx('editor.numbering'), 'number', NUMBERS);
      const none = document.createElement('button');
      none.type = 'button'; none.className = 'pal-none'; none.textContent = tx('editor.noList'); none.disabled = !at;
      none.addEventListener('click', () => { get().setList(null); closePop(); closeDrops(); });
      pop.append(none);
    };
    const listOn = (pe) => !!pe.listAt();
    const list = group();
    const listIcon = (pe) => ((pe.listAt() || {}).kind === 'number' ? 'list-numbers' : 'list-bullets');  // the kind in use
    popover(button(list, { icon: 'list-bullets', label: tx('editor.bulletsNumbering'), run: () => {}, on: listOn, iconOf: listIcon, enabled: (pe) => pe.canList() }), listMenu);
    // pages are right to left: indenting moves the item left, so the arrows point that way
    button(list, { icon: 'text-outdent', label: tx('editor.decreaseIndent'), keys: 'Shift+Tab', run: (pe) => pe.chain().liftListItem('listItem').run(),
      enabled: (pe) => can(pe, (c) => c.liftListItem('listItem')) });
    button(list, { icon: 'text-indent', label: tx('editor.increaseIndent'), keys: 'Tab', run: (pe) => pe.chain().sinkListItem('listItem').run(),
      enabled: (pe) => can(pe, (c) => c.sinkListItem('listItem')) });

    const align = group();
    [...physical([['left', 'text-align-left', tx('editor.alignLeft')], ['center', 'text-align-center', tx('editor.center')], ['right', 'text-align-right', tx('editor.alignRight')]]),
      ['justify', 'text-align-justify', tx('editor.justify')]].forEach(([a, ic, label]) => {
      button(align, { icon: ic, label, run: (pe) => pe.align(a), on: (pe) => pe.alignActive(a), enabled: (pe) => a !== 'justify' || !pe.editor.isActive('figure') });
    });
    button(align, { icon: 'arrows-left-right', label: tx('editor.paragraphDirectionLeftRightEnglish'), run: (pe) => pe.toggleDir(),
      on: (pe) => pe.isLtr(), enabled: (pe) => !pe.editor.isActive('figure') });
    // Word's Borders button for paragraphs; the line style chosen is kept for the next borders
    let borderStyle = 'single';
    popover(button(align, { icon: 'square-half-bottom', label: tx('editor.paragraphBorders'), run: () => {}, enabled: (pe) => !!pe.spacing(), on: (pe) => !!pe.borders() }), (pop) => {
      const b = get().borders() || {};
      const has = (k) => !!b[k];
      const box = ['top', 'bottom', 'left', 'right'].every(has);
      const side = (label, k) => [label, has(k), (pe) => pe.setBorders(k, borderStyle)];
      menu(pop, [[tx('editor.borders')],
        side(tx('editor.bottomBorder'), 'bottom'), side(tx('editor.topBorder'), 'top'), side(tx('editor.rightBorder'), 'right'), side(tx('editor.leftBorder'), 'left'),
        [tx('editor.noBorders'), !Object.keys(b).length, (pe) => pe.setBorders('none')],
        [tx('editor.allBordersLineBetweenParagraphs'), box && has('between'), (pe) => pe.setBorders('all', borderStyle)],
        [tx('editor.outsideBorders'), box && !has('between'), (pe) => pe.setBorders('outside', borderStyle)],
        [tx('editor.lineStyle')],
        ['chips', [['single', tx('editor.single')], ['thick', tx('editor.thick')], ['double', tx('editor.double')], ['dashed', tx('editor.dashed')], ['dotted', tx('editor.dotted')]].map(([v, label]) =>
          [label, borderStyle === v, (pe) => { borderStyle = v; if (Object.keys(b).length) pe.setBorders('style', v); }])]]);
    });
    // Word's line and paragraph spacing menu; 1.25 is what a paragraph has until it is given another
    popover(button(align, { icon: 'arrows-out-line-vertical', label: tx('editor.lineParagraphSpacing'), run: () => {}, enabled: (pe) => !!pe.spacing() }), (pop) => {
      const sp = get().spacing() || {};
      const rows = [[tx('editor.lineSpacing')]];
      [[1, '1.0'], [1.15, '1.15'], [null, tx('editor.spacingUsual')], [1.5, '1.5'], [2, '2.0'], [2.5, '2.5'], [3, '3.0']].forEach(([v, label]) => {
        rows.push([label, (sp.lineHeight || null) === v, (pe) => pe.setSpacing({ lineHeight: v })]);
      });
      rows.push([tx('app.paragraph')]);
      rows.push(sp.spaceBefore ? [tx('editor.removeSpaceBeforeParagraph'), false, (pe) => pe.setSpacing({ spaceBefore: null })]
        : [tx('editor.addSpaceBeforeParagraph'), false, (pe) => pe.setSpacing({ spaceBefore: 12 })]);
      rows.push(sp.spaceAfter === 0 ? [tx('editor.addSpaceAfterParagraph'), false, (pe) => pe.setSpacing({ spaceAfter: null })]
        : [tx('editor.removeSpaceAfterParagraph'), false, (pe) => pe.setSpacing({ spaceAfter: 0 })]);
      menu(pop, rows);
    });

    const ins = group();
    const insertTable = (rows, cols) => {
      const pe = get(); if (!pe) return;
      const row = () => ({ type: 'tableRow', content: Array.from({ length: cols }, () => ({ type: 'tableCell', content: [{ type: 'paragraph' }] })) });
      pe.insertBlock({ type: 'table', content: Array.from({ length: rows }, row) });
      closePop(); closeDrops();
    };
    // like Word: point at the grid for the size, or type any number of rows and columns
    popover(button(ins, { icon: 'table', text: tx('editor.table'), label: tx('editor.insertTable'), run: () => {} }), (pop) => {
      const R = 8, C = 8;
      const label = document.createElement('div'); label.className = 'grid-label'; label.textContent = tx('editor.chooseNumberRowsColumns');
      const grid = document.createElement('div'); grid.className = 'tbl-grid'; grid.style.gridTemplateColumns = `repeat(${C}, 1fr)`;
      const cells = [];
      const mark = (r, c) => {
        cells.forEach((b) => b.classList.toggle('on', +b.dataset.r <= r && +b.dataset.c <= c));
        label.textContent = tx('editor.tableSize', { rows: tx('editor.rowCount', { n: r }), cols: tx('editor.columnCount', { n: c }) });  // spelled out: digits alone read backwards in RTL
      };
      for (let r = 1; r <= R; r++) {
        for (let c = 1; c <= C; c++) {
          const b = document.createElement('button');
          b.type = 'button'; b.dataset.r = r; b.dataset.c = c; b.setAttribute('aria-label', tx('editor.tableSize', { rows: tx('editor.rowCount', { n: r }), cols: tx('editor.columnCount', { n: c }) }));
          b.addEventListener('mouseenter', () => mark(r, c)); b.addEventListener('focus', () => mark(r, c));
          b.addEventListener('click', () => insertTable(r, c));
          grid.append(b); cells.push(b);
        }
      }
      const custom = document.createElement('div'); custom.className = 'grid-custom';
      const num = (lbl, v) => {
        const l = document.createElement('label'); const i = document.createElement('input');
        i.type = 'number'; i.min = '1'; i.max = '50'; i.value = v; l.append(document.createTextNode(lbl), i); custom.append(l); return i;
      };
      const rr = num(tx('editor.rows'), 3), cc = num(tx('editor.columns'), 3);
      const go = document.createElement('button'); go.type = 'button'; go.className = 'btn small primary'; go.textContent = tx('editor.insert');
      go.addEventListener('click', () => insertTable(Math.max(1, Math.min(50, +rr.value || 1)), Math.max(1, Math.min(20, +cc.value || 1))));
      custom.append(go);
      pop.append(label, grid, custom);
    });
    popover(button(ins, { icon: 'images', text: tx('editor.picture'), label: tx('editor.insertPicture'), run: () => {}, always: true, enabled: () => actions.hasPage() }), (pop) => {
      menu(pop, [[tx('editor.pictureDevice'), false, () => actions.pickImage()],
        [tx('editor.partPagePhotoLogoDrawing'), false, () => actions.picture()]]);
    }, true);
    const flagBtn = button(ins, { icon: 'flag', text: tx('editor.flag'), label: tx('editor.flagSelectedTextNote'), run: () => actions.flag(), always: true, enabled: (pe) => !!pe });
    const insOwn = [...ins.children];

    // the line at the cursor: its spot on the photo, and reading it again with another engine (the app's panel)
    const again = group();
    const rereadBtn = button(again, { icon: 'scan', text: tx('editor.reread'), label: tx('editor.linePagePhotoReadingAnother'), run: () => actions.showLine() });
    // a click into the text shows that line on the photo; this turns that off and on (remembered on this computer)
    const eyeBtn = button(again, { icon: 'eye', cls: 'tb-eye', label: tx('editor.previewLinePhotoClick'), always: true, on: () => actions.previewOn(),
      run: () => { actions.togglePreview(); update(); } });

    const hist = group();
    const undoBtn = button(hist, { icon: 'arrow-u-up-left', label: tx('editor.undo'), keys: 'Ctrl+Z', run: (pe) => pe.chain().undo().run(), enabled: (pe) => can(pe, (c) => c.undo()) });
    const redoBtn = button(hist, { icon: 'arrow-u-up-right', label: tx('editor.redo'), keys: 'Ctrl+Y', run: (pe) => pe.chain().redo().run(), enabled: (pe) => can(pe, (c) => c.redo()) });

    // phones: three menus (the text, the paragraph, inserts) so the row fits the width; app.js closes them like its own
    // popovers (outside, Esc, its dim). A menu's button shows what is on inside it: lit, or (mirror: a group) the icon of
    // that group's tool in use, as the paragraph shows its alignment.
    const drops = [];
    const drop = (ic, label, { once = true, mirror = false } = {}) => {
      const d = document.createElement('details'); d.className = 'pop-wrap tb-sheet';
      const sum = document.createElement('summary'); sum.className = 'tb'; sum.title = label; sum.setAttribute('aria-label', label);
      const caret = icon('caret-down'); caret.classList.add('tb-caret');
      sum.append(icon(ic), caret);  // ▾: it opens a menu
      const body = document.createElement('div'); body.className = 'pop'; body.setAttribute('role', 'group'); body.setAttribute('aria-label', label);
      const h = document.createElement('h4'); h.className = 'sheet-title'; h.textContent = label;
      d.append(sum, body);
      // a choice closes it (alignment, a list, an insert); the text's look stays open, to set more than one
      if (once) body.addEventListener('click', (ev) => { const b = ev.target.closest('.tb'); if (b && !b.hasAttribute('aria-haspopup')) closeDrops(); });
      const it = { d, body, sum, ic, mirror, fill: (...kids) => body.replaceChildren(h, ...kids) };
      if (mirror) sum.classList.add('tb-mirror');
      drops.push(it); return it;
    };
    function closeDrops() { for (const x of drops) if (actions.shutPop) actions.shutPop(x.d); else x.d.open = false; }
    function syncDrops() {
      for (const x of drops) {
        const on = (x.mirror || x.body).querySelector('.tb.on');
        if (x.mirror) x.sum.querySelector('use').setAttribute('href', (on ? on.querySelector('use') : null)?.getAttribute('href') || 'vendor/icons.svg#' + x.ic);
        else x.sum.classList.toggle('on', !!on);
      }
    }
    const dText = drop('text-aa', tx('editor.groupText'), { once: false }), dPara = drop('text-align-right', tx('app.paragraph'), { mirror: align }),
      dMore = drop('dots-three', tx('editor.insertLine'));
    const part = (name, ...kids) => {  // a named part of a menu
      const s = document.createElement('div'); s.className = 'tb-sec';
      const h = document.createElement('h5'); h.textContent = name; s.append(h, ...kids); return s;
    };
    const [boldB, italB, undB, strikeB, colorB, markB, eraserB] = [...fmt.children];
    const fmtOwn = [boldB, italB, undB, strikeB, colorB, markB, eraserB];
    const marks = group('tb-seg', dText.body), colors = group('tb-rows', dText.body);
    const quick = document.createElement('div'); quick.className = 'tb-quick';

    // wide: two rows that sit side by side when the pane is wide (the text's look, then the paragraph, inserts and
    // undo); phones: the row and its sheet. The same buttons move between them, so their state stays one.
    const row = (...groups) => { const r = document.createElement('div'); r.className = 'tb-row'; r.append(...groups); return r; };
    let laidOut = null;
    // phones: spacing and borders as named rows of their own in the paragraph's sheet (their icons alone say little)
    const alignOwn = [...align.children], paraRows = group('tb-rows', document.createElement('div'));
    const paraMore = alignOwn.filter((b) => [tx('editor.lineParagraphSpacing'), tx('editor.paragraphBorders')].includes(b.getAttribute('aria-label')));
    const arrange = () => {
      const p = phone();
      if (p === laidOut) return;
      laidOut = p; closePop(); closeDrops();
      if (p) {
        marks.replaceChildren(boldB, italB, undB, strikeB); colors.replaceChildren(colorB, markB, eraserB);
        dText.fill(part(tx('editor.styleSize'), style), part(tx('editor.fontStyle'), marks), part(tx('editor.colors'), colors));
        align.replaceChildren(...alignOwn.filter((b) => !paraMore.includes(b))); paraRows.replaceChildren(...paraMore);
        dPara.fill(part(tx('editor.lists'), list), part(tx('editor.alignmentDirection'), align), part(tx('editor.spacingBorders'), paraRows));
        ins.replaceChildren(...insOwn.filter((n) => n !== flagBtn)); again.replaceChildren(rereadBtn, eyeBtn); dMore.fill(ins, again);
        quick.replaceChildren(flagBtn, undoBtn, redoBtn, dText.d, dPara.d, dMore.d);  // flags first: they are the review
        bar.replaceChildren(quick);
      } else {
        fmt.replaceChildren(...fmtOwn); align.replaceChildren(...alignOwn); ins.replaceChildren(...insOwn); again.replaceChildren(rereadBtn, eyeBtn); hist.replaceChildren(undoBtn, redoBtn);
        bar.replaceChildren(row(style, fmt), row(list, align, ins, again, hist));
      }
    };
    arrange();
    window.addEventListener('resize', arrange);

    // ---- the floating bar
    const float = document.createElement('div');
    float.className = 'tb-float'; float.hidden = true;
    float.setAttribute('role', 'toolbar'); float.setAttribute('aria-label', tx('editor.selectionTools'));
    floatHost.append(float);
    const working = (pe) => pe.editor.isFocused || float.contains(document.activeElement) || bar.contains(document.activeElement);
    const isCells = (pe) => '$anchorCell' in pe.editor.state.selection;  // several table cells selected
    const mode = (pe) => {
      if (!pe || !working(pe)) return null;
      if (pe.editor.isActive('figure') || pe.editor.isActive('inlineImage')) return 'figure';
      if (pe.editor.isActive('table') && (pe.editor.state.selection.empty || isCells(pe))) return 'table';
      return pe.editor.state.selection.empty ? null : 'text';
    };
    const when = (m) => (pe) => mode(pe) === m;

    const ft = group('', float);
    [['text-b', tx('editor.bold'), 'bold'], ['text-italic', tx('editor.italic'), 'italic'], ['text-underline', tx('editor.underline'), 'underline'], ['text-strikethrough', tx('editor.strikethrough'), 'strike']]
      .forEach(([ic, label, mark]) => {
        const cap = mark[0].toUpperCase() + mark.slice(1);
        button(ft, { icon: ic, label, run: (pe) => pe.chain()['toggle' + cap]().run(), on: (pe) => pe.editor.isActive(mark), show: when('text') });
      });
    popover(button(ft, { icon: 'list-bullets', label: tx('editor.bulletsNumbering'), run: () => {}, on: listOn, iconOf: listIcon, show: when('text'), enabled: (pe) => pe.canList() }), listMenu);
    button(ft, { icon: 'flag', text: tx('editor.flag'), label: tx('editor.flagNote'), run: () => actions.flag(), always: true, show: when('text') });

    const inTable = when('table');
    button(ft, { text: tx('editor.addRowShort'), label: tx('editor.addRow'), run: (pe) => pe.chain().addRowAfter().run(), show: inTable });
    button(ft, { text: tx('editor.deleteRowShort'), label: tx('editor.deleteRow'), run: (pe) => pe.chain().deleteRow().run(), show: inTable, enabled: (pe) => can(pe, (c) => c.deleteRow()) });
    button(ft, { text: tx('editor.addColumnShort'), label: tx('editor.addColumn'), run: (pe) => pe.chain().addColumnAfter().run(), show: inTable });
    button(ft, { text: tx('editor.deleteColumnShort'), label: tx('editor.deleteColumn'), run: (pe) => pe.chain().deleteColumn().run(), show: inTable, enabled: (pe) => can(pe, (c) => c.deleteColumn()) });
    button(ft, { icon: 'table', text: tx('editor.tableLines'), label: tx('editor.showTableLines'), run: (pe) => pe.toggleTableLines(), show: inTable,
      on: (pe) => !pe.editor.getAttributes('table').borderless });
    popover(button(ft, { icon: 'paint-bucket', label: tx('editor.cellFillColor'), run: () => {}, show: inTable }),
      palette(tx('editor.noFill'), (pe, c) => pe.chain().setCellAttribute('backgroundColor', c).run()));
    button(ft, { icon: 'trash', label: tx('editor.deleteTable'), run: (pe) => pe.chain().deleteTable().run(), show: inTable });

    const onFig = when('figure');
    physical([['left', 'text-align-left', tx('editor.pictureLeft')], ['center', 'text-align-center', tx('editor.pictureCenter')], ['right', 'text-align-right', tx('editor.pictureRight')]]).forEach(([a, ic, label]) => {
      button(ft, { icon: ic, label, run: (pe) => pe.align(a), on: (pe) => pe.alignActive(a), show: onFig });
    });
    button(ft, { icon: 'crop', text: tx('editor.crop'), label: tx('editor.cropPicture'), run: (pe) => { pe.cropPicture(); update(); }, on: (pe) => pe.cropping(), show: onFig });
    // Word's Layout Options: how the text goes with the picture, and its width on the page
    popover(button(ft, { icon: 'text-columns', text: tx('editor.wrap'), label: tx('editor.textWrappingPictureSizeBorder'), run: () => {}, show: onFig }), (pop) => {
      const f = get().figure() || {}, w = Math.round(Math.min(1, f.wFrac || 0.5) * 100);
      const wrap = (label, v) => [label, (f.wrap || null) === v, (pe) => pe.setFigure({ wrap: v })];
      menu(pop, [[tx('editor.wrapText')],
        wrap(tx('editor.wrapInline'), 'inline'),
        wrap(tx('editor.wrapSquare'), 'square'),
        wrap(tx('editor.wrapTight'), 'tight'),
        wrap(tx('editor.wrapThrough'), 'through'),
        wrap(tx('editor.wrapTopBottom'), null),
        wrap(tx('editor.wrapBehind'), 'behind'),
        wrap(tx('editor.wrapFront'), 'front'),
        [tx('editor.widthPage')],
        ['chips', [25, 33, 50, 75, 100].map((p) => [p + '%', w === p, (pe) => pe.setFigure({ wFrac: p / 100 })])],
        [tx('editor.border')],
        ['chips', [[null, tx('editor.pictureNoBorder')], ['single', tx('editor.singleLine')], ['thick', tx('editor.thickLine')], ['double', tx('editor.doubleLine')], ['dashed', tx('editor.dashedLine')], ['dotted', tx('editor.dottedLine')]]
          .map(([v, label]) => [label, (f.border || null) === v, (pe) => pe.setFigure({ border: v })])]]);
    });
    button(ft, { icon: 'trash', text: tx('editor.deletePicture'), label: tx('editor.deletePicture'), run: (pe) => pe.chain().deleteSelection().run(), show: onFig });

    // above the selection, the table (or the top of the visible part of a tall one) or the picture; below when there is no room
    function place(pe, m) {
      const view = pe.editor.view, s = view.state.selection;
      let r;
      if (m === 'text') {
        const a = view.coordsAtPos(s.from), b = view.coordsAtPos(s.to);
        r = { top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), left: Math.min(a.left, b.left), right: Math.max(a.right, b.right) };
      } else {
        const at = m === 'figure' ? view.nodeDOM(s.from) : view.domAtPos(s.from).node;
        const node = at && (m === 'table' ? (at.nodeType === 3 ? at.parentElement : at).closest('table') : at);
        if (!node) { float.hidden = true; return; }
        r = ((m === 'figure' && node.querySelector && node.querySelector('img')) || node).getBoundingClientRect();  // a free picture's box has no height
      }
      const host = floatHost.getBoundingClientRect(), w = float.offsetWidth, h = float.offsetHeight;
      let top = r.top - h - 6;
      if (top < host.top + 2) top = m === 'table' && r.bottom > host.top + h + 8 ? host.top + 2 : r.bottom + 6;
      const left = Math.max(host.left + 4, Math.min((r.left + r.right) / 2 - w / 2, host.right - w - 4));
      float.style.top = (top - host.top + floatHost.scrollTop) + 'px';
      float.style.left = (left - host.left + floatHost.scrollLeft) + 'px';
    }

    function update() {
      const pe = get();
      for (const it of items) {
        const shown = pe && it.show ? it.show(pe) : true;
        it.node.hidden = !shown;
        // "always" tools belong to the app (picture, flag): they say themselves when they can work
        it.node.disabled = it.always ? !!(it.enabled && !it.enabled(pe)) : !pe || (it.enabled ? !it.enabled(pe) : false);
        if (it.on) { const on = !!(pe && it.on(pe)); it.node.setAttribute('aria-pressed', String(on)); it.node.classList.toggle('on', on); }
        if (it.value && pe) it.node.value = it.value(pe);
        if (it.iconOf && pe) it.node.querySelector('use').setAttribute('href', 'vendor/icons.svg#' + it.iconOf(pe));
      }
      syncDrops();
      const m = mode(pe);
      float.hidden = !m;
      if (m) place(pe, m);
    }
    floatHost.addEventListener('scroll', () => { if (!float.hidden) update(); }, { passive: true });
    update();
    return { update };
  }

  window.DocEditor = { mount, toolbar };
})();
