"""EasyOCR (free, runs on the server; optional install: pip install easyocr)."""
from __future__ import annotations

import os
import threading
from importlib.util import find_spec

from .common import EngineError, Line, fragments_to_lines

_reader = None
_lock = threading.Lock()


def available() -> tuple[bool, str]:
    if not find_spec("easyocr"):  # looked up, not imported: listing the readers stays instant (it brings torch)
        return False, "EasyOCR غير مثبت على الخادم (pip install easyocr)"
    return True, ""


def _get_reader():
    global _reader
    with _lock:
        if _reader is None:
            import easyocr
            model_dir = os.environ.get("EASYOCR_MODELS") or None
            _reader = easyocr.Reader(["ar", "en"], gpu=os.environ.get("EASYOCR_GPU") == "1",
                                     model_storage_directory=model_dir,
                                     download_enabled=os.environ.get("EASYOCR_DOWNLOAD", "1") == "1")
        return _reader


def run(img) -> list[Line]:
    ok, why = available()
    if not ok:
        raise EngineError(why)
    import numpy as np
    try:
        reader = _get_reader()
        res = reader.readtext(np.array(img), detail=1, paragraph=False)
    except Exception as e:
        raise EngineError(f"تعذرت القراءة بـ EasyOCR: {e}") from e
    frags = [(box, text, float(conf)) for box, text, conf in res]
    return fragments_to_lines(frags)
