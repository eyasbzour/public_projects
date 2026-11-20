"""Turn the finished Word file into other formats.

Formats: docx (as is), pdf, odt, txt, png (one image per page; several pages come as a .zip).
With LibreOffice (the Docker server), or with Microsoft Word on a Windows computer (the desktop program),
whichever is there; PNG pages come from the PDF (pdftoppm, or pypdfium2).
"""
from __future__ import annotations

import io
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

SOFFICE = os.environ.get("SOFFICE_BIN") or shutil.which("soffice") or shutil.which("libreoffice")
PDFTOPPM = shutil.which("pdftoppm")
_word_lock = __import__("threading").Lock()


def _has_word() -> bool:
    """Microsoft Word installed (Windows): it converts as well as LibreOffice and most offices have it."""
    if os.name != "nt":
        return False
    try:
        import winreg

        winreg.CloseKey(winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, r"Word.Application\CLSID"))
        import comtypes.client  # noqa: F401
        return True
    except Exception:
        return False


def _has_pdfium() -> bool:
    try:
        import pypdfium2  # noqa: F401
        return True
    except Exception:
        return False


WORD = not SOFFICE and _has_word()
PNG_DPI = int(os.environ.get("PNG_DPI", "150"))

FORMATS = {
    "docx": {"label": "Word (.docx)", "ext": "docx", "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    "pdf": {"label": "PDF", "ext": "pdf", "mime": "application/pdf"},
    "odt": {"label": "OpenDocument (.odt)", "ext": "odt", "mime": "application/vnd.oasis.opendocument.text"},
    "png": {"label": "صور PNG", "ext": "png", "mime": "image/png"},
    "txt": {"label": "نص عادي (.txt)", "ext": "txt", "mime": "text/plain; charset=utf-8"},
}


class ConvertError(Exception):
    pass


def available() -> dict:
    """Which formats this server can produce."""
    out = {"docx": True}
    out["pdf"] = out["odt"] = out["txt"] = bool(SOFFICE or WORD)
    out["png"] = bool((SOFFICE or WORD) and (PDFTOPPM or _has_pdfium()))
    return out


# Word's SaveAs2 formats; SaveAs2, not ExportAsFixedFormat, which can hang
WORD_FORMATS = {"pdf": 17, "odt": 23, "txt": 2}


def _word(src: Path, fmt: str, outdir: Path) -> Path:
    """Convert with a private, hidden Word (one at a time: Word does not like several at once)."""
    import comtypes
    import comtypes.client

    out = outdir / (src.stem + "." + fmt)
    with _word_lock:
        comtypes.CoInitialize()
        word = None
        try:
            word = comtypes.client.CreateObject("Word.Application", dynamic=True)
            word.Visible = False
            word.DisplayAlerts = 0
            doc = word.Documents.Open(str(src), False, True)  # not as a conversion, read-only
            try:
                if fmt == "txt":  # UTF-8 (65001); the COM bridge takes Word's arguments by position only
                    doc.SaveAs2(str(out), WORD_FORMATS["txt"], False, "", False, "", False, False, False, False, False, 65001)
                else:
                    doc.SaveAs2(str(out), WORD_FORMATS[fmt])
            finally:
                doc.Close(False)
        except Exception as e:
            raise ConvertError(f"تعذر التحويل عبر Word: {e}") from e
        finally:
            if word is not None:
                try:
                    word.Quit(False)
                except Exception:
                    pass
            comtypes.CoUninitialize()
    if not out.exists():
        raise ConvertError("تعذر التحويل عبر Word")
    return out


def _to(src: Path, fmt: str, outdir: Path) -> Path:
    if SOFFICE:
        return _soffice(src, {"txt": "txt:Text (encoded):UTF8"}.get(fmt, fmt), outdir)
    if WORD:
        return _word(src, fmt, outdir)
    raise ConvertError("لا يوجد على هذا الجهاز LibreOffice ولا Microsoft Word، لذا يتوفر Word (.docx) فقط")


def _soffice(src: Path, target: str, outdir: Path, timeout: int = 180) -> Path:
    if not SOFFICE:
        raise ConvertError("LibreOffice غير مثبت على الخادم، لذا يتوفر Word فقط")
    # a private profile per call lets several conversions run at the same time
    profile = outdir / "lo-profile"
    cmd = [SOFFICE, f"-env:UserInstallation=file://{profile}", "--headless", "--norestore",
           "--convert-to", target, "--outdir", str(outdir), str(src)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise ConvertError("استغرق التحويل وقتاً أطول من المسموح") from e
    ext = target.split(":")[0]
    out = outdir / (src.stem + "." + ext)
    if not out.exists():
        raise ConvertError("تعذر التحويل: " + (r.stderr or r.stdout or "")[-300:])
    return out


def convert(docx: bytes, fmt: str, base_name: str) -> tuple[bytes, str, str]:
    """Return (content, filename, mime)."""
    if fmt not in FORMATS:
        raise ConvertError("صيغة غير معروفة")
    safe = "".join(c for c in (base_name or "document") if c not in '\\/:*?"<>|').strip() or "document"
    if fmt == "docx":
        return docx, safe + ".docx", FORMATS["docx"]["mime"]

    with tempfile.TemporaryDirectory(prefix="docscan-") as tmp:
        tmp = Path(tmp)
        src = tmp / "document.docx"
        src.write_bytes(docx)

        if fmt == "odt":
            out = _to(src, "odt", tmp)
            return out.read_bytes(), safe + ".odt", FORMATS["odt"]["mime"]

        if fmt == "txt":
            out = _to(src, "txt", tmp)
            return out.read_bytes(), safe + ".txt", FORMATS["txt"]["mime"]

        # PDF (also the first step for PNG). The browser sends notes as footnotes for these formats:
        # LibreOffice's "comments in margin" export is ignored by 7.4 and fails on 25.2.
        pdf = _to(src, "pdf", tmp)
        if fmt == "pdf":
            return pdf.read_bytes(), safe + ".pdf", FORMATS["pdf"]["mime"]

        # PNG: one image per page
        if PDFTOPPM:
            r = subprocess.run([PDFTOPPM, "-r", str(PNG_DPI), "-png", str(pdf), str(tmp / "page")],
                               capture_output=True, text=True, timeout=180)
            err = r.stderr
        elif _has_pdfium():  # PDFium, Chrome's PDF engine (Apache/BSD): the Windows program has no pdftoppm
            import pypdfium2

            doc = pypdfium2.PdfDocument(str(pdf))
            try:
                for i in range(len(doc)):
                    doc[i].render(scale=PNG_DPI / 72).to_pil().save(str(tmp / f"page-{i + 1}.png"))
            finally:
                doc.close()  # Windows: the file stays locked, and the temporary folder undeletable, until closed
            err = ""
        else:
            raise ConvertError("لا توجد أداة لتحويل الصفحات إلى صور على هذا الجهاز")
        pages = sorted(tmp.glob("page-*.png"), key=lambda p: int(p.stem.split("-")[-1]))
        if not pages:
            raise ConvertError("تعذر إنشاء الصور: " + err[-200:])
        if len(pages) == 1:
            return pages[0].read_bytes(), safe + ".png", FORMATS["png"]["mime"]
        buf = io.BytesIO()
        width = max(2, len(str(len(pages))))
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for i, p in enumerate(pages, 1):
                z.write(p, f"{safe} - {str(i).zfill(width)}.png")
        return buf.getvalue(), safe + ".zip", "application/zip"
