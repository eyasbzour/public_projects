"""How the text is printed, from the photo: bold lines, and bold, italic, underlined and coloured words.

Bold lines: a bold line carries about one and a half times the ink of a plain one. Measured on the test pages as
dark pixels per inked column: plain lines 4.9-6.5, the bold subject 9.5 and the bold "التوصيات" 8.3. A short line
used to become a heading just for being short, so greetings and closings ("تحية طيبة وبعد،", "Dear Director,") came
out as bold headings; now a short line is a heading when it is bold or centred (lines_to_blocks).

Words (mark_styles) get Word.fmt, which words_to_segs carries to the editor and the export:
- underline: a thin rule under the words that does not run on past them (a rule across the page is a divider, and
  a rule with nothing printed above it is a line to fill in);
- bold: strokes clearly thicker than the page's usual ones (twice the ink over its outline);
- italic: letters leaning away from the page's usual lean;
- colour (c) and highlight (bg), from the photo in colour: ink clearly coloured where the print is black, and paper
  clearly tinted behind a word. Blue, red and purple ink has left the text before this as a pen or a stamp
  (marks.py); dark navy or maroon print, and green or orange, stay and keep their colour.
Size is left to the template: the document's text size is the user's setting, and a larger line becomes a heading.
A reader that boxes a run of words (PaddleOCR) gives one box for all of them; each word's place is then split by its
length (word_spans) and moved to the nearest gap in the ink.
"""
from __future__ import annotations

import math
import statistics

import numpy as np
from PIL import Image

from .common import Line, otsu_threshold, word_spans

BOLD = 1.35  # a bold line: times the page's typical ink per column
WORD_BOLD = 1.3  # a bold word: times the page's usual stroke width
ITALIC = (9, 18)  # degrees an italic word leans, past the page's usual lean (synthetic italics lean about 12)
SLANTS = range(-21, 22, 3)


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


def _runs(row: np.ndarray, min_len: float) -> list[tuple[int, int]]:
    """Runs of True at least min_len long, as (start, end) with end exclusive."""
    d = np.diff(np.concatenate(([0], row.astype(np.int8), [0])))
    return [(a, b) for a, b in zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)) if b - a >= min_len]


def _close(a: np.ndarray, k: int = 2) -> np.ndarray:
    """Fills gaps of up to 2k pixels along each row, so a rule broken by noise reads as one."""
    d = a.copy()
    for s in range(1, k + 1):
        d[:, s:] |= a[:, :-s]
        d[:, :-s] |= a[:, s:]
    e = d.copy()
    for s in range(1, k + 1):
        e[:, s:] &= d[:, :-s]
        e[:, :-s] &= d[:, s:]
    return e | a


def _rules(ln: Line, dark: np.ndarray, h: float) -> list[tuple[str, float, float, int, int]]:
    """Underlines on a line: ("u", x0, x1, top row, bottom row) on the page. (Strikethrough is not looked for: through
    Arabic letters it could not be told from them reliably enough.)"""
    H, W = dark.shape
    r0, r1 = max(0, int(ln.y0)), min(H, int(ln.y1 + 0.35 * h) + 1)
    c0, c1 = max(0, int(ln.x0 - h)), min(W, int(ln.x1 + h) + 1)
    sub = dark[r0:r1, c0:c1]
    if sub.shape[0] < 4 or sub.shape[1] < 4:
        return []
    closed = _close(sub)
    long = max(1.2 * h, 20)
    bands: list[list] = []  # [top, bottom, a, b] of rows that carry one long run each
    for y in range(sub.shape[0]):
        for a, b in _runs(closed[y], long):
            for band in bands:
                if band[1] == y - 1 and min(b, band[3]) - max(a, band[2]) >= 0.6 * (b - a):
                    band[1], band[2], band[3] = y, min(a, band[2]), max(b, band[3])
                    break
            else:
                bands.append([y, y, a, b])
    thin = max(3, 0.2 * h)
    bands = [bd for bd in bands if bd[1] - bd[0] + 1 <= thin]
    if not bands:
        return []
    in_band = np.zeros(sub.shape[0], bool)
    for top, bottom, _, _ in bands:
        in_band[top:bottom + 1] = True
    text = sub.copy()
    text[in_band] = False  # the letters without the long runs
    # the baseline: the row with the most ink (Arabic letters join along it, in runs of their own, but within one word:
    # under three line heights). A rule over several words can outweigh it, so its rows are left out.
    proj = sub.sum(axis=1).astype(float)
    for top, bottom, a, b in bands:
        if b - a >= min(3 * h, 0.6 * (ln.x1 - ln.x0)):
            proj[top:bottom + 1] = 0
    base = int(np.argmax(proj[:max(1, int(ln.y1) - r0)]))
    out = []
    for top, bottom, a, b in bands:
        x0, x1 = c0 + a, c0 + b
        if x0 < ln.x0 - 0.6 * h or x1 > ln.x1 + 0.6 * h:
            continue  # runs on past the words: a divider or a table's line
        # under the letters and apart from them (with nothing printed above it, it is a line to fill in)
        if (top > base + max(2, 0.06 * h) and text[:top, a:b].any(axis=0).mean() >= 0.5
                and sub[max(0, top - 3):top, a:b].any(axis=0).mean() < 0.6):
            out.append(("u", x0, x1, r0 + top, r0 + bottom))
    return out


