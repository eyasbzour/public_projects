"""Text in every interface language, by name, from the same files as the browser (web/i18n/<code>.json, read by
web/js/i18n.js too). Arabic is the source: the text a name falls back to.

msg(): a message for the screen. It is the Arabic text, and also carries its name and values, so a reply sends it as
{key, args} (to_json) and the browser shows it in the chosen language.

doc(): text the readers write into the document (doc.* names): a note on an uncertain word, "[توقيع]" in place of a
signature. It follows the page's language, not the interface's: engines/common.py in_language() renders it.
"""
from __future__ import annotations

import json
import string
from functools import lru_cache
from pathlib import Path

LANG_DIR = Path(__file__).resolve().parent.parent / "web" / "i18n"
SOURCE = "ar"


@lru_cache(maxsize=None)
def languages() -> tuple[str, ...]:
    """The language files, read once: a new file is picked up when the server starts again."""
    return tuple(sorted(p.stem for p in LANG_DIR.glob("*.json")))


@lru_cache(maxsize=None)
def language_file(code: str) -> tuple[dict, dict]:
    """A language's {name, dir} and its entries."""
    data = json.loads((LANG_DIR / f"{code}.json").read_text(encoding="utf-8"))
    return data.pop("_meta"), data


def _plural(lang: str, n) -> str:
    """Intl.PluralRules' form for Arabic (zero, one, two, few, many, other), and one/other for the other languages,
    as English. A language with other rules (French: 0 is "one") needs its own line here, as the browser has."""
    try:
        n = int(n)
    except (TypeError, ValueError):
        return "other"
    if lang == "ar":
        return "zero" if n == 0 else "one" if n == 1 else "two" if n == 2 else "few" if 3 <= n % 100 <= 10 else \
            "many" if 11 <= n % 100 <= 99 else "other"
    return "one" if n == 1 else "other"


class _Format(string.Formatter):
    """{x!l}: the value in lower case ("this signature")."""

    def convert_field(self, value, conversion):
        return str(value).lower() if conversion == "l" else super().convert_field(value, conversion)


def render(lang: str, key: str, **args) -> str:
    """The text of a name in lang (else Arabic), its values filled in, and in lang too when they are messages."""
    lang = lang if lang in languages() else SOURCE
    v = language_file(lang)[1].get(key) or language_file(SOURCE)[1][key]
    if isinstance(v, dict):
        n = args.get("n")
        v = (n == 0 and v.get("zero")) or v.get(_plural(lang, n)) or v["other"]
    if not args:
        return v
    return _Format().format(v, **{k: render(lang, x.key, **x.args) if isinstance(x, Msg) else str(_of(x))
                                  for k, x in args.items()})


class Msg(str):
    """The Arabic text, with the name and values it was made from."""
    key: str
    args: dict

    def __new__(cls, key: str, **args):
        self = super().__new__(cls, render(SOURCE, key, **args))
        self.key, self.args = key, args
        return self


def msg(key: str, **args) -> Msg:
    return Msg(key, **args)


def doc(key: str, **args) -> Msg:
    assert key.startswith("doc."), key
    return Msg(key, **args)


def _of(v):
    """The message an exception carries, when it carries one."""
    if isinstance(v, BaseException) and v.args and isinstance(v.args[0], Msg):
        return v.args[0]
    return v


def to_json(v):
    """A reply's content with every message as {key, args}, at any depth, so the browser shows it in its language
    (web/js/i18n.js I18N.revive); an exception as its message, or its text. main.py's Reply sends every reply so."""
    v = _of(v)
    if isinstance(v, Msg):
        return {"key": v.key, "args": {k: to_json(x) for k, x in v.args.items()}}
    if isinstance(v, BaseException):
        return str(v)
    if isinstance(v, dict):
        return {k: to_json(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [to_json(x) for x in v]
    return v


def payload(m) -> dict:
    """An error reply: {"error": the Arabic text, "key", "args"}; an exception's message when it has one."""
    m = _of(m)
    if isinstance(m, Msg):
        return {"error": str(m), "key": m.key, "args": m.args}
    return {"error": str(m)}
