"""Engine registry: every way the app can read a page."""
from __future__ import annotations

from . import ai_engines, easyocr_engine, nuqta_engine, paddle_engine, tesseract_engine
import io
import os

from . import direction as ltr_page
from .common import EngineError, each_box, in_language, lines_to_blocks, load_image, page_skew, seg_lists, unturn_box  # noqa: F401
from .emphasis import mark_bold
from .lists import mark_list_items
from .marks import split_marks
from .numbers import check_numbers
from .tables import find_tables
from messages import msg

# EasyOCR and PaddleOCR score their own confidence lower than Tesseract does,
# so they get their own threshold for flagging.
BOX_ENGINE_LOW_CONF = float(os.environ.get("BOX_ENGINE_LOW_CONFIDENCE", "35"))

ENGINES = [
    # best first: the first one the server has is the default. PaddleOCR is the user's pick after testing, and it
    # reads tables best. Known weakness (test pages): it kept 18/34 numbers, against 30 for Tesseract "best" and 33
    # for EasyOCR, because its Arabic model drops Western digits inside Arabic lines ("م ض / 245 / 2026") at high
    # confidence, so they are not flagged.
    {"id": "paddle", "label": msg("reader.paddleocrRecommended"), "group": "free", "key": None},
    # the most accurate for Arabic, also for numbers and some handwriting, but about a minute a page on a CPU:
    # the default second opinion for flagged words and paragraphs (nuqta_engine.py)
    {"id": "nuqta", "label": msg("reader.nuqtaMostAccurateArabicSlower"), "group": "free", "key": None},
    {"id": "tess-best", "label": msg("reader.tesseractBest"), "group": "free", "key": None},
    {"id": "easyocr", "label": "EasyOCR", "group": "free", "key": None},
    {"id": "tess-standard", "label": msg("reader.tesseractStandard"), "group": "free", "key": None},
    {"id": "tess-fast", "label": msg("reader.tesseractFast"), "group": "free", "key": None},
    {"id": "claude", "label": msg("reader.claudeAi"), "group": "ai", "key": "claude"},
    {"id": "google", "label": "Google Vision", "group": "ai", "key": "google"},
]


def availability(engine_id: str) -> tuple[bool, str]:
    if engine_id.startswith("tess-"):
        return tesseract_engine.available(engine_id[5:])
    if engine_id == "easyocr":
        return easyocr_engine.available()
    if engine_id == "paddle":
        return paddle_engine.available()
    if engine_id == "nuqta":
        return nuqta_engine.available()
    if engine_id == "claude":
        return ai_engines.claude_available()
    if engine_id == "google":
        return ai_engines.google_available()
    return False, msg("server.unknownReader")


def run(engine_id: str, image_bytes: bytes, *, rotation: int = 0, cleanup: str = "clean",
        api_key: str | None = None, model: str | None = None, skip_letterhead: bool = True,
        low_conf: float = 65, langs: str = "ara+eng", spot: bool = False, direction: str = "auto",
        doc_lang: str | None = None) -> tuple[list[dict], str]:
    """Read a page into blocks. spot=True: the image is a small cut-out (read_spots), read as plain text
    without the page-level steps (handwriting, lists, the number check). direction: "auto" (from the text),
    "rtl" (Arabic) or "ltr" (English): a left-to-right page's blocks get dir "ltr" (direction.py).
    doc_lang: the language of the text the readers write into the document (notes, "[Signature]"); by default the
    page's: English on a left-to-right page, Arabic otherwise. Returns the blocks and that language, which the page
    keeps, so a spot read again later gets it too (read_spots)."""
    blocks, ltr = _read(engine_id, image_bytes, rotation=rotation, cleanup=cleanup, api_key=api_key, model=model,
                        skip_letterhead=skip_letterhead, low_conf=low_conf, langs=langs, spot=spot, direction=direction)
    lang = doc_lang or ("en" if ltr else "ar")
    return in_language(blocks, lang), lang


