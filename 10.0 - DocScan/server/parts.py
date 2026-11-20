"""The optional readers (Nuqta and EasyOCR) for the Windows program, downloaded from inside it.

Setup offers them as a component (desktop/installer.iss); whoever skipped it, or whose download failed, adds them
here. The same two release assets are unpacked where setup puts them: {app}\\parts\\heavy (the libraries, with the
VERSION that setup compares) and {app}\\models. They work at once: the folder joins sys.path, as desktop/app.py adds
it at start. Only the Windows program sets DOCSCAN_ROOT; a server never offers this.
"""
from __future__ import annotations

import importlib
import json
import os
import shutil
import sys
import tempfile
import threading
import urllib.request
import zipfile
from pathlib import Path

REPO = os.environ.get("DOCSCAN_UPDATE_REPO", "eyasbzour/docscan")
ROOT = Path(os.environ.get("DOCSCAN_ROOT", "."))
HEAVY = ROOT / "parts" / "heavy"
ASSETS = {"DocScan-part-heavy.zip": HEAVY, "DocScan-part-models.zip": ROOT / "models"}
NEED = 7 * 1024 ** 3  # the downloads (about 2 GB) and what they unpack to (about 4 GB), with room to spare
_state = {"state": "idle", "done": 0, "total": 0, "error": ""}  # idle, downloading, unpacking, done, restart, error
_lock = threading.Lock()
_stop = threading.Event()


class _Stopped(Exception):
    pass


def offered() -> bool:
    return bool(os.environ.get("DOCSCAN_ROOT"))


def status() -> dict:
    return dict(_state)


def start() -> None:
    with _lock:
        if _state["state"] in ("downloading", "unpacking"):
            return
        if shutil.disk_usage(ROOT).free < NEED:
            raise RuntimeError("لا توجد مساحة كافية على القرص: يلزم نحو 7 جيجابايت فارغة.")
        _state.update(state="downloading", done=0, total=0, error="")
        _stop.clear()
    threading.Thread(target=_run, daemon=True, name="parts").start()


def stop() -> None:
    """The user's "stop": only while downloading; unpacking is short and must not be cut."""
    _stop.set()


def _get(url: str):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "DocScan-updater"}), timeout=60)


def _run() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="docscan-parts-"))
    try:
        # this version's own release: its readers are built against this version's base packages
        tag = "v" + os.environ.get("DOCSCAN_VERSION", "0.0.0")
        with _get(f"https://api.github.com/repos/{REPO}/releases/tags/{tag}") as r:
            assets = {a["name"]: a for a in json.load(r).get("assets", []) if a["name"] in ASSETS}
        if len(assets) < len(ASSETS):
            raise RuntimeError("ملفات القرّاء غير موجودة في إصدار " + tag)
        _state["total"] = sum(a["size"] for a in assets.values())
        for name, a in assets.items():
            with _get(a["browser_download_url"]) as r, open(tmp / name, "wb") as f:
                while chunk := r.read(1 << 20):
                    if _stop.is_set():
                        raise _Stopped
                    f.write(chunk)
                    _state["done"] += len(chunk)
        _state["state"] = "unpacking"
        shutil.rmtree(HEAVY, ignore_errors=True)  # a half-finished earlier attempt
        for name, dest in ASSETS.items():
            with zipfile.ZipFile(tmp / name) as z:
                files = z.namelist()
                # VERSION last: setup takes the readers as installed only once everything is there
                z.extractall(dest, [m for m in files if m != "VERSION"])
                if "VERSION" in files:
                    z.extract("VERSION", dest)
        if "paddle" in sys.modules:
            # PaddleOCR is loaded with its own OpenMP runtime, and torch cannot load beside it (desktop/app.py
            # setup()): the readers work from the next start
            _state["state"] = "restart"
            return
        site = str(HEAVY / "site-packages")
        if site not in sys.path:
            sys.path.append(site)  # after the base packages, as desktop/app.py adds it
        importlib.invalidate_caches()
        _state["state"] = "done"
    except _Stopped:
        _state.update(state="idle", done=0, total=0, error="")
    except Exception as e:
        _state.update(state="error", error=f"تعذر تنزيل القرّاء الإضافيين: {e}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
