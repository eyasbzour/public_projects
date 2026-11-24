"""Installing an update (server/updater.py): the download's progress, then the installer starts and the program
closes; or the error says why. Nothing is downloaded or run: the download and the installer are stand-ins."""
import io
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import updater  # noqa: E402

SIZE = 3 * (1 << 20) + 5


class Download(io.BytesIO):
    headers = {"Content-Length": str(SIZE)}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


@pytest.fixture
def stand_ins(monkeypatch, tmp_path):
    started, closed = [], []
    monkeypatch.setattr(updater.tempfile, "gettempdir", lambda: str(tmp_path))
    monkeypatch.setattr(updater.subprocess, "Popen", lambda args, **k: started.append(args))
    monkeypatch.setitem(updater._state, "info", {"version": "9.9.9", "url": "https://example.invalid/x.exe", "size": 0})
    monkeypatch.setattr(updater, "_install", {"state": "idle", "done": 0, "total": 0, "error": ""})
    return started, closed


def wait_for(state):
    for _ in range(200):
        if updater.status()["install"]["state"] == state:
            return updater.status()["install"]
        time.sleep(0.02)
    raise AssertionError(updater.status()["install"])


def test_the_download_counts_up_then_the_installer_starts_and_the_program_closes(monkeypatch, stand_ins, tmp_path):
    started, closed = stand_ins
    monkeypatch.setattr(updater.urllib.request, "urlopen", lambda *a, **k: Download(b"x" * SIZE))
    updater.install(lambda: closed.append(True))
    st = wait_for("installing")
    assert st["done"] == st["total"] == SIZE
    assert started and started[0][0].endswith("HarfOCR-Setup-9.9.9.exe") and "/SILENT" in started[0]
    assert (tmp_path / "HarfOCR-Setup-9.9.9.exe").stat().st_size == SIZE
    time.sleep(1.8)
    assert closed == [True]  # after the installer started, never before


def test_a_failed_download_says_why_and_closes_nothing(monkeypatch, stand_ins):
    started, closed = stand_ins

    def offline(*a, **k):
        raise OSError("no network")

    monkeypatch.setattr(updater.urllib.request, "urlopen", offline)
    updater.install(lambda: closed.append(True))
    st = wait_for("error")
    assert "no network" in str(st["error"].args) and not started and not closed


def test_cancel_stops_the_download_and_starts_nothing(monkeypatch, stand_ins, tmp_path):
    started, closed = stand_ins

    class Slow(Download):  # a chunk at a time, slowly enough to cancel halfway
        def read(self, n=-1):
            time.sleep(0.05)
            return super().read(n)

    monkeypatch.setattr(updater.urllib.request, "urlopen", lambda *a, **k: Slow(b"x" * SIZE))
    updater.install(lambda: closed.append(True))
    for _ in range(200):
        if updater.status()["install"]["done"]:
            break
        time.sleep(0.01)
    updater.cancel()
    st = wait_for("idle")
    assert st["error"] == "" and not started and not closed
    assert not (tmp_path / "HarfOCR-Setup-9.9.9.exe").exists()  # the half-downloaded installer is gone
