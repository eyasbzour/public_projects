"""Shared helpers: image preparation and turning OCR words/lines into editor blocks.

A block is what the editor and the Word export work with:
    {"type": "p" | "h" | "li" | "c" | "table", "bold": bool,
     "segs": [{"s": "text"}, {"s": "unclear words", "note": "why it is flagged"}],
     "rows": [[segs, segs], ...]}            # tables only
"""
from __future__ import annotations

import io
import re
import statistics
from dataclasses import dataclass, field

from PIL import Image, ImageOps

BIDI_MARKS = re.compile(r"[‎‏‪-‮⁦-⁩]")
HAS_LETTER = re.compile(r"[؀-ۿA-Za-z0-9]")
BULLETS = set("•●▪◦·-–✓✔➢►»«*○■□")  # with how readers misread a bullet ("»" for "•")


class EngineError(Exception):
    """An error message that is safe to show to the user."""


def load_image(data: bytes, rotation: int = 0, mode: str = "clean", min_width: int = 1800) -> Image.Image:
    """Open the photo, rotate it, and optionally clean it up for OCR.

    mode: "none"  - as is
          "clean" - grayscale, stretch contrast, upscale small photos
          "bw"    - clean + black/white threshold (helps faint or shadowed photos)
    """
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img).convert("RGB")
    if rotation % 360:
        img = img.rotate(-(rotation % 360), expand=True, fillcolor="white")
    if mode == "none":
        return img
    g = ImageOps.grayscale(img)
    g = ImageOps.autocontrast(g, cutoff=1)
    if g.width < min_width:
        scale = min_width / g.width
        g = g.resize((int(g.width * scale), int(g.height * scale)), Image.LANCZOS)
    if mode == "bw":
        g = g.point(lambda p, t=otsu_threshold(g): 255 if p > t else 0)
    return g.convert("RGB")


def otsu_threshold(gray: Image.Image) -> int:
    hist = gray.histogram()[:256]
    total = sum(hist)
    sum_all = sum(i * h for i, h in enumerate(hist))
    sum_b = w_b = 0
    best_t, best_var = 128, -1.0
    for t in range(256):
        w_b += hist[t]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += t * hist[t]
        m_b, m_f = sum_b / w_b, (sum_all - sum_b) / w_f
        var = w_b * w_f * (m_b - m_f) ** 2
        if var > best_var:
            best_var, best_t = var, t
    return best_t


def to_jpeg(img: Image.Image, max_side: int = 2000, quality: int = 88) -> bytes:
    img = img.copy()
    img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=quality)
    return buf.getvalue()


@dataclass
class Word:
    text: str
    conf: float  # 0-100
    box: tuple[float, float, float, float] | None = None  # x0, y0, x1, y1 on the image that was read
    note: str | None = None  # a reason to check this word other than low confidence (numbers.py)


@dataclass
class Line:
    words: list[Word]
    x0: float
    y0: float
    x1: float
    y1: float
    new_para: bool = False
    extra: dict = field(default_factory=dict)


def clean_word(text: str) -> str:
    return BIDI_MARKS.sub("", text or "").strip()


def low_note(conf: float) -> str:
    return f"قراءة غير مؤكدة (درجة الثقة {round(conf)}%)، قارن مع الصورة الأصلية"


def words_to_segs(words: list[Word], low_conf: float, size: tuple[int, int] | None = None) -> list[dict]:
    """Join words into text segments; runs of low-confidence words become one flagged segment.

    With the read image's size, a flagged segment also gets "box": where it sits on the page, as
    fractions [x0, y0, x1, y1], so the review panel can show that spot of the photo.
    """
    segs: list[dict] = []
    buf: list[str] = []
    low: list[Word] = []

    def flush_plain():
        if buf:
            segs.append({"s": " ".join(buf) + " "})
            buf.clear()

    def flush_low(note: str | None = None):
        if low:
            text = " ".join(w.text for w in low)
            seg = {"s": text, "note": note or low_note(min(w.conf for w in low))}
            if size and all(w.box for w in low):
                W, H = size
                seg["box"] = [round(min(w.box[0] for w in low) / W, 4), round(min(w.box[1] for w in low) / H, 4),
                              round(max(w.box[2] for w in low) / W, 4), round(max(w.box[3] for w in low) / H, 4)]
            segs.append(seg)
            segs.append({"s": " "})
            low.clear()

    for w in words:
        if w.note:  # flagged for its own reason: a segment of its own with that note
            flush_plain()
            flush_low()
            low.append(w)
            flush_low(w.note)
        elif w.conf < low_conf:
            flush_plain()
            low.append(w)
        else:
            flush_low()
            buf.append(w.text)
    flush_plain()
    flush_low()
    # tidy trailing space
    while segs and segs[-1].get("note") is None and not segs[-1]["s"].strip():
        segs.pop()
    if segs and segs[-1].get("note") is None:
        segs[-1]["s"] = segs[-1]["s"].rstrip()
    return segs


