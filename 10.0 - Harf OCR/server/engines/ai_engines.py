"""Key-based engines: Claude (Anthropic) and Google Cloud Vision.

The key comes from the user with each request (or from a server environment variable if the
department chooses to set one). It is used for that request only and never stored or logged.
"""
from __future__ import annotations

import base64
import json
import os
import re
from importlib.util import find_spec

from .common import EngineError, Word, low_note, seg_lists, to_jpeg
from messages import doc, msg, render

MARK = re.compile(r"\[\[(.*?)\|\|(.*?)\]\]", re.S)
TAG = re.compile(r"<(/?)(b|i|u|s)>")  # how a word is printed, in Claude's text (prompt rule 9)
TAG_FMT = {"b": "b", "i": "i", "u": "u", "s": "x"}  # to the segments' keys (blocks-doc.js)
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
    # the words Claude writes into the document come from the language files (doc.*), in the page's language
    def words(lang):
        return {k.split(".")[1]: render(lang, k) for k in ("doc.handwrittenNote", "doc.stamp", "doc.signature", "doc.uncertain", "doc.unreadable")}
    ar, en = words("ar"), words("en")
    return f"""You are transcribing one photographed page of an official document (usually Arabic) into JSON that will be turned into an editable Word document.

Rules:
1. Transcribe every printed or typed word exactly as printed: keep spelling mistakes, punctuation, numbers and wording. Do not correct, summarize, translate or reorder.
2. Follow the page's reading order. Make one block per paragraph, heading, list item or table. Keep list numbers like "1." or "أولاً:" inside the text.
3. {letterhead}
4. Handwriting, stamps, seals, signatures, highlighter marks and watermarks are NOT body text. Never put them in blocks. For each one add an entry to "notes": "anchor" = 3 to 8 words copied exactly from a printed block next to it; "note" = in the page's language, what it is ({ar["handwrittenNote"]} / {ar["stamp"]} / {ar["signature"]} ... on an Arabic page; {en["handwrittenNote"]} / {en["stamp"]} / {en["signature"]} ... on an English one), where it is, and what you can read. Mark uncertain readings "({ar["uncertain"]})" or "({en["uncertain"]})" and unreadable parts "[{ar["unreadable"]}]" or "[{en["unreadable"]}]". Never invent names, numbers or dates you cannot read.
5. If a printed word is unclear (blurred, under a stamp, cut off), write your best reading as [[reading||short reason, in the page's language]]. If you cannot read it at all write [[…||{ar["unreadable"]}: reason]] or [[…||{en["unreadable"]}: reason]].
6. If something in the original looks wrong (for example numbers that do not add up), keep the original text and wrap it as [[text||description of the issue, in the page's language]].
7. Tables: use type "table" with "rows" (a list of rows, each a list of cell strings, header row first) and no "text".
8. Use type "center" for centered lines such as closings or titles, "heading" for section titles, "bullet" for bulleted items, otherwise "paragraph". Set "bold" when the whole line is printed in bold.
9. Inside the text, wrap words printed bold, italic, underlined or struck through in <b>...</b>, <i>...</i>, <u>...</u> or <s>...</s> (they can nest). Only what is printed that way; a whole bold line is "bold" instead.

Reply with JSON only, no code fences, in exactly this shape:
{{"blocks":[{{"type":"heading|paragraph|bullet|center|table","bold":false,"text":"...","rows":[["..."]]}}],"notes":[{{"anchor":"...","note":"..."}}]}}"""


def _styled(text: str) -> tuple[str, list[dict]]:
    """The text without its <b> <i> <u> <s> tags, and each character's format ({"b": True, ...})."""
    plain, fmts, on, pos = [], [], {}, 0
    for m in TAG.finditer(text):
        for ch in text[pos:m.start()]:
            plain.append(ch)
            fmts.append(dict(on))
        key = TAG_FMT[m.group(2)]
        if m.group(1):
            on.pop(key, None)
        else:
            on[key] = True
        pos = m.end()
    for ch in text[pos:]:
        plain.append(ch)
        fmts.append(dict(on))
    return "".join(plain), fmts


def _text_to_segs(text: str) -> list[dict]:
    text, fmts = _styled(text or "")
    segs, pos = [], 0

    def plain(a, b):  # one segment per run of the same format
        while a < b:
            e = a
            while e < b and fmts[e] == fmts[a]:
                e += 1
            segs.append({"s": text[a:e], **fmts[a]})
            a = e
    for m in MARK.finditer(text):
        plain(pos, m.start())
        a, b = m.span(1)
        common = {k: True for k in fmts[a] if all(f.get(k) for f in fmts[a:b])} if b > a else {}  # one note, one piece
        segs.append({"s": m.group(1), **common, "note": m.group(2).strip() or doc("doc.uncertain")})
        pos = m.end()
    plain(pos, len(text))
    return [s for s in segs if s["s"] or s.get("note")]


