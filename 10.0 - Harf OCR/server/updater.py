"""Updates for the Windows program (desktop/app.py sets DOCSCAN_DESKTOP=1 and DOCSCAN_VERSION).

On start, and from Settings, the program asks GitHub for the latest release. A newer one is offered in the app; installing
downloads its installer (HarfOCR-Setup-<version>.exe) and runs it in silent mode, and the program closes so
the installer can replace it (the installer opens it again). No internet, GitHub down, no release yet:
nothing is shown. Only the release is fetched; nothing about the user is sent (a generic User-Agent).
What's new is the version tag's message, which .github/workflows/release.yml puts between NOTES markers.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import threading
import urllib.request
from messages import msg

REPO = os.environ.get("DOCSCAN_UPDATE_REPO", "eyasbzour/harf-ocr")
NOTES = re.compile(r"<!-- whats-new -->(.*?)<!-- /whats-new -->", re.S)  # release.yml writes these
_state: dict = {"checked": False, "info": None}
# installing an update: idle, downloading (done of total bytes), installing (the installer runs, the program closes),
# error; the page shows it on the update bar
_install: dict = {"state": "idle", "done": 0, "total": 0, "error": ""}
_cancel = threading.Event()  # the user's Cancel, while it downloads (cancel)


def current() -> str:
    return os.environ.get("DOCSCAN_VERSION", "0.0.0")


def _tuple(v: str) -> tuple:
    return tuple(int(x) for x in re.findall(r"\d+", v)[:3]) or (0,)


def check(timeout: float = 5, quiet: bool = True) -> dict | None:
    """The newer release, or None (also when offline, unless quiet is False: then a failure raises)."""
    try:
        req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/releases/latest",
                                     headers={"User-Agent": "HarfOCR-updater", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            rel = json.load(r)
        latest = rel.get("tag_name", "").lstrip("v")
        if not latest or _tuple(latest) <= _tuple(current()):
            return None
        asset = next((a for a in rel.get("assets", []) if re.match(r"HarfOCR-Setup-.*\.exe$", a.get("name", ""))), None)
        if not asset:
            return None
        notes = NOTES.search(rel.get("body") or "")  # none in releases before 1.0.2
        return {"version": latest, "url": asset["browser_download_url"], "size": asset.get("size", 0),
                "notes": notes.group(1).strip()[:2000] if notes else "", "page": rel.get("html_url", "")}
    except Exception:
        if not quiet:
            raise
        return None


def check_in_background() -> None:
    def run():
        _state["info"] = check()
        _state["checked"] = True
    threading.Thread(target=run, daemon=True, name="update-check").start()


def check_now() -> dict:
    """The Settings button: ask again, and say so when GitHub cannot be reached."""
    _state["info"] = check(quiet=False)
    _state["checked"] = True
    return status()


def status() -> dict:
    return {"current": current(), "checked": _state["checked"], "update": _state["info"], "install": dict(_install)}


def install(quit_app) -> None:
    """Start downloading the newer installer (status() says how far); then it starts and the program closes (quit_app)
    so it can be replaced."""
    if _install["state"] in ("downloading", "installing"):
        return
    info = _state["info"] or check()
    if not info:
        raise RuntimeError(msg("server.noUpdate"))
    _install.update(state="downloading", done=0, total=info.get("size") or 0, error="")
    _cancel.clear()
    threading.Thread(target=_install_now, args=(info, quit_app), daemon=True, name="update-install").start()


def cancel() -> None:
    """The user's Cancel: only while it downloads; once the installer runs, the program is closing."""
    if _install["state"] == "downloading":
        _cancel.set()


def _install_now(info: dict, quit_app) -> None:
    try:
        _download_and_start(info, quit_app)
    except Exception as e:
        _install.update(state="error", error=msg("server.couldntUpdate", error=e))


def _download_and_start(info: dict, quit_app) -> None:
    path = os.path.join(tempfile.gettempdir(), f"HarfOCR-Setup-{info['version']}.exe")
    req = urllib.request.Request(info["url"], headers={"User-Agent": "HarfOCR-updater"})
    with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as f:
        _install["total"] = int(r.headers.get("Content-Length") or 0) or _install["total"]
        while chunk := r.read(1 << 20):
            if _cancel.is_set():
                break
            f.write(chunk)
            _install["done"] += len(chunk)
    if _cancel.is_set():  # cancelled: the half-downloaded installer goes, and the bar offers the update again
        os.remove(path)
        _install.update(state="idle", done=0, error="")
        return
    _install["state"] = "installing"
    # /SILENT shows only progress. The installer waits for the program to close (installer.iss InitializeSetup;
    # quit_app below) and opens it again after (its [Run] entry).
    # Its log goes next to the program's (desktop/app.py), to see why an update did not install.
    log = os.path.join(os.environ.get("LOCALAPPDATA", tempfile.gettempdir()), "DocScan", "logs", "setup.log")
    subprocess.Popen([path, "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/RESTARTAPPLICATIONS",
                      f"/LOG={log}"],
                     close_fds=True, creationflags=getattr(subprocess, "DETACHED_PROCESS", 0))
    threading.Timer(1.5, quit_app).start()