def _snap(spans: list, ln: Line, ink: np.ndarray, h: float) -> list:
    """Each word's place inside a box it shares with others: the cuts go in the widest gaps in the ink, one fewer than
    the words (the space between words is wider than the gaps between Arabic letters that do not join). With too few
    gaps, each cut by length moves to the widest gap within a line height of it. ink: the line's rows of the page,
    without its underlines (they run across the spaces)."""
    out = list(spans)
    W = ink.shape[1]
    sub = ink
    i = 0
    while i < len(out):
        j = i
        while j < len(out) and ln.words[j].box == ln.words[i].box:
            j += 1
        if j - i > 1 and out[i]:
            lo, hi = max(0, int(out[j - 1][0])), min(W, int(out[i][1]) + 1)
            gaps = [g for g in _runs(~sub[:, lo:hi].any(axis=0), 2) if g[0] > 0 and g[1] < hi - lo]
            if len(gaps) >= j - i - 1:
                cuts = sorted((lo + (g[0] + g[1]) / 2 for g in sorted(gaps, key=lambda g: g[0] - g[1])[:j - i - 1]), reverse=True)
            else:
                cuts = []
                for k in range(i + 1, j):
                    cut = (out[k][1] + out[k - 1][0]) / 2
                    near = [g for g in gaps if abs(lo + (g[0] + g[1]) / 2 - cut) <= h]
                    cuts.append(lo + (lambda g: (g[0] + g[1]) / 2)(max(near, key=lambda g: g[1] - g[0])) if near else cut)
            edges = [out[i][1]] + cuts + [out[j - 1][0]]
            for k in range(i, j):
                out[k] = (edges[k - i + 1], edges[k - i])
        i = j
    return out


def _stroke(word: np.ndarray) -> float | None:
    """Stroke width: twice the ink over its outline; None for a speck."""
    area = int(word.sum())
    if area < 30:
        return None
    p = np.pad(word, 1)
    inner = p[1:-1, 1:-1] & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    edge = area - int(inner.sum())
    return 2 * area / edge if edge else None


def _slants(word: np.ndarray) -> dict[int, float] | None:
    """How upright the strokes stand when the word is leaned back by each angle (degrees): the sum of squared column
    counts, which peaks when the strokes line up with the columns. None for a speck."""
    ys, xs = np.nonzero(word)
    if len(xs) < 30:
        return None
    mid = word.shape[0] / 2
    out = {}
    for t in SLANTS:
        cols = np.round(xs + (ys - mid) * math.tan(math.radians(t))).astype(int)
        out[t] = float((np.bincount(cols - cols.min()).astype(np.int64) ** 2).sum())
    return out


HIGHLIGHTS = [(15, "#ffc000"), (40, "#ffff00"), (75, "#92d050"), (170, "#9dc3e6"), (260, "#d9b3ff"), (300, "#ff99cc"), (360, "#ffc000")]


def _hex(rgb) -> str:
    return "#" + "".join(f"{int(v):02x}" for v in rgb)


def _colours(lines: list[Line], spans: dict, core: np.ndarray, colour: Image.Image) -> None:
    """Sets fmt c (text colour) and bg (highlight) on words printed in colour or on a tinted background."""
    import colorsys

    rgb = np.asarray(colour.convert("RGB")).astype(int)
    sy, sx = rgb.shape[0] / core.shape[0], rgb.shape[1] / core.shape[1]
    per_word = []
    for ln in lines:
        y0, y1 = max(0, int(ln.y0)), min(core.shape[0], int(ln.y1))
        for w, sp in zip(ln.words, spans[id(ln)]):
            if not sp or y1 <= y0:
                continue
            x0, x1 = max(0, int(sp[0])), min(core.shape[1], int(sp[1]) + 1)
            m = core[y0:y1, x0:x1]
            ys, xs = np.mgrid[y0:y1, x0:x1]
            px = rgb[np.minimum((ys * sy).astype(int), rgb.shape[0] - 1), np.minimum((xs * sx).astype(int), rgb.shape[1] - 1)]
            ink, paper = px[m], px[~m]
            if len(ink) >= 20 and len(paper) >= 20:
                # the darkest half of the ink: a blurred letter's edges take on the paper's colour
                ink = ink[ink.sum(axis=1) <= np.median(ink.sum(axis=1))]
                per_word.append((w, np.median(ink, axis=0), np.median(paper, axis=0)))
    if len(per_word) < 3:
        return
    page_ink = np.median([i for _, i, _ in per_word], axis=0)
    page_paper = np.median([p for _, _, p in per_word], axis=0)
    for w, ink, paper in per_word:
        hue, sat, val = colorsys.rgb_to_hsv(*(paper / 255))
        if sat >= 0.25 and val >= 0.55 and np.abs(paper - page_paper).max() >= 40:
            w.fmt["bg"] = next(c for top, c in HIGHLIGHTS if hue * 360 < top)
        tint = 100 if "bg" in w.fmt else 45  # on a highlight, black print takes some of its colour
        if np.ptp(ink) >= tint and np.abs(ink - page_ink).max() >= tint:
            w.fmt["c"] = _hex(ink)


