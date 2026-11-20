"""Nuqta Arabic OCR 0.8B (free, Apache-2.0, runs on the server's CPU; optional install: transformers, accelerate).

A small vision-language model trained on Arabic documents. Measured on the test letter on a CPU: the number line
("الرقم: م ض / 245 / 2026 التاريخ: 10/11/2026") and printed lines exactly right in 3-5 s each, and a handwritten
margin note partly right where PaddleOCR returned garbage. PaddleOCR-VL, the other candidate, ran out of memory
at 7.6 GB. Too slow to be the default for whole pages (about a minute a page), so it serves two ways:
- a second opinion on spots (a flagged word, a paragraph): read_crop(), a few seconds each;
- a whole page: PaddleOCR finds the text lines (their boxes keep the layout steps working), Nuqta reads each.
Confidence comes from the model's own token probabilities, so unsure words are flagged like any engine's.
"""
from __future__ import annotations

import math
import os
import threading
from importlib.util import find_spec

from .common import EngineError, Line, Word, fragments_to_lines

REPO = os.environ.get("NUQTA_MODEL", "SalahALHaismawi/Nuqta-Arabic-OCR-0.8B")
PROMPT = "Transcribe the Arabic text in this image exactly as written. Include only the diacritics (tashkeel) that are visible in the image."
_model = None
_lock = threading.Lock()


def available() -> tuple[bool, str]:
    if not (find_spec("torch") and find_spec("transformers")):  # looked up, not imported: listing the readers stays instant
        return False, "Nuqta غير مثبت على الخادم (pip install transformers accelerate)"
    return True, ""


def _get():
    global _model
    with _lock:
        if _model is None:
            import torch
            from transformers import AutoModelForImageTextToText, AutoProcessor

            torch.set_num_threads(max(1, (os.cpu_count() or 2) - 1))
            processor = AutoProcessor.from_pretrained(REPO)
            model = AutoModelForImageTextToText.from_pretrained(REPO, dtype=torch.float32)
            model.eval()
            _model = (processor, model)
        return _model


def read_crop(img, max_new_tokens: int = 400) -> list[tuple[str, float]]:
    """The words in a cut-out image, each with a confidence 0-100 (its least sure token)."""
    import torch

    processor, model = _get()
    w, h = img.size
    if w * h > 2_400_000:  # the model's training size
        k = (2_400_000 / (w * h)) ** 0.5
        img = img.resize((max(32, int(w * k)), max(32, int(h * k))))
    messages = [{"role": "user", "content": [{"type": "image", "image": img.convert("RGB")}, {"type": "text", "text": PROMPT}]}]
    inputs = processor.apply_chat_template(messages, add_generation_prompt=True, tokenize=True, return_dict=True,
                                           return_tensors="pt", enable_thinking=False)
    with _lock, torch.inference_mode():  # one reading at a time: the model is big and uses every core
        out = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False, output_scores=True,
                             return_dict_in_generate=True)
    tokens = out.sequences[0, inputs["input_ids"].shape[1]:]
    words: list[tuple[str, float]] = []
    text, low = "", 1.0
    for score, tok in zip(out.scores, tokens):
        piece = processor.tokenizer.decode([int(tok)], skip_special_tokens=True)
        p = float(torch.softmax(score[0].float(), -1)[int(tok)])
        for ch in piece:
            if ch.isspace():
                if text:
                    words.append((text, 100 * low)); text, low = "", 1.0
            else:
                text += ch
        if piece.strip():
            low = min(low, p)
    if text:
        words.append((text, 100 * low))
    return [(t, round(c, 1)) for t, c in words if not math.isnan(c)]


def run(img, spot: bool = False) -> list[Line]:
    ok, why = available()
    if not ok:
        raise EngineError(why)
    try:
        if spot:  # a cut-out: read it whole, as one line
            words = read_crop(img)
            return [Line([Word(t, c, (0, 0, img.width, img.height)) for t, c in words], 0, 0, img.width, img.height)] if words else []
        from . import paddle_engine  # the text lines' places on the page

        if not paddle_engine.available()[0]:
            raise EngineError("قراءة صفحة كاملة بـ Nuqta تحتاج PaddleOCR لتحديد أسطر النص")
        import numpy as np

        frags = paddle_engine._fragments(paddle_engine._get().predict(np.array(img.convert("RGB"))[:, :, ::-1]))
        out = []
        for poly, _, _ in frags:
            xs, ys = [p[0] for p in poly], [p[1] for p in poly]
            pad = 0.15 * (max(ys) - min(ys))
            crop = img.crop((max(0, min(xs) - 2 * pad), max(0, min(ys) - pad), min(img.width, max(xs) + 2 * pad), min(img.height, max(ys) + pad)))
            words = read_crop(crop, max_new_tokens=160)
            if words:
                out.append((poly, words, None))
        return fragments_to_lines(out)
    except EngineError:
        raise
    except Exception as e:
        raise EngineError(f"تعذرت القراءة بـ Nuqta: {e}") from e
