"""The draft store on a temp folder (server/drafts.py): saving, conflicts, the list and photos."""
import io
import os
import sys

import pytest
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from drafts import DraftError, DraftStore  # noqa: E402


@pytest.fixture
def store(tmp_path):
    return DraftStore(tmp_path / "drafts")


def new(store, name="Letter"):
    return store.create(name=name, owner="x", template="plain", date="2026-11-23")


def refused(fn, *args):
    with pytest.raises(DraftError) as e:
        fn(*args)
    return e.value


def test_a_save_from_the_current_version_goes_through_and_counts_up(store):
    d = new(store)
    r = store.save(d["id"], {**d, "name": "Renamed", "id": "someone-else", "created": 0})
    got = store.get(d["id"])
    assert r["version"] == got["version"] == 2 and got["name"] == "Renamed"
    assert got["id"] == d["id"] and got["created"] == d["created"]  # the client can't change who it is


def test_a_save_from_an_older_version_is_refused_with_the_current_draft(store):
    d = new(store)
    store.save(d["id"], {**d, "name": "First edit"})
    e = refused(store.save, d["id"], {**d, "name": "Late edit"})  # still made from version 1
    assert e.status == 409 and e.extra["current"]["name"] == "First edit"
    assert store.get(d["id"])["name"] == "First edit"


def test_the_list_follows_saves_and_deletes(store):
    a, b = new(store, "A"), new(store, "B")
    assert [x["name"] for x in store.list()] == ["B", "A"]  # the last edited first
    store.save(a["id"], {**a, "name": "A2", "pages": [{"id": "p"}]})
    assert {x["name"]: x["pages"] for x in store.list()} == {"A2": 1, "B": 0}
    store.delete(b["id"])
    assert [x["name"] for x in store.list()] == ["A2"]


def test_bad_ids_and_missing_drafts(store):
    assert refused(store.get, "../etc").status == 400
    assert refused(store.get, "0" * 32).status == 404
    assert refused(store.add_image, "0" * 32, b"x").status == 404
    d = new(store)
    assert refused(store.image, d["id"], "../draft.json").status == 400
    assert refused(store.image, d["id"], "0" * 32 + ".jpg").status == 404


def png(size, mode="RGBA", colour=(0, 0, 0, 0)):
    buf = io.BytesIO()
    Image.new(mode, size, colour).save(buf, "PNG")
    return buf.getvalue()


def test_a_photo_with_see_through_parts_lands_on_white_and_no_larger_than_3200(store):
    d = new(store)
    r = store.add_image(d["id"], png((4000, 1000)))
    assert (r["width"], r["height"]) == (3200, 800)
    img = Image.open(store.image(d["id"], r["name"]))
    assert img.format == "JPEG" and min(img.getpixel((10, 10))) > 245  # white, not black
    assert refused(store.add_image, d["id"], b"not an image").status == 400
