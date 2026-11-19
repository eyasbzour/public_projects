"""Handwriting, signatures and stamps: marks the free readers cannot read.

On the office's letters these are nearly always in coloured ink (a blue or red pen, a purple stamp) while
the print is black. The free readers skip them or turn them into garbage words inside the nearest line,
and that also glued the subject line to the paragraph under it. So a word whose ink is mostly coloured,
or a low-confidence word much taller than the print, leaves the text; so does coloured ink that no word
covers (a signature or stamp the reader never saw). Each mark goes back in as a flagged placeholder at its
place ("[تأشيرة بخط اليد]"), with its spot on the photo, for the reviewer to type or delete.

shortcut: colour is the main signal; black-ink handwriting is only caught by low confidence and size.
"""
from __future__ import annotations

import statistics

import numpy as np
from PIL import Image

from .common import Line

LABELS = {"hand": "تأشيرة بخط اليد", "sign": "توقيع", "stamp": "ختم"}


def ink_masks(colour: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    """(coloured ink, black ink) as boolean arrays. Pens and stamps are blue, purple or red; yellow and
    green are left out, because they are highlighters (and paper tint), and the print on them is black.
    Very dark pixels are print whatever their tint: letters printed on a highlight have dark yellow edges."""
    import cv2

    hsv = cv2.cvtColor(np.asarray(colour.convert("RGB")), cv2.COLOR_RGB2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]  # OpenCV hue 0-180: red <= 10 or >= 160, blue / purple 90-160
    pen_hue = (h <= 10) | (h >= 90)
    coloured = (s > 70) & (v >= 60) & (v < 215) & pen_hue
    black = ((v < 120) & (s <= 70)) | (v < 60)
    return coloured, black


def note_for(kind: str, text: str) -> str:
    label = LABELS[kind]
    guess = f" القراءة الآلية التقريبية: «{text}»." if text else ""
    return f"{label} في الصورة لا تقرؤه القراءة الآلية بدقة.{guess} اكتب نصه هنا أو احذف هذا الموضع."


def _kind(box: tuple, h: float, page_h: float) -> str:
    w, ht = box[2] - box[0], box[3] - box[1]
    if 0.7 < w / max(ht, 1) < 1.45 and min(w, ht) > 2.2 * h:
        return "stamp"
    return "sign" if box[1] > 0.6 * page_h else "hand"


def split_marks(lines: list[Line], colour: Image.Image, read_size: tuple[int, int],
                low_conf: float) -> tuple[list[Line], list[dict]]:
    """The lines without their marks, and the marks: {kind, text, box, label, note}, box in read-image pixels.

    colour: the photo in colour (the read image may be a cleaned-up grayscale copy); read_size: the size of
    the image the words' boxes refer to.
    """
    if not lines:
        return lines, []
    coloured, black = ink_masks(colour)
    sx, sy = colour.width / read_size[0], colour.height / read_size[1]
    heights = [ln.y1 - ln.y0 for ln in lines if ln.y1 > ln.y0] or [20]
    h = statistics.median(heights)

    def colour_share(box) -> tuple[int, int]:
        x0, y0 = max(0, int(box[0] * sx)), max(0, int(box[1] * sy))
        x1, y1 = int(box[2] * sx) + 1, int(box[3] * sy) + 1
        return int(coloured[y0:y1, x0:x1].sum()), int(black[y0:y1, x0:x1].sum())

    marks: list[dict] = []
    kept: list[Line] = []
    covered = np.zeros_like(coloured)
    for ln in lines:
        keep, run = [], []
        for w in ln.words:
            is_mark = False
            if w.box:
                c, k = colour_share(w.box)
                tall = (w.box[3] - w.box[1]) > 1.6 * h
                is_mark = (c >= 30 and c > 1.2 * k) or (w.conf < min(low_conf, 60) and tall)
                covered[max(0, int(w.box[1] * sy)):int(w.box[3] * sy) + 1, max(0, int(w.box[0] * sx)):int(w.box[2] * sx) + 1] = True
            if is_mark:
                run.append(w)
                continue
            if run:
                marks.append({"words": run}); run = []
            keep.append(w)
        if run:
            marks.append({"words": run})
        if len(keep) < len(ln.words):
            ln.words = keep
            boxes = [w.box for w in keep if w.box]
            if boxes:
                ln.x0, ln.y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
                ln.x1, ln.y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
        if ln.words:
            kept.append(ln)

    out = []
    for m in marks:
        ws = m["words"]
        box = (min(w.box[0] for w in ws), min(w.box[1] for w in ws), max(w.box[2] for w in ws), max(w.box[3] for w in ws))
        out.append({"text": " ".join(w.text for w in ws), "box": box})

    # coloured ink no word covers: a signature or stamp the reader skipped
    import cv2

    raw = coloured & ~covered
    free = raw.astype(np.uint8)
    k = max(3, int(0.6 * h * sx))
    free = cv2.dilate(free, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(free, connectivity=8)
    for i in range(1, n):
        x, y, w, ht, area = stats[i]
        box = (x / sx, y / sy, (x + w) / sx, (y + ht) / sy)
        if (box[2] - box[0]) * (box[3] - box[1]) < (1.5 * h) ** 2:
            continue
        # the ink itself (before the dilation): under half a line tall it is a line drawn under or through
        # the print (a red spellcheck squiggle on a screenshot, an underline), not words to type
        rows = np.flatnonzero((raw[y:y + ht, x:x + w] & (labels[y:y + ht, x:x + w] == i)).any(axis=1))
        if rows.size and rows[-1] - rows[0] + 1 < 0.5 * h * sy:
            continue
        out.append({"text": "", "box": box})

    # one mark per place: pieces that touch or nearly touch are one note, signature or stamp
    out.sort(key=lambda m: m["box"][1])
    merged: list[dict] = []
    for m in out:
        for o in merged:
            a, b = o["box"], m["box"]
            if a[0] - h <= b[2] and b[0] - h <= a[2] and a[1] - h <= b[3] and b[1] - h <= a[3]:
                o["box"] = (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))
                o["text"] = " ".join(t for t in (o["text"], m["text"]) if t)
                break
        else:
            merged.append(dict(m))
    for m in merged:
        m["kind"] = _kind(m["box"], h, read_size[1])
        m["label"], m["note"] = f"[{LABELS[m['kind']]}]", note_for(m["kind"], m["text"])
    return kept, merged
