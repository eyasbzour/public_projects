"""Harf OCR server: reads photographed pages, stores drafts, serves header templates and the web app.

Run:  uvicorn main:app --host 0.0.0.0 --port 8000   (from the server/ folder)
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import os
import re
import secrets
import shutil
import time
import uuid
import zipfile
from functools import lru_cache
from pathlib import Path

from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

import convert
import engines
from messages import Msg, language_file, languages, msg, payload, to_json
import parts
import remote

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("DOCSCAN_DATA", ROOT / "data"))
DRAFTS = DATA / "drafts"
TEMPLATES = Path(os.environ.get("DOCSCAN_TEMPLATES", ROOT / "templates"))
WEB = ROOT / "web"
for d in (DRAFTS, TEMPLATES):
    d.mkdir(parents=True, exist_ok=True)

APP_PASSWORD = os.environ.get("APP_PASSWORD", "")      # optional shared password for the whole app
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")        # needed to add/remove templates (if set)
LOW_CONF = float(os.environ.get("LOW_CONFIDENCE", "65"))
OCR_SLOTS = asyncio.Semaphore(int(os.environ.get("MAX_OCR_JOBS", "2")))
CONVERT_SLOTS = asyncio.Semaphore(int(os.environ.get("MAX_CONVERT_JOBS", "2")))
MAX_UPLOAD = 25 * 1024 * 1024
CLAUDE_MODELS = os.environ.get("CLAUDE_MODELS", "claude-sonnet-5-5,claude-opus-5-5,claude-haiku-5-5").split(",")

ID_RE = re.compile(r"^[a-f0-9]{32}$")
IMG_RE = re.compile(r"^[a-f0-9]{32}\.jpg$")
TPL_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,60}$")

class Reply(JSONResponse):
    """Every JSON reply: messages in it go out as {key, args} (messages.py to_json), in whatever field."""

    def render(self, content) -> bytes:
        return super().render(to_json(content))


app = FastAPI(title="Harf OCR", docs_url=None, redoc_url=None, default_response_class=Reply)


# ------------------------------------------------------------------ web files: always the current version
# After an update the browser must not mix a cached old stylesheet with the new page (the page looked broken
# until Ctrl+F5). "no-cache" still uses the cache, but asks first; unchanged files answer 304 at no cost.
@app.middleware("http")
async def revalidate_web_files(request: Request, call_next):
    response = await call_next(request)
    if request.method == "GET" and not request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


# ------------------------------------------------------------------ optional shared password
@app.middleware("http")
async def password_gate(request: Request, call_next):
    if APP_PASSWORD:
        auth = request.headers.get("authorization", "")
        ok = False
        if auth.lower().startswith("basic "):
            try:
                _, pw = base64.b64decode(auth[6:]).decode().split(":", 1)
                ok = secrets.compare_digest(pw, APP_PASSWORD)
            except Exception:
                ok = False
        if not ok:
            return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="Harf OCR"'})
    return await call_next(request)


# ------------------------------------------------------------------ use on phone (remote.py)
# what a phone may reach before signing in: the sign-in page and what it draws with
PHONE_OPEN = ("/phone.html", "/api/remote/login", "/css/app.css", "/js/theme.js", "/vendor/icons.svg",
              "/js/i18n.js", "/i18n/all.js")
PC_ONLY = ("/api/remote", "/api/update", "/api/parts", "/api/restart", "/api/lang")  # the program's own controls


@app.middleware("http")
async def phone_gate(request: Request, call_next):
    if not remote.is_remote(request.scope):
        return await call_next(request)
    path = request.url.path
    if path in PHONE_OPEN:
        return await call_next(request)
    if path.startswith(PC_ONLY):
        return refuse(msg("server.onlyAvailableComputer"), 403)
    if remote.signed_in(request.cookies.get(remote.COOKIE)):
        return await call_next(request)
    if path.startswith("/api/"):
        return refuse(msg("server.sessionEndedOpenLinkAgain"), 401)
    return RedirectResponse("/phone.html", status_code=303)


def refuse(m, status: int, **extra) -> JSONResponse:
    """A refusal or error reply: {"error", "key", "args"} (messages.py payload), so the page shows it in its language."""
    return Reply({**payload(m), **extra}, status_code=status)


def _err(status: int, m: Msg):
    raise HTTPException(status_code=status, detail=m)


@app.exception_handler(StarletteHTTPException)
async def _http_error(request: Request, exc: StarletteHTTPException):
    """An _err() refusal goes out like refuse(); FastAPI's own (404 for an unknown path) as before."""
    if isinstance(exc.detail, Msg):
        return refuse(exc.detail, exc.status_code)
    return await http_exception_handler(request, exc)


