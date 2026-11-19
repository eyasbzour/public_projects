/*
 * Image editor for one page photo: rotate (90° steps and fine straightening), crop, zoom,
 * brightness, contrast, grayscale. Produces a new JPEG; the caller keeps the original.
 *
 *   ImageEditor.open({ src, hasOriginal, onSave: async (blob, crop) => {}, onRestore: async () => {} })
 *   pick: true opens with the crop frame on, to cut out a part of the page (logo, chart) for the text;
 *   crop = { x, y, w, h } as shares of the (rotated) page.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const PREVIEW_MAX = 1400;   // preview works on a smaller copy for speed
  const MIN_CROP = 0.04;      // smallest crop, as a share of width/height

  let img = null, preview = null, opts = null;
  let st = null;              // { rot90, fine, bright, contrast, gray, crop: {x,y,w,h} (0..1), cropOn }
  let opened = '';            // st as it was on opening: anything else is an unsaved edit
  let rotated = null;         // preview-size rotated + filtered canvas
  let scale = 1;              // display px per rotated-canvas px
  let raf = 0;

  const fresh = () => ({ rot90: 0, fine: 0, bright: 100, contrast: 100, gray: false, crop: { x: 0, y: 0, w: 1, h: 1 }, cropOn: false });

  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }

  function downscaled(source, max) {
    const k = Math.min(1, max / Math.max(source.naturalWidth || source.width, source.naturalHeight || source.height));
    const c = document.createElement('canvas');
    c.width = Math.round((source.naturalWidth || source.width) * k);
    c.height = Math.round((source.naturalHeight || source.height) * k);
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  /** Rotate (with the canvas growing to fit) and apply colour filters. */
  function render(source, s) {
    const w = source.width, h = source.height;
    const a = ((s.rot90 + s.fine) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
    const W = Math.round(w * cos + h * sin), H = Math.round(w * sin + h * cos);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.filter = `brightness(${s.bright}%) contrast(${s.contrast}%)${s.gray ? ' grayscale(1)' : ''}`;
    ctx.translate(W / 2, H / 2); ctx.rotate(a); ctx.drawImage(source, -w / 2, -h / 2);
    return c;
  }

  function redraw() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      rotated = render(preview, st);
      const stage = $('ieStage');
      const fit = Math.min((stage.clientWidth - 32) / rotated.width, (stage.clientHeight - 32) / rotated.height, 1.5);
      scale = fit * ($('ieZoom').value / 100);
      const cv = $('ieCanvas');
      cv.width = Math.round(rotated.width * scale); cv.height = Math.round(rotated.height * scale);
      cv.getContext('2d').drawImage(rotated, 0, 0, cv.width, cv.height);
      placeCrop();
    });
  }

  function placeCrop() {
    const box = $('ieCropBox'), cv = $('ieCanvas');
    box.classList.toggle('hidden', !st.cropOn);
    $('ieCrop').setAttribute('aria-pressed', String(st.cropOn));
    if (!st.cropOn) return;
    const c = st.crop;
    Object.assign(box.style, { left: c.x * cv.width + 'px', top: c.y * cv.height + 'px', width: c.w * cv.width + 'px', height: c.h * cv.height + 'px' });
  }

  // ---- crop dragging (pointer events work for mouse, pen and touch)
  let drag = null;
  function onPointerDown(e) {
    if (!st.cropOn) return;
    e.preventDefault();
    drag = { handle: e.target.dataset.h || 'move', x: e.clientX, y: e.clientY, start: { ...st.crop } };
    $('ieCropBox').setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (!drag) return;
    const cv = $('ieCanvas');
    const dx = (e.clientX - drag.x) / cv.width, dy = (e.clientY - drag.y) / cv.height;
    let { x, y, w, h } = drag.start;
    const hd = drag.handle;
    if (hd === 'move') { x += dx; y += dy; }
    if (hd.includes('w')) { x += dx; w -= dx; }
    if (hd.includes('e')) { w += dx; }
    if (hd.includes('n')) { y += dy; h -= dy; }
    if (hd.includes('s')) { h += dy; }
    if (w < MIN_CROP) { if (hd.includes('w')) x -= MIN_CROP - w; w = MIN_CROP; }
    if (h < MIN_CROP) { if (hd.includes('n')) y -= MIN_CROP - h; h = MIN_CROP; }
    x = Math.max(0, Math.min(x, 1 - w)); y = Math.max(0, Math.min(y, 1 - h));
    w = Math.min(w, 1 - x); h = Math.min(h, 1 - y);
    st.crop = { x, y, w, h }; placeCrop();
  }
  function onPointerUp() { drag = null; }

  function resetCrop() { st.crop = { x: 0.03, y: 0.03, w: 0.94, h: 0.94 }; }

  function syncControls() {
    $('ieFine').value = st.fine; $('ieFineVal').textContent = st.fine + '°';
    $('ieBright').value = st.bright; $('ieContrast').value = st.contrast; $('ieGray').checked = st.gray;
  }

  async function save() {
    const btn = $('ieSave'); btn.disabled = true;
    try {
      const full = render(downscaled(img, 3200), st);
      const c = st.cropOn ? st.crop : { x: 0, y: 0, w: 1, h: 1 };
      const sx = Math.round(c.x * full.width), sy = Math.round(c.y * full.height);
      const sw = Math.max(1, Math.round(c.w * full.width)), sh = Math.max(1, Math.round(c.h * full.height));
      const out = document.createElement('canvas'); out.width = sw; out.height = sh;
      out.getContext('2d').drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.92));
      await opts.onSave(blob, c);
      $('dlgImage').close();
    } catch (e) {
      await window.appAsk('تعذر حفظ الصورة: ' + (e && e.message ? e.message : e), { ok: 'حسناً', cancel: false });
    } finally { btn.disabled = false; }
  }

  let bound = false;
  function bind() {
    if (bound) return; bound = true;
    const rerotate = () => { if (st.cropOn) resetCrop(); redraw(); };
    $('ieRotL').onclick = () => { st.rot90 = (st.rot90 + 270) % 360; rerotate(); };
    $('ieRotR').onclick = () => { st.rot90 = (st.rot90 + 90) % 360; rerotate(); };
    $('ieFine').oninput = () => { st.fine = +$('ieFine').value; $('ieFineVal').textContent = st.fine + '°'; rerotate(); };
    $('ieBright').oninput = () => { st.bright = +$('ieBright').value; redraw(); };
    $('ieContrast').oninput = () => { st.contrast = +$('ieContrast').value; redraw(); };
    $('ieGray').onchange = () => { st.gray = $('ieGray').checked; redraw(); };
    $('ieZoom').oninput = redraw;
    $('ieCrop').onclick = () => { st.cropOn = !st.cropOn; if (st.cropOn) resetCrop(); placeCrop(); };
    $('ieReset').onclick = () => { st = fresh(); $('ieZoom').value = 100; syncControls(); redraw(); };
    $('ieCancel').onclick = () => $('dlgImage').close();
    // A click on the dimmed area outside the editor closes it, and so does Esc; with unsaved edits
    // they ask first. The press has to start outside too, so a crop drag that ends outside is not a close.
    const dlg = $('dlgImage');
    const outside = (e) => { const r = dlg.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
    const leave = async () => {
      if (opts.pick || JSON.stringify(st) === opened ||
          await window.appAsk('إغلاق محرر الصورة وتجاهل التعديلات؟', { ok: 'تجاهل التعديلات', danger: true })) dlg.close();
    };
    let pressedOutside = false;
    dlg.addEventListener('pointerdown', (e) => { pressedOutside = outside(e); });
    dlg.addEventListener('click', (e) => { if (pressedOutside && outside(e)) leave(); pressedOutside = false; });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); leave(); });  // Esc
    $('ieSave').onclick = save;
    $('ieRestore').onclick = async () => {
      if (!opts.onRestore || !(await window.appAsk('استعادة الصورة الأصلية كما رُفعت؟ يضيع تحرير هذه الصورة.', { ok: 'استعادة', danger: true }))) return;
      await opts.onRestore(); $('dlgImage').close();
    };
    const box = $('ieCropBox');
    box.addEventListener('pointerdown', onPointerDown);
    box.addEventListener('pointermove', onPointerMove);
    box.addEventListener('pointerup', onPointerUp);
    box.addEventListener('pointercancel', onPointerUp);
    $('ieStage').addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const z = $('ieZoom'); z.value = Math.max(+z.min, Math.min(+z.max, +z.value - Math.sign(e.deltaY) * 10)); redraw();
    }, { passive: false });
    window.addEventListener('resize', () => { if ($('dlgImage').open) redraw(); });
  }

  async function open(o) {
    opts = o; bind();
    st = fresh();
    if (o.rotation) st.rot90 = ((o.rotation % 360) + 360) % 360;
    $('ieZoom').value = 100; syncControls();
    $('ieRestore').classList.toggle('hidden', !o.hasOriginal || !!o.pick);
    if (o.pick) { st.cropOn = true; resetCrop(); }
    opened = JSON.stringify(st);
    $('ieSave').querySelector('span').textContent = o.pick ? 'إدراج في النص' : 'حفظ الصورة';
    $('dlgImage').setAttribute('aria-label', o.pick ? 'إدراج صورة من الصفحة' : 'تحرير الصورة');
    const hint = document.querySelector('.img-ed-hint');
    hint.dataset.edit = hint.dataset.edit || hint.textContent;
    hint.textContent = o.pick ? 'حرّك إطار القص حول الجزء المطلوب (شعار، رسم بياني، توقيع) ثم اضغط "إدراج في النص". يُدرج بعد الفقرة التي كنت فيها.' : hint.dataset.edit;
    $('dlgImage').showModal();
    const cv = $('ieCanvas'); cv.width = cv.height = 1;
    img = await loadImage(o.src);
    preview = downscaled(img, PREVIEW_MAX);
    redraw();
  }

  window.ImageEditor = { open, _render: render };
})();
