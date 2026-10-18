"""The advisor's structured answer (GEMINI_SPEC.md section 5): blocks instead of one paragraph.

Gemini writes `blocks`: a one-line `answer` first, then optional `bullets`, a `note`, a `widget`
(the app draws it from the person's real data; Gemini only names it and its parameters, never a
number) and `products`. Text may use a tiny inline markup, parsed by the web into elements (never
HTML): **bold**, ==highlight==, [product:ID] and [metric:ID]. Every text still passes the number
and wording validators; every product id must come from a tool result or the routine.
"""

import re
from typing import Any, Literal

from pydantic import BaseModel, Field

METRIC_IDS = (
    "tone_ita",
    "pigment_spots",
    "tone_evenness",
    "redness",
    "blemishes",
    "pores",
    "texture",
    "lines",
    "dark_circles",
    "shine",
    "glow",
)
# As the app labels them (web/src/lib/metrics.ts METRIC_META), for the plain-text message.
METRIC_LABELS = {
    "tone_ita": "skin tone (ITA°)",
    "pigment_spots": "dark spots",
    "tone_evenness": "tone evenness",
    "redness": "redness",
    "blemishes": "blemishes",
    "pores": "pores",
    "texture": "texture",
    "lines": "lines",
    "dark_circles": "under-eye",
    "shine": "shine",
    "glow": "glow",
}
SITES = (
    "face_full",
    "cheek_macro",
    "left_cheek_macro",
    "right_cheek_macro",
    "forehead_macro",
    "chin_macro",
    "nose_macro",
    "forearm_treated",
    "forearm_control",
)
WIDGET_KINDS = (
    "metric_trend",
    "session_summary",
    "routine",
    "product",
    "product_test",
)
MAX_WIDGETS = 2

# [product:minimalist-retinol-0-3-face-serum], [metric:redness]
TOKEN = re.compile(r"\[(product|metric):([A-Za-z0-9_.\-]{1,120})\]")
EMPHASIS = re.compile(r"\*\*|==")


class WidgetSpec(BaseModel):
    """Which widget and its parameters; the app fills it from the person's own data."""

    kind: Literal[
        "metric_trend", "session_summary", "routine", "product", "spot_diary", "product_test"
    ]
    metric_id: str | None = None  # metric_trend
    site: str | None = None  # metric_trend, session_summary (optional)
    session_id: str | None = None  # session_summary: an id from CONTEXT or "latest"
    slot: Literal["am", "pm"] | None = None  # routine (optional)
    product_id: str | None = None  # product


class Block(BaseModel):
    type: Literal["answer", "bullets", "note", "widget", "products"]
    text: str | None = Field(default=None, max_length=600)  # answer, note
    items: list[str] = Field(default_factory=list, max_length=6)  # bullets
    widget: WidgetSpec | None = None  # widget
    product_ids: list[str] = Field(default_factory=list, max_length=4)  # products


def strip(text: str) -> str:
    """The words a person reads, for the validators: markup tokens and emphasis removed (a
    product id such as minimalist-retinol-0-3 is not a number Gemini wrote)."""
    return EMPHASIS.sub("", TOKEN.sub(" ", text))


def refs(text: str, kind: str) -> set[str]:
    return {ref for k, ref in TOKEN.findall(text) if k == kind}


def texts(blocks: list[Block]) -> list[str]:
    out: list[str] = []
    for b in blocks:
        if b.type in ("answer", "note") and b.text:
            out.append(b.text)
        elif b.type == "bullets":
            out.extend(i for i in b.items if i)
    return out


def ordered_product_refs(blocks: list[Block]) -> list[str]:
    """Every product id the answer uses, in reading order: in text, in products blocks and in
    product widgets."""
    found: list[str] = []
    for b in blocks:
        for t in texts([b]):
            found += [ref for k, ref in TOKEN.findall(t) if k == "product"]
        if b.type == "products":
            found += b.product_ids
        if b.type == "widget" and b.widget and b.widget.kind == "product" and b.widget.product_id:
            found.append(b.widget.product_id)
    return list(dict.fromkeys(found))


def product_refs(blocks: list[Block]) -> set[str]:
    return set(ordered_product_refs(blocks))


def bad_metric_refs(blocks: list[Block]) -> set[str]:
    return {m for t in texts(blocks) for m in refs(t, "metric")} - set(METRIC_IDS)


def widget_params(w: WidgetSpec, session_ids: set[str], product_ids: set[str]) -> dict | None:
    """The widget's parameters if they are usable, else None (the widget is left out)."""
    if w.site is not None and w.site not in SITES:
        return None
    if w.kind == "metric_trend":
        if w.metric_id not in METRIC_IDS:
            return None
        return {"metric_id": w.metric_id, **({"site": w.site} if w.site else {})}
    if w.kind == "session_summary":
        sid = w.session_id or "latest"
        if sid != "latest" and sid not in session_ids:
            return None
        return {"session_id": sid, **({"site": w.site} if w.site else {})}
    if w.kind == "routine":
        return {"slot": w.slot} if w.slot else {}
    if w.kind == "product":
        return {"product_id": w.product_id} if w.product_id in product_ids else None
    if w.kind == "spot_diary":
        return None  # the spot diary is gone from the app (Oct 18); older answers may still ask
    return {}  # product_test: no parameters


def normalize(
    blocks: list[Block], session_ids: set[str], product_ids: set[str]
) -> list[dict[str, Any]]:
    """Blocks as the api returns them: answer first, empty blocks and unusable widgets left out,
    at most MAX_WIDGETS widgets."""
    out: list[dict[str, Any]] = []
    widgets = 0
    for b in blocks:
        if b.type in ("answer", "note") and b.text and b.text.strip():
            out.append({"type": b.type, "text": b.text.strip()})
        elif b.type == "bullets":
            items = [i.strip() for i in b.items if i and i.strip()]
            if items:
                out.append({"type": "bullets", "items": items})
        elif b.type == "widget" and b.widget and widgets < MAX_WIDGETS:
            params = widget_params(b.widget, session_ids, product_ids)
            if params is not None:
                widgets += 1
                out.append({"type": "widget", "widget": {"kind": b.widget.kind, "params": params}})
        elif b.type == "products":
            ids = [i for i in dict.fromkeys(b.product_ids) if i in product_ids]
            if ids:
                out.append({"type": "products", "product_ids": ids})
    # answer first: if Gemini put something before it, the answer moves to the top
    answers = [b for b in out if b["type"] == "answer"]
    if answers and out[0] is not answers[0]:
        out.remove(answers[0])
        out.insert(0, answers[0])
    return out


def plain(text: str, names: dict[str, str], labels: dict[str, str]) -> str:
    def name(m: re.Match[str]) -> str:
        kind, ref = m.group(1), m.group(2)
        return (names if kind == "product" else labels).get(ref, ref.replace("_", " "))

    return EMPHASIS.sub("", TOKEN.sub(name, text))


def message_of(blocks: list[dict[str, Any]], names: dict[str, str], labels: dict[str, str]) -> str:
    """The plain-text answer (the `message` older clients read, the copy button, the history the
    web sends back): answer, bullets and notes, markup turned into names."""
    lines: list[str] = []
    for b in blocks:
        if b["type"] in ("answer", "note"):
            lines.append(plain(b["text"], names, labels))
        elif b["type"] == "bullets":
            lines.extend(f"- {plain(i, names, labels)}" for i in b["items"])
    return "\n".join(lines)[:1000]