# ------------------------------------------------------------------ the Windows program: updates
DESKTOP = os.environ.get("DOCSCAN_DESKTOP") == "1"
if DESKTOP:
    import updater

    updater.check_in_background()


@app.get("/api/update")
def update_status():
    """Is a newer version released? Only the Windows program checks; the server answers "no" otherwise."""
    return updater.status() if DESKTOP else {"current": None, "checked": True, "update": None}


@app.post("/api/update/check")
def update_check():
    if not DESKTOP:
        return update_status()
    try:
        return updater.check_now()
    except Exception:
        return refuse(msg("server.couldntReachGithubCheckInternet"), 502)


@app.post("/api/update/install")
async def update_install():
    if not DESKTOP:
        return refuse(msg("server.updatingOnlyAvailableWindowsProgram"), 404)
    try:
        await run_in_threadpool(updater.install, QUIT_APP[0])
    except Exception as e:
        return refuse(msg("server.couldntUpdate", error=e), 502)
    return {"ok": True}


QUIT_APP = [lambda: os._exit(0)]  # desktop/app.py replaces it with closing its window
RESTART_APP = [None]  # desktop/app.py sets it: close, and open again


@app.post("/api/restart")
def restart():
    if not RESTART_APP[0]:
        return refuse(msg("server.restartingOnlyAvailableWindowsProgram"), 404)
    RESTART_APP[0]()
    return {"ok": True}


@app.get("/api/parts")
def parts_status():
    return parts.status()


@app.post("/api/parts/stop")
def parts_stop():
    parts.stop()
    return parts.status()


@app.post("/api/parts/install")
def parts_install():
    if not parts.offered():
        return refuse(msg("server.downloadingReadersOnlyAvailableWindows"), 404)
    try:
        parts.start()
    except Exception as e:
        return refuse(e, 507)
    return parts.status()


# ------------------------------------------------------------------ use on phone: the link and its QR code
@app.get("/api/remote")
def remote_status():
    if not remote.offered():
        return refuse(msg("server.usePhoneOnlyAvailableWindows"), 404)
    st = remote.status()
    if st["state"] == "on":
        import segno

        # dark on light whatever the theme: phone cameras read it that way
        st["qr"] = segno.make(st["url"], error="m").svg_inline(scale=5, border=2, dark="#14161a", light="#fdfdfd")
        st["shown"] = st["password"][:4] + " " + st["password"][4:]
    return st


@app.post("/api/remote/start")
def remote_start():
    if not remote.offered():
        return refuse(msg("server.usePhoneOnlyAvailableWindows"), 404)
    remote.start(app)
    return remote_status()


@app.post("/api/remote/stop")
def remote_stop():
    remote.stop()
    return remote_status()


