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
    # Wisp on the public demo journey: every judge asks as the demo account, so one shared count.
    "demo_advisor": (300, 3000),
    "retailer_ask": (20, 1500),
    "proof_claims": (30, 1500),  # Willow Proof claim drafts (app/proof_ai.py)
    "label_scan": (30, 1500),
    "analyze": (60, 2000),
    "metric_story": (60, 3000),  # one Gemini call per new story; past it, the facts version
    "sample_runs": (12, 600),
    "routine_check": (100, 5000),  # re-run on every routine change; past it, rules only
    # Proof-gated promotion (app/campaigns.py): Firestore writes, not paid calls; bounded anyway.
    "campaign_create": (20, 2000),
    "shelf_upload": (20, 2000),  # Shelf vs results stock files (app/shelf.py)
    "sponsored_event": (60, 100000),  # a person counts once a day per campaign and kind
    "product_request": (10, 2000),  # requests for products the catalog lacks (Firestore + photo)
}

MESSAGES = {
    "advisor": "That is 20 questions for today.",
    "demo_advisor": "The demo's questions for today are used up. Your own account has its own.",
    "retailer_ask": "That is 20 questions for today.",
    "campaign_create": "That is 20 new campaigns for today.",
    "proof_claims": "That is 30 sets of claim drafts for today.",
    "product_request": "That is 10 product requests for today.",
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
