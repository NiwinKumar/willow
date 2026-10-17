"""How a product feels to the person using it: their own verdict and look-and-feel tags.

Self-reported, so it is kept apart from every measurement: it never changes a Proof tier, the
measured evidence, campaign eligibility or a reading. Brands see it only as totals of 10 or more
people (app/retail_intel.py), the advisor reads it as the person's own words (app/advisor.py).
"""

from contextlib import suppress
from datetime import UTC, date, datetime
from typing import Any, Literal

VERDICTS = {
    "working": "It's working for me",
    "unsure": "Too soon to tell",
    "not_for_me": "Not for me",
}
# look and feel, cosmetic words only (no condition names)
TAGS = {
    "feels_nice": ("Nice to use", True),
    "absorbs": ("Absorbs well", True),
    "softer": ("Skin feels softer", True),
    "looks_better": ("Looks better", True),
    "heavy": ("Heavy or sticky", False),
    "stings": ("Stings or tingles", False),
    "drying": ("Dries my skin", False),
    "breakouts": ("More breakouts", False),
}
Verdict = Literal["working", "unsure", "not_for_me"]
Tag = Literal[
    "feels_nice", "absorbs", "softer", "looks_better", "heavy", "stings", "drying", "breakouts"
]
MAX_TAGS = 4
HISTORY = 26
# brands count an answer only once a product has had two weeks
MIN_WEEK = 2


def week_of(started_at: str | None, day: date) -> int:
    """Whole weeks from the start date to the answer day (0 in the first week)."""
    try:
        start = date.fromisoformat(started_at or "")
    except ValueError:
        return 0
    return max(0, (day - start).days // 7)


def record(doc: dict[str, Any], verdict: str, tags: list[str], now: datetime | None = None) -> None:
    """Set the latest answer and keep one per week in the history (a new answer replaces that
    week's)."""
    now = now or datetime.now(UTC)
    # a stopped product's weeks of use end on its stop day
    day = now.date()
    with suppress(ValueError):
        day = min(day, date.fromisoformat(doc.get("ended_at") or ""))
    answer = {
        "verdict": verdict,
        "tags": list(dict.fromkeys(tags))[:MAX_TAGS],
        "week": week_of(doc.get("started_at"), day),
        "at": now.isoformat(),
    }
    history = [h for h in doc.get("feel_history") or [] if h.get("week") != answer["week"]]
    doc["feel"] = answer
    doc["feel_history"] = (history + [answer])[-HISTORY:]


def words(answer: dict[str, Any] | None) -> dict[str, Any] | None:
    """The answer in words, for the advisor (the person's own view, not a measurement)."""
    if not answer:
        return None
    return {
        "verdict": VERDICTS.get(answer.get("verdict"), answer.get("verdict")),
        "feels": [TAGS[t][0] for t in answer.get("tags") or [] if t in TAGS],
        "week": answer.get("week"),
    }
