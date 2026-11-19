"""English (left-to-right) pages.

The layout steps were written for right-to-left pages: a line's words are taken right to left, table columns
are numbered from the right, "start" is the right side, a bullet sits at a line's right end. Rather than a
second copy of each step, a left-to-right page is mirrored (x -> page width - x) before them and mirrored
back after, so the same tested code serves both; its blocks get dir "ltr", which the editor and Word follow.
"""
from __future__ import annotations

import re

from PIL import Image, ImageOps

from .common import Line, Word

LATIN = re.compile(r"[A-Za-z]")
ARABIC = re.compile(r"[؀-ۿ]")


def is_ltr(lines: list[Line]) -> bool:
    """Mostly Latin letters: an English page."""
    text = " ".join(w.text for ln in lines for w in ln.words)
    latin, arabic = len(LATIN.findall(text)), len(ARABIC.findall(text))
    return latin >= 20 and latin > 1.5 * arabic


def in_reading_order(lines: list[Line]) -> list[Line]:
    """Words of each line left to right (box engines list them right to left; the words inside one text box
    keep their own order)."""
    for ln in lines:
        if ln.words and all(w.box for w in ln.words):
            ln.words.sort(key=lambda w: w.box[0])
    return lines


def mirror_lines(lines: list[Line], width: float) -> list[Line]:
    flip = lambda b: (width - b[2], b[1], width - b[0], b[3])  # noqa: E731
    return [Line([Word(w.text, w.conf, flip(w.box) if w.box else None, w.note) for w in ln.words],
                 width - ln.x1, ln.y0, width - ln.x0, ln.y1, ln.new_para, dict(ln.extra)) for ln in lines]


def mirror_grids(grids: list, width: float) -> list:
    from .tables import Grid

    return [Grid(sorted(width - x for x in g.xs), list(g.ys)) for g in grids]


def mirror_image(img: Image.Image) -> Image.Image:
    return ImageOps.mirror(img)


def unmirror_blocks(blocks: list[dict]) -> list[dict]:
    """Boxes (fractions) back to the real page, and every block marked left to right."""
    def fix(box):
        return [round(1 - box[2], 4), box[1], round(1 - box[0], 4), box[3]]

    def segs(ss):
        for sg in ss or []:
            if sg.get("box"):
                sg["box"] = fix(sg["box"])

    for b in blocks:
        b["dir"] = "ltr"
        if b.get("box"):
            b["box"] = fix(b["box"])
        if b.get("lines"):
            b["lines"] = [fix(ln[:4]) + ln[4:] for ln in b["lines"]]
        segs(b.get("segs"))
        for row in b.get("cellBoxes") or []:
            row[:] = [fix(c) if c else c for c in row]
        for row in b.get("rows") or []:
            for cell in row:
                segs(cell)
    return blocks
