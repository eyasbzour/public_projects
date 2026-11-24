// Flagged spots and their second readings: a flagged word or paragraph can be read again, from its box on the photo,
// by another reader, and what that reader saw is offered in its place.
//
// A spot can be read again only while the page's photo is the one its text was read from (the boxes are on it): a
// photo edited or turned since needs the page read again first. Second readings belong to their page, kept by the
// page itself, so they never show on another. A flag here is { text, box } (app.js takes them from the editor).
(function (root) {
  var key = function (box) { return String(box); };

  function create(opts) {
    var read = opts.read;  // (page, engine, boxes) -> Promise<[{ text }]>, one per box
    var page = null, seen = new Map();  // box -> { engine, text }, for page only

    function on(p) { if (p !== page) { page = p; seen = new Map(); } }

    var spots = {
      // the page's photo is still the one its text was read from
      readable: function (p) { return !!(p && p.readImage && p.readImage === p.image); },
      // the second reading of a flag, when there is one
      reading: function (p, flag) { on(p); return flag.box ? seen.get(key(flag.box)) || null : null; },
      // the second reading to offer: there is one and it says something else
      offer: function (p, flag) {
        var s = spots.reading(p, flag);
        return s && s.text && s.text !== flag.text ? s : null;
      },
      // the flags with a reading to offer: [{ flag, text }]
      pending: function (p, flags) {
        return flags.map(function (f) { var s = spots.offer(p, f); return s ? { flag: f, text: s.text } : null; })
          .filter(Boolean);
      },
      // reads the flags' spots again with engine; resolves to their readings, kept for the page
      reread: function (p, engine, flags) {
        var withBox = flags.filter(function (f) { return f.box; });
        if (!withBox.length) return Promise.resolve([]);  // nothing on the photo to read
        return read(p, engine, withBox.map(function (f) { return f.box; })).then(function (res) {
          on(p);
          return withBox.map(function (f, i) {
            var s = { engine: engine, text: res[i] && res[i].text || '' };
            seen.set(key(f.box), s);
            return s;
          });
        });
      },
    };
    return spots;
  }

  var Spots = { create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = Spots;
  else root.Spots = Spots;
})(this);