def _read(engine_id, image_bytes, *, rotation, cleanup, api_key, model, skip_letterhead, low_conf, langs, spot,
          direction) -> tuple[list[dict], bool]:
    """The blocks, and whether the page runs left to right."""
    if engine_id not in {e["id"] for e in ENGINES}:
        raise EngineError(msg("server.unknownReader"))
    ok, why = availability(engine_id)
    if not ok:
        raise EngineError(why)
    # Clean-up (grayscale, contrast, upscale) is tuned for Tesseract. The neural engines resize on their
    # own and do worse on it: PaddleOCR drops the digits of "الرقم: 245 / 2026" on the cleaned image.
    mode = cleanup if engine_id.startswith("tess-") else "none"
    img = load_image(image_bytes, rotation, mode)
    if engine_id in ("claude", "google"):
        blocks = (ai_engines.run_claude(img, api_key, model, skip_letterhead and not spot) if engine_id == "claude"
                  else ai_engines.run_google(img, api_key, low_conf))
        return blocks, direction == "ltr" or (direction == "auto" and ltr_page.is_ltr_text(ltr_page.blocks_text(blocks)))
    # free engines: lines with word positions -> one shared layout step (tables, side-by-side parts, paragraphs)
    page = img if mode == "none" else load_image(image_bytes, rotation, "none")
    skew = 0.0 if spot else page_skew(page)
    if skew:  # a photo taken at an angle: its lines run into each other. Read it straight; the boxes go back after.
        rotation += skew
        img = load_image(image_bytes, rotation, mode)
    grids, unruled = find_tables(img)
    if engine_id.startswith("tess-"):
        lines = tesseract_engine.run(unruled, engine_id[5:], langs, spot)  # it reads table cells only without the lines
    else:
        lines = nuqta_engine.run(img, spot) if engine_id == "nuqta" else (easyocr_engine if engine_id == "easyocr" else paddle_engine).run(img)
    ltr = direction == "ltr" or (direction == "auto" and ltr_page.is_ltr(lines))
    if ltr and engine_id == "paddle":  # an English page: PaddleOCR's English recognizer reads it far better,
        lines = paddle_engine.with_arabic(paddle_engine.run(img, "en"), lines)  # but not its Arabic words
    if engine_id in ("paddle", "easyocr", "nuqta"):
        low_conf = min(low_conf, BOX_ENGINE_LOW_CONF)
        if engine_id == "paddle" and not ltr and not spot and tesseract_engine.available("best", langs)[0]:
            # PaddleOCR drops digits inside Arabic lines: Tesseract reads the page too, for the numbers (numbers.py).
            # Only a check: when Tesseract fails or runs out of time, the page keeps PaddleOCR's reading.
            clean = load_image(image_bytes, rotation, "clean")
            try:
                second = tesseract_engine.run(find_tables(clean)[1], "best", langs)
            except EngineError as e:
                print(f"number check skipped: {e}")
            else:
                lines = check_numbers(lines, second, clean.width / img.width, grids)
    colour = None
    if ltr:  # the layout steps work right to left: mirror the page for them, and back after (direction.py)
        W = img.width
        lines = ltr_page.mirror_lines(ltr_page.in_reading_order(lines), W)
        grids = ltr_page.mirror_grids(grids, W)
        colour = ltr_page.mirror_image(img if mode == "none" else load_image(image_bytes, rotation, "none"))
        img = ltr_page.mirror_image(img)
    def done(blocks):
        if ltr:
            blocks = ltr_page.unmirror_blocks(blocks)
        if skew:
            blocks = each_box(blocks, lambda box: unturn_box(box, skew, page.size))
        return blocks, ltr  # run() decides the page's language from ltr
    if spot:
        return done(lines_to_blocks(lines, low_conf, grids, img.size))
    # handwriting, signatures and stamps leave the text and come back as notes (colour needs the photo itself)
    if colour is None:
        colour = img if mode == "none" else load_image(image_bytes, rotation, "none")
    lines, marks = split_marks(lines, colour, img.size, low_conf)
    lines = mark_list_items(lines, img)  # bullets and numbers, even when the reader skipped the bullet
    lines = mark_bold(lines, img)  # which short lines are headings
    return done(lines_to_blocks(lines, low_conf, grids, img.size, marks))


def read_spots(engine_id: str, image_bytes: bytes, boxes: list, *, rotation: int = 0, **kw) -> list[dict]:
    """Read only some spots of a page (a flagged word, a paragraph) with any engine: a second opinion.

    boxes: [x0, y0, x1, y1] as fractions of the page as it was read (after its rotation). Each spot is cut
    out with a margin and read on its own. Returns, per box, {"text", "segs"}; segs keep the engine's flags.
    """
    page = load_image(image_bytes, rotation, "none")
    W, H = page.size
    out = []
    for b in boxes:
        x0, y0, x1, y1 = b[0] * W, b[1] * H, b[2] * W, b[3] * H
        pad = max(10.0, 0.4 * (y1 - y0))
        cx0, cy0, cx1, cy1 = int(max(0, x0 - 2 * pad)), int(max(0, y0 - pad)), int(min(W, x1 + 2 * pad)), int(min(H, y1 + pad))
        crop = page.crop((cx0, cy0, cx1, cy1))
        if crop.height < 60:  # readers do better on text at least this tall
            f = 60 / max(crop.height, 1)
            crop = crop.resize((int(crop.width * f), int(crop.height * f)))
        buf = io.BytesIO()
        crop.save(buf, "PNG")
        segs: list[dict] = []
        for part in seg_lists(run(engine_id, buf.getvalue(), spot=True, **kw)[0]):
            if part and segs:
                segs.append({"s": " "})
            segs.extend(part)
        for sg in segs:  # a flag's spot is on the cut-out: put it back on the page
            if "box" in sg:
                bx = sg["box"]
                sg["box"] = [round((cx0 + bx[0] * (cx1 - cx0)) / W, 4), round((cy0 + bx[1] * (cy1 - cy0)) / H, 4),
                             round((cx0 + bx[2] * (cx1 - cx0)) / W, 4), round((cy0 + bx[3] * (cy1 - cy0)) / H, 4)]
        merged: list[dict] = []
        for sg in segs:  # neighbouring plain text in one piece
            if merged and "note" not in sg and "note" not in merged[-1]:
                merged[-1] = {"s": merged[-1]["s"] + sg["s"]}
            else:
                merged.append(dict(sg))
        out.append({"segs": merged, "text": "".join(sg["s"] for sg in merged).strip()})
    return out
