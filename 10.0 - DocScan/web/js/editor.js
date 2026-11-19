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

  // a picture cut from the page photo; wFrac = its share of the page width on the photo
  const Figure = T.Node.create({
    name: 'figure',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addOptions() { return { src: (name) => name }; },
    addAttributes() {
      const data = (name, num) => ({
        default: num ? 0 : null,
        parseHTML: (el) => (num ? +el.getAttribute('data-' + name) || 0 : el.getAttribute('data-' + name) || null),
        renderHTML: () => ({}),
      });
      return { image: data('image'), w: data('w', true), h: data('h', true), wFrac: data('wfrac', true), align: data('align') };
    },
    parseHTML() { return [{ tag: 'figure.fig' }]; },
    renderHTML({ node }) {
      const a = node.attrs;
      return ['figure', { class: 'fig', 'data-image': a.image, 'data-w': a.w, 'data-h': a.h, 'data-wfrac': a.wFrac, 'data-align': a.align || '' },
        ['img', { src: this.options.src(a.image), alt: 'صورة مدرجة من الصفحة', draggable: 'false',
          style: 'width:' + Math.round(Math.min(1, a.wFrac || 0.5) * 100) + '%' }]];
    },
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
        Figure.configure({ src: opts.src }),
        Flag, BlockBox,
      ],
      content: window.BlocksDoc.blocksToDoc(blocks),
      editorProps: {
        attributes: { dir: 'rtl', class: 'doc', spellcheck: 'false', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'نص الصفحة' },
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

      // left to right (English) or right to left, for the paragraphs, lists and tables in the selection
      isLtr() {
        const { $from } = editor.state.selection;
        for (let d = $from.depth; d > 0; d--) if ($from.node(d).attrs.dir === 'ltr') return true;
        return false;
      },
      toggleDir() {
        const to = this.isLtr() ? null : 'ltr';
        const st = editor.state, tr = st.tr, { from, to: end } = st.selection;
        const types = ['paragraph', 'heading', 'bulletList', 'orderedList', 'table'];
        st.doc.nodesBetween(from, end, (node, pos) => {
          if (types.includes(node.type.name)) tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { dir: to }));
        });
        const { $from } = st.selection;  // and the list or table the cursor is in
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d);
          if (types.includes(n.type.name) && d < $from.depth) tr.setNodeMarkup($from.before(d), null, Object.assign({}, n.attrs, { dir: to }));
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
        focused().updateAttributes('table', lined ? { borderless: true } : { borderless: false, lineless: false }).run();
      },
    };
    el.docEditor = api;  // for the browser checks (tests/browser)
    return api;
  }

  // ------------------------------------------------------------------ toolbar
  const SVG_NS = 'http://www.w3.org/2000/svg';
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
      b.type = 'button'; b.className = 'tb' + (o.text ? ' tb-text' : '');
      b.title = o.label + (o.keys ? ' (' + o.keys + ')' : ''); b.setAttribute('aria-label', o.label);
      if (o.icon) b.append(icon(o.icon));
      if (o.text) b.append(document.createTextNode(o.text));
      if (o.on) b.setAttribute('aria-pressed', 'false');
      b.addEventListener('mousedown', (e) => e.preventDefault());  // keep the text selection
      b.addEventListener('click', () => { const pe = get(); if (pe || o.always) o.run(pe); });
      g.append(b);
      items.push({ node: b, on: o.on, enabled: o.enabled, show: o.show, always: o.always });
      return b;
    };
    const can = (pe, fn) => { try { return fn(pe.editor.can().chain().focus()).run(); } catch (e) { return false; } };

    // small panels under a toolbar button (colours, table size); one at a time, closed by Esc or a click elsewhere
    let open = null;
    const closePop = () => { if (open) { open.pop.remove(); open.btn.setAttribute('aria-expanded', 'false'); open = null; } };
    const popover = (btn, build) => {
      btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => {
        const again = open && open.btn === btn;
        closePop();
        if (again || !get()) return;
        const pop = document.createElement('div');
        pop.className = 'tb-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', btn.getAttribute('aria-label'));
        build(pop);
        document.body.append(pop);
        const r = btn.getBoundingClientRect();
        pop.style.top = (r.bottom + 4) + 'px';
        pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8)) + 'px';
        btn.setAttribute('aria-expanded', 'true');
        open = { btn, pop };
        const first = pop.querySelector('button, input'); if (first) first.focus({ preventScroll: true });
      });
    };
    document.addEventListener('pointerdown', (e) => { if (open && !open.pop.contains(e.target) && !open.btn.contains(e.target)) closePop(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { const b = open.btn; closePop(); b.focus(); } });

    // Word's standard colours and their light tints
    const COLORS = [['#c00000', 'أحمر داكن'], ['#ff0000', 'أحمر'], ['#ffc000', 'برتقالي'], ['#ffff00', 'أصفر'], ['#92d050', 'أخضر فاتح'],
      ['#00b050', 'أخضر'], ['#00b0f0', 'أزرق فاتح'], ['#0070c0', 'أزرق'], ['#002060', 'كحلي'], ['#7030a0', 'بنفسجي'],
      ['#000000', 'أسود'], ['#404040', 'رمادي داكن'], ['#7f7f7f', 'رمادي'], ['#bfbfbf', 'رمادي فاتح'], ['#f2f2f2', 'رمادي باهت'],
      ['#fce4d6', 'خوخي فاتح'], ['#fff2cc', 'أصفر باهت'], ['#e2efda', 'أخضر باهت'], ['#ddebf7', 'أزرق باهت'], ['#ede7f6', 'بنفسجي باهت']];
    const palette = (noneLabel, apply) => (pop) => {
      const done = (c) => { apply(get(), c); closePop(); };
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
      more.append(document.createTextNode('لون آخر'), pick);
      pop.append(none, grid, more);
    };

    const style = group();
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'نوع السطر'); sel.title = 'نوع السطر';
    [['p', 'فقرة'], ['h1', 'عنوان رئيسي'], ['h2', 'عنوان'], ['h3', 'عنوان فرعي'], ['q', 'اقتباس']].forEach(([v, l]) => {
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
    // text size in points, like Word: pick from the list or type any size
    const size = document.createElement('input');
    size.type = 'text'; size.inputMode = 'decimal'; size.className = 'tb-size';
    size.placeholder = 'حجم'; size.title = 'حجم النص المحدد (نقطة)'; size.setAttribute('aria-label', 'حجم النص المحدد بالنقاط');
    size.setAttribute('list', 'tbSizes');
    const sizes = document.createElement('datalist'); sizes.id = 'tbSizes';
    [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72].forEach((n) => { const o = document.createElement('option'); o.value = n; sizes.append(o); });
    const applySize = () => {
      const pe = get(); if (!pe) return;
      const n = parseFloat(size.value);
      if (n >= 6 && n <= 96) pe.chain().setFontSize(n + 'pt').run(); else pe.chain().unsetFontSize().run();
    };
    size.addEventListener('change', applySize);
    size.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applySize(); } });
    style.append(size, sizes);
    items.push({ node: size, enabled: (pe) => !pe.editor.isActive('figure'), value: (pe) => {
      if (document.activeElement === size) return size.value;  // do not overwrite while typing
      const m = String(pe.editor.getAttributes('textStyle').fontSize || '').match(/^([\d.]+)(pt|px)?$/);
      return m ? String(m[2] === 'px' ? Math.round(+m[1] * 1.5) / 2 : +m[1]) : '';
    } });
    items.push({ node: sel, enabled: (pe) => !pe.editor.isActive('figure'), value: (pe) => {
      if (pe.editor.isActive('blockquote')) return 'q';
      const h = [1, 2, 3].find((l) => pe.editor.isActive('heading', { level: l }));
      return h ? 'h' + h : 'p';
    } });

    const fmt = group();
    [['text-b', 'عريض', 'Ctrl+B', 'bold'], ['text-italic', 'مائل', 'Ctrl+I', 'italic'], ['text-underline', 'تحته خط', 'Ctrl+U', 'underline'],
      ['text-strikethrough', 'يتوسطه خط', 'Ctrl+Shift+S', 'strike']].forEach(([ic, label, keys, mark]) => {
      const cap = mark[0].toUpperCase() + mark.slice(1);
      button(fmt, { icon: ic, label, keys, run: (pe) => pe.chain()['toggle' + cap]().run(), on: (pe) => pe.editor.isActive(mark),
        enabled: (pe) => can(pe, (c) => c['toggle' + cap]()) });
    });
    popover(button(fmt, { icon: 'text-a-underline', label: 'لون النص', run: () => {} }),
      palette('تلقائي (أسود)', (pe, c) => (c ? pe.chain().setColor(c) : pe.chain().unsetColor()).run()));
    popover(button(fmt, { icon: 'highlighter', label: 'لون خلفية النص', run: () => {} }),
      palette('بلا لون', (pe, c) => (c ? pe.chain().setBackgroundColor(c) : pe.chain().unsetBackgroundColor()).run()));
    button(fmt, { icon: 'eraser', label: 'إزالة التنسيق (يبقى التعليم)', run: (pe) => pe.chain().unsetBold().unsetItalic().unsetUnderline().unsetStrike()
      .unsetColor().unsetBackgroundColor().unsetFontSize().run() });

    const list = group();
    button(list, { icon: 'list-bullets', label: 'قائمة نقطية', keys: 'Ctrl+Shift+8', run: (pe) => pe.chain().toggleBulletList().run(),
      on: (pe) => pe.editor.isActive('bulletList'), enabled: (pe) => can(pe, (c) => c.toggleBulletList()) });
    button(list, { icon: 'list-numbers', label: 'قائمة مرقمة', keys: 'Ctrl+Shift+7', run: (pe) => pe.chain().toggleOrderedList().run(),
      on: (pe) => pe.editor.isActive('orderedList'), enabled: (pe) => can(pe, (c) => c.toggleOrderedList()) });
    // pages are right to left: indenting moves the item left, so the arrows point that way
    button(list, { icon: 'text-outdent', label: 'إنقاص المسافة البادئة', keys: 'Shift+Tab', run: (pe) => pe.chain().liftListItem('listItem').run(),
      enabled: (pe) => can(pe, (c) => c.liftListItem('listItem')) });
    button(list, { icon: 'text-indent', label: 'زيادة المسافة البادئة', keys: 'Tab', run: (pe) => pe.chain().sinkListItem('listItem').run(),
      enabled: (pe) => can(pe, (c) => c.sinkListItem('listItem')) });

    const align = group();
    [['right', 'text-align-right', 'محاذاة لليمين'], ['center', 'text-align-center', 'توسيط'], ['left', 'text-align-left', 'محاذاة لليسار'],
      ['justify', 'text-align-justify', 'ضبط من الجهتين']].forEach(([a, ic, label]) => {
      button(align, { icon: ic, label, run: (pe) => pe.align(a), on: (pe) => pe.alignActive(a), enabled: (pe) => a !== 'justify' || !pe.editor.isActive('figure') });
    });
    button(align, { icon: 'arrows-left-right', label: 'اتجاه الفقرة: من اليسار (إنجليزي) أو من اليمين', run: (pe) => pe.toggleDir(),
      on: (pe) => pe.isLtr(), enabled: (pe) => !pe.editor.isActive('figure') });

    const ins = group();
    const insertTable = (rows, cols) => {
      const pe = get(); if (!pe) return;
      const row = () => ({ type: 'tableRow', content: Array.from({ length: cols }, () => ({ type: 'tableCell', content: [{ type: 'paragraph' }] })) });
      pe.insertBlock({ type: 'table', content: Array.from({ length: rows }, row) });
      closePop();
    };
    // like Word: point at the grid for the size, or type any number of rows and columns
    popover(button(ins, { icon: 'table', text: 'جدول', label: 'إدراج جدول', run: () => {} }), (pop) => {
      const R = 8, C = 8;
      const label = document.createElement('div'); label.className = 'grid-label'; label.textContent = 'اختر عدد الصفوف والأعمدة';
      const grid = document.createElement('div'); grid.className = 'tbl-grid'; grid.style.gridTemplateColumns = `repeat(${C}, 1fr)`;
      const cells = [];
      const mark = (r, c) => {
        cells.forEach((b) => b.classList.toggle('on', +b.dataset.r <= r && +b.dataset.c <= c));
        label.textContent = `${r} ${r === 1 ? 'صف' : 'صفوف'} × ${c} ${c === 1 ? 'عمود' : 'أعمدة'}`;  // spelled out: digits alone read backwards in RTL
      };
      for (let r = 1; r <= R; r++) {
        for (let c = 1; c <= C; c++) {
          const b = document.createElement('button');
          b.type = 'button'; b.dataset.r = r; b.dataset.c = c; b.setAttribute('aria-label', `${r} صف × ${c} عمود`);
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
      const rr = num('صفوف', 3), cc = num('أعمدة', 3);
      const go = document.createElement('button'); go.type = 'button'; go.className = 'btn small primary'; go.textContent = 'إدراج';
      go.addEventListener('click', () => insertTable(Math.max(1, Math.min(50, +rr.value || 1)), Math.max(1, Math.min(20, +cc.value || 1))));
      custom.append(go);
      pop.append(label, grid, custom);
    });
    button(ins, { icon: 'images', text: 'صورة', label: 'إدراج جزء من صورة الصفحة (شعار، رسم، توقيع)', run: () => actions.picture(), always: true,
      enabled: () => actions.hasPage() });
    button(ins, { icon: 'flag', text: 'تعليم', label: 'تعليم النص المحدد كملاحظة', run: () => actions.flag(), always: true, enabled: (pe) => !!pe });

    // the line at the cursor: its spot on the photo, and reading it again with another engine (the app's panel)
    const again = group();
    button(again, { icon: 'scan', text: 'أعد القراءة', label: 'السطر في صورة الصفحة، وقراءته بقارئ آخر', run: () => actions.showLine() });
    // a click into the text shows that line on the photo; this turns that off and on (remembered on this computer)
    button(again, { icon: 'eye', label: 'معاينة السطر من الصورة عند النقر', always: true, on: () => actions.previewOn(),
      run: () => { actions.togglePreview(); update(); } });

    const hist = group();
    button(hist, { icon: 'arrow-u-up-right', label: 'تراجع', keys: 'Ctrl+Z', run: (pe) => pe.chain().undo().run(), enabled: (pe) => can(pe, (c) => c.undo()) });
    button(hist, { icon: 'arrow-u-up-left', label: 'إعادة', keys: 'Ctrl+Y', run: (pe) => pe.chain().redo().run(), enabled: (pe) => can(pe, (c) => c.redo()) });

    // two rows that sit side by side when the pane is wide: the text's look, then the paragraph, inserts and undo
    const row = (...groups) => { const r = document.createElement('div'); r.className = 'tb-row'; r.append(...groups); return r; };
    bar.replaceChildren(row(style, fmt), row(list, align, ins, again, hist));

    // ---- the floating bar
    const float = document.createElement('div');
    float.className = 'tb-float'; float.hidden = true;
    float.setAttribute('role', 'toolbar'); float.setAttribute('aria-label', 'أدوات التحديد');
    floatHost.append(float);
    const working = (pe) => pe.editor.isFocused || float.contains(document.activeElement) || bar.contains(document.activeElement);
    const isCells = (pe) => '$anchorCell' in pe.editor.state.selection;  // several table cells selected
    const mode = (pe) => {
      if (!pe || !working(pe)) return null;
      if (pe.editor.isActive('figure')) return 'figure';
      if (pe.editor.isActive('table') && (pe.editor.state.selection.empty || isCells(pe))) return 'table';
      return pe.editor.state.selection.empty ? null : 'text';
    };
    const when = (m) => (pe) => mode(pe) === m;

    const ft = group('', float);
    [['text-b', 'عريض', 'bold'], ['text-italic', 'مائل', 'italic'], ['text-underline', 'تحته خط', 'underline'], ['text-strikethrough', 'يتوسطه خط', 'strike']]
      .forEach(([ic, label, mark]) => {
        const cap = mark[0].toUpperCase() + mark.slice(1);
        button(ft, { icon: ic, label, run: (pe) => pe.chain()['toggle' + cap]().run(), on: (pe) => pe.editor.isActive(mark), show: when('text') });
      });
    button(ft, { icon: 'list-bullets', label: 'قائمة نقطية', run: (pe) => pe.chain().toggleBulletList().run(), on: (pe) => pe.editor.isActive('bulletList'), show: when('text') });
    button(ft, { icon: 'list-numbers', label: 'قائمة مرقمة', run: (pe) => pe.chain().toggleOrderedList().run(), on: (pe) => pe.editor.isActive('orderedList'), show: when('text') });
    button(ft, { icon: 'flag', text: 'تعليم', label: 'تعليم كملاحظة', run: () => actions.flag(), always: true, show: when('text') });

    const inTable = when('table');
    button(ft, { text: '+ صف', label: 'إضافة صف', run: (pe) => pe.chain().addRowAfter().run(), show: inTable });
    button(ft, { text: '− صف', label: 'حذف الصف', run: (pe) => pe.chain().deleteRow().run(), show: inTable, enabled: (pe) => can(pe, (c) => c.deleteRow()) });
    button(ft, { text: '+ عمود', label: 'إضافة عمود', run: (pe) => pe.chain().addColumnAfter().run(), show: inTable });
    button(ft, { text: '− عمود', label: 'حذف العمود', run: (pe) => pe.chain().deleteColumn().run(), show: inTable, enabled: (pe) => can(pe, (c) => c.deleteColumn()) });
    button(ft, { icon: 'table', text: 'خطوط', label: 'إظهار خطوط الجدول', run: (pe) => pe.toggleTableLines(), show: inTable,
      on: (pe) => !pe.editor.getAttributes('table').borderless });
    popover(button(ft, { icon: 'paint-bucket', label: 'لون تعبئة الخلايا', run: () => {}, show: inTable }),
      palette('بلا تعبئة', (pe, c) => pe.chain().setCellAttribute('backgroundColor', c).run()));
    button(ft, { icon: 'trash', label: 'حذف الجدول', run: (pe) => pe.chain().deleteTable().run(), show: inTable });

    const onFig = when('figure');
    [['right', 'text-align-right', 'الصورة لليمين'], ['center', 'text-align-center', 'الصورة في الوسط'], ['left', 'text-align-left', 'الصورة لليسار']].forEach(([a, ic, label]) => {
      button(ft, { icon: ic, label, run: (pe) => pe.align(a), on: (pe) => pe.alignActive(a), show: onFig });
    });
    button(ft, { icon: 'trash', text: 'حذف الصورة', label: 'حذف الصورة', run: (pe) => pe.chain().deleteSelection().run(), show: onFig });

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
        r = node.getBoundingClientRect();
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
      }
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