def mark_styles(lines: list[Line], img: Image.Image, colour: Image.Image | None = None) -> list[Line]:
    """Sets Word.fmt from the photo, on the words that are printed that way: b, i, u, and with the photo in colour,
    c and bg."""
    gray = img.convert("L")
    g = np.asarray(gray)
    t = otsu_threshold(gray)
    dark = g < t
    ink, paper = g[dark], g[~dark]
    # for the rules, only the core of the ink: on a blurred photo the grey halo around the letters would fill the gap
    # between the letters and an underline
    core = g < ((np.percentile(ink, 10) + np.median(paper)) / 2 if ink.size and paper.size else t)
    H, W = dark.shape
    heights = [ln.y1 - ln.y0 for ln in lines if ln.y1 > ln.y0 and ln.words]
    if not heights:
        return lines
    h = statistics.median(heights)
    found = []  # (word, its ink) for the page-wide comparisons
    placed = {}  # each line's word spans
    for ln in lines:
        rules = _rules(ln, core, h)
        y0, y1 = max(0, int(ln.y0)), min(H, int(ln.y1))
        ink = core[y0:y1].copy()
        for _, _, _, top, bottom in rules:  # the letters without the underlines, for the spaces, weight and lean
            ink[max(0, top - y0):max(0, bottom + 1 - y0)] = False
        spans = placed[id(ln)] = _snap(word_spans(ln.words), ln, ink, h)
        for w, sp in zip(ln.words, spans):
            if not sp:
                continue
            a, b = sp
            for kind, x0, x1, _, _ in rules:
                if min(b, x1) - max(a, x0) >= 0.5 * (b - a):
                    w.fmt[kind] = True
            cut = ink[:, max(0, int(a)):min(W, int(b) + 1)]
            if cut.size and (b - a) >= 0.8 * h:
                found.append((w, ln, cut))
    strokes = [(w, ln, _stroke(cut)) for w, ln, cut in found]
    usual = [s for _, _, s in strokes if s]
    if len(usual) >= 5:
        typical = statistics.median(usual)
        for w, ln, s in strokes:
            if s and s > WORD_BOLD * typical and not ln.extra.get("bold"):
                w.fmt["b"] = True
    # italic: leaning away from the page's usual lean (Arabic letters measure a few degrees off upright), and clearly
    # sharper so than at that usual lean
    # and clearly sharper so than at that usual lean. Arabic letters give a noisier measure than Latin ones, so a word
    # on its own needs a much clearer lean than two neighbours leaning the same way.
    slants = [(w, ln, sc) for w, ln, cut in found if (sc := _slants(cut))]
    if len(slants) >= 5:
        usual = statistics.median(max(sc, key=sc.get) for _, _, sc in slants)
        ref = min(SLANTS, key=lambda t: abs(t - usual))
        lean = {}  # word -> (side, gain) for the words that may be italic
        for w, _, sc in slants:
            t = max(sc, key=sc.get)
            if ITALIC[0] <= abs(t - ref) <= ITALIC[1] and sc[t] >= 1.1 * sc[ref]:
                lean[id(w)] = (t > ref, sc[t] / sc[ref])
        for w, ln, _ in slants:
            if id(w) not in lean:
                continue
            side, gain = lean[id(w)]
            k = ln.words.index(w)
            pair = any(0 <= n < len(ln.words) and lean.get(id(ln.words[n]), (None,))[0] == side for n in (k - 1, k + 1))
            if gain >= 1.25 or pair:
                w.fmt["i"] = True
    if colour is not None:
        _colours(lines, placed, core, colour)
    for ln in lines:  # a word too short to measure ("في", "by") takes what both its neighbours share
        for k in range(1, len(ln.words) - 1):
            w, a, b = ln.words[k], ln.words[k - 1], ln.words[k + 1]
            for kind in ("b", "i"):
                if a.fmt.get(kind) and b.fmt.get(kind) and kind not in w.fmt and len(w.text) <= 3:
                    w.fmt[kind] = True
    return lines
