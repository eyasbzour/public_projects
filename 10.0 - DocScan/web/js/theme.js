// Light or dark, as chosen in Settings (ds.theme: "light", "dark", or none for the system's choice).
// Loaded in <head> so the page never draws in the wrong theme first; the system's choice is followed live.
(function () {
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  function pick() {
    var t = null;
    try { t = localStorage.getItem('ds.theme'); } catch (e) { /* storage blocked */ }
    return t === 'light' || t === 'dark' ? t : 'system';
  }
  function apply() {
    var t = pick();
    document.documentElement.setAttribute('data-theme', t === 'system' ? (media.matches ? 'dark' : 'light') : t);
  }
  apply();
  if (media.addEventListener) media.addEventListener('change', apply);
  window.DocTheme = {
    pick: pick,
    set: function (t) {
      try { if (t === 'light' || t === 'dark') localStorage.setItem('ds.theme', t); else localStorage.removeItem('ds.theme'); }
      catch (e) { /* storage blocked: it still applies until the page reloads */ }
      if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
      else apply();
    }
  };
})();
