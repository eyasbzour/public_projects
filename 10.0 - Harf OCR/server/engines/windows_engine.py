"""Windows' own reader (Windows.Media.Ocr, the one in the Snipping Tool and PowerToys): free, offline, under a second
a page, with nothing to download where Windows has Arabic. It gives no confidence, so it flags no words.
It needs the pywinrt packages (desktop/requirements.txt) and Windows' Arabic text recognition."""
from __future__ import annotations

import asyncio
import sys
from concurrent.futures import ThreadPoolExecutor
from importlib.util import find_spec

from .common import EngineError, Line, fragments_to_lines
from .direction import ARABIC, LATIN
from messages import msg

# Small print reads far better enlarged: "السيد" and "تحية" came out "لسيد" and "حية" on a 1240x1754 letter, right
# at twice its size. Pages are scaled up to about this long side (Windows takes at most 10000 pixels a side).
LONG_SIDE = 4000
MAX_SCALE = 4
# its own thread, with its own event loop: the reader's calls are asynchronous, and the server's thread may have a loop
_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="winocr")


def _languages() -> list[str]:
    from winrt.windows.media.ocr import OcrEngine
    return [l.language_tag for l in OcrEngine.available_recognizer_languages]


def available() -> tuple[bool, str]:
    if sys.platform != "win32" or not find_spec("winrt.windows.media.ocr"):  # looked up, not imported
        return False, msg("server.windowsReaderNotHere")
    try:
        if not any(t.lower().startswith("ar") for t in _languages()):
            return False, msg("server.windowsReaderNeedsArabic")
    except Exception as e:  # noqa: BLE001 - an older Windows, or WinRT missing
        return False, msg("server.couldntReadWindows", error=e)
    return True, ""


async def _recognize(img, lang: str):
    from winrt.windows.globalization import Language
    from winrt.windows.graphics.imaging import BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap
    from winrt.windows.media.ocr import OcrEngine
    from PIL import Image
    r, g, b, a = img.convert("RGBA").split()
    data = Image.merge("RGBA", (b, g, r, a)).tobytes()  # Windows takes BGRA
    bmp = SoftwareBitmap.create_copy_from_buffer(data, BitmapPixelFormat.BGRA8, img.width, img.height,
                                                 BitmapAlphaMode.PREMULTIPLIED)
    tag = next((t for t in _languages() if t.lower().startswith(lang)), None)
    engine = OcrEngine.try_create_from_language(Language(tag)) if tag else None
    if engine is None:
        raise EngineError(msg("server.windowsReaderNeedsArabic"))
    return await engine.recognize_async(bmp)


def _words(img, lang: str, scale: float) -> list[Line]:
    try:
        res = _pool.submit(asyncio.run, _recognize(img, lang)).result()
    except EngineError:
        raise
    except Exception as e:  # noqa: BLE001
        raise EngineError(msg("server.couldntReadWindows", error=e)) from e
    frags = []
    for ln in res.lines:
        for w in ln.words:  # one box per word: its own place, which the style step (emphasis.py) measures
            b = w.bounding_rect
            x0, y0, x1, y1 = b.x / scale, b.y / scale, (b.x + b.width) / scale, (b.y + b.height) / scale
            frags.append(([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], w.text, 1.0))  # no confidence: never flagged
    return fragments_to_lines(frags)


def _latin(words) -> bool:
    t = " ".join(w.text for w in words)
    return len(LATIN.findall(t)) > len(ARABIC.findall(t))


def _rtl_order(words: list) -> list:
    """Right to left, as on an Arabic page, with each run of English words left to right inside it (one box a
    word: in place order, "the attached report" came out "report attached the")."""
    out, run = [], []
    for w in words + [None]:
        if w is not None and (LATIN.search(w.text) or (run and not ARABIC.search(w.text))):
            run.append(w)
            continue
        out += run[::-1]
        run = []
        if w is not None:
            out.append(w)
    return out


def run(img) -> list[Line]:
    """Arabic with its digits, and the English lines with Windows' English recognizer when Windows has it (the
    Arabic one turns "the attached report" into "attached_xepor.t"): an English page, or English on an Arabic one."""
    ok, why = available()
    if not ok:
        raise EngineError(why)
    from PIL import Image
    scale = min(MAX_SCALE, max(1.0, LONG_SIDE / max(img.size)))
    big = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS) if scale > 1 else img
    lines = _words(big, "ar", scale)
    english = [ln for ln in lines if _latin(ln.words)]
    if english and any(t.lower().startswith("en") for t in _languages()):
        en = [w for ln in _words(big, "en", scale) for w in ln.words]
        for ln in english:
            h = ln.y1 - ln.y0
            mine = [w for w in en if ln.y0 <= (w.box[1] + w.box[3]) / 2 <= ln.y1 and ln.x0 - h <= w.box[0] and w.box[2] <= ln.x1 + h]
            if mine:
                ln.words = sorted(mine, key=lambda w: -w.box[2])
    for ln in lines:
        ln.words = _rtl_order(ln.words)
    return lines
