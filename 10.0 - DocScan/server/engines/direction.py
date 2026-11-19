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
    keep their own order), but a run of Arabic words right to left inside that: "Total: ثلاثة كشوف 517" kept
    the order of its letters, and sorting by place had turned its Arabic words around."""
    for ln in lines:
        if ln.words and all(w.box for w in ln.words):
            ln.words.sort(key=lambda w: w.box[0])
            ln.words = arabic_runs_rtl(ln.words)
    return lines


def arabic_runs_rtl(words: list[Word]) -> list[Word]:
    """Words in left-to-right place order, with each run of Arabic text boxes turned to right-to-left order. The
    words of one text box stay together and in order; numbers and signs between two Arabic boxes join their run."""
    units: list[list[Word]] = []
    for w in words:
        if units and units[-1][0].box == w.box:
            units[-1].append(w)
        else:
            units.append([w])

    def kind(u):
        t = " ".join(w.text for w in u)
        ar, la = len(ARABIC.findall(t)), len(LATIN.findall(t))
        return "ar" if ar > la else ("en" if la else "")

    out: list[Word] = []
    run: list[list[Word]] = []
    between: list[list[Word]] = []  # numbers and signs after the run so far: in it if more Arabic follows
    for u in units + [None]:
        k = kind(u) if u else "en"
        if k == "ar":
            run += between + [u]
            between = []
        elif not k and run:
            between.append(u)
        else:
            for r in reversed(run):
                out += r
            for r in between + ([u] if u else []):
                out += r
            run, between = [], []
    return out


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