def drop_junk(words: list[Word]) -> list[Word]:
    """Remove specks and margin noise: very low confidence tokens with no real letters."""
    out = []
    for w in words:
        t = clean_word(w.text)
        if not t:
            continue
        letters = len(HAS_LETTER.findall(t))
        if w.conf < 40 and letters < 2:
            continue
        out.append(Word(t, w.conf, w.box, w.note))
    return out


def page_align(para: list[Line], left: float, right: float) -> str:
    """Where a paragraph sits across the text area: '' (full width), 'start', 'center' or 'end'.

    shortcut: assumes right-to-left pages (start = right), true for this app's Arabic letters;
    swap start/end if English-only pages are ever read.
    """
    span = (right - left) or 1
    x0, x1 = min(ln.x0 for ln in para), max(ln.x1 for ln in para)
    if x1 - x0 > 0.8 * span:
        return ""
    gap_start, gap_end = right - x1, x0 - left
    if abs(gap_start - gap_end) < 0.12 * span:
        return "center"
    return "end" if gap_start > gap_end else "start"


def merge_rows(lines: list[Line]) -> list[Line]:
    """Join lines that sit side by side on one text row, top to bottom.

    Tesseract reads "الرقم: ..." on the right and "التاريخ: ..." on the left as separate blocks;
    as one line, split_row() can keep them on one row with a part on each side.
    """
    rows: list[Line] = []
    for ln in sorted(lines, key=lambda l: l.y0):
        for r in rows[-3:]:
            overlap = min(r.y1, ln.y1) - max(r.y0, ln.y0)
            side_by_side = ln.x1 <= r.x0 or ln.x0 >= r.x1
            if side_by_side and overlap > 0.5 * min(r.y1 - r.y0, ln.y1 - ln.y0):
                r.words = ln.words + r.words if ln.x0 >= r.x1 else r.words + ln.words  # right one first
                r.x0, r.y0, r.x1, r.y1 = min(r.x0, ln.x0), min(r.y0, ln.y0), max(r.x1, ln.x1), max(r.y1, ln.y1)
                break
        else:
            rows.append(ln)
    return rows


def row_gaps(words: list[Word], min_gap: float) -> list[tuple[float, float]]:
    """Empty stretches wider than min_gap between a row's words, right to left, as (left x, right x).

    Measured on the page (visual order), so an English phrase inside an Arabic line, whose words run
    left to right, never looks like a gap.
    """
    if len(words) < 2 or any(w.box is None for w in words):
        return []
    gaps, run_left = [], None
    for w in sorted(words, key=lambda w: -w.box[2]):
        if run_left is not None and run_left - w.box[2] > min_gap:
            gaps.append((w.box[2], run_left))
        run_left = w.box[0] if run_left is None else min(run_left, w.box[0])
    return gaps


def cut_row(words: list[Word], cuts: list[float]) -> list[list[Word]]:
    """Words split at x positions (right to left) into parts; words keep their reading order."""
    parts: list[list[Word]] = [[] for _ in range(len(cuts) + 1)]
    for w in words:
        cx = (w.box[0] + w.box[2]) / 2
        parts[sum(cx < c for c in cuts)].append(w)
    return parts


def split_row(words: list[Word], min_gap: float) -> tuple[list[list[Word]], list[float]]:
    """Cut a row where there is a wide empty gap: ([[right part words], [next part], ...], the cut positions)."""
    cuts = [(lo + hi) / 2 for lo, hi in row_gaps(words, min_gap)]
    return (cut_row(words, cuts), cuts) if cuts else ([words], [])


