"""The saved drafts: one folder each, <root>/<id>/draft.json and its photos in <root>/<id>/images/.

A draft is saved whole and atomically, and carries a version: a save names the version it was made from, and one made
from an older version (someone else saved in between) is refused with the current draft. The list reads each
draft.json again only when the file changed. Photos come in as any image and are kept as JPEG on white, at most
3200 px. Errors are DraftError with the HTTP status that fits them (main.py turns them into replies).
"""
from __future__ import annotations

import io
import json
import re
import shutil
import time
import uuid
from pathlib import Path

from PIL import Image, ImageOps

import sheet
from messages import Msg, msg

ID_RE = re.compile(r"^[a-f0-9]{32}$")
IMG_RE = re.compile(r"^[a-f0-9]{32}\.jpg$")
MAX_SIDE = 3200


class DraftError(Exception):
    def __init__(self, status: int, message: Msg, **extra):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra


class DraftStore:
    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        # each draft.json's line in the list, with the file's (mtime, size) it was read at: a draft file holds every
        # page's text and versions, so it is read again only when it changed
        self._summaries: dict[Path, tuple[tuple[int, int], dict]] = {}

    def _dir(self, draft_id: str) -> Path:
        if not ID_RE.match(draft_id or ""):
            raise DraftError(400, msg("server.invalidDraftId"))
        return self.root / draft_id

    def _write(self, d: dict) -> None:
        dd = self._dir(d["id"])
        dd.mkdir(parents=True, exist_ok=True)
        tmp = dd / "draft.json.tmp"
        tmp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf8")
        tmp.replace(dd / "draft.json")

    def list(self) -> list[dict]:
        """{id, name, owner, updated, pages} for each draft, the last edited first."""
        items, seen = [], set()
        for f in self.root.glob("*/draft.json"):
            try:
                st = f.stat()
                stamp = (st.st_mtime_ns, st.st_size)
                hit = self._summaries.get(f)
                if not hit or hit[0] != stamp:
                    d = json.loads(f.read_text(encoding="utf8"))
                    hit = self._summaries[f] = (stamp, {"id": d["id"], "name": d.get("name", ""), "owner": d.get("owner", ""),
                                                        "updated": d.get("updated", 0), "pages": len(d.get("pages", []))})
            except Exception:  # half written or not a draft: left out
                continue
            seen.add(f)
            items.append(hit[1])
        for gone in set(self._summaries) - seen:  # deleted drafts
            self._summaries.pop(gone, None)  # another request may have dropped it already
        items.sort(key=lambda x: -x["updated"])
        return items

    def create(self, *, name: str, owner: str, template: str, date: str) -> dict:
        now = time.time()
        d = {"id": uuid.uuid4().hex, "name": name[:200], "owner": owner[:100], "created": now, "updated": now,
             "version": 1, "template": template, "date": date, "pages": []}
        self._write(d)
        return d

    def get(self, draft_id: str) -> dict:
        f = self._dir(draft_id) / "draft.json"
        if not f.exists():
            raise DraftError(404, msg("server.draftNotFound"))
        return json.loads(f.read_text(encoding="utf8"))

    def save(self, draft_id: str, body: dict) -> dict:
        """Saves the draft the client sends, made from body["version"]: {version, updated} of the new one."""
        cur = self.get(draft_id)
        if int(body.get("version", 0)) != int(cur.get("version", 0)):
            raise DraftError(409, msg("server.someoneElseEditedDraftOpen"), current=cur)
        d = {**body, "id": cur["id"], "created": cur.get("created"), "updated": time.time(),
             "version": int(cur.get("version", 0)) + 1}
        self._write(d)
        return {"version": d["version"], "updated": d["updated"]}

    def delete(self, draft_id: str) -> None:
        dd = self._dir(draft_id)
        if dd.exists():
            shutil.rmtree(dd)

    def add_image(self, draft_id: str, raw: bytes, fit: bool = False) -> dict:
        """A photo for the draft, as sent: {name, width, height} of the JPEG kept. fit: a sheet photographed on a
        desk is cut out and flattened (sheet.py), and the photo as taken is kept too, as "original"."""
        dd = self._dir(draft_id)
        if not (dd / "draft.json").exists():
            raise DraftError(404, msg("server.draftNotFound"))
        try:
            img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
            if img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info):
                # a pasted screenshot or logo with see-through parts: on white paper, not black
                img = img.convert("RGBA")
                paper = Image.new("RGB", img.size, "white")
                paper.paste(img, mask=img.getchannel("A"))
                img = paper
            else:
                img = img.convert("RGB")
        except Exception:
            raise DraftError(400, msg("server.fileIsntValidImage")) from None
        img.thumbnail((MAX_SIDE, MAX_SIDE))
        (dd / "images").mkdir(exist_ok=True)

        def keep(im) -> str:
            name = uuid.uuid4().hex + ".jpg"
            im.save(dd / "images" / name, "JPEG", quality=90)
            return name
        corners = sheet.find_sheet(img) if fit else None
        if corners is None:
            return {"name": keep(img), "width": img.width, "height": img.height}
        original, flat = keep(img), sheet.flatten(img, corners)
        return {"name": keep(flat), "width": flat.width, "height": flat.height, "original": original}

    def image(self, draft_id: str, name: str) -> Path:
        if not IMG_RE.match(name or ""):
            raise DraftError(400, msg("server.invalidPhotoName"))
        p = self._dir(draft_id) / "images" / name
        if not p.exists():
            raise DraftError(404, msg("server.photoNotFound"))
        return p
