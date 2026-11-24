"""The readers' seam (engines/__init__.py Reader): the shared pipeline with a stand-in reader, no OCR installed."""
import io
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import engines  # noqa: E402
from engines import Reader  # noqa: E402
from engines.common import Line, Word  # noqa: E402


def photo(size=(1000, 600)):
    buf = io.BytesIO()
    Image.new("RGB", size, "white").save(buf, "PNG")
    return buf.getvalue()


def stand_in(monkeypatch, lines, **kw):
    seen = {}

    def read(job):
        seen["job"] = job
        return lines

    r = Reader("fake", "Fake", "free", lambda: (True, ""), read, **kw)
    monkeypatch.setitem(engines.BY_ID, "fake", r)
    return seen


def test_a_reader_only_gives_lines_and_the_pipeline_lays_them_out(monkeypatch):
    unsure = Word("مرفق", 50, (300, 100, 420, 130))
    stand_in(monkeypatch, [Line([Word("الكتاب", 95, (500, 100, 700, 130)), unsure], 300, 100, 700, 130)])
    blocks, lang = engines.run("fake", photo(), direction="rtl")
    assert lang == "ar" and blocks[0]["type"] in ("p", "h")
    assert any("note" in s for s in blocks[0]["segs"])  # 50 is under the usual threshold (65)


def test_a_reader_with_its_own_confidence_scale_flags_by_it(monkeypatch):
    stand_in(monkeypatch, [Line([Word("الكتاب", 95, (500, 100, 700, 130)), Word("مرفق", 50, (300, 100, 420, 130))],
                                300, 100, 700, 130)], low_conf=35)
    blocks, _ = engines.run("fake", photo(), direction="rtl")
    assert not any("note" in s for s in blocks[0]["segs"])  # 50 is sure enough on a scale that runs lower


def test_only_a_reader_that_asks_for_it_gets_the_cleaned_page_and_the_languages(monkeypatch):
    seen = stand_in(monkeypatch, [])
    engines.run("fake", photo(), cleanup="bw", langs="ara")
    assert seen["job"].img.width == 1000  # as photographed
    seen = stand_in(monkeypatch, [], cleanup=True)
    engines.run("fake", photo(), cleanup="bw", langs="ara")
    assert seen["job"].img.width > 1000 and seen["job"].langs == "ara"  # cleaned up: made larger for Tesseract


def test_the_readers_list_says_what_each_takes(monkeypatch):
    from fastapi.testclient import TestClient

    import main

    got = {e["id"]: e for e in TestClient(main.app).get("/api/engines").json()["engines"]}
    assert [e["id"] for e in got.values()] == [r.id for r in engines.READERS]
    assert got["tess-best"]["cleanup"] and not got["paddle"]["cleanup"]
    assert got["claude"]["key"] == "claude" and got["paddle"]["key"] is None
