"""Routine schedules: which days a routine product is used (docs/CONTRACT.md section 4).

`schedule` on a routine entry is `{kind, days?, anchor}` or null (null means every day):
- daily: every day.
- alternate: every other day, counted from `anchor` (the anchor day is a "use" day). Two products
  with anchors one day apart alternate nights (the routine check's "Alternate nights" fix).
- days: chosen weekdays, `days` as 0 = Monday .. 6 = Sunday.

The day is the person's own calendar day. Schedules decide "TONIGHT" / "RESTS" in the app, keep a
resting day from counting as a missed one in recent use, and let the routine check skip pairs
that never share a day.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Kind = Literal["daily", "alternate", "days"]
CYCLE_DAYS = 14  # every pattern repeats within lcm(2, 7) days


class Schedule(BaseModel):
    kind: Kind
    days: list[int] | None = Field(default=None, max_length=7)
    anchor: date | None = None

    @field_validator("days")
    @classmethod
    def _weekdays(cls, v: list[int] | None) -> list[int] | None:
        if v is None:
            return v
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("days are weekdays, 0 (Monday) to 6 (Sunday)")
        return sorted(set(v))

    @model_validator(mode="after")
    def _complete(self) -> "Schedule":
        if self.kind == "days" and not self.days:
            raise ValueError("pick at least one day")
        if self.kind != "days":
            self.days = None
        today = datetime.now(UTC).date()
        if self.anchor is None:
            self.anchor = today
        elif abs((self.anchor - today).days) > 366:
            raise ValueError("the schedule anchor must be within a year of today")
        return self


def _parse(schedule: dict[str, Any] | None) -> dict[str, Any] | None:
    if not schedule or schedule.get("kind") in (None, "daily"):
        return None
    return schedule


def applies_on(schedule: dict[str, Any] | None, day: date) -> bool:
    """Is this a "use" day? A missing or unreadable schedule means every day."""
    s = _parse(schedule)
    if s is None:
        return True
    if s["kind"] == "alternate":
        try:
            anchor = date.fromisoformat(str(s.get("anchor"))[:10])
        except ValueError:
            return True
        return (day - anchor).days % 2 == 0
    if s["kind"] == "days":
        return day.weekday() in (s.get("days") or range(7))
    return True


def share_a_day(a: dict[str, Any] | None, b: dict[str, Any] | None) -> bool:
    """Do two schedules ever fall on the same day? (Checked over one full cycle.)"""
    start = datetime.now(UTC).date()
    return any(
        applies_on(a, d) and applies_on(b, d)
        for d in (start + timedelta(days=i) for i in range(CYCLE_DAYS))
    )


WEEKDAY = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def words(schedule: dict[str, Any] | None) -> str:
    """Plain words for prompts and notes: "every day", "every other day", "Mon, Thu"."""
    s = _parse(schedule)
    if s is None:
        return "every day"
    if s["kind"] == "alternate":
        return "every other day"
    return ", ".join(WEEKDAY[d] for d in s.get("days") or [])
