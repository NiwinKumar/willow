"""The check-in reminder in the person's own terms (Nov 29): Gemini writes the push body and a
short weekly recap line from their routine and their own verdicts on it ("It's working for me",
"Too soon to tell"). Never a reading or a score: the input holds product names, times of day, the
person's verdicts and the places the check-in covers, nothing measured.

Checked in code: at most 140 characters each, only numbers that are in the input, no banned
words. Kept per person per week on their user doc (one Gemini call a week at most); any failure
gives the fixed template (app/reminders.payload), as before.
"""

import json
import logging
from datetime import date
from typing import Any

from pydantic import BaseModel, Field

from app import feel, gemini, numbers, reminders
from app.explain import BANNED, SAFE
from app.store import Doc, Store

log = logging.getLogger("willow.reminder_text")

MAX_CHARS = 140


class Lines(BaseModel):
    body: str = Field(max_length=300)
    recap: str = Field(max_length=300)


INSTRUCTIONS = """Write two short lines for a skincare check-in reminder, from the person's
routine and their own verdicts on each product.
- "body": the push notification body. Invite them to take today's check-in photos by the same
  window light, naming what the check-in covers. Warm, calm, one sentence.
- "recap": one sentence on their week: which products they use and how they said each one feels.
Each under 140 characters. No numbers unless they are in the input, no scores, no measurements,
no claims that skin changed. Cosmetic language only. British spelling."""


def week_key(day: date) -> str:
    y, w, _ = day.isocalendar()
    return f"{y}-W{w:02d}"


def inputs(entries: list[tuple[str, Doc]], places: list[str]) -> dict[str, Any]:
    """What Gemini sees: current products, their times of day and the person's own verdict."""
    products = []
    for _, e in entries:
        if e.get("ended_at"):
            continue
        said = feel.words(e.get("feel"))
        products.append(
            {
                "product": f"{e.get('brand', '')} {e.get('custom_name', '')}".strip(),
                "when": e.get("slots") or [],
                "they_said": said["verdict"] if said else None,
                "feels": said["feels"] if said else [],
            }
        )
    return {"checkin_covers": reminders._place_words(places) if places else None,
            "products": products[:8]}  # fmt: skip


def valid(text: str, allowed: set[str]) -> bool:
    text = text.strip()
    return (
        0 < len(text) <= MAX_CHARS
        and numbers.only_known(text, allowed)
        and not BANNED.search(text)
        and not SAFE.search(text)
    )


def lines(store: Store, uid: str, user: Doc, places: list[str], day: date) -> dict[str, str] | None:
    """This week's {body, recap}: kept on the user doc, else written now; None on any failure."""
    week = week_key(day)
    kept = user.get("reminder_text")
    if isinstance(kept, dict) and kept.get("week") == week:
        # a rejected answer is kept too (body ""), so a week asks Gemini once
        if not kept.get("body"):
            return None
        return {"body": kept["body"], "recap": kept.get("recap") or ""}
    data = inputs(store.routine_list(uid), places)
    if not data["products"]:
        return None
    allowed = numbers.collect(data)
    try:
        out = gemini.generate_json(
            "reminder_text",
            [json.dumps(data)],
            Lines,
            instructions=INSTRUCTIONS,
            temperature=0.3,
            max_output_tokens=400,
            timeout_ms=10_000,
        )
    except gemini.GeminiError:
        return None
    body, recap = out.body.strip(), out.recap.strip()
    if not valid(body, allowed):
        log.info("reminder_text: body rejected")
        store.user_merge(uid, {"reminder_text": {"week": week, "body": "", "recap": ""}})
        return None
    if not valid(recap, allowed):
        recap = ""
    store.user_merge(uid, {"reminder_text": {"week": week, "body": body, "recap": recap}})
    return {"body": body, "recap": recap}


def checkin_message(
    store: Store, uid: str, user: Doc, places: list[str], day: date
) -> dict[str, str]:
    """The reminder push: the template, with Gemini's body when one passed the checks."""
    message = reminders.payload("checkin", places)
    try:
        written = lines(store, uid, user, places, day)
    except Exception:  # never let the personal line stop a reminder
        log.exception("reminder_text failed")
        written = None
    if written:
        message = {**message, "body": written["body"]}
    return message
