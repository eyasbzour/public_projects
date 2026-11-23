// The interface text, by name (web/js/i18n.js). No Arabic text is left in the code or the static pages; every name
// the code, the pages, the server and the Windows program's launcher use is in web/i18n/ar.json (the source), and
// every language file has exactly those names, with the same {values}. node --test web/js/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const AR = /[؀-ۿ]/;
const CODES = fs.readdirSync(path.join(ROOT, 'web/i18n')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
const FILES = Object.fromEntries(CODES.map((c) => [c, JSON.parse(read(`web/i18n/${c}.json`))]));

// a page's I18N with every language file loaded, as the server's /i18n/all.js does; lang: the chosen one
function load(lang) {
  const ctx = { Intl, String, Object, HARF_LANG_DEFAULT: lang };
  vm.createContext(ctx);
  vm.runInContext(read('web/js/i18n.js'), ctx);
  for (const c of CODES) ctx.I18N.add(c, JSON.parse(JSON.stringify(FILES[c])));
  return ctx;
}
const I18N = load().I18N;
const entries = ({ _meta, ...e }) => e;  // a language file without its _meta
const SOURCE = entries(FILES.ar);
const NAME = /^[a-z][A-Za-z]*\.[A-Za-z][A-Za-z0-9]*$/;
const AREAS = new Set(Object.keys(SOURCE).map((k) => k.split('.')[0]));

// A small JavaScript lexer: the string and template literals of a source, past comments and regex literals (which
// may hold Arabic: patterns over the document's text). A template's "text" is its fixed parts only.
const AFTER_REGEX_OK = /^(?:[(,=:[!&|?{;+\-*%<>~^]|return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;
function lex(src) {
  const out = [];
  let i = 0, prev = '';
  const n = src.length;
  const add = (raw, text) => out.push({ raw, text });
  function quoted(q) {
    const s = i++;
    while (i < n && src[i] !== q) i += src[i] === '\\' ? 2 : 1;
    i++;
    return src.slice(s, i);
  }
  function template() {
    const s = i++;
    let fixed = '';
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { fixed += src.slice(i, i + 2); i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; code('}'); i++; fixed += '${}'; continue; }
      fixed += src[i++];
    }
    i++;
    return [src.slice(s, i), fixed];
  }
  function code(stop) {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (stop && c === '}' && depth === 0) return;
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
      if (c === "'" || c === '"') { const raw = quoted(c); add(raw, unquote(raw)); prev = 'str'; continue; }
      if (c === '`') { const [raw, fixed] = template(); add(raw, fixed); prev = 'str'; continue; }
      if (c === '/' && (!prev || AFTER_REGEX_OK.test(prev))) {
        i++;
        for (let cls = false; i < n && src[i] !== '\n'; i++) {
          if (src[i] === '\\') { i++; continue; }
          if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; else if (src[i] === '/' && !cls) break;
        }
        i++;
        while (i < n && /[a-z]/i.test(src[i])) i++;
        prev = 're';
        continue;
      }
      if (/\s/.test(c)) { i++; continue; }
      if (/[\w$]/.test(c)) { const s = i; while (i < n && /[\w$]/.test(src[i])) i++; prev = src.slice(s, i); continue; }
      if (c === '{') depth++;
      if (c === '}') depth--;
      prev = c;
      i++;
    }
  }
  code();
  return out;
}
const unquote = (s) => s.slice(1, -1).replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');

const JS = fs.readdirSync(path.join(ROOT, 'web/js')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'i18n.js')
  .map((f) => 'web/js/' + f);
// Arabic that is not interface text: patterns and digit tables, named here one by one
const NOT_TEXT = new Set([
  'web/js/editor.js|١.', 'web/js/editor.js|٢.', 'web/js/editor.js|٣.',  // list marker samples: Hindi digits
  'web/js/editor.js|أ.', 'web/js/editor.js|ب.', 'web/js/editor.js|ت.',  // and Arabic letters
  'web/js/app.js|ا', 'web/js/app.js|ه', 'web/js/app.js|ي',  // the drafts search folds أ إ آ, ة and ى
  'web/js/docx-export.js|مراجع',  // the comment author when a caller gives none; app.js always gives one
]);

const PAGES = ['web/index.html', 'web/phone.html'];
// each browser source: a JS file, or a page's inline scripts
const SOURCES = JS.map((f) => [f, read(f)])
  .concat(PAGES.map((f) => [f, [...read(f).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')]));
const ALL = SOURCES.flatMap(([file, src]) => lex(src).map((l) => ({ ...l, file })));
// a page without its comments, scripts and styles
const markup = (file) => read(file).replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
const pageNames = (file) => [...markup(file).matchAll(/\sdata-i18n(?:-[a-z-]+)?="([^"]*)"/g)].map((m) => m[1]);

// the server's and the launcher's names: msg("..."), doc("..."), tr("...") (server/messages.py, desktop/app.py),
// and every other quoted name in them (a table of names, as in Claude's instructions)
function pyFiles() {
  const out = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/^(tests|__pycache__)$/.test(e.name)) walk(p); } else if (e.name.endsWith('.py')) out.push(p);
  });
  walk(path.join(ROOT, 'server'));
  return out.concat(path.join(ROOT, 'desktop/app.py')).map((p) => fs.readFileSync(p, 'utf8'));
}
const PY = pyFiles();
const pyCalled = PY.flatMap((s) => [...s.matchAll(/\b(?:msg|doc|tr)\(\s*"([^"\n]*)"/g)].map((m) => m[1]));
const pyQuoted = PY.flatMap((s) => [...s.matchAll(/"([a-z][A-Za-z]*\.[A-Za-z][A-Za-z0-9]*)"/g)].map((m) => m[1]));

// names the code asks for, which must exist
const asked = [
  ...SOURCES.flatMap(([, src]) => [...src.matchAll(/\b(?:tx|I18N\.t)\(\s*'([^'\n]*)'/g)].map((m) => m[1])),
  ...PAGES.flatMap(pageNames), ...pyCalled,
];
// any quoted name counts as used (a name can sit in a table and reach tx() through a variable)
const used = new Set([...asked, ...ALL.map((l) => l.text).filter((t) => NAME.test(t)), ...pyQuoted]);

test('no Arabic text in the browser code: only named data', () => {
  const loose = ALL.filter((l) => AR.test(l.text) && !NOT_TEXT.has(l.file + '|' + l.text));
  assert.deepStrictEqual(loose.map((l) => `${l.file}: ${l.raw.slice(0, 80)}`), []);
});

test('no Arabic text in the static pages: data-i18n names instead', () => {
  const bad = PAGES.flatMap((f) => [...markup(f).matchAll(/>([^<]*)<|\s[\w-]+="([^"]*)"/g)]
    .map((m) => m[1] ?? m[2]).filter((s) => AR.test(s)).map((s) => `${f}: ${s.trim().slice(0, 60)}`));
  assert.deepStrictEqual(bad, []);
});

test('a name is a literal: tx() and I18N.t() never get a built string', () => {
  const bad = SOURCES.flatMap(([, s]) => [...s.matchAll(/\b(?:tx|I18N\.t)\(\s*([^'\s)][^,)]*)/g)].map((m) => m[1]));
  assert.deepStrictEqual(bad, []);
});

test('every name asked for is in ar.json', () => {
  assert.deepStrictEqual([...new Set(asked)].filter((k) => !(k in SOURCE)), []);
});

test('every quoted name that looks like one of ours is in ar.json', () => {
  const like = [...used].filter((k) => NAME.test(k) && !/\.(py|js|json|html|css|svg|txt)$/.test(k) && AREAS.has(k.split('.')[0]) && !(k in SOURCE));
  assert.deepStrictEqual(like, []);
});

test('no name in ar.json is left unused', () => {
  assert.deepStrictEqual(Object.keys(SOURCE).filter((k) => !used.has(k)), []);
});

test('each language file has _meta { name, dir }', () => {
  for (const c of CODES) assert.ok(FILES[c]._meta && FILES[c]._meta.name && ['ltr', 'rtl'].includes(FILES[c]._meta.dir), c);
  assert.ok(CODES.includes('ar') && CODES.includes('en'));
});

const holes = (s) => [...new Set([...String(s).matchAll(/\{(\w+)(?:![a-z])?\}/g)].map((m) => m[1]))].sort().join(',');
const forms = (v) => (typeof v === 'object' ? Object.values(v) : [v]);
const other = (v) => (typeof v === 'object' ? v.other : v);
const within = (form, of) => holes(form).split(',').every((h) => !h || holes(of).split(',').includes(h));

for (const code of CODES) {
  const D = entries(FILES[code]);
  const ltr = FILES[code]._meta.dir === 'ltr';
  if (code !== 'ar') {
    test(`${code}: exactly the names in ar.json`, () => {
      assert.deepStrictEqual({ missing: Object.keys(SOURCE).filter((k) => !(k in D)), extra: Object.keys(D).filter((k) => !(k in SOURCE)) },
        { missing: [], extra: [] });
    });
  }
  test(`${code}: the same {values} as the Arabic (a plural form may leave out {n})`, () => {
    const bad = Object.entries(D).filter(([k, v]) => k in SOURCE
      && (holes(other(v)) !== holes(other(SOURCE[k])) || !forms(v).every((f) => within(f, other(SOURCE[k]))))).map(([k]) => k);
    assert.deepStrictEqual(bad, []);
  });
  test(`${code}: plain text (no dashes or curly quotes${ltr ? ', no Arabic letters' : ''}), plurals with one and other`, () => {
    const bad = Object.entries(D).filter(([, v]) => (typeof v === 'object' && !(v.one && v.other))
      || forms(v).some((f) => typeof f !== 'string' || !f.trim() || /[–—‘’“”]/.test(f) || (ltr && AR.test(f))))
      .map(([k]) => k);
    assert.deepStrictEqual(bad, []);
  });
}

test('en: each line is the right sentence (digits and names carry over from the Arabic)', () => {
  // catches a translation put against the wrong name, which the {values} check alone does not
  const D = entries(FILES.en);
  const marks = (s) => (String(s).match(/[0-9]+|[A-Za-z][A-Za-z.]*[A-Za-z]/g) || []);
  const bad = Object.entries(D).filter(([k, v]) => {
    const got = forms(v).join(' ');
    return marks(other(SOURCE[k]).replace(/\{\w+(?:![a-z])?\}/g, '')).some((w) => !got.includes(w));
  }).map(([k]) => k);
  assert.deepStrictEqual(bad, []);
});

test('Arabic plural forms', () => {
  const { tx } = load();
  assert.strictEqual(tx('app.pageCount', { n: 0 }), 'بلا صفحات');
  assert.strictEqual(tx('app.pageCount', { n: 2 }), 'صفحتان');
  assert.strictEqual(tx('app.pageCount', { n: 7 }), '7 صفحات');
  assert.strictEqual(tx('app.pageCount', { n: 12 }), '12 صفحة');
  assert.strictEqual(tx('editor.rowCount', { n: 1 }), '1 صف');
  assert.strictEqual(tx('editor.rowCount', { n: 15 }), '15 صفاً');
});

test('English: zero and plural forms, a message inside a message, direction', () => {
  const { tx, I18N: en } = load('en');
  assert.strictEqual(en.lang(), 'en');
  assert.strictEqual(tx('app.pageCount', { n: 0 }), 'No pages');
  assert.strictEqual(tx('app.pageCount', { n: 1 }), '1 page');
  assert.strictEqual(tx('app.pageCount', { n: 12 }), '12 pages');
  assert.strictEqual(en.message({ error: 'x', key: 'server.couldntDownloadExtraReaders',
    args: { error: { key: 'server.couldntReadEasyocr', args: { error: 'boom' } } } }),
  "Couldn't download the extra readers: Couldn't read with EasyOCR: boom");
  assert.strictEqual(en.languages()[0].code, 'ar');  // the source first
});

test('tx(): values, falling back to Arabic and then the name; message(); an unknown language', () => {
  const ctx = load('xx');
  ctx.I18N.add('xx', { _meta: { name: 'Test', dir: 'ltr' }, 'test.page': { one: '{n} page', other: '{n} pages' }, 'test.hello': 'Hello {name}' });
  assert.strictEqual(ctx.tx('test.page', { n: 1 }), '1 page');
  assert.strictEqual(ctx.tx('test.page', { n: 3 }), '3 pages');
  assert.strictEqual(ctx.tx('test.hello', { name: 'Eyas' }), 'Hello Eyas');
  assert.strictEqual(ctx.tx('ui.save'), SOURCE['ui.save']);  // not in xx: the Arabic
  assert.strictEqual(ctx.tx('no.suchName'), 'no.suchName');
  assert.strictEqual(ctx.I18N.message({ error: 'مرحباً x', key: 'test.hello', args: { name: 'x' } }), 'Hello x');
  assert.strictEqual(ctx.I18N.message({ detail: 'Not Found' }), 'Not Found');
  assert.strictEqual(ctx.I18N.message('Google Vision'), 'Google Vision');  // plain text stays as it is
  assert.strictEqual(load('zz').I18N.lang(), 'ar');  // no such file: Arabic
});

test('a name that says a side says the same side as its Arabic', () => {
  // alignRight / pictureLeft / rotate90Left...: right is يمين and left is يسار, so the English made from the name agrees
  // right is يمين or أيمن, left يسار or أيسر. A side at the end of the name (alignRight, rotate90LeftLabel) or at its start (rightBorder); not "right to left"
  const side = (k) => (k.match(/(Right|Left)(?:Label)?$/) || k.match(/\.(right|left)(?!Left|Right)[A-Z]/) || [])[1];
  const bad = Object.entries(SOURCE).filter(([k, v]) => {
    const s = side(k);
    return s && !JSON.stringify(v).includes(s.toLowerCase() === 'right' ? 'يم' : 'يس');
  }).map(([k]) => k);
  assert.deepStrictEqual(bad, []);
});

test('revive: a server message ({ key, args } only) becomes its text, nested too; other objects stay', () => {
  const { I18N: en } = load('en');
  const reply = JSON.parse(JSON.stringify({
    label: { key: 'reader.tesseractFast', args: {} },
    error: { key: 'server.couldntDownloadExtraReaders', args: { error: { key: 'server.couldntReadEasyocr', args: { error: 'x' } } } },
    engine: { id: 'claude', key: 'claude' },
    failed: { error: 'شيء', key: 'server.draftNotFound', args: {} },
  }), en.revive);
  assert.strictEqual(reply.label, 'Tesseract (fast)');
  assert.strictEqual(reply.error, "Couldn't download the extra readers: Couldn't read with EasyOCR: x");
  assert.deepStrictEqual(reply.engine, { id: 'claude', key: 'claude' });
  assert.strictEqual(en.message(reply.failed), 'Draft not found');
});
