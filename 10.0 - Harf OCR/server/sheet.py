"""A phone photo of a sheet of paper: find the sheet's four corners and flatten it, as a scanner would see it
(drafts.py add_image, when a photo is added). Only a sheet that stands out from what is around it is taken: a
scan, or a page photographed edge to edge, stays as it is (the reader straightens small tilts on its own)."""
from __future__ import annotations

import cv2
import numpy as np
from PIL import Image

WORK = 800  # the long side the sheet is looked for at
MIN_AREA, MAX_AREA = 0.2, 0.92  # the sheet's share of the photo: smaller is not the page, larger leaves nothing to cut
CONTRAST = 30  # how much brighter the paper is than what lies around it (0-255): a table's frame on white paper is not


def _order(q: np.ndarray) -> np.ndarray:
    """Top left, top right, bottom right, bottom left."""
    s, d = q.sum(1), np.diff(q, axis=1).ravel()
    return np.array([q[s.argmin()], q[d.argmin()], q[s.argmax()], q[d.argmax()]], dtype=np.float32)


def find_sheet(img: Image.Image) -> np.ndarray | None:
    """The sheet's corners in the photo's pixels (top left, top right, bottom right, bottom left), or None."""
    k = WORK / max(img.size)
    small = np.asarray(img.convert("L").resize((max(1, round(img.width * k)), max(1, round(img.height * k)))))
    blur = cv2.GaussianBlur(small, (5, 5), 0)
    _, bright = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # the text and lines on the paper filled in, so the sheet is one bright shape
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (25, 25)))
    bright = cv2.morphologyEx(bright, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)))
    contours, _ = cv2.findContours(bright, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    hull = cv2.convexHull(max(contours, key=cv2.contourArea))
    peri = cv2.arcLength(hull, True)
    quad = None
    for eps in (0.02, 0.03, 0.04, 0.05, 0.06):
        approx = cv2.approxPolyDP(hull, eps * peri, True)
        if len(approx) == 4:
            quad = approx.reshape(4, 2).astype(np.float32)
            break
    if quad is None:
        return None
    area = cv2.contourArea(quad) / (small.shape[0] * small.shape[1])
    if not MIN_AREA <= area <= MAX_AREA:
        return None
    quad = _order(quad)
    for i in range(4):  # every corner near a right angle: a sheet seen at a slant, not a sliver
        a, b, c = quad[i - 1], quad[i], quad[(i + 1) % 4]
        u, v = a - b, c - b
        cos = float(u @ v / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-6))
        if abs(cos) > 0.5:  # outside 60 to 120 degrees
            return None
    inside = np.zeros_like(small)
    cv2.fillConvexPoly(inside, quad.astype(np.int32), 255)
    if np.median(small[inside > 0]) - np.median(small[inside == 0]) < CONTRAST:
        return None
    return quad / k


def flatten(img: Image.Image, corners: np.ndarray) -> Image.Image:
    """The sheet alone, square to the frame, at the size it has in the photo."""
    tl, tr, br, bl = corners
    w = round(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
    h = round(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
    m = cv2.getPerspectiveTransform(corners.astype(np.float32), np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]]))
    out = cv2.warpPerspective(np.asarray(img.convert("RGB")), m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return Image.fromarray(out)
