"""Key-based engines: Claude (Anthropic) and Google Cloud Vision.

The key comes from the user with each request (or from a server environment variable if the
department chooses to set one). It is used for that request only and never stored or logged.
"""
from __future__ import annotations

import base64
import json
import os
import re

from .common import EngineError, Word, low_note, to_jpeg

MARK = re.compile(r"\[\[(.*?)\|\|(.*?)\]\]", re.S)
TYPE_MAP = {"heading": "h", "paragraph": "p", "bullet": "li", "center": "c", "table": "table",
            "h": "h", "p": "p", "li": "li", "c": "c"}


# ---------------------------------------------------------------- Claude
def claude_prompt(skip_letterhead: bool) -> str:
    letterhead = (
        "The printed letterhead at the very top of the page (state/ministry names, emblem text) and the printed "
        "contact footer at the very bottom (address, phone, fax, email, website) will be replaced by our own "
        "template, so LEAVE THEM OUT. Keep everything between them: reference numbers, dates, addressee, "
        "greeting, subject, body, closing, signatory name and title, attachments and 'copy to' lists."
        if skip_letterhead else
        "Include the printed letterhead and footer text as normal blocks."
    )
    return f"""You are transcribing one photographed page of an official Arabic document into JSON that will be turned into an editable Word document.

Rules:
1. Transcribe every printed or typed word exactly as printed: keep spelling mistakes, punctuation, numbers and wording. Do not correct, summarize, translate or reorder.
2. Follow the page's reading order. Make one block per paragraph, heading, list item or table. Keep list numbers like "1." or "أولاً:" inside the text.
3. {letterhead}
4. Handwriting, stamps, seals, signatures, highlighter marks and watermarks are NOT body text. Never put them in blocks. For each one add an entry to "notes": "anchor" = 3 to 8 words copied exactly from a printed block next to it; "note" = in Arabic, what it is (تأشيرة بخط اليد / ختم / توقيع ...), where it is, and what you can read. Mark uncertain readings "(غير مؤكد)" and unreadable parts "[غير مقروء]". Never invent names, numbers or dates you cannot read.
5. If a printed word is unclear (blurred, under a stamp, cut off), write your best reading as [[reading||short Arabic reason]]. If you cannot read it at all write [[…||غير مقروء: reason]].
6. If something in the original looks wrong (for example numbers that do not add up), keep the original text and wrap it as [[text||Arabic description of the issue]].
7. Tables: use type "table" with "rows" (a list of rows, each a list of cell strings, header row first) and no "text".
8. Use type "center" for centered lines such as closings or titles, "heading" for section titles, "bullet" for bulleted items, otherwise "paragraph". Set "bold" when the line is printed in bold.

Reply with JSON only, no code fences, in exactly this shape:
{{"blocks":[{{"type":"heading|paragraph|bullet|center|table","bold":false,"text":"...","rows":[["..."]]}}],"notes":[{{"anchor":"...","note":"..."}}]}}"""


def _text_to_segs(text: str) -> list[dict]:
    segs, pos = [], 0
    for m in MARK.finditer(text or ""):
        if m.start() > pos:
            segs.append({"s": text[pos:m.start()]})
        segs.append({"s": m.group(1), "note": m.group(2).strip() or "غير مؤكد"})
        pos = m.end()
    if pos < len(text or ""):
        segs.append({"s": text[pos:]})
    return [s for s in segs if s["s"] or s.get("note")]


def _attach_note(blocks: list[dict], anchor: str, note: str) -> None:
    anchor = (anchor or "").strip()

    def seg_lists():
        for b in blocks:
            if b["type"] == "table":
                for row in b.get("rows", []):
                    for cell in row:
                        yield cell
            else:
                yield b["segs"]

    if anchor:
        for segs in seg_lists():
            for i, sg in enumerate(segs):
                if sg.get("note") is None and anchor in sg["s"]:
                    a = sg["s"].index(anchor)
                    parts = []
                    if a:
                        parts.append({"s": sg["s"][:a]})
                    parts.append({"s": anchor, "note": note})
                    rest = sg["s"][a + len(anchor):]
                    if rest:
                        parts.append({"s": rest})
                    segs[i:i + 1] = parts
                    return
                if sg.get("note") is not None and anchor in sg["s"]:
                    sg["note"] += "\n" + note
                    return
    # anchor not found: attach to the first text on the page
    for segs in seg_lists():
        for sg in segs:
            if sg["s"].strip():
                prefix = "(موضع الملاحظة تقريبي) "
                if sg.get("note"):
                    sg["note"] += "\n" + prefix + note
                else:
                    sg["note"] = prefix + note
                return
    blocks.append({"type": "p", "bold": False, "segs": [{"s": "ملاحظة", "note": note}]})


