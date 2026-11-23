// The interface language. Text is looked up by name: tx('app.deletePage', { page: 3 }) is the chosen language's
// "app.deletePage" with {page} filled in, else the Arabic one (the source), else the name itself.
//
// A language is one file, web/i18n/<code>.json: { "_meta": { "name", "dir" }, "<name>": "text", ... }. The server
// serves them all as /i18n/all.js (server/main.py), so adding a language is adding its file; web/js/i18n.test.js
// checks it has every name. A plural is { one, other, ... } by Intl.PluralRules on vars.n, with zero where it reads
// better than "0 ...".
//
// The static pages carry names, not text: data-i18n="<name>" for an element's text, data-i18n-<attribute>="<name>"
// for title, aria-label, placeholder, alt and data-short. I18N.apply() fills them in once, before the app's scripts,
// so changing the language reloads the page.
(function (root) {
  var dicts = {}, metas = {};
  var SOURCE = 'ar';
  function stored() {
    try { return localStorage.getItem('ds.lang'); } catch (e) { return null; }  // storage blocked
  }
  // ds.lang when chosen; else the default the server gives (HARF_LANG_DEFAULT, first in /i18n/all.js: the Windows
  // program's installer or Settings, or a server's DOCSCAN_LANG); read when first asked, which all.js does
  var wanted = null;
  function current() {
    if (wanted === null) wanted = stored() || root.HARF_LANG_DEFAULT || SOURCE;
    return metas[wanted] ? wanted : SOURCE;
  }

  var rules = {};
  function plural(n) {
    var l = current();
    try { return (rules[l] = rules[l] || new Intl.PluralRules(l)).select(n); } catch (e) { return n === 1 ? 'one' : 'other'; }
  }
  // {name} -> its value; a value that is itself a server message ({ key, args }) is put in the language too
  function fill(s, vars) {
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) {
      if (!(k in vars)) return m;
      var x = vars[k];
      return x && typeof x === 'object' && x.key ? t(x.key, x.args) : x;
    }) : s;
  }
  function t(key, vars) {
    var d = dicts[current()], v = d && d[key];
    if (v == null && dicts[SOURCE]) v = dicts[SOURCE][key];
    if (v && typeof v === 'object') v = (vars && vars.n === 0 && v.zero) || v[plural(vars && vars.n)] || v.other;
    return fill(typeof v === 'string' ? v : String(key), vars);
  }
  // a server reply's message, { error, key, args } (server/messages.py), in the chosen language; a label the server
  // sends is a message too ({ key, args }), or plain text (a reader's own name, a template's typed name)
  function message(data) {
    if (!data) return '';
    if (typeof data === 'string') return data;
    if (data.key) return t(data.key, data.args);
    var m = data.error || data.detail;
    return typeof m === 'string' ? m : '';
  }

  // JSON.parse's reviver for the server's replies: a message ({ key, args } and nothing else: messages.py to_json)
  // becomes its text in the chosen language; its values are revived first, so nested messages too
  function revive(k, v) {
    if (v && typeof v === 'object' && typeof v.key === 'string' && v.args && typeof v.args === 'object'
      && Object.keys(v).length === 2) return t(v.key, v.args);
    return v;
  }

  var ATTRS = ['title', 'aria-label', 'placeholder', 'alt', 'data-short'];
  function apply(node) {
    var els = node.querySelectorAll('[data-i18n]'), i, j;
    for (i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute('data-i18n'));
    for (j = 0; j < ATTRS.length; j++) {
      els = node.querySelectorAll('[data-i18n-' + ATTRS[j] + ']');
      for (i = 0; i < els.length; i++) els[i].setAttribute(ATTRS[j], t(els[i].getAttribute('data-i18n-' + ATTRS[j])));
    }
  }

  var I18N = {
    t: t, message: message, apply: apply, revive: revive,
    lang: current,
    // a name's text in every language, unfilled: to recognise text the server wrote in the page's language
    texts: function (key) {
      return Object.keys(dicts).map(function (c) { return dicts[c][key]; }).filter(function (v) { return typeof v === 'string'; });
    },
    // { code, name, dir } for each language, the source first: names in their own language
    languages: function () {
      return Object.keys(metas).sort(function (a, b) { return (a !== SOURCE) - (b !== SOURCE) || (a < b ? -1 : 1); })
        .map(function (c) { return { code: c, name: metas[c].name, dir: metas[c].dir }; });
    },
    // a language file's content: { _meta: { name, dir }, name: text, ... }
    add: function (code, file) {
      var entries = {};
      for (var k in file) if (k !== '_meta') entries[k] = file[k];
      metas[code] = file._meta;
      dicts[code] = entries;
      if (code === current() && root.document) {
        root.document.documentElement.lang = code;
        root.document.documentElement.dir = file._meta.dir;
      }
    },
    // saves the choice; the caller reloads the page (after saving the open draft)
    set: function (code) {
      try { if (metas[code]) localStorage.setItem('ds.lang', code); else localStorage.removeItem('ds.lang'); } catch (e) { /* blocked */ }
    }
  };
  root.I18N = I18N;
  root.tx = t;  // "tx", not "t": many functions here have a local t
})(typeof window !== 'undefined' ? window : globalThis);
