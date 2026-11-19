"""Bold lines, from the photo: a bold line carries about one and a half times the ink of a plain one.

Measured on the test pages as dark pixels per inked column: plain lines 4.9-6.5, the bold subject 9.5 and
the bold "التوصيات" 8.3. A short line used to become a heading just for being short, so greetings and
closings ("تحية طيبة وبعد،", "Dear Director,") came out as bold headings; now a short line is a heading
when it is bold or centred (lines_to_blocks).
"""
from __future__ import annotations

import statistics

import numpy as np
from PIL import Image

from .common import Line

BOLD = 1.35  # times the page's typical ink per column


def mark_bold(lines: list[Line], img: Image.Image) -> list[Line]:
    """Sets line.extra["bold"] on lines that are clearly heavier than the page's typical line."""
    dark = np.asarray(img.convert("L")) < 128
    weights = {}
    for ln in lines:
        b = dark[max(0, int(ln.y0)):int(ln.y1), max(0, int(ln.x0)):int(ln.x1)]
        cols = int(b.any(axis=0).sum())
        if cols > 10:
            weights[id(ln)] = b.sum() / cols
    if len(weights) < 3:
        return lines
    typical = statistics.median(weights.values())
    for ln in lines:
        if weights.get(id(ln), 0) > BOLD * typical:
            ln.extra["bold"] = True
    return lines
