"""PaddleOCR (free, runs on the server; optional install: pip install paddlepaddle paddleocr).

PaddleOCR changed its Python API between 2.x (ocr()) and 3.x (predict()); both are handled.
"""
from __future__ import annotations

import threading

from .common import EngineError, Line, fragments_to_lines

_ocr = None
_lock = threading.Lock()


def available() -> tuple[bool, str]:
    try:
        import paddleocr  # noqa: F401
    except Exception:
        return False, "PaddleOCR غير مثبت على الخادم (pip install paddlepaddle paddleocr)"
    return True, ""


_by_lang: dict = {}
RECOGNIZERS = {"ar": "arabic_PP-OCRv5_mobile_rec", "en": "en_PP-OCRv5_mobile_rec"}


def _get(lang: str = "ar"):
    global _ocr
    with _lock:
        if lang not in _by_lang:
            from paddleocr import PaddleOCR
            try:  # 3.x (tested: paddleocr 3.7, paddlepaddle 3.3 on CPU). Models are named on purpose:
                # lang="ar" alone picks a recognizer that returns blanks for Arabic, oneDNN fails on
                # paddlepaddle 3.3 (PIR attribute error), and without oneDNN the server detector needs > 5 GB.
                _by_lang[lang] = PaddleOCR(text_detection_model_name="PP-OCRv5_mobile_det",
                                           text_recognition_model_name=RECOGNIZERS[lang],
                                           use_doc_orientation_classify=False, use_doc_unwarping=False,
                                           use_textline_orientation=False, enable_mkldnn=False)
            except TypeError:  # 2.x
                _by_lang[lang] = PaddleOCR(lang="arabic" if lang == "ar" else "en", use_angle_cls=False, show_log=False)
        _ocr = _by_lang["ar"] if "ar" in _by_lang else _by_lang[lang]
        return _by_lang[lang]


def _fragments(result) -> list:
    frags = []
    for page in result or []:
        if page is None:
            continue
        # 3.x: dict-like result with rec_polys / rec_texts / rec_scores
        get = getattr(page, "get", None)
        if get and get("rec_texts") is not None:
            for poly, text, score in zip(get("rec_polys"), get("rec_texts"), get("rec_scores")):
                frags.append(([[float(p[0]), float(p[1])] for p in poly], text, float(score)))
            continue
        # 2.x: list of [box, (text, score)]
        for item in page:
            box, (text, score) = item[0], item[1]
            frags.append((box, text, float(score)))
    return frags


def run(img, lang: str = "ar") -> list[Line]:
    """lang "ar" (Arabic pages, with their English words) or "en" (English pages)."""
    ok, why = available()
    if not ok:
        raise EngineError(why)
    import numpy as np
    try:
        ocr = _get(lang)
        arr = np.array(img)[:, :, ::-1]  # RGB -> BGR
        result = ocr.predict(arr) if hasattr(ocr, "predict") else ocr.ocr(arr)
    except Exception as e:
        raise EngineError(f"تعذرت القراءة بـ PaddleOCR: {e}") from e
    return fragments_to_lines(_fragments(result))
