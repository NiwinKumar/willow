"""A one-line note on a routine product, read into fixed tags (Nov 29).

The person writes how a product feels in their own words ("tingles a bit, smells odd"). Gemini
maps it to tags from a fixed list, each with a confidence word; only high and medium are kept.
Gemini never writes text the person sees and never makes up a tag (the schema is the list).
Self-reported, like app/feel.py: never part of a measurement, and not exported to Proof (its
perception rows read the cohort's feel answers from BigQuery, not routine notes). When Gemini
is down, past the daily cap, or answers "none", the note is saved without tags.
"""

import json
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field

from app import gemini, limits
from app.store import Store

NOTE_MAX = 140
TAGS = (
    "stinging",
    "dryness",
    "tightness",
    "breakouts",
    "oiliness",
    "redness_flare",
    "pleasant_texture",
    "scent_issue",
    "none",
)
Tag = Literal[
    "stinging",
    "dryness",
    "tightness",
    "breakouts",
    "oiliness",
    "redness_flare",
    "pleasant_texture",
    "scent_issue",
    "none",
]
MAX_TAGS = 4


class TagRead(BaseModel):
    tag: Tag
    confidence: Literal["high", "medium", "low"]


class NoteRead(BaseModel):
    tags: list[TagRead] = Field(default_factory=list, max_length=8)


INSTRUCTIONS = f"""The person wrote a short note about how one skincare product feels to use.
Return every tag from this list that the note clearly says, with your confidence:
{", ".join(TAGS)}.
stinging = stings, tingles, burns; dryness = dry, flaky; tightness = feels tight; breakouts =
new spots or bumps; oiliness = greasy, oily, shiny; redness_flare = goes red, flushed;
pleasant_texture = nice texture, absorbs well, feels lovely; scent_issue = smell or fragrance
bothers them. "none" only when the note says nothing about how it feels. Never guess."""


def tags_of(out: NoteRead) -> list[str]:
    """High and medium confidence tags, in the list's order; "none" only on its own."""
    kept = {t.tag for t in out.tags if t.confidence in ("high", "medium")}
    kept.discard("none")
    return [t for t in TAGS if t in kept][:MAX_TAGS]


def read(store: Store, uid: str, text: str) -> tuple[list[str], str]:
    """(tags, source): source "gemini", or "none" when no reading was made."""
    text = text.strip()[:NOTE_MAX]
    if not text:
        return [], "none"
    try:
        limits.take(store, uid, "note_tags")
    except HTTPException:
        return [], "none"
    try:
        out = gemini.generate_json(
            "note_tags",
            [json.dumps({"NOTE": text})],
            NoteRead,
            instructions=INSTRUCTIONS,
            temperature=0.0,
            max_output_tokens=300,
        )
    except gemini.GeminiError:
        limits.refund(store, uid, "note_tags")
        return [], "none"
    return tags_of(out), "gemini"


def record(doc: dict[str, Any], text: str, tags: list[str], source: str) -> None:
    """Keep the note on the entry; an empty note clears it."""
    text = text.strip()[:NOTE_MAX]
    if not text:
        doc["note"] = None
        return
    doc["note"] = {
        "text": text,
        "tags": tags,
        "source": source,
        "at": datetime.now(UTC).isoformat(),
    }