def shared_gaps(a: list[tuple[float, float]], b: list[tuple[float, float]], min_w: float) -> list[tuple[float, float]]:
    """The empty stretches two rows have in common (at least min_w wide), right to left."""
    out = [(max(l1, l2), min(h1, h2)) for l1, h1 in a for l2, h2 in b if min(h1, h2) - max(l1, l2) >= min_w]
    return sorted(out, key=lambda g: -g[1])


def lineless_tables(lines: list[Line], h: float, span: float) -> list[list[float] | None]:
    """Tables printed without lines: runs of 3+ consecutive rows whose column gaps line up.

    One wide gap in a single line proves nothing (justified text can have one), but the same empty
    vertical strips through three rows in a row are a table's column borders. Returns, per line,
    the cut positions of the table it belongs to, or None.
    """
    gaps = [row_gaps(ln.words, max(1.2 * h, 0.03 * span)) for ln in lines]
    cuts: list[list[float] | None] = [None] * len(lines)
    i = 0
    while i < len(lines):
        common, j = gaps[i], i + 1
        while j < len(lines) and common and lines[j].y0 - lines[j - 1].y1 < 1.5 * h:
            nxt = shared_gaps(common, gaps[j], 0.5 * h)
            if not nxt:
                break
            common, j = nxt, j + 1
        if j - i >= 3 and common:
            table = [(lo + hi) / 2 for lo, hi in common]  # one list per table: its rows share it
            for k in range(i, j):
                cuts[k] = table
            i = j
        else:
            i += 1
    return cuts


