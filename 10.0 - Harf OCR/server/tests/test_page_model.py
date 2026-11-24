"""The page model the readers write, as shared fixtures: tests/fixtures/pages.json.

The pages here come from the real layout code (lines_to_blocks, Claude's reply, notes put in the page's language), so
when the readers' output changes this test fails, and the browser's tests (web/js/page-model.test.js) read the same
file through the editor and the Word export. After a change made on purpose, write the file again:
    HARF_WRITE_FIXTURES=1 python -m pytest tests/test_page_model.py
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from engines.ai_engines import parse_claude_json  # noqa: E402
from engines.common import Line, Word, in_language, lines_to_blocks  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "pages.json"
SIZE = (1200, 1600)


def w(text, x0, x1, y, conf=95):
    return Word(text, conf, (x0, y, x1, y + 30))


def line(*words):
    return Line(list(words), min(x.box[0] for x in words), words[0].box[1], max(x.box[2] for x in words), words[0].box[3])


def pages() -> dict:
    letter = [
        line(w("الموضوع:", 640, 760, 100), w("تقرير", 520, 620, 100)),                  # short and centred: a heading
        line(w("نص", 1000, 1100, 200), w("الكتاب", 700, 980, 200, conf=30), w("الأول", 100, 680, 200)),  # one word unsure
        line(w("تكملة", 600, 1100, 236)),                                                # close below: the same paragraph
        line(w("•", 1080, 1100, 320), w("بند", 700, 1050, 320)),                        # a bullet
        line(w("المدير", 100, 300, 460)),                                                # short, far side: a signature
    ]
    parts_row = [
        line(w("الرقم:", 1000, 1100, 100), w("245", 920, 980, 100), w("التاريخ:", 300, 400, 100), w("10/11/2026", 150, 280, 100)),
        line(w("نص", 150, 1100, 170)),
    ]
    lineless = [line(*(w(t, x0, x1, y) for t, x0, x1 in cells)) for y, cells in (
        (100, [("اليوم", 900, 1000), ("الساعة", 700, 780), ("المكان", 200, 300)]),
        (150, [("الأحد", 910, 1000), ("9:00", 720, 780), ("قاعة", 220, 300)]),
        (200, [("الثلاثاء", 880, 1000), ("11:30", 705, 780), ("مكتب", 180, 300)]))]
    claude = parse_claude_json('{"blocks":[{"type":"heading","text":"الموضوع"},'
                               '{"type":"paragraph","text":"قرأنا [[الكتاب||غير واضح]] المرفق"},'
                               '{"type":"table","rows":[["أ","ب"],["1","2"]]}],'
                               '"notes":[{"anchor":"المرفق","note":"ختم"}]}')
    out = {"letter": lines_to_blocks(letter, 65, (), SIZE), "parts row": lines_to_blocks(parts_row, 65, (), SIZE),
           "lineless table": lines_to_blocks(lineless, 65, (), SIZE), "claude": claude}
    # as the browser gets them: notes are text in the page's language
    return json.loads(json.dumps({k: in_language(v, "ar") for k, v in out.items()}, ensure_ascii=False))


def test_the_readers_page_model_matches_the_shared_fixtures():
    now = pages()
    if os.environ.get("HARF_WRITE_FIXTURES"):
        FIXTURES.parent.mkdir(parents=True, exist_ok=True)
        FIXTURES.write_text(json.dumps(now, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    assert now == json.loads(FIXTURES.read_text(encoding="utf-8")), "the page model changed: see this file's docstring"


def test_the_fixtures_hold_every_kind_the_browser_must_read():
    kinds = {b["type"] for p in pages().values() for b in p}
    assert {"h", "p", "li", "table"} <= kinds
    segs = [s for p in pages().values() for b in p for s in (b.get("segs") or [x for r in b.get("rows", []) for c in r for x in c])]
    assert any("note" in s for s in segs) and any("box" in s for s in segs)