def parse_claude_json(raw: str) -> list[dict]:
    s = raw.strip()
    a, b = s.find("{"), s.rfind("}")
    if a < 0 or b < 0:
        raise EngineError("لم يرجع Claude نتيجة قابلة للقراءة")
    try:
        data = json.loads(s[a:b + 1])
    except json.JSONDecodeError as e:
        raise EngineError("لم يرجع Claude نتيجة قابلة للقراءة (JSON)") from e
    blocks = []
    for bk in data.get("blocks", []):
        t = TYPE_MAP.get(str(bk.get("type", "paragraph")).lower(), "p")
        if t == "table":
            rows = [[_text_to_segs(str(c)) for c in row] for row in bk.get("rows") or [] if isinstance(row, list)]
            if rows:
                blocks.append({"type": "table", "bold": False, "rows": rows})
            continue
        segs = _text_to_segs(str(bk.get("text", "")))
        if segs:
            blocks.append({"type": t, "bold": bool(bk.get("bold")) or t == "h", "segs": segs})
    for n in data.get("notes", []) or []:
        if n.get("note"):
            _attach_note(blocks, str(n.get("anchor", "")), str(n["note"]))
    return blocks


def claude_available() -> tuple[bool, str]:
    try:
        import anthropic  # noqa: F401
    except Exception:
        return False, "مكتبة anthropic غير مثبتة على الخادم"
    return True, ""


def run_claude(img, api_key: str | None, model: str, skip_letterhead: bool) -> list[dict]:
    import anthropic

    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise EngineError("أدخل مفتاح Claude API في الإعدادات")
    data = base64.b64encode(to_jpeg(img, 2000)).decode()
    client = anthropic.Anthropic(api_key=key, timeout=300, max_retries=2)
    try:
        msg = client.messages.create(
            model=model or "claude-sonnet-5-5",
            max_tokens=16000,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}},
                {"type": "text", "text": claude_prompt(skip_letterhead)},
            ]}],
        )
    except anthropic.AuthenticationError as e:
        raise EngineError("مفتاح Claude غير صالح") from e
    except anthropic.APIStatusError as e:
        raise EngineError(f"خطأ من Claude ({e.status_code}): {getattr(e, 'message', e)}") from e
    except anthropic.APIConnectionError as e:
        raise EngineError("تعذر الاتصال بخدمة Claude من الخادم") from e
    raw = "".join(getattr(b, "text", "") for b in msg.content if getattr(b, "type", "") == "text")
    if msg.stop_reason == "max_tokens":
        raise EngineError("الصفحة طويلة جداً لقراءتها دفعة واحدة")
    return parse_claude_json(raw)


# ---------------------------------------------------------------- Google Cloud Vision
def google_available() -> tuple[bool, str]:
    try:
        import httpx  # noqa: F401
    except Exception:
        return False, "مكتبة httpx غير مثبتة على الخادم"
    return True, ""


def run_google(img, api_key: str | None, low_conf: float) -> list[dict]:
    import httpx

    key = api_key or os.environ.get("GOOGLE_VISION_API_KEY")
    if not key:
        raise EngineError("أدخل مفتاح Google Vision في الإعدادات")
    body = {"requests": [{
        "image": {"content": base64.b64encode(to_jpeg(img, 2400, 92)).decode()},
        "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
        "imageContext": {"languageHints": ["ar", "en"]},
    }]}
    try:
        r = httpx.post("https://vision.googleapis.com/v1/images:annotate", params={"key": key}, json=body, timeout=120)
    except httpx.HTTPError as e:
        raise EngineError("تعذر الاتصال بخدمة Google Vision من الخادم") from e
    data = r.json() if r.content else {}
    if r.status_code != 200 or "error" in data:
        msg = (data.get("error") or {}).get("message") or r.text[:200]
        raise EngineError(f"خطأ من Google Vision: {msg}")
    res = (data.get("responses") or [{}])[0]
    if "error" in res:
        raise EngineError(f"خطأ من Google Vision: {res['error'].get('message')}")
    pages = (res.get("fullTextAnnotation") or {}).get("pages") or []
    blocks = []
    for page in pages:
        for blk in page.get("blocks", []):
            for par in blk.get("paragraphs", []):
                words, seps = [], []
                for w in par.get("words", []):
                    syms = w.get("symbols", [])
                    text = "".join(s.get("text", "") for s in syms)
                    brk = ((syms[-1].get("property") or {}).get("detectedBreak") or {}).get("type") if syms else None
                    words.append(Word(text, float(w.get("confidence", 1)) * 100))
                    seps.append(" " if brk in ("SPACE", "SURE_SPACE", "EOL_SURE_SPACE", "LINE_BREAK") else "")
                segs = _google_segs(words, seps, low_conf)
                if segs:
                    blocks.append({"type": "p", "bold": False, "segs": segs})
    return blocks


def _google_segs(words, seps, low_conf):
    segs = []
    for w, sep in zip(words, seps):
        low = w.conf < low_conf
        if low:
            segs.append({"s": w.text, "note": low_note(w.conf), "_low": True})
            if sep:
                segs.append({"s": sep})
        else:
            if segs and not segs[-1].get("note"):
                segs[-1]["s"] += w.text + sep
            else:
                segs.append({"s": w.text + sep})
    # merge neighbouring low-confidence words into one comment
    merged = []
    for sg in segs:
        if (sg.get("_low") and len(merged) >= 2 and merged[-2].get("_low")
                and not merged[-1].get("note") and not merged[-1]["s"].strip()):
            space = merged.pop()
            merged[-1]["s"] += space["s"] + sg["s"]
            continue
        merged.append(sg)
    for sg in merged:
        sg.pop("_low", None)
    if merged and not merged[-1].get("note"):
        merged[-1]["s"] = merged[-1]["s"].rstrip()
    return [s for s in merged if s["s"]]
