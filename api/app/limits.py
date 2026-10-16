"""Daily usage caps (docs/GEMINI_SPEC.md "Cost and quota guardrails").

Each paid action counts per person and across everyone. Guest accounts are free to create, so
the per-person cap alone would not bound cost; the global cap does. Counters live in Firestore
under users/{uid}/usage/{day} (the global one under the pseudo-user "_global").
"""

from datetime import UTC, datetime, timedelta

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
    "routine_check": (100, 5000),  # re-run on every routine change; past it, rules only
    # Proof-gated promotion (app/campaigns.py): Firestore writes, not paid calls; bounded anyway.
    "campaign_create": (20, 2000),
    "sponsored_event": (60, 100000),  # a person counts once a day per campaign and kind
}

MESSAGES = {
    "advisor": "That is 20 questions for today.",
    "retailer_ask": "That is 20 questions for today.",
    "campaign_create": "That is 20 new campaigns for today.",
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
        # Everyone's cap: this attempt did not happen, so the person's own count goes back.
        store.usage_incr(uid, day, action, -1)
        store.usage_incr(GLOBAL_UID, day, action, -1)
        raise HTTPException(
            429,
            {"code": "busy", "message": "Willow is very busy today. Please try again tomorrow."},
        )
    return used


def refund(store: Store, uid: str, action: str) -> None:
    """Give a use back when the action failed on our side (engine down, Gemini unavailable)."""
    day = datetime.now(UTC).date().isoformat()
    store.usage_incr(uid, day, action, -1)
    store.usage_incr(GLOBAL_UID, day, action, -1)


# What GET /v1/me/usage reports (the paid actions a person sees a count for).
SHOWN = ("advisor", "routine_check", "label_scan", "retailer_ask")


def usage(store: Store, uid: str, now: datetime | None = None) -> dict[str, dict[str, object]]:
    """Today's (UTC) count per shown action, read without counting anything. An attempt refused
    past the cap stays counted, so `used` is clamped to the cap."""
    now = now or datetime.now(UTC)
    day = now.date()
    counts = store.usage_get(uid, day.isoformat())
    resets = datetime(day.year, day.month, day.day, tzinfo=UTC) + timedelta(days=1)
    out: dict[str, dict[str, object]] = {}
    for action in SHOWN:
        cap = CAPS[action][0]
        raw = max(0, int(counts.get(action) or 0))
        out[action] = {
            "used": min(raw, cap),
            "cap": cap,
            "remaining": max(0, cap - raw),
            "resets_at": resets.isoformat().replace("+00:00", "Z"),
        }
    return out
