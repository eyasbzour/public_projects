"""Use on phone: the Windows program's pages from a phone's browser, from anywhere, behind a password.

Started and stopped from the PC only. A second local listener serves the same app on its own port, and only the
tunnel connects to it: Cloudflare's free quick tunnel (cloudflared.exe, downloaded on first use into {app}\\bin)
gives it a public https://<words>.trycloudflare.com link. Every request through it needs the session cookie that
the password gives (main.py phone_gate). The link and the password are new each time; Stop, or closing the
program (desktop/app.py), ends both. Pages pass through Cloudflare, encrypted (README, Privacy).
"""
from __future__ import annotations

import os
import re
import secrets
import socket
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(os.environ.get("DOCSCAN_ROOT", "."))
EXE = ROOT / "bin" / "cloudflared.exe"
EXE_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
COOKIE = "ds_phone"
ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"  # no 0/o or 1/l/i: easy to read off the screen and type on a phone
TRIES, LOCKOUT = 5, 60  # wrong passwords allowed per LOCKOUT seconds, from anyone
LINK = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")

_state = {"state": "off", "url": "", "password": "", "error": ""}  # off, starting, on, error
_sessions: set[str] = set()
_fails: list[float] = []
_proc: subprocess.Popen | None = None
_server = None
_port = 0
_lock = threading.Lock()


def offered() -> bool:
    return bool(os.environ.get("DOCSCAN_ROOT"))


def is_remote(scope: dict) -> bool:
    """The request came in on the tunnel's listener (the local port: a header could be forged, this cannot)."""
    server = scope.get("server")
    return bool(_port) and bool(server) and server[1] == _port


def status() -> dict:
    return dict(_state)


def start(app) -> None:
    with _lock:
        if _state["state"] in ("starting", "on"):
            return
        _state.update(state="starting", url="", password="", error="")
    threading.Thread(target=_run, args=(app,), daemon=True, name="remote").start()


def stop() -> None:
    global _proc, _server, _port
    with _lock:
        proc, _proc = _proc, None
        _sessions.clear()
        _state.update(state="off", url="", password="", error="")
        if _server is not None:
            _server.should_exit = True
            _server, _port = None, 0
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()


def login(password: str) -> str | None:
    """A session token for the right password; None for a wrong one. Raises PermissionError while locked out."""
    now = time.time()
    _fails[:] = [t for t in _fails if now - t < LOCKOUT]
    if len(_fails) >= TRIES:
        raise PermissionError
    typed = re.sub(r"[\s-]", "", password or "").lower()
    if _state["state"] == "on" and secrets.compare_digest(typed, _state["password"]):
        token = secrets.token_urlsafe(32)
        _sessions.add(token)
        return token
    _fails.append(now)
    return None


def signed_in(token: str | None) -> bool:
    return bool(token) and token in _sessions


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _download() -> None:
    EXE.parent.mkdir(parents=True, exist_ok=True)
    part = EXE.with_suffix(".part")
    req = urllib.request.Request(EXE_URL, headers={"User-Agent": "DocScan"})
    with urllib.request.urlopen(req, timeout=60) as r, open(part, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    part.replace(EXE)


def _run(app) -> None:
    global _proc, _server, _port
    try:
        if not EXE.exists():
            _download()
        import uvicorn

        port = _free_port()
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
        thread = threading.Thread(target=server.run, daemon=True, name="remote-server")
        thread.start()
        while not server.started and thread.is_alive():
            time.sleep(0.05)
        if not server.started:
            raise RuntimeError("تعذر فتح منفذ الاتصال على هذا الجهاز")
        password = "".join(secrets.choice(ALPHABET) for _ in range(8))
        proc = subprocess.Popen([str(EXE), "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}"],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                errors="replace")
        with _lock:
            if _state["state"] != "starting":  # stopped while it was starting
                server.should_exit = True
                proc.terminate()
                return
            _server, _port, _proc = server, port, proc
            _sessions.clear()
            _fails.clear()
        threading.Thread(target=_watch, args=(proc, password), daemon=True, name="cloudflared").start()
        threading.Timer(45, _give_up, args=(proc,)).start()
    except Exception as e:
        stop()
        _state.update(state="error", error=f"تعذر تشغيل الاتصال: {e}")


def _give_up(proc: subprocess.Popen) -> None:
    if _proc is proc and _state["state"] == "starting":  # no link yet: no internet, or the service is blocked
        stop()
        _state.update(state="error", error="تعذر الوصول إلى خدمة Cloudflare. تأكد من الاتصال بالإنترنت.")


def _watch(proc: subprocess.Popen, password: str) -> None:
    """cloudflared prints the link once it is up; its output is read to the end so its pipe never fills."""
    for line in proc.stdout:
        if _state["state"] == "starting" and (m := LINK.search(line)):
            _state.update(state="on", url=m.group(0), password=password)
    if _proc is proc:  # it ended by itself, not by stop()
        stop()
        _state.update(state="error", error="انقطع الاتصال. شغّله من جديد.")
