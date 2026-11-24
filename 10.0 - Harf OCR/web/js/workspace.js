// The open draft: which page is shown, the editor holding it, and saving.
//
// The shown page is kept as the page itself, not its place in the list, and the editor is bound to the page it was
// opened on: flush() writes the editor's text into that page only. So pages can be added, moved, sorted or deleted
// in any order and no page ever receives another's text (deleting the shown page used to write it into the next).
//
// Changes mark the draft unsaved and save it after a pause; a save sent from an older version (someone else saved
// the draft in between) fails with status 409 and the draft stays unsaved. app.js draws all of it.
(function (root) {
  function create(opts) {
    var save = opts.save;                        // (draft) -> Promise<{ version, updated }>
    var onState = opts.onState || function () {};  // dirty, saving or error changed
    var onFail = opts.onFail || function () {};    // a save failed: (error), error.status 409 for a conflict
    var delay = opts.delay == null ? 4000 : opts.delay;

    var draft = null, shown = null, bound = null;  // bound: { editor, page } while an editor shows a page
    var timer = null, edits = 0;  // edits: changes so far, so one made while a save is out keeps the draft unsaved
    var ws = { dirty: false, saving: false, error: null };

    function flush() {
      if (bound && bound.page.blocks) bound.page.blocks = bound.editor.getBlocks();
    }
    function state() { onState(ws); }
    function changed() {
      edits++; ws.dirty = true; state();
      clearTimeout(timer);
      if (delay !== Infinity) timer = setTimeout(function () { ws.save(); }, delay);
    }

    Object.defineProperties(ws, {
      draft: { get: function () { return draft; } },
      page: { get: function () { return shown; } },
      // the shown page's place in the list; -1 with none
      index: { get: function () { return draft && shown ? draft.pages.indexOf(shown) : -1; } },
    });

    // a draft just loaded: saved, its first page shown, no editor yet
    ws.load = function (d) {
      bound = null; clearTimeout(timer);
      draft = d; shown = d && d.pages[0] || null;
      ws.dirty = false; ws.error = null; state();
    };
    // the editor now showing the shown page (null: none)
    ws.bind = function (editor) {
      flush();
      bound = editor && shown ? { editor: editor, page: shown } : null;
    };
    // the editor goes without writing back: its page's text was just replaced (a new reading, a version restored),
    // or the editor is closing after a flush
    ws.release = function () { bound = null; };
    ws.flush = flush;
    ws.changed = changed;
    // shows page i (kept inside the list); the editor's text goes back into its own page first
    ws.show = function (i) {
      flush(); bound = null;
      shown = draft && draft.pages.length ? draft.pages[Math.max(0, Math.min(i, draft.pages.length - 1))] : null;
      return shown;
    };
    // the shown page stays shown; when it is the one deleted, the page after it (or before, at the end)
    ws.removePage = function (i) {
      flush();
      var gone = draft.pages.splice(i, 1)[0];
      if (gone === shown) { bound = null; shown = draft.pages[Math.min(i, draft.pages.length - 1)] || null; }
      changed();
      return gone;
    };
    ws.movePage = function (from, to) {
      if (from === to || from < 0 || to < 0 || from >= draft.pages.length || to >= draft.pages.length) return false;
      flush();
      draft.pages.splice(to, 0, draft.pages.splice(from, 1)[0]);
      changed();
      return true;
    };
    // sorts the pages by cmp, keeping the order of equal ones
    ws.sortPages = function (cmp) {
      flush();
      var k = new Map(draft.pages.map(function (p, n) { return [p, n]; }));
      draft.pages.sort(function (a, b) { return cmp(a, b) || k.get(a) - k.get(b); });
      changed();
    };
    ws.addPages = function (pages) {
      if (!pages.length) return;
      draft.pages.push.apply(draft.pages, pages);
      if (!shown) shown = pages[0];
      changed();
    };

    // saves now when there is something to save; resolves true when saved
    ws.save = function () {
      if (!draft || ws.saving) return Promise.resolve(false);
      clearTimeout(timer);
      flush();
      var d = draft, made = edits;
      ws.saving = true; state();
      return Promise.resolve().then(function () { return save(d); }).then(function (r) {
        d.version = r.version; d.updated = r.updated;
        if (d === draft) { ws.dirty = edits !== made; ws.error = null; }
        return true;
      }, function (e) {
        if (d === draft) ws.error = e;
        onFail(e);
        return false;
      }).then(function (ok) { ws.saving = false; state(); return ok; });
    };
    return ws;
  }

  var Workspace = { create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = Workspace;
  else root.Workspace = Workspace;
})(this);
