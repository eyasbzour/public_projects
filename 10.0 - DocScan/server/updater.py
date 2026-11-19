"""Updates for the Windows program (desktop/app.py sets DOCSCAN_DESKTOP=1 and DOCSCAN_VERSION).

On start the program asks GitHub for the latest release. A newer one is offered in the app; installing
downloads its installer (DocScan-Setup-<version>.exe) and runs it in silent mode, and the program closes so
the installer can replace it (the installer opens it again). No internet, GitHub down, no release yet:
nothing is shown. Only the release is fetched; nothing about the user is sent (a generic User-Agent).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import threading
import urllib.request

REPO = os.environ.get("DOCSCAN_UPDATE_REPO", "eyasbzour/docscan")
_state: dict = {"checked": False, "info": None}


def current() -> str:
    return os.environ.get("DOCSCAN_VERSION", "0.0.0")


def _tuple(v: str) -> tuple:
    return tuple(int(x) for x in re.findall(r"\d+", v)[:3]) or (0,)


def check(timeout: float = 5) -> dict | None:
    """The newer release, or None (also when offline)."""
    try:
        req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/releases/latest",
                                     headers={"User-Agent": "DocScan-updater", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            rel = json.load(r)
        latest = rel.get("tag_name", "").lstrip("v")
        if not latest or _tuple(latest) <= _tuple(current()):
            return None
        asset = next((a for a in rel.get("assets", []) if re.match(r"DocScan-Setup-.*\.exe$", a.get("name", ""))), None)
        if not asset:
            return None
        return {"version": latest, "url": asset["browser_download_url"], "size": asset.get("size", 0),
                "notes": (rel.get("body") or "")[:2000], "page": rel.get("html_url", "")}
    except Exception:
        return None


def check_in_background() -> None:
    def run():
        _state["info"] = check()
        _state["checked"] = True
    threading.Thread(target=run, daemon=True, name="update-check").start()


def status() -> dict:
    return {"current": current(), "checked": _state["checked"], "update": _state["info"]}


def install(quit_app) -> None:
    """Download the newer installer and start it; then close the program (quit_app) so it can be replaced."""
    info = _state["info"] or check()
    if not info:
        raise RuntimeError("لا يوجد تحديث")
    path = os.path.join(tempfile.gettempdir(), f"DocScan-Setup-{info['version']}.exe")
    req = urllib.request.Request(info["url"], headers={"User-Agent": "DocScan-updater"})
    with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    # /SILENT shows only progress; the installer closes and reopens the program (RestartApplications)
    subprocess.Popen([path, "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/RESTARTAPPLICATIONS"],
                     close_fds=True, creationflags=getattr(subprocess, "DETACHED_PROCESS", 0))
    threading.Timer(1.5, quit_app).start()
