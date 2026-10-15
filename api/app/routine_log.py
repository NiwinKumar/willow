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

from app import schedule

SLOTS = ("am", "pm")
PAST_DAYS = 30  # ticks can be added or removed this far back (a forgotten evening, a weekend)
MAX_RANGE_DAYS = 92  # one read covers about a quarter
RECENT_DAYS = 14  # recent use: the last two weeks (the log's default range too)


def today() -> date:
    return datetime.now(UTC).date()


def parse_day(text: str, field: str = "date") -> date:
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise HTTPException(
            422, {"code": "bad_request", "message": f"{field} must be YYYY-MM-DD"}
        ) from exc


def check_day(day_text: str) -> date:
    day = parse_day(day_text)
    now = today()
    if not now - timedelta(days=PAST_DAYS) <= day <= now + timedelta(days=1):
        raise HTTPException(
            422,
            {"code": "bad_request", "message": f"only the last {PAST_DAYS} days can be changed"},
        )
    return day


def check_untick(day_text: str, slot: str) -> date:
    """Removing a tick is always allowed (a mistaken tick must be removable after the product's
    slots or dates changed, or after it was removed): the day window and the slot name only."""
    if slot not in SLOTS:
        raise HTTPException(422, {"code": "bad_request", "message": "slot must be am or pm"})
    return check_day(day_text)


def local_today(text: str | None) -> date:
    """The person's own calendar day, as the app sends it, kept within a day of UTC's; UTC's
    own when it is missing or malformed (a bad hint never fails the routine list)."""
    now = today()
    try:
        day = date.fromisoformat(text) if text else now
    except ValueError:
        return now
    return min(max(day, now - timedelta(days=1)), now + timedelta(days=1))


def check_tick(day_text: str, entry: dict[str, Any] | None, slot: str) -> date:
    """The day a tick may be written for, or a 4xx that says why not."""
    day = check_day(day_text)
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


def ticked(doc: dict[str, Any], entry_id: str | None = None) -> bool:
    used = doc.get("used") or {}
    return bool(used.get(entry_id)) if entry_id else any(used.values())


def recent_use(
    entry: dict[str, Any],
    entry_id: str,
    logs: list[dict[str, Any]],
    now: date,
    since: str | None,
) -> dict[str, int] | None:
    """Days with any tick for this product, over the days it was in the routine within the last
    RECENT_DAYS, counted from `since`, the day the person first ticked anything (never "0 of 21
    days" for days before ticking existed; a gap in ticking stays a gap). None when the person
    has never ticked, or the product had no days in the window."""
    if not since:
        return None
    first = max(now - timedelta(days=RECENT_DAYS - 1), date.fromisoformat(since))
    if entry.get("started_at"):
        first = max(first, date.fromisoformat(entry["started_at"][:10]))
    last = now
    if entry.get("ended_at"):
        last = min(last, date.fromisoformat(entry["ended_at"][:10]))
    if (last - first).days < 0:  # stopped before the window, or starts after today
        return None
    lo, hi = first.isoformat(), last.isoformat()
    used_days = {
        d["date"] for d in logs if lo <= d["date"] <= hi and (d.get("used") or {}).get(entry_id)
    }
    # A day the schedule rests the product (every other night, chosen days) is not a missed day;
    # a tick on a rest day still counts as a day used.
    days = (first + timedelta(days=i) for i in range((last - first).days + 1))
    of_days = sum(
        1
        for d in days
        if schedule.applies_on(entry.get("schedule"), d) or d.isoformat() in used_days
    )
    if of_days == 0:
        return None
    return {"days_used": len(used_days), "of_days": of_days}