def lines_to_blocks(lines: list[Line], low_conf: float, tables: list = (), size: tuple[int, int] | None = None,
                    marks: list = ()) -> list[dict]:
    """Turn OCR lines into editor blocks, keeping the page layout where it can.

    - words inside a ruled table (tables.find_tables) go into that table's cells;
    - a row with a wide gap ("الرقم ...      التاريخ ...") becomes a borderless table row,
      so each part stays on its side; consecutive such rows share one table;
    - other lines group into paragraphs by vertical gaps, with a guessed type and alignment;
    - marks (marks.split_marks: handwriting, signatures, stamps) come back as flagged placeholders, each
      after the block above it, so a note in the margin never splits or glues paragraphs.
    """
    items: list[tuple[float, str, object]] = []  # (top, kind, payload), sorted into page order below
    W, H = size or (0, 0)

    def frac(x0, y0, x1, y1):
        """A place on the page as fractions, so a cell can be shown and read again; none without the size."""
        return [round(x0 / W, 4), round(y0 / H, 4), round(x1 / W, 4), round(y1 / H, 4)] if size else None

    def part_boxes(ln: Line, cuts: list[float]) -> list:
        """Each part of a row cut at x positions (right to left), on the line's height."""
        edges = [max(ln.x1, cuts[0] + h if cuts else ln.x1)] + list(cuts) + [min(ln.x0, cuts[-1] - h if cuts else ln.x0)]
        return [frac(edges[k + 1], ln.y0, edges[k], ln.y1) for k in range(len(cuts) + 1)]
    for grid in tables:
        cells = [[[] for _ in grid.xs[1:]] for _ in grid.ys[1:]]
        for ln in lines:
            keep = []
            for w in ln.words:
                rc = grid.cell(w.box) if w.box else None
                (cells[rc[0]][rc[1]] if rc else keep).append(w)
            if len(keep) < len(ln.words):
                ln.words = keep
                boxes = [w.box for w in keep if w.box]
                if boxes:  # the line's extent without its table words
                    ln.x0, ln.y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
                    ln.x1, ln.y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
        rows = [[words_to_segs(c, low_conf, size) for c in row] for row in cells]
        if any(seg for row in rows for cell in row for seg in cell):
            n = len(grid.xs) - 1  # column 0 is the rightmost (Grid.cell)
            boxes = [[frac(grid.xs[n - 1 - c], grid.ys[r], grid.xs[n - c], grid.ys[r + 1]) for c in range(n)] for r in range(len(rows))]
            items.append((grid.ys[0], "table", (rows, boxes)))

    lines = merge_rows([ln for ln in lines if ln.words])
    if not lines and not items and not marks:
        return []
    heights = [ln.y1 - ln.y0 for ln in lines if ln.y1 > ln.y0] or [20]
    h = statistics.median(heights)
    widest = max((ln.x1 - ln.x0 for ln in lines), default=1) or 1
    left = min((ln.x0 for ln in lines), default=0)
    right = max((ln.x1 for ln in lines), default=size[0] if size else 1)
    min_gap = max(3 * h, 0.06 * (right - left))
    table_cuts = lineless_tables(lines, h, right - left)
    for ln, cuts in zip(lines, table_cuts):
        if cuts:  # a row of a table printed without lines; rows of one table share the same cuts
            items.append((ln.y0, "trow", (id(cuts), cut_row(ln.words, cuts), part_boxes(ln, cuts))))
            continue
        parts, row_cuts = split_row(ln.words, min_gap)
        items.append((ln.y0, "row", (parts, part_boxes(ln, row_cuts))) if len(parts) > 1 else (ln.y0, "line", ln))
    items.sort(key=lambda it: it[0])

    def spot(para: list[Line], lens: list[int]) -> dict:
        """Where the block sits on the page (fractions), so it can be read again with another engine; with more
        than one line, each line too: [x0, y0, x1, y1, where its text starts in the block]. words_to_segs joins
        the words with one space, so lens (each line's words plus a space each) add up to those offsets."""
        if not size:
            return {}
        W, H = size
        frac = lambda ln: [round(ln.x0 / W, 4), round(ln.y0 / H, 4), round(ln.x1 / W, 4), round(ln.y1 / H, 4)]
        out = {"box": [round(min(ln.x0 for ln in para) / W, 4), round(min(ln.y0 for ln in para) / H, 4),
                       round(max(ln.x1 for ln in para) / W, 4), round(max(ln.y1 for ln in para) / H, 4)]}
        if len(para) > 1:
            starts = [sum(lens[:k]) for k in range(len(para))]
            out["lines"] = [frac(ln) + [at] for ln, at in zip(para, starts)]
        return out

    def para_block(para: list[Line]) -> dict | None:
        words = [w for ln in para for w in ln.words]
        lens = [sum(len(w.text) + 1 for w in ln.words) for ln in para]
        btype = "p"
        item = para[0].extra.get("list")  # lists.mark_list_items
        if item:
            segs = words_to_segs(words, low_conf, size)
            num = para[0].extra.get("num")
            return {"type": item, "bold": False, "level": 0, "segs": segs, **({"start": num} if num and num > 1 else {}), **spot(para, lens)} if segs else None
        if words and (words[0].text in BULLETS or words[0].text[:1] in BULLETS):
            first = words[0]
            rest = first.text[1:].strip()
            words = ([Word(rest, first.conf, first.box)] if rest else []) + words[1:]
            lens[0] -= len(first.text) - len(rest) + (0 if rest else 1)
            btype = "li"
        align = page_align(para, left, right)
        if btype == "p" and len(para) == 1:
            # a short line is a heading when it looks like one: bold on the photo (emphasis.py) or centred;
            # a short plain line at the start is a greeting or a closing, and one on the far side a date or signature
            text = " ".join(w.text for w in words)
            short = len(text) < 60 and para[0].x1 - para[0].x0 < 0.55 * widest
            if short and (para[0].extra.get("bold") or align == "center") and align != "end":
                btype = "h"
        segs = words_to_segs(words, low_conf, size)
        bold = btype == "h" or all(ln.extra.get("bold") for ln in para)
        return {"type": btype, "bold": bold, "segs": segs, **({"align": align} if align else {}), **spot(para, lens)} if segs else None

    blocks: list[dict] = []
    tops: list[float] = []  # where each block starts on the page, to put the marks back in order
    para: list[Line] = []
    prev_kind = None

    def flush():
        b = para_block(para) if para else None
        if b:
            blocks.append(b)
            tops.append(para[0].y0)
        para.clear()

    def add(block: dict, top: float):
        blocks.append(block)
        tops.append(top)

    for top, kind, x in items:
        if kind == "line":
            # a list item starts its own block; a line back at the margin after one ends it; a line at the same
            # indent after an item that stopped short of the margin is the next item (its bullet was missed),
            # while one after a full line is the item wrapping on
            item = para and para[0].extra.get("list")
            outdented = item and x.x1 > para[0].x1 + 0.3 * h  # on the test page the indent is about half a line height
            if item and not outdented and not x.extra.get("list") and abs(x.x1 - para[0].x1) < 0.25 * h and para[-1].x0 > left + 3 * h:
                x.extra["list"] = item
            if para and (x.extra.get("list") or outdented or x.new_para or x.y0 - para[-1].y1 > 0.75 * h):
                flush()
            para.append(x)
        else:
            flush()
            # cellBoxes: each cell's place on the page, in the same shape as rows
            boxed = lambda b, boxes: {**b, "cellBoxes": boxes} if size else b
            if kind == "table":
                rows, boxes = x
                add(boxed({"type": "table", "bold": False, "rows": rows}, boxes), top)
            elif kind == "trow":
                run, parts, boxes = x
                row = [words_to_segs(p, low_conf, size) for p in parts]
                if prev_kind == ("trow", run):
                    blocks[-1]["rows"].append(row)
                    if size:
                        blocks[-1]["cellBoxes"].append(boxes)
                else:  # lineless: cells start-aligned like a ruled table's, only drawn without lines
                    add(boxed({"type": "table", "bold": False, "borderless": True, "lineless": True, "rows": [row]}, [boxes]), top)
            else:
                parts, boxes = x
                row = [words_to_segs(p, low_conf, size) for p in parts]
                if prev_kind == "row" and len(blocks[-1]["rows"][0]) == len(row):
                    blocks[-1]["rows"].append(row)
                    if size:
                        blocks[-1]["cellBoxes"].append(boxes)
                else:
                    add(boxed({"type": "table", "bold": False, "borderless": True, "rows": [row]}, [boxes]), top)
        prev_kind = ("trow", x[0]) if kind == "trow" else kind
    flush()

    for m in sorted(marks, key=lambda m: m["box"][1], reverse=True):  # bottom first: positions above stay valid
        x0, y0, x1, y1 = m["box"]
        seg = {"s": m["label"], "note": m["note"]}
        if size:
            W, H = size
            seg["box"] = [round(x0 / W, 4), round(y0 / H, 4), round(x1 / W, 4), round(y1 / H, 4)]
        align = page_align([Line([], x0, y0, x1, y1)], left, right)
        at = sum(1 for t in tops if t <= y0)
        blocks.insert(at, {"type": "p", "bold": False, "segs": [seg], **({"align": align} if align else {})})
        tops.insert(at, y0)
    return blocks


