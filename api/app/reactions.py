"""Reaction log (build-spec, POST/GET /v1/me/reactions): what to do next, by a fixed rule.

The outcome is fixed text chosen in code from the signs the person ticked, never written by
Gemini and never a dosing tweak for anything beyond mild stinging or dryness. Any reaction that
is not mild puts the product on the person's avoid list (profile.safety.avoid_products), so every
check and plan leaves it out from then on. Reactions are stored on the user doc, last 50 kept.
"""

import secrets
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app import safety
from app.store import Store, iso

Sign = Literal[
    "stinging",
    "redness",
    "itch",
    "dryness",
    "breakouts",
    "swelling",
    "blisters",
    "hives",
    "eyes_lips",
    "breathing",
]
URGENT_SIGNS = {"swelling", "blisters", "hives", "eyes_lips", "breathing"}
STOP_SIGNS = {"redness", "itch", "stinging"}
PERSISTENT_DAYS = 3
KEEP = 50
REPORT = "You can report a reaction to the brand or to your national regulator."

OUTCOMES: dict[str, dict[str, Any]] = {
    "urgent": {
        "level": "urgent",
        "title": "Stop using it and get medical help now.",
        "steps": [
            "Rinse the product off with plenty of cool water.",
            "Trouble breathing, or swelling of the lips, tongue or eyes: call your local "
            "emergency number.",
            "Take the product, or a photo of its ingredient list, to show the doctor.",
        ],
    },
    "stop": {
        "level": "stop",
        "title": "Stop this product, rinse with water, and see a doctor or pharmacist if it "
        "doesn't settle in a few days.",
        "steps": [
            "Rinse the area gently with cool water.",
            "Leave out this product, and any other active, until your skin settles.",
            "See a doctor or pharmacist if it doesn't settle in a few days, or sooner if it "
            "gets worse.",
        ],
    },
    "mild": {
        "level": "mild",
        "title": "Mild stinging or dryness can settle. Use it less often for a week; stop if it "
        "gets worse.",
        "steps": [
            "Use it less often for a week.",
            "Stop if it gets worse, or if you see swelling, blisters or hives.",
        ],
    },
}


class ReactionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: str = Field(min_length=1, max_length=120)
    entry_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,64}$")
    signs: list[Sign] = Field(min_length=1, max_length=10)
    strength: Literal["mild", "strong"] = "mild"
    since_days: int = Field(default=0, ge=0, le=365)

    @field_validator("product_id")
    @classmethod
    def _pid(cls, v: str) -> str:
        if not safety.PRODUCT_ID.match(v):
            raise ValueError("product_id is a catalog product id")
        return v

    @field_validator("signs")
    @classmethod
    def _signs(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(v))


def level_of(signs: list[str], strength: str, since_days: int) -> str:
    """urgent: any sign of a serious reaction; stop: strong or lasting redness, itch or
    stinging; otherwise mild."""
    if set(signs) & URGENT_SIGNS:
        return "urgent"
    if set(signs) & STOP_SIGNS and (strength == "strong" or since_days >= PERSISTENT_DAYS):
        return "stop"
    return "mild"


def outcome(level: str) -> dict[str, Any]:
    o = OUTCOMES[level]
    return {**o, "steps": list(o["steps"]), "report": REPORT}


def _view(r: dict[str, Any]) -> dict[str, Any]:
    return {**r, "created_at": iso(r.get("created_at"))}


def record(store: Store, uid: str, body: ReactionIn) -> dict[str, Any]:
    level = level_of(list(body.signs), body.strength, body.since_days)
    reaction = {
        "id": f"rx_{secrets.token_hex(4)}",
        "product_id": body.product_id,
        "entry_id": body.entry_id,
        "signs": list(body.signs),
        "strength": body.strength,
        "since_days": body.since_days,
        "level": level,
        "created_at": datetime.now(UTC),
    }
    doc = store.user_get(uid) or {}
    kept = [*(doc.get("reactions") or []), reaction][-KEEP:]
    fields: dict[str, Any] = {"reactions": kept}
    if level != "mild":
        # the whole profile is written back: a memory store replaces the map on merge
        profile = dict(doc.get("profile") or {})
        saved = safety.profile_of(doc) or safety.SafetyProfile().model_dump()
        avoid = list(saved.get("avoid_products") or [])
        if body.product_id not in avoid:
            avoid = [*avoid, body.product_id][-safety.MAX_AVOID_PRODUCTS :]
        profile["safety"] = {**saved, "avoid_products": avoid}
        profile.setdefault("goals", [])
        profile["updated_at"] = datetime.now(UTC)
        fields["profile"] = profile
    store.user_merge(uid, fields)
    return {"reaction": _view(reaction), "outcome": outcome(level)}


def listing(store: Store, uid: str) -> list[dict[str, Any]]:
    """Newest first."""
    doc = store.user_get(uid) or {}
    return [_view(r) for r in reversed(doc.get("reactions") or [])]
