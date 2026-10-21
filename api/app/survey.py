"""The validation survey (docs/SURVEY.md): one definition, checked answers, stored rows.

The questions live in seed/survey_v1.json, which the web page also reads, so the ids the page
sends are the ids checked here. Answers are kept as option ids in Firestore
(survey_responses/{id}); an email, when someone leaves one, goes to its own collection
(survey_contacts/{id}). The Google Sheet gets readable labels (app/survey_sheet.py).
"""

import hashlib
import json
import re
import secrets
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.store import Store

DEFINITION = Path(__file__).resolve().parent.parent / "seed" / "survey_v1.json"
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
COUNTRY = re.compile(r"^[A-Z]{2}$")
# Answering every screen takes a few minutes; under this the response is kept but marked.
MIN_SECONDS = 30
# Per network address per day, on each api instance (enough to stop a script, not a person).
PER_ADDRESS = 6


class Invalid(ValueError):
    """An answer the survey does not have."""


@lru_cache
def definition() -> dict[str, Any]:
    return json.loads(DEFINITION.read_text())


def questions() -> dict[str, dict[str, Any]]:
    return {q["id"]: q for q in definition()["questions"]}


def answer_columns() -> list[dict[str, Any]]:
    """Questions that hold an answer, in survey order (the info screen and the email do not)."""
    return [q for q in definition()["questions"] if q["kind"] not in ("info", "email")]


def clean(answers: dict[str, Any]) -> dict[str, Any]:
    """Every answer checked against the definition; blank text answers dropped."""
    known = questions()
    out: dict[str, Any] = {}
    for qid, value in answers.items():
        q = known.get(qid)
        if q is None or q["kind"] in ("info", "email"):
            raise Invalid(f"unknown question {qid!r}")
        ids = {o["id"] for o in q.get("options", [])}
        kind = q["kind"]
        if kind in ("single", "scale"):
            if not isinstance(value, str) or value not in ids:
                raise Invalid(f"{qid}: not one of its options")
            out[qid] = value
        elif kind == "multi":
            if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
                raise Invalid(f"{qid}: expected a list of options")
            picked = list(dict.fromkeys(value))
            if not picked or any(v not in ids for v in picked):
                raise Invalid(f"{qid}: not one of its options")
            if q.get("max") and len(picked) > q["max"]:
                raise Invalid(f"{qid}: at most {q['max']}")
            exclusive = {o["id"] for o in q["options"] if o.get("exclusive")}
            if len(picked) > 1 and exclusive & set(picked):
                raise Invalid(f"{qid}: that choice goes alone")
            out[qid] = picked
        elif kind == "text":
            if not isinstance(value, str):
                raise Invalid(f"{qid}: expected text")
            text = value.strip()
            if len(text) > q.get("max_length", 1000):
                raise Invalid(f"{qid}: too long")
            if text:
                out[qid] = text
        elif kind == "country":
            if not isinstance(value, str) or not (COUNTRY.match(value) or value == "none"):
                raise Invalid(f"{qid}: expected a country code")
            out[qid] = value
    return out


def label(qid: str, value: Any) -> str:
    """The words a person picked, for the sheet: '1–2', 'Breakouts; Redness'."""
    q = questions()[qid]
    names = {o["id"]: o["label"] for o in q.get("options", [])}
    if isinstance(value, list):
        return "; ".join(names.get(v, v) for v in value)
    if q["kind"] == "country":
        return "Prefer not to say" if value == "none" else value
    return names.get(value, value)


def valid_email(value: str) -> bool:
    return len(value) <= 254 and bool(EMAIL.match(value))


_seen: dict[tuple[str, str], int] = {}


def over_limit(address: str) -> bool:
    """Count one response from this address today (hashed, never stored); True past the cap."""
    day = datetime.now(UTC).date().isoformat()
    key = (day, hashlib.sha256(address.encode()).hexdigest()[:16])
    for old in [k for k in _seen if k[0] != day]:
        del _seen[old]
    _seen[key] = _seen.get(key, 0) + 1
    return _seen[key] > PER_ADDRESS


def save(
    store: Store,
    *,
    answers: dict[str, Any],
    source: str,
    duration_s: int,
    screened_out: str | None,
    email: str | None,
) -> tuple[str, dict[str, Any], dict[str, Any] | None]:
    """Store one response (and its contact, if any). Returns (id, response, contact)."""
    rid = datetime.now(UTC).strftime("%Y%m%d%H%M%S") + "-" + secrets.token_hex(4)
    now = datetime.now(UTC)
    suspect = ["fast"] if screened_out is None and duration_s < MIN_SECONDS else []
    doc: dict[str, Any] = {
        "version": definition()["version"],
        "submitted_at": now,
        "source": source,
        "duration_s": duration_s,
        "screened_out": screened_out,
        "suspect": suspect,
        "answers": answers,
        "has_contact": bool(email),
        "sheet_synced": False,
    }
    store.survey_response_set(rid, doc)
    contact = None
    if email:
        email_q = questions()["email"]
        contact = {
            "response_id": rid,
            "email": email,
            "consent": email_q["consent"],
            "consented_at": now,
            "pilot": answers.get("pilot"),
            "chat": answers.get("chat"),
            "version": definition()["version"],
        }
        store.survey_contact_set(rid, contact)
    return rid, doc, contact