def fragments_to_lines(frags: list[tuple[list, str, float]]) -> list[Line]:
    """For engines that return text boxes (EasyOCR, PaddleOCR): group boxes into lines.

    frags: (box as 4 points [[x,y],...], text, confidence 0-1); text may also be [(word, confidence 0-100)], from an
    engine that scores each word (Nuqta), and then the confidence is None.
    Arabic reads right to left, so boxes on one line are ordered by x descending.
    """
    items = []
    for box, text, conf in frags:
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        items.append({"x0": min(xs), "x1": max(xs), "y0": min(ys), "y1": max(ys), "text": text, "conf": None if conf is None else conf * 100})
    items.sort(key=lambda it: (it["y0"] + it["y1"]) / 2)
    rows: list[list[dict]] = []
    for it in items:
        cy = (it["y0"] + it["y1"]) / 2
        if rows:
            last = rows[-1]
            ly0 = min(r["y0"] for r in last)
            ly1 = max(r["y1"] for r in last)
            if ly0 <= cy <= ly1:
                last.append(it)
                continue
        rows.append([it])
    lines = []
    for row in rows:
        row.sort(key=lambda r: -r["x1"])
        words = []
        for r in row:
            box = (r["x0"], r["y0"], r["x1"], r["y1"])  # tokens share their text box's position
            if isinstance(r["text"], list):
                words += [Word(clean_word(t), c, box) for t, c in r["text"] if clean_word(t)]
            else:
                words += [Word(tok, r["conf"], box) for tok in clean_word(r["text"]).split()]
        lines.append(Line(drop_junk(words), min(r["x0"] for r in row), min(r["y0"] for r in row),
                          max(r["x1"] for r in row), max(r["y1"] for r in row)))
    return lines
