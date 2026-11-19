"""Bulleted and numbered lists on the photo.

The readers rarely return the bullet itself (PaddleOCR skips it, Tesseract reads "•" as "»"), so list lines
ran together into one paragraph. A line is a list item when it starts with a bullet or a number token
("1." "١-" "(2)" "أ-"), or when the photo shows a small dot or dash at its start (the right end: pages read
right to left) set apart from the first letter: the bullet the reader skipped. Its indent alone is not
enough, a slightly tilted photo shifts line starts by as much.
"""
from __future__ import annotations

import re

import numpy as np
from PIL import Image

from .common import BULLETS, Line

NUMBERED = re.compile(r"^[(\[]?([0-9٠-٩]{1,2}|[أ-ي])[.\-)\]]$|^[.\-)]([0-9٠-٩]{1,2})$")
DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def _bullet_ink(ink: np.ndarray, ln: Line, h: float) -> bool:
    """A dot or dash at the line's start (its right end), apart from the first letter.

    PaddleOCR's box often includes the bullet it then leaves out of the text; Tesseract's may stop before
    it, so the look reaches a little past the box too. A letter's own dots sit above or below the letter,
    never a gap away from it.
    """
    import cv2

    x0, x1 = max(0, int(ln.x1 - 1.6 * h)), min(ink.shape[1], int(ln.x1 + 1.4 * h))
    y0, y1 = max(0, int(ln.y0)), min(ink.shape[0], int(ln.y1))
    if x1 <= x0 or y1 <= y0:
        return False
    n, _, stats, _ = cv2.connectedComponentsWithStats(ink[y0:y1, x0:x1].astype(np.uint8), connectivity=8)
    comps = sorted((s for s in stats[1:] if s[4] > 3), key=lambda s: -(s[0] + s[2]))  # rightmost first
    if len(comps) < 2:
        return False
    bx, by, bw, bh, area = comps[0]
    gap = bx - max(s[0] + s[2] for s in comps[1:])
    middle = (by + bh / 2) / (y1 - y0)
    dot = 0.12 * h <= bw <= 0.45 * h and 0.12 * h <= bh <= 0.45 * h and area >= 0.5 * bw * bh
    dash = 0.15 * h <= bw <= 0.6 * h and 0.03 * h <= bh <= 0.15 * h
    return (dot or dash) and gap >= 0.25 * h and 0.25 <= middle <= 0.8


def mark_list_items(lines: list[Line], img: Image.Image) -> list[Line]:
    """Sets line.extra["list"] to "li" or "ol" (and "num" for a number token) and drops the bullet or number
    word, which Word draws itself. Lines and their order are otherwise unchanged."""
    words_h = sorted(ln.y1 - ln.y0 for ln in lines if ln.words and ln.y1 > ln.y0)
    if not words_h:
        return lines
    h = words_h[len(words_h) // 2]
    ink = np.asarray(img.convert("L")) < 128
    for ln in lines:
        if not ln.words:
            continue
        first = ln.words[0].text
        m = NUMBERED.match(first.translate(DIGITS))
        if m and len(ln.words) > 1:
            ln.extra["list"] = "ol"
            token = m.group(1) or m.group(2)
            if token.isdigit():
                ln.extra["num"] = int(token)
            ln.words = ln.words[1:]
        elif (first in BULLETS or first[:1] in BULLETS) and (len(first) > 1 or len(ln.words) > 1):
            ln.extra["list"] = "li"
            rest = first[1:].strip() if first not in BULLETS else ""
            ln.words = ([type(ln.words[0])(rest, ln.words[0].conf, ln.words[0].box, ln.words[0].note)] if rest else []) + ln.words[1:]
        elif _bullet_ink(ink, ln, h):
            ln.extra["list"] = "li"
    return lines
