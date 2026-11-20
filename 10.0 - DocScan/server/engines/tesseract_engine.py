"""Tesseract (free, runs on the server). Three model choices: fast / standard / best."""
from __future__ import annotations

import os
import shutil
import subprocess
from functools import lru_cache

from .common import EngineError, Line, Word, drop_junk

# Model folders (see README for the downloads). Linux packages usually ship the "fast" models,
# so each choice points at its own folder. If a folder is missing, that choice shows as unavailable;
# "fast" falls back to the system models.
MODEL_DIRS = {
    "fast": os.environ.get("TESSDATA_FAST", "/opt/tessdata/fast"),
    "standard": os.environ.get("TESSDATA_STANDARD", "/opt/tessdata/standard"),
    "best": os.environ.get("TESSDATA_BEST", "/opt/tessdata/best"),
}
LANGS = os.environ.get("TESSERACT_LANGS", "ara+eng")


@lru_cache(maxsize=None)
def _langs_in(dir_: str) -> frozenset:
    if not shutil.which("tesseract"):
        return frozenset()
    if dir_:  # a model folder: its languages are its files, no need to start tesseract for them
        try:
            return frozenset(f[:-len(".traineddata")] for f in os.listdir(dir_) if f.endswith(".traineddata"))
        except OSError:
            return frozenset()
    cmd = ["tesseract", "--list-langs"] + (["--tessdata-dir", dir_] if dir_ else [])
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout
    except Exception:
        return frozenset()
    return frozenset(l.strip() for l in out.splitlines()[1:] if l.strip())


def _dir(model: str) -> str:
    dir_ = MODEL_DIRS.get(model, "")
    if model == "fast" and dir_ and not os.path.isdir(dir_):
        return ""  # system models
    return dir_


def available(model: str, langs: str = LANGS) -> tuple[bool, str]:
    if not shutil.which("tesseract"):
        return False, "Tesseract غير مثبت على الخادم"
    dir_ = _dir(model)
    if dir_ and not os.path.isdir(dir_):
        return False, f"ملفات النموذج غير موجودة على الخادم: {dir_}"
    need = set(langs.split("+"))
    have = _langs_in(dir_)
    if not need <= have:
        return False, "اللغة العربية غير مثبتة لهذا النموذج: " + ", ".join(sorted(need - have))
    return True, ""


def run(img, model: str, langs: str | None = None, spot: bool = False) -> list[Line]:
    langs = langs if langs in ("ara", "ara+eng") else LANGS
    ok, why = available(model, langs)
    if not ok:
        raise EngineError(why)
    dir_ = _dir(model)
    if spot:  # a cut-out of one word or line: mode 7 ("one text line") reads it far better than the page modes
        one = _read(img, langs, dir_, 7)
        block = _read(img, langs, dir_, 6)
        return block if _confident_chars(block) > 1.5 * _confident_chars(one) else one
    # Page layout mode 3 (automatic) keeps columns and blocks apart, but on some pages it finds almost
    # no text (a report page with a handwritten note: 4 words, where mode 6, "one block of text",
    # read 40). Read with both and keep mode 6 only when it reads clearly more confident text.
    best = _read(img, langs, dir_, 3)
    alt = _read(img, langs, dir_, 6)
    return alt if _confident_chars(alt) > 1.5 * _confident_chars(best) else best


def _confident_chars(lines: list[Line]) -> int:
    return sum(len(w.text) for ln in lines for w in ln.words if w.conf >= 60)


def _read(img, langs: str, dir_: str, psm: int) -> list[Line]:
    import pytesseract

    config = f"--oem 1 --psm {psm} -c preserve_interword_spaces=1"
    if dir_:
        config += f' --tessdata-dir "{dir_}"'
    try:
        d = pytesseract.image_to_data(img, lang=langs, config=config, output_type=pytesseract.Output.DICT, timeout=180)
    except RuntimeError as e:  # timeout
        raise EngineError("انتهت مهلة القراءة بـ Tesseract") from e

    lines: dict = {}
    order = []
    last_par = None
    for i in range(len(d["text"])):
        if d["level"][i] != 5:  # words only
            continue
        text = d["text"][i]
        conf = float(d["conf"][i])
        if not text.strip() or conf < 0:
            continue
        key = (d["block_num"][i], d["par_num"][i], d["line_num"][i])
        x, y, w, h = d["left"][i], d["top"][i], d["width"][i], d["height"][i]
        if key not in lines:
            par = key[:2]
            lines[key] = Line([], x, y, x + w, y + h, new_para=(par != last_par))
            last_par = par
            order.append(key)
        ln = lines[key]
        ln.words.append(Word(text, conf, (x, y, x + w, y + h)))
        ln.x0, ln.y0 = min(ln.x0, x), min(ln.y0, y)
        ln.x1, ln.y1 = max(ln.x1, x + w), max(ln.y1, y + h)

    out = []
    for k in order:
        ln = lines[k]
        ln.words = drop_junk(ln.words)
        out.append(ln)
    return out