def _attach_note(blocks: list[dict], anchor: str, note: str) -> None:
    anchor = (anchor or "").strip()

    if anchor:
        for segs in seg_lists(blocks):
            for i, sg in enumerate(segs):
                if sg.get("note") is None and anchor in sg["s"]:
                    a = sg["s"].index(anchor)
                    fmt = {k: v for k, v in sg.items() if k != "s"}  # the pieces keep how the text is printed
                    parts = []
                    if a:
                        parts.append({"s": sg["s"][:a], **fmt})
                    parts.append({"s": anchor, **fmt, "note": note})
                    rest = sg["s"][a + len(anchor):]
                    if rest:
                        parts.append({"s": rest, **fmt})
                    segs[i:i + 1] = parts
                    return
                if sg.get("note") is not None and anchor in sg["s"]:
                    sg["note"] = doc("doc.notesJoined", first=sg["note"], second=note)
                    return
    # anchor not found: attach to the first text on the page
    for segs in seg_lists(blocks):
        for sg in segs:
            if sg["s"].strip():
                placed = doc("doc.notesPlaceApproximate", note=note)
                sg["note"] = doc("doc.notesJoined", first=sg["note"], second=placed) if sg.get("note") else placed
                return
    blocks.append({"type": "p", "bold": False, "segs": [{"s": doc("doc.note"), "note": note}]})


def parse_claude_json(raw: str) -> list[dict]:
    s = raw.strip()
    a, b = s.find("{"), s.rfind("}")
    if a < 0 or b < 0:
        raise EngineError(msg("server.claudeNoResult"))
    try:
        data = json.loads(s[a:b + 1])
    except json.JSONDecodeError as e:
        raise EngineError(msg("server.claudeNoJson")) from e
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


# the server's own keys, used when a user has entered none (README: settings)
CLAUDE_KEY_ENV, GOOGLE_KEY_ENV = "ANTHROPIC_API_KEY", "GOOGLE_VISION_API_KEY"


def claude_available() -> tuple[bool, str]:
    if not find_spec("anthropic"):  # looked up, not imported: listing the readers stays instant
        return False, msg("server.anthropicLibraryIsntInstalledServer")
    return True, ""


def run_claude(img, api_key: str | None, model: str, skip_letterhead: bool) -> list[dict]:
    import anthropic

    key = api_key or os.environ.get(CLAUDE_KEY_ENV)
    if not key:
        raise EngineError(msg("server.enterClaudeApiKeySettings"))
    data = base64.b64encode(to_jpeg(img, 2000)).decode()
    client = anthropic.Anthropic(api_key=key, timeout=300, max_retries=2)
    try:
        reply = client.messages.create(
            model=model or "claude-sonnet-5-5",
            max_tokens=16000,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}},
                {"type": "text", "text": claude_prompt(skip_letterhead)},
            ]}],
        )
    except anthropic.AuthenticationError as e:
        raise EngineError(msg("server.claudeKeyIsntValid")) from e
    except anthropic.APIStatusError as e:
        raise EngineError(msg("server.claudeError", status=e.status_code, error=getattr(e, "message", e))) from e
    except anthropic.APIConnectionError as e:
        raise EngineError(msg("server.couldntReachClaudeServer")) from e
    raw = "".join(getattr(b, "text", "") for b in reply.content if getattr(b, "type", "") == "text")
    if reply.stop_reason == "max_tokens":
        raise EngineError(msg("server.pageTooLongReadOne"))
    return parse_claude_json(raw)


# ---------------------------------------------------------------- Google Cloud Vision
def google_available() -> tuple[bool, str]:
    if not find_spec("httpx"):
        return False, msg("server.httpxLibraryIsntInstalledServer")
    return True, ""


def run_google(img, api_key: str | None, low_conf: float) -> list[dict]:
    import httpx

    key = api_key or os.environ.get(GOOGLE_KEY_ENV)
    if not key:
        raise EngineError(msg("server.enterGoogleVisionKeySettings"))
    body = {"requests": [{
        "image": {"content": base64.b64encode(to_jpeg(img, 2400, 92)).decode()},
        "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
        "imageContext": {"languageHints": ["ar", "en"]},
    }]}
    try:
        r = httpx.post("https://vision.googleapis.com/v1/images:annotate", params={"key": key}, json=body, timeout=120)
    except httpx.HTTPError as e:
        raise EngineError(msg("server.couldntReachGoogleVisionServer")) from e
    data = r.json() if r.content else {}
    if r.status_code != 200 or "error" in data:
        detail = (data.get("error") or {}).get("message") or r.text[:200]
        raise EngineError(msg("server.googleVisionError", error=detail))
    res = (data.get("responses") or [{}])[0]
    if "error" in res:
        raise EngineError(msg("server.googleVisionError", error=res["error"].get("message")))
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
