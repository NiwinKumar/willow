"""Routine use log: which routine products the person ticked as used, per day and AM/PM slot.

Stored per person and day (users/{uid}/routine_log/{YYYY-MM-DD}: {date, used: {entry_id: [slots]}}).
The day is the person's own calendar day, sent by the app (the api cannot know their time zone),
so it may run one day ahead of the server's UTC date. Used for Home's "routine today" ticks and
for each product's recent use ("used on 9 of the last 14 days"), which makes "did this product
work for me?" honest about whether it was actually used.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import HTTPException

SLOTS = ("am", "pm")
PAST_DAYS = 30  # ticks can be added or removed this far back (a forgotten evening, a weekend)
MAX_RANGE_DAYS = 92  # one read covers about a quarter
RECENT_DAYS = 28  # recent use is counted over the last four weeks


def today() -> date:
    return datetime.now(UTC).date()


def parse_day(text: str, field: str = "date") -> date:
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise HTTPException(
            422, {"code": "bad_request", "message": f"{field} must be YYYY-MM-DD"}
        ) from exc


def check_tick(day_text: str, entry: dict[str, Any] | None, slot: str) -> date:
    """The day a tick may be written for, or a 4xx that says why not."""
    day = parse_day(day_text)
    now = today()
    if not now - timedelta(days=PAST_DAYS) <= day <= now + timedelta(days=1):
        raise HTTPException(
            422,
            {"code": "bad_request", "message": f"only the last {PAST_DAYS} days can be changed"},
        )
    if entry is None:
        raise HTTPException(404, {"code": "not_found", "message": "routine entry not found"})
    if slot not in SLOTS:
        raise HTTPException(422, {"code": "bad_request", "message": "slot must be am or pm"})
    if slot not in (entry.get("slots") or []):
        raise HTTPException(
            409, {"code": "conflict", "message": f"this product is not in your {slot} routine"}
        )
    started = entry.get("started_at")
    ended = entry.get("ended_at")
    if started and day < date.fromisoformat(started[:10]):
        raise HTTPException(
            409, {"code": "conflict", "message": "that day is before you started this product"}
        )
    if ended and day > date.fromisoformat(ended[:10]):
        raise HTTPException(
            409, {"code": "conflict", "message": "that day is after you stopped this product"}
        )
    return day


def day_view(doc: dict[str, Any]) -> dict[str, Any]:
    """{date, used: {entry_id: [slots]}}, empty entries dropped, slots in AM-PM order."""
    used = {eid: [s for s in SLOTS if s in slots] for eid, slots in (doc.get("used") or {}).items()}
    return {"date": doc["date"], "used": {eid: s for eid, s in used.items() if s}}


def recent_use(
    entry: dict[str, Any], entry_id: str, logs: list[dict[str, Any]], now: date
) -> dict[str, int]:
    """Days with any tick for this product, over the days it was in the routine within the last
    RECENT_DAYS (from its start, or the window start, to today or its stop)."""
    first = now - timedelta(days=RECENT_DAYS - 1)
    if entry.get("started_at"):
        first = max(first, date.fromisoformat(entry["started_at"][:10]))
    last = now
    if entry.get("ended_at"):
        last = min(last, date.fromisoformat(entry["ended_at"][:10]))
    of_days = max((last - first).days + 1, 0)
    lo, hi = first.isoformat(), last.isoformat()
    used = sum(1 for d in logs if lo <= d["date"] <= hi and (d.get("used") or {}).get(entry_id))
    return {"days_used": used, "of_days": of_days}
