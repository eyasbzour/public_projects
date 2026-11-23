"""Text by name (messages.py, web/i18n/*.json): no Arabic text left in the server or the Windows launcher, every
msg(), doc() and tr() name exists with exactly its values, replies carry their name, and a left-to-right page's
document text is English. Run from server/: python -m pytest tests -q"""
import ast
import os
import re
import string
import tempfile
from pathlib import Path

os.environ.setdefault("DOCSCAN_DATA", tempfile.mkdtemp(prefix="harf-test-data-"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from engines.common import low_note  # noqa: E402
from engines.marks import LABELS, note_for  # noqa: E402
from engines.common import in_language  # noqa: E402
from messages import doc, language_file, languages, msg, payload, render, to_json  # noqa: E402

SERVER = Path(__file__).resolve().parent.parent
FILES = [p for p in SERVER.rglob("*.py") if "tests" not in p.parts] + [SERVER.parent / "desktop" / "app.py"]
ARABIC = re.compile("[؀-ۿ]")
SOURCE = language_file("ar")[1]
# Arabic that is about the document's own text, not words anyone is shown: patterns and digit tables
PATTERN_CALLS = {"compile", "maketrans"}


def _name(call):
    f = call.func
    return f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else ""


def _trees():
    for path in FILES:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            for child in ast.iter_child_nodes(node):
                child.parent = node
        yield path, tree


def _under(node, test):
    while node is not None:
        if test(node):
            return True
        node = getattr(node, "parent", None)
    return False


def test_no_arabic_text_in_the_code():
    loose = []
    for path, tree in _trees():
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Constant) and isinstance(node.value, str) and ARABIC.search(node.value)):
                continue
            if isinstance(node.parent, ast.Expr):  # a docstring
                continue
            if _under(node, lambda n: isinstance(n, ast.Call) and _name(n) in PATTERN_CALLS):
                continue
            # Claude's instructions quote the kind of text it will find ("أولاً:"); its own words come from the files
            if _under(node, lambda n: isinstance(n, ast.FunctionDef) and n.name == "claude_prompt"):
                continue
            loose.append(f"{path.relative_to(SERVER.parent)}:{node.lineno}: {node.value[:60]}")
    assert loose == []


def _holes(template):
    return {f for _, f, _, _ in string.Formatter().parse(template) if f}


def _other(v):
    return v["other"] if isinstance(v, dict) else v


def test_each_name_exists_with_exactly_its_values():
    bad = []
    for path, tree in _trees():
        for c in ast.walk(tree):
            if isinstance(c, ast.Call) and _name(c) in ("msg", "doc", "tr") and c.args and isinstance(c.args[0], ast.Constant):
                key = c.args[0].value
                if key not in SOURCE:
                    bad.append(f"{path.name}:{c.lineno}: no {key}")
                elif _name(c) != "tr" and _holes(_other(SOURCE[key])) != {k.arg for k in c.keywords}:
                    bad.append(f"{path.name}:{c.lineno}: values of {key}")
                elif _name(c) == "doc" and not key.startswith("doc."):
                    bad.append(f"{path.name}:{c.lineno}: doc() takes doc.* names")
    assert bad == []


# ---- replies
@pytest.fixture(scope="module")
def client():
    import main

    return TestClient(main.app)


def test_payload_carries_the_name_and_nested_messages():
    inner = RuntimeError(msg("server.couldntReadEasyocr", error="boom"))
    p = to_json(payload(msg("server.couldntDownloadExtraReaders", error=inner)))
    assert p["key"] == "server.couldntDownloadExtraReaders"
    assert p["args"]["error"] == {"key": "server.couldntReadEasyocr", "args": {"error": "boom"}}
    assert p["error"] == render("ar", "server.couldntDownloadExtraReaders", error=render("ar", "server.couldntReadEasyocr", error="boom"))
    assert payload(ValueError("plain")) == {"error": "plain"}


def test_a_refusal_has_its_name(client):
    r = client.get("/api/drafts/not-a-valid-id!")
    assert r.status_code in (400, 404)
    body = r.json()
    assert body["key"] in ("server.invalidDraftId", "server.draftNotFound") and body["error"] == SOURCE[body["key"]]


def test_an_unknown_path_still_gets_fastapis_reply(client):
    r = client.get("/api/nothing-here")
    assert r.status_code == 404 and "key" not in r.json()


def test_messages_go_out_as_names_in_any_field(client):
    eng = {e["id"]: e["label"] for e in client.get("/api/engines").json()["engines"]}
    assert eng["paddle"] == {"key": "reader.paddleocrRecommended", "args": {}} and eng["easyocr"] == "EasyOCR"
    tpl = client.get("/api/templates").json()["templates"]
    assert {"key": "template.noHeader", "args": {}} in [t["name"] for t in tpl]


def test_all_languages_with_the_default(client, monkeypatch):
    monkeypatch.setenv("DOCSCAN_LANG", "en")
    body = client.get("/i18n/all.js").text
    assert body.startswith('window.HARF_LANG_DEFAULT = "en";\n')
    for code in languages():
        assert f'I18N.add("{code}", {{"_meta"' in body
    monkeypatch.setenv("DOCSCAN_LANG", "xx")  # no such language file: no default
    assert client.get("/i18n/all.js").text.startswith("I18N.add(")


def test_language_files():
    assert {"ar", "en"} <= set(languages())
    meta, words = language_file("en")
    assert meta == {"name": "English", "dir": "ltr"} and words["ui.save"] == "Save"
    assert language_file("ar")[0]["dir"] == "rtl"


