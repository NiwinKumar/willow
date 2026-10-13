"""Daily usage caps (docs/GEMINI_SPEC.md "Cost and quota guardrails").

Each paid action counts per person and across everyone. Guest accounts are free to create, so
the per-person cap alone would not bound cost; the global cap does. Counters live in Firestore
under users/{uid}/usage/{day} (the global one under the pseudo-user "_global").
"""

from datetime import UTC, datetime

from fastapi import HTTPException

from app.store import Store

GLOBAL_UID = "_global"

# action: (per person, everyone)
CAPS: dict[str, tuple[int, int]] = {
    "advisor": (20, 3000),
    "retailer_ask": (20, 1500),
    "label_scan": (30, 1500),
    "analyze": (60, 2000),
    "sample_runs": (12, 600),
}

MESSAGES = {
    "advisor": "That is 20 questions for today.",
    "retailer_ask": "That is 20 questions for today.",
}


def take(store: Store, uid: str, action: str) -> int:
    """Count one use; raise 429 when either cap is passed. Returns this person's count today."""
    per_person, everyone = CAPS[action]
    day = datetime.now(UTC).date().isoformat()
    used = store.usage_incr(uid, day, action)
    if used > per_person:
        raise HTTPException(
            429,
            {"code": "daily_limit", "message": MESSAGES.get(action, "That is enough for today.")},
        )
    if store.usage_incr(GLOBAL_UID, day, action) > everyone:
        raise HTTPException(
            429,
            {"code": "busy", "message": "Willow is very busy today. Please try again tomorrow."},
        )
    return used