@app.post("/api/remote/login")
async def remote_login(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    try:
        token = remote.login(str(body.get("password", "")))
    except PermissionError:
        return refuse(msg("server.tooManyTriesWaitMinute"), 429)
    if not token:
        return refuse(msg("server.wrongPassword"), 401)
    res = JSONResponse({"ok": True})
    # the phone reaches it over https (the tunnel), so the cookie is Secure; it lasts while the browser is open
    res.set_cookie(remote.COOKIE, token, httponly=True, secure=True, samesite="lax", path="/")
    return res


# ------------------------------------------------------------------ engines + OCR
@app.get("/api/engines")
def list_engines(request: Request):
    out = []
    for e in engines.ENGINES:
        ok, why = engines.availability(e["id"])
        server_key = bool((e["key"] == "claude" and os.environ.get("ANTHROPIC_API_KEY")) or
                          (e["key"] == "google" and os.environ.get("GOOGLE_VISION_API_KEY")))
        # Nuqta and EasyOCR come as one download in the Windows program (parts.py)
        installable = not ok and e["id"] in ("nuqta", "easyocr") and parts.offered() and not remote.is_remote(request.scope)
        if installable and parts.status()["state"] == "restart":
            installable, why = False, msg("server.downloadCompleteRestartProgramReader")
        out.append({**e, "available": ok, "reason": why or None, "serverKey": server_key, "installable": installable})
    return {"engines": out, "claudeModels": CLAUDE_MODELS, "lowConfidence": LOW_CONF}


@app.post("/api/ocr")
async def ocr(
    draft_id: str = Form(...),
    image: str = Form(...),
    engine: str = Form("tess-standard"),
    rotation: int = Form(0),
    cleanup: str = Form("clean"),
    model: str = Form(""),
    skip_letterhead: bool = Form(True),
    api_key: str = Form(""),
    langs: str = Form("ara+eng"),
    direction: str = Form("auto"),
):
    path = _image_path(draft_id, image)
    if cleanup not in ("none", "clean", "bw"):
        cleanup = "clean"
    data = path.read_bytes()
    t0 = time.time()
    async with OCR_SLOTS:
        try:
            blocks, lang = await run_in_threadpool(
                engines.run, engine, data, rotation=rotation, cleanup=cleanup,
                api_key=api_key or None, model=model or None,
                skip_letterhead=skip_letterhead, low_conf=LOW_CONF,
                langs=langs if langs in ("ara", "ara+eng") else "ara+eng",
                direction=direction if direction in ("auto", "rtl", "ltr") else "auto")
        except engines.EngineError as e:
            return refuse(e, 422)
        except Exception as e:  # never echo the key or the request body
            return refuse(msg("server.unexpectedErrorWhileReading", error=type(e).__name__), 500)
    # lang: the document's language (its notes, "[Signature]"), kept with the page for reading its spots again
    return {"blocks": blocks, "lang": lang, "engine": engine, "seconds": round(time.time() - t0, 1)}


@app.post("/api/ocr-spots")
async def ocr_spots(
    draft_id: str = Form(...),
    image: str = Form(...),
    engine: str = Form("tess-best"),
    boxes: str = Form(...),  # JSON: [[x0, y0, x1, y1], ...] as fractions of the page as read
    rotation: int = Form(0),
    cleanup: str = Form("clean"),
    model: str = Form(""),
    api_key: str = Form(""),
    langs: str = Form("ara+eng"),
    doc_lang: str = Form(""),  # the page's language (/api/ocr "lang"): notes in what is read come in it
):
    """A second opinion: read only some spots of a page (flagged words, a paragraph) with another engine."""
    try:
        spots = [[float(v) for v in b][:4] for b in json.loads(boxes)][:80]
        assert spots and all(len(b) == 4 and 0 <= b[0] < b[2] <= 1 and 0 <= b[1] < b[3] <= 1 for b in spots)
    except Exception:
        return refuse(msg("server.invalidSpots"), 422)
    data = _image_path(draft_id, image).read_bytes()
    t0 = time.time()
    async with OCR_SLOTS:
        try:
            results = await run_in_threadpool(
                engines.read_spots, engine, data, spots, rotation=rotation,
                cleanup=cleanup if cleanup in ("none", "clean", "bw") else "clean", api_key=api_key or None,
                model=model or None, low_conf=LOW_CONF, langs=langs if langs in ("ara", "ara+eng") else "ara+eng",
                doc_lang=doc_lang if doc_lang in languages() else None)
        except engines.EngineError as e:
            return refuse(e, 422)
        except Exception as e:  # never echo the key or the request body
            return refuse(msg("server.unexpectedErrorWhileReading", error=type(e).__name__), 500)
    return {"results": results, "engine": engine, "seconds": round(time.time() - t0, 1)}


# ------------------------------------------------------------------ drafts
def _draft_dir(draft_id: str) -> Path:
    if not ID_RE.match(draft_id or ""):
        _err(400, msg("server.invalidDraftId"))
    return DRAFTS / draft_id


def _load(draft_id: str) -> dict:
    f = _draft_dir(draft_id) / "draft.json"
    if not f.exists():
        _err(404, msg("server.draftNotFound"))
    return json.loads(f.read_text(encoding="utf8"))


def _save(d: dict) -> None:
    dd = _draft_dir(d["id"])
    dd.mkdir(parents=True, exist_ok=True)
    tmp = dd / "draft.json.tmp"
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf8")
    tmp.replace(dd / "draft.json")


def _image_path(draft_id: str, name: str) -> Path:
    if not IMG_RE.match(name or ""):
        _err(400, msg("server.invalidPhotoName"))
    p = _draft_dir(draft_id) / "images" / name
    if not p.exists():
        _err(404, msg("server.photoNotFound"))
    return p


# the drafts list's line for each draft.json, by its path, with the file's (mtime, size) it was read at: a draft file
# holds every page's text and versions, so it is read again only when it changed
_SUMMARIES: dict[Path, tuple[tuple[int, int], dict]] = {}


@app.get("/api/drafts")
def list_drafts():
    items, seen = [], set()
    for f in DRAFTS.glob("*/draft.json"):
        try:
            st = f.stat()
            stamp = (st.st_mtime_ns, st.st_size)
            hit = _SUMMARIES.get(f)
            if not hit or hit[0] != stamp:
                d = json.loads(f.read_text(encoding="utf8"))
                hit = _SUMMARIES[f] = (stamp, {"id": d["id"], "name": d.get("name", ""), "owner": d.get("owner", ""),
                                               "updated": d.get("updated", 0), "pages": len(d.get("pages", []))})
        except Exception:
            continue
        seen.add(f)
        items.append(hit[1])
    for gone in set(_SUMMARIES) - seen:  # deleted drafts
        _SUMMARIES.pop(gone, None)  # another request may have dropped it already
    items.sort(key=lambda x: -x["updated"])
    return {"drafts": items}


@app.post("/api/drafts")
def create_draft(body: dict = Body(...)):
    now = time.time()
    tpls = list_templates()["templates"]  # sorted: first one is the default
    d = {"id": uuid.uuid4().hex, "name": str(body.get("name") or msg("ui.newDraft"))[:200],
         "owner": str(body.get("owner") or "")[:100], "created": now, "updated": now, "version": 1,
         "template": body.get("template") or (tpls[0]["id"] if tpls else ""), "date": body.get("date") or "", "pages": []}
    _save(d)
    return d


@app.get("/api/drafts/{draft_id}")
def get_draft(draft_id: str):
    return _load(draft_id)


@app.put("/api/drafts/{draft_id}")
def put_draft(draft_id: str, body: dict = Body(...)):
    cur = _load(draft_id)
    if int(body.get("version", 0)) != int(cur.get("version", 0)):
        return refuse(msg("server.someoneElseEditedDraftOpen"), 409, current=cur)
    keep = {"id": cur["id"], "created": cur.get("created")}
    d = {**body, **keep, "updated": time.time(), "version": int(cur.get("version", 0)) + 1}
    _save(d)
    return {"version": d["version"], "updated": d["updated"]}


@app.delete("/api/drafts/{draft_id}")
def delete_draft(draft_id: str):
    dd = _draft_dir(draft_id)
    if dd.exists():
        shutil.rmtree(dd)
    return {"ok": True}


@app.post("/api/drafts/{draft_id}/images")
def upload_image(draft_id: str, file: UploadFile = File(...)):
    dd = _draft_dir(draft_id)
    if not (dd / "draft.json").exists():
        _err(404, msg("server.draftNotFound"))
    raw = file.file.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD:
        _err(413, msg("server.photoTooLargeLimitMb", limit=MAX_UPLOAD // 1024 ** 2))
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
        _err(400, msg("server.fileIsntValidImage"))
    img.thumbnail((3200, 3200))
    name = uuid.uuid4().hex + ".jpg"
    (dd / "images").mkdir(exist_ok=True)
    img.save(dd / "images" / name, "JPEG", quality=90)
    return {"name": name, "width": img.width, "height": img.height}


@app.get("/api/drafts/{draft_id}/images/{name}")
def get_image(draft_id: str, name: str):
    return FileResponse(_image_path(draft_id, name), media_type="image/jpeg",
                        headers={"Cache-Control": "private, max-age=86400"})


# ------------------------------------------------------------------ header templates
def _check_admin(token: str):
    if ADMIN_TOKEN and not secrets.compare_digest(token or "", ADMIN_TOKEN):
        _err(403, msg("server.wrongAdminCode"))


@app.get("/api/templates")
def list_templates():
    out = []
    for f in TEMPLATES.glob("*.docx"):
        meta = TEMPLATES / (f.stem + ".json")
        info = {}
        if meta.exists():
            try:
                info = json.loads(meta.read_text(encoding="utf8"))
            except Exception:
                info = {}
        # the built-in one is named in the language files; a user's keeps what was typed
        name = msg("template.noHeader") if f.stem == "plain" else info.get("name") or f.stem
        out.append({"id": f.stem, "name": name, "order": int(info.get("order", 50))})
    # lowest "order" first; the first template is the default for new drafts
    out.sort(key=lambda t: (t["order"], str(t["name"])))
    return {"templates": out, "adminRequired": bool(ADMIN_TOKEN)}


@app.get("/api/templates/{tpl_id}/file")
def template_file(tpl_id: str):
    if not TPL_RE.match(tpl_id):
        _err(400, msg("server.invalidTemplateId"))
    f = TEMPLATES / f"{tpl_id}.docx"
    if not f.exists():
        _err(404, msg("server.templateNotFound"))
    return FileResponse(f, media_type=convert.FORMATS["docx"]["mime"])


@app.post("/api/templates")
def add_template(name: str = Form(...), file: UploadFile = File(...), admin_token: str = Form("")):
    _check_admin(admin_token)
    raw = file.file.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD or not raw.startswith(b"PK"):
        _err(400, msg("server.fileIsntValidWordFile"))
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            if "word/document.xml" not in z.namelist():
                raise ValueError
    except Exception:
        _err(400, msg("server.fileIsntValidWordFile"))
    tid = "t-" + uuid.uuid4().hex[:10]
    (TEMPLATES / f"{tid}.docx").write_bytes(raw)
    (TEMPLATES / f"{tid}.json").write_text(json.dumps({"name": name[:120]}, ensure_ascii=False), encoding="utf8")
    return {"id": tid, "name": name}


@app.delete("/api/templates/{tpl_id}")
def delete_template(tpl_id: str, admin_token: str = ""):
    _check_admin(admin_token)
    if not TPL_RE.match(tpl_id):
        _err(400, msg("server.invalidTemplateId"))
    if tpl_id == "plain":  # ships with the program and the server image; the page offers no delete for it
        _err(400, msg("server.builtInTemplateCantDelete"))
    for ext in (".docx", ".json"):
        p = TEMPLATES / f"{tpl_id}{ext}"
        if p.exists():
            p.unlink()
    return {"ok": True}


# ------------------------------------------------------------------ export formats
@app.get("/api/formats")
def formats():
    can = convert.available()
    return {"formats": [{"id": k, "label": v["label"], "available": can.get(k, False)} for k, v in convert.FORMATS.items()]}


@app.post("/api/convert")
async def convert_doc(file: UploadFile = File(...), format: str = Form("pdf"), name: str = Form("document")):
    raw = await file.read(MAX_UPLOAD * 2 + 1)
    if len(raw) > MAX_UPLOAD * 2 or not raw.startswith(b"PK"):
        _err(400, msg("server.invalidWordFile"))
    async with CONVERT_SLOTS:
        try:
            data, filename, mime = await run_in_threadpool(convert.convert, raw, format, name)
        except convert.ConvertError as e:
            return refuse(e, 422)
    from urllib.parse import quote
    return Response(data, media_type=mime, headers={
        "Content-Disposition": f"attachment; filename=\"document.{filename.rsplit('.', 1)[-1]}\"; filename*=UTF-8''{quote(filename)}"})


@app.post("/api/lang")
async def set_lang(request: Request):
    """The Windows program: the language picked in Settings, for what shows before the page next time (the splash,
    the window title, the web engine's own words). desktop/app.py language() reads the file it names."""
    if not DESKTOP:
        return refuse(msg("server.onlyAvailableWindowsProgram"), 404)
    try:
        body = await request.json()
    except ValueError:
        body = None
    lang = body.get("lang") if isinstance(body, dict) else None
    if lang not in languages():
        _err(400, msg("server.unknownLanguage"))
    Path(os.environ["DOCSCAN_LANG_FILE"]).write_text(lang, encoding="utf-8")
    os.environ["DOCSCAN_LANG"] = lang  # the default in /i18n/all.js from now on
    return {"lang": lang}


# ------------------------------------------------------------------ web app
@lru_cache(maxsize=8)
def _all_languages(default: str) -> tuple[str, str]:
    body = f"window.HARF_LANG_DEFAULT = {json.dumps(default)};\n" if default else ""
    body += "".join(f"I18N.add({json.dumps(code)}, {json.dumps({'_meta': meta, **entries}, ensure_ascii=False)});\n"
                    for code in languages() for meta, entries in [language_file(code)])
    return body, '"' + hashlib.sha1(body.encode("utf-8")).hexdigest()[:16] + '"'


@app.get("/i18n/all.js")
def all_languages(request: Request):
    """Every language file (web/i18n/*.json) as one script, so adding a language is adding its file; first the
    interface language until the user picks one (web/js/i18n.js): DOCSCAN_LANG, which the Windows program sets from
    its installer's language or the pick in Settings (desktop/app.py, /api/lang), or an office server's admin sets.
    Built once per default; the browser asks again each load (no-cache) and gets 304 while it has the same one."""
    lang = os.environ.get("DOCSCAN_LANG", "")
    body, etag = _all_languages(lang if lang in languages() else "")
    headers = {"Cache-Control": "no-cache", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(body, media_type="text/javascript", headers=headers)


app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
