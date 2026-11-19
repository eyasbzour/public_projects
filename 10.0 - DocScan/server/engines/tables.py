"""Find ruled tables (printed grid lines) on a page photo, so the free engines' words can go into cells.

Works for tables drawn with lines, which is how official letters print them. Tables without lines
are read as normal text.
shortcut: a merged cell's text lands in one grid cell and its neighbours stay empty; a page tilted by
more than a degree or two can lose its lines. Revisit with PaddleOCR's table model (PP-StructureV3)
if real documents need either.
"""
from __future__ import annotations

from bisect import bisect
from dataclasses import dataclass


@dataclass
class Grid:
    xs: list[float]  # column borders, left to right
    ys: list[float]  # row borders, top to bottom

    def cell(self, box) -> tuple[int, int] | None:
        """(row, column) of the cell holding a word's centre; columns are numbered from the right."""
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        if not (self.xs[0] < cx < self.xs[-1] and self.ys[0] < cy < self.ys[-1]):
            return None
        return bisect(self.ys, cy) - 1, len(self.xs) - 1 - bisect(self.xs, cx)


def _borders(mask, horizontal: bool, min_span: float) -> list[float]:
    """Centres of the straight lines in mask that run across most of the table."""
    import cv2

    _, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    centres = sorted(y + h / 2 if horizontal else x + w / 2
                     for x, y, w, h, _ in stats[1:] if (w if horizontal else h) >= min_span)
    out: list[float] = []
    for c in centres:
        if not out or c - out[-1] > 8:  # one border drawn as two close strokes counts once
            out.append(c)
    return out


def find_tables(img) -> tuple[list[Grid], "Image.Image"]:
    """The ruled tables on the page, and a copy of the page without their lines (for Tesseract)."""
    import cv2
    import numpy as np
    from PIL import Image

    gray = np.asarray(img.convert("L"))
    H, W = gray.shape
    ink = cv2.adaptiveThreshold(255 - gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 15, -2)
    # keep only long straight strokes: longer than any letter, so text never counts as a border
    rect = cv2.getStructuringElement
    horiz = cv2.morphologyEx(ink, cv2.MORPH_OPEN, rect(cv2.MORPH_RECT, (max(30, W // 15), 1)))
    vert = cv2.morphologyEx(ink, cv2.MORPH_OPEN, rect(cv2.MORPH_RECT, (1, max(20, H // 40))))
    # bridge small breaks in photographed lines and the steps of slightly tilted ones
    horiz = cv2.dilate(horiz, rect(cv2.MORPH_RECT, (9, 3)))
    vert = cv2.dilate(vert, rect(cv2.MORPH_RECT, (3, 9)))

    n, labels, stats, _ = cv2.connectedComponentsWithStats(cv2.bitwise_or(horiz, vert))
    grids = []
    lines = np.zeros_like(gray)  # the accepted tables' border pixels
    for i, (x, y, w, h, _) in enumerate(stats[1:], 1):
        if w < 0.2 * W or h < 0.03 * H:
            continue
        own = (labels[y:y + h, x:x + w] == i).astype(np.uint8)
        ys = _borders(horiz[y:y + h, x:x + w] & own, True, 0.6 * w)
        xs = _borders(vert[y:y + h, x:x + w] & own, False, 0.6 * h)
        if len(ys) >= 3 and len(xs) >= 3:  # at least 2 x 2 cells; a single framed box is not a table
            grids.append(Grid([x + v for v in xs], [y + v for v in ys]))
            lines[y:y + h, x:x + w] |= own * 255
    if not grids:
        return grids, img
    # Tesseract reads nothing inside a grid (its cells came out empty) but reads the same words once
    # the lines are gone, so it gets a copy with the borders painted white; positions do not change.
    rgb = np.array(img.convert("RGB"))
    rgb[cv2.dilate(lines, rect(cv2.MORPH_RECT, (3, 3))) > 0] = 255
    return grids, Image.fromarray(rgb)