def test_lang_is_for_the_windows_program(client):
    assert client.post("/api/lang", json={"lang": "en"}).status_code == 404  # a server: no


# ---- the document's own text
def test_an_english_page_gets_english_notes_and_labels():
    blocks = [{"type": "p", "segs": [{"s": "Dear "}, {"s": doc("doc.bracketLabel", label=LABELS["sign"]), "note": note_for("sign", "محمد")}]},
              {"type": "table", "rows": [[[{"s": "x", "note": low_note(40)}]]]}]
    in_language(blocks, "en")
    seg = blocks[0]["segs"][1]
    assert seg["s"] == "[Signature]"
    assert seg["note"].startswith("The machine reading can't read this signature in the photo") and '"محمد"' in seg["note"]
    assert blocks[1]["rows"][0][0][0]["note"] == "Uncertain reading (confidence 40%). Compare it with the original photo."


def test_an_arabic_page_keeps_its_arabic():
    blocks = [{"type": "p", "segs": [{"s": "x", "note": low_note(40)}]}]
    in_language(blocks, "ar")
    note = blocks[0]["segs"][0]["note"]
    # plain text: a message left in would reach the browser as {key, args} and come out in the interface's language
    assert note == SOURCE["doc.uncertainReadingConfidenceCompareOriginal"].format(conf=40) and type(note) is str


def test_render_plurals_and_fallback():
    assert render("ar", "app.pageCount", n=2) == "صفحتان"
    assert render("en", "app.pageCount", n=0) == "No pages"
    assert render("xx", "ui.save") == SOURCE["ui.save"]  # no such language: the Arabic


# ---- the review's fixes
def test_claude_and_google_notes_follow_the_page(monkeypatch):
    import io

    from PIL import Image

    import engines
    from engines import ai_engines

    buf = io.BytesIO()
    Image.new("RGB", (40, 40), "white").save(buf, "PNG")
    def english(*a, **k):  # a new page each time: in_language changes the blocks it is given
        return [{"type": "p", "segs": [{"s": "The quarterly report of the archive department is attached "},
                                       {"s": "here", "note": low_note(40)}]}]
    monkeypatch.setattr(ai_engines, "run_google", english)
    out, lang = engines.run("google", buf.getvalue(), api_key="k")
    assert lang == "en" and out[0]["segs"][1]["note"] == "Uncertain reading (confidence 40%). Compare it with the original photo."
    # a spot read again keeps the page's language, whatever the cut-out looks like
    out, lang = engines.run("google", buf.getvalue(), api_key="k", doc_lang="ar")
    assert lang == "ar" and out[0]["segs"][1]["note"] == SOURCE["doc.uncertainReadingConfidenceCompareOriginal"].format(conf=40)


def test_a_claude_note_placed_roughly_is_in_the_page_language():
    from engines.ai_engines import _attach_note

    blocks = [{"type": "p", "segs": [{"s": "Dear Director,", "note": low_note(30)}]}]
    _attach_note(blocks, "nowhere on the page", "A stamp")
    in_language(blocks, "en")
    assert blocks[0]["segs"][0]["note"] == ("Uncertain reading (confidence 30%). Compare it with the original photo.\n"
                                            "(the note's place is approximate) A stamp")


def test_lang_refuses_a_body_that_is_not_an_object(client, monkeypatch, tmp_path):
    import main

    monkeypatch.setattr(main, "DESKTOP", True)
    monkeypatch.setenv("DOCSCAN_LANG_FILE", str(tmp_path / "lang"))
    for body in (["en"], "en", None):
        r = client.post("/api/lang", json=body)
        assert r.status_code == 400 and r.json()["key"] == "server.unknownLanguage", body
    assert client.post("/api/lang", content=b"not json", headers={"content-type": "application/json"}).status_code == 400
    assert client.post("/api/lang", json={"lang": "en"}).status_code == 200
    assert (tmp_path / "lang").read_text(encoding="utf-8") == "en"


def test_limits_in_messages_come_from_their_values():
    import main
    import parts

    assert str(main.MAX_UPLOAD // 1024 ** 2) in msg("server.photoTooLargeLimitMb", limit=main.MAX_UPLOAD // 1024 ** 2)
    assert render("en", "server.notEnoughDiskSpaceAbout", need=parts.NEED // 1024 ** 3).startswith("Not enough disk space: about 7 GB")


def test_plurals_by_language():
    assert render("en", "app.pageCount", n=15) == "15 pages"  # English has no "many"
    assert render("ar", "app.pageCount", n=15) == "15 صفحة"


# ---- caching
def test_all_languages_answers_304_when_unchanged(client):
    r = client.get("/i18n/all.js")
    etag = r.headers["etag"]
    assert r.status_code == 200 and etag
    r2 = client.get("/i18n/all.js", headers={"If-None-Match": etag})
    assert r2.status_code == 304 and r2.content == b""


def test_drafts_list_follows_changes(client):
    d = client.post("/api/drafts", json={"name": "first"}).json()
    names = lambda: {x["id"]: x["name"] for x in client.get("/api/drafts").json()["drafts"]}  # noqa: E731
    assert names()[d["id"]] == "first"
    cur = client.get(f"/api/drafts/{d['id']}").json()
    client.put(f"/api/drafts/{d['id']}", json={**cur, "name": "renamed"})
    assert names()[d["id"]] == "renamed"
    client.delete(f"/api/drafts/{d['id']}")
    assert d["id"] not in names()
