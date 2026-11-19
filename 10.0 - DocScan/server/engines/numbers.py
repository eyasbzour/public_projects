"""A second opinion on numbers for PaddleOCR.

PaddleOCR's Arabic model drops Western digits inside Arabic lines ("م ض / 245 / 2026" came out as "م ض4/")
at high confidence, so nothing was flagged; Tesseract keeps them (measured on the test pages: 18 of 34
numbers against 30). Reference numbers and dates matter most in these letters, so after PaddleOCR reads a
page, Tesseract reads it too, and a line where Tesseract finds numbers PaddleOCR lacks is taken from
Tesseract's reading, with those numbers flagged for the reviewer.
"""
from __future__ import annotations

import re
from collections import Counter

from .common import Line, Word

DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
NUM = re.compile(r"\d+")
NOTE = "رقم قرأه Tesseract ولم يظهر في قراءة PaddleOCR، تحقق منه في الصورة"


def numbers(text: str) -> Counter:
    return Counter(NUM.findall(text.translate(DIGITS)))


def check_numbers(lines: list[Line], second: list[Line], scale: float, grids=()) -> list[Line]:
    """lines: PaddleOCR's; second: Tesseract's lines of the same page, whose boxes are `scale` times larger.
    Returns the lines, with those that miss numbers replaced by Tesseract's words for the same place.
    Ruled tables (grids) are left alone: there PaddleOCR reads each cell as its own box and keeps its digits,
    and Tesseract's reading of a table row was the weaker one (20 of 20 cells fell to 18)."""
    words = [Word(w.text, w.conf, tuple(v / scale for v in w.box)) for ln in second for w in ln.words if w.box]
    in_table = lambda ln: any(g.xs[0] <= (ln.x0 + ln.x1) / 2 <= g.xs[-1] and g.ys[0] <= (ln.y0 + ln.y1) / 2 <= g.ys[-1] for g in grids)  # noqa: E731
    out = []
    for ln in lines:
        if in_table(ln):
            out.append(ln)
            continue
        h = ln.y1 - ln.y0
        here = [w for w in words if ln.y0 <= (w.box[1] + w.box[3]) / 2 <= ln.y1 and w.box[0] >= ln.x0 - h and w.box[2] <= ln.x1 + h]
        missing = numbers(" ".join(w.text for w in here)) - numbers(" ".join(w.text for w in ln.words))
        if not missing or not here:
            out.append(ln)
            continue
        new = []
        for w in sorted(here, key=lambda w: -w.box[2]):  # right to left, as the line reads
            if numbers(w.text) & missing:
                w = Word(w.text, w.conf, w.box, note=NOTE)
            new.append(w)
        out.append(Line(new, ln.x0, ln.y0, ln.x1, ln.y1, ln.new_para, ln.extra))
    return out
