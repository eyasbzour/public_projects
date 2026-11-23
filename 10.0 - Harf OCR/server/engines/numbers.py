"""A second opinion on numbers for PaddleOCR.

PaddleOCR's Arabic model drops Western digits inside Arabic lines ("م ض / 245 / 2026" came out as "م ض4/")
at high confidence, so nothing was flagged; Tesseract keeps them (measured on the test pages: 18 of 34
numbers against 30). Reference numbers and dates matter most in these letters, so after PaddleOCR reads a
page, Tesseract reads it too, and the numbers Tesseract finds in a line and PaddleOCR lacks are put
into PaddleOCR's line, flagged for the reviewer.
"""
from __future__ import annotations

import re
from collections import Counter

from .common import DIGITS, Line, Word
from messages import doc

NUM = re.compile(r"\d+")
NUMBERISH = re.compile(r"[\d\u0660-\u0669/\\.:,\u060c-]+")  # digits and what stands between them ("12 / 2026", "1/12/2026")
NOTE = doc("doc.numberTesseractReadPaddleocrMissed")


def numbers(text: str) -> Counter:
    return Counter(NUM.findall(text.translate(DIGITS)))


def check_numbers(lines: list[Line], second: list[Line], scale: float, grids=()) -> list[Line]:
    """lines: PaddleOCR's; second: Tesseract's lines of the same page, whose boxes are `scale` times larger.
    Returns the lines, with the numbers a line misses put in from Tesseract's reading of the same place.
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
        out.append(Line(_splice(ln.words, sorted(here, key=lambda w: -w.box[2]), missing, h), ln.x0, ln.y0, ln.x1, ln.y1, ln.new_para, ln.extra))
    return out


def _splice(mine: list[Word], theirs: list[Word], missing: Counter, h: float) -> list[Word]:
    """PaddleOCR's words, with Tesseract's numbers put in where they stand. Only the numbers: Tesseract's Arabic
    words are the weaker reading ("صباحاً" came out as "Coal dala"). A run such as "12 / 2026" goes in whole; the
    digits PaddleOCR left at that spot ("ض4/", "2") are taken out of its words."""
    runs, run = [], []
    for w in theirs + [None]:  # right to left
        if w is not None and (NUMBERISH.fullmatch(w.text) or numbers(w.text) & missing):
            run.append(Word(w.text, w.conf, w.box, NOTE if numbers(w.text) & missing else None))
            continue
        if any(x.note for x in run):
            runs.append(run)
        run = []
    # where each of PaddleOCR's words stands: the words of one piece share its box, so it is split by their length
    at, i = [], 0
    while i < len(mine):
        j = i
        while j < len(mine) and mine[j].box == mine[i].box:
            j += 1
        if mine[i].box is None:
            at += [0.0] * (j - i)
        else:
            x0, x1 = mine[i].box[0], mine[i].box[2]
            n = sum(len(w.text) + 1 for w in mine[i:j])
            done = 0
            for w in mine[i:j]:
                at.append(x1 - (x1 - x0) * (done + len(w.text) / 2) / n)
                done += len(w.text) + 1
        i = j
    placed = list(zip(at, mine))
    for run in runs:
        lo, hi = min(w.box[0] for w in run) - h, max(w.box[2] for w in run) + h
        kept = []
        for x, w in placed:
            if lo <= x <= hi and isinstance(w, Word) and NUM.search(w.text.translate(DIGITS)):
                rest = NUMBERISH.sub("", w.text)
                if not rest:
                    continue
                w = Word(rest, w.conf, w.box, w.note)
            kept.append((x, w))
        placed = kept + [((run[0].box[2] + run[-1].box[0]) / 2, run)]
    out = []
    for _, w in sorted(placed, key=lambda p: -p[0]):
        out += w if isinstance(w, list) else [w]
    return out
