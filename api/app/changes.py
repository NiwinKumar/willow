"""What else changed since the last check-in (Nov 28).

At each check-in the person says what was different since their last one: period, stress, sleep,
travel, sport, sun, diet, routine changes, health, or anything in their own words. It is kept on
the session (`changes`), never leaves the person's account (not exported, not in Proof) and is
deleted with it.

This module holds the fixed list of tags, the routine summary the app pre-fills (products started
or stopped since the last check-in and how often each was ticked), and the patterns: for each kind
of change, the person's readings on check-ins where they noted it against check-ins where they
did not. Code decides whether a pattern exists, against the person's own normal range; Gemini only
words it (app/metric_story.py, the advisor). Never a cause: "higher on weeks you noted…".
"""

from datetime import UTC, date, datetime, timedelta
from statistics import mean, median
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app import baselines, explain
from app.results import measured_result
from app.store import Store, iso

# tag -> (group, words the app and the story use). Groups are what patterns are found for.
TAGS: dict[str, tuple[str, str]] = {
    "period": ("period", "had a period"),
    "stress_work": ("stress", "work stress"),
    "stress_study": ("stress", "study stress or exams"),
    "sleep_poor": ("sleep", "slept badly"),
    "travel": ("travel", "travelled"),
    "travel_hot": ("travel", "a hotter place"),
    "travel_cold": ("travel", "a colder place"),
    "travel_humid": ("travel", "a more humid place"),
    "sport_gym": ("sport", "gym or sport"),
    "sport_swim": ("sport", "swimming"),
    "sport_outdoor": ("sport", "outdoor sport"),
    "sun": ("sun", "lots of sun"),
    "diet": ("diet", "ate differently"),
    "diet_sugar": ("diet", "more sugar"),
    "diet_dairy": ("diet", "more dairy"),
    "diet_spicy": ("diet", "more spicy food"),
    "diet_alcohol": ("diet", "more alcohol"),
    "diet_less_water": ("diet", "less water"),
    "routine_skipped": ("routine_skipped", "skipped products"),
    "routine_new": ("routine_new", "tried something new on the skin"),
    "makeup_new": ("routine_new", "new makeup"),
    "clinic": ("clinic", "a facial or clinic visit"),
    "picked": ("picked", "picked at spots"),
    "unwell": ("unwell", "felt unwell"),
    "new_medicine": ("unwell", "started a new medicine"),
}
Tag = Literal[
    "period", "stress_work", "stress_study", "sleep_poor", "travel", "travel_hot", "travel_cold",
    "travel_humid", "sport_gym", "sport_swim", "sport_outdoor", "sun", "diet", "diet_sugar",
    "diet_dairy", "diet_spicy", "diet_alcohol", "diet_less_water", "routine_skipped",
    "routine_new", "makeup_new", "clinic", "picked", "unwell", "new_medicine",
]  # fmt: skip
GROUP_WORDS = {
    "period": "your period",
    "stress": "stress",
    "sleep": "poor sleep",
    "travel": "travel",
    "sport": "sport or sweat",
    "sun": "lots of sun",
    "diet": "diet changes",
    "routine_skipped": "skipped products",
    "routine_new": "something new on your skin",
    "clinic": "a facial or clinic visit",
    "picked": "picking at spots",
    "unwell": "feeling unwell",
}
# The readings each kind of change is compared with (tone is never judged).
WATCH = {
    "period": ("blemishes", "redness", "shine"),
    "stress": ("blemishes", "redness"),
    "sleep": ("blemishes", "redness", "dark_circles"),
    "travel": ("blemishes", "shine", "redness"),
    "sport": ("blemishes", "shine", "redness"),
    "sun": ("pigment_spots", "redness", "tone_evenness"),
    "diet": ("blemishes", "shine", "redness"),
    "routine_skipped": ("blemishes", "redness"),
    "routine_new": ("blemishes", "redness"),
    "clinic": ("redness", "pigment_spots", "texture"),
    "picked": ("blemishes", "pigment_spots"),
    "unwell": ("blemishes", "redness", "dark_circles"),
}
ZONE_WORDS = {
    "forehead": "on your forehead",
    "nose": "on your nose",
    "left_cheek": "on your left cheek",
    "right_cheek": "on your right cheek",
    "chin": "on your chin",
    "around_mouth": "around your mouth",
    "left_jaw": "along your left jaw",
    "right_jaw": "along your right jaw",
    "under_eyes": "under your eyes",
}
# Patterns: enough check-ins on each side, a gap bigger than the normal range, and most noted
# weeks on the same side of the other weeks' middle.
MIN_EACH = 3
MIN_SHARE = 2 / 3
OTHER_MAX = 280


class Changes(BaseModel):
    """PATCH /v1/sessions/{id} `changes`: what was different since the last check-in."""

    tags: list[Tag] = Field(default_factory=list, max_length=len(TAGS))
    other: str | None = Field(default=None, max_length=OTHER_MAX)
    # "Nothing different": an answer too (it counts as a week without each tag)
    nothing: bool = False

    @field_validator("tags")
    @classmethod
    def _unique(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(v))

    @field_validator("other")
    @classmethod
    def _tidy(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None


def stored(c: Changes) -> dict[str, Any]:
    """The session's `changes` field: an empty answer is "nothing different"."""
    nothing = c.nothing or (not c.tags and not c.other)
    return {
        "tags": [] if nothing else c.tags,
        "other": None if nothing else c.other,
        "nothing": nothing,
        "answered_at": datetime.now(UTC),
    }


def view(doc: dict[str, Any]) -> dict[str, Any] | None:
    c = doc.get("changes")
    if not isinstance(c, dict):
        return None
    tags = [t for t in c.get("tags") or [] if t in TAGS]
    return {
        "tags": tags,
        "words": [TAGS[t][1] for t in tags],
        "other": c.get("other"),
        "nothing": bool(c.get("nothing")),
        "answered_at": iso(c.get("answered_at")),
    }


def groups_of(doc: dict[str, Any]) -> set[str] | None:
    """The kinds of change noted on a session; None when the person did not answer."""
    c = doc.get("changes")
    if not isinstance(c, dict):
        return None
    return {TAGS[t][0] for t in c.get("tags") or [] if t in TAGS}


# ---------------------------------------------------------------------------------------------
# The routine summary the app pre-fills


def _day(ts: Any) -> date | None:
    if isinstance(ts, datetime):
        return ts.date()
    try:
        return date.fromisoformat(str(ts)[:10])
    except ValueError:
        return None


def previous_session(store: Store, uid: str, sid: str, doc: dict[str, Any]):
    """The person's last face check-in before this one (any capture mode): (id, doc) or None."""
    at = doc.get("created_at")
    if not at:
        return None
    earlier = [
        (oid, o)
        for oid, o in store.sessions_list(uid)
        if oid != sid
        and o.get("site") == doc.get("site")
        and o.get("created_at")
        and o["created_at"] < at
        and _passed(o)
    ]
    return max(earlier, key=lambda r: r[1]["created_at"], default=None)


def routine_since(store: Store, uid: str, lo: date, hi: date) -> list[dict[str, Any]]:
    """Routine products started or stopped between two days, and how often each product in the
    routine then was ticked (app/metric_story._usage), for the app to show as already known."""
    from app.metric_story import _usage  # the same count the story uses

    logs = store.routine_logs(uid, lo.isoformat(), hi.isoformat())
    out = []
    for entry_id, e in sorted(store.routine_list(uid), key=lambda r: r[0]):
        started = _day(e.get("started_at")) if e.get("started_at") else None
        ended = _day(e.get("ended_at")) if e.get("ended_at") else None
        if (started and started > hi) or (ended and ended < lo):
            continue
        out.append(
            {
                "name": e.get("custom_name") or "",
                "brand": e.get("brand") or "",
                "started": started.isoformat() if started and started >= lo else None,
                "stopped": ended.isoformat() if ended and ended <= hi else None,
                "use": _usage(entry_id, e, logs, lo, hi),
            }
        )
    return out


def prefill(store: Store, uid: str, sid: str, doc: dict[str, Any]) -> dict[str, Any]:
    """GET /v1/sessions/{id}/changes: the answer so far, the last check-in's day, and the routine
    between the two (at most the last 14 days when there is no earlier check-in)."""
    hi = _day(doc.get("created_at")) or datetime.now(UTC).date()
    prev = previous_session(store, uid, sid, doc)
    since = _day(prev[1]["created_at"]) if prev else None
    lo = since + timedelta(days=1) if since else hi - timedelta(days=13)
    return {
        "changes": view(doc),
        "since": since.isoformat() if since else None,
        "routine": routine_since(store, uid, min(lo, hi), hi),
    }


# ---------------------------------------------------------------------------------------------
# Patterns


def _passed(doc: dict[str, Any]) -> bool:
    """A finished, measured check-in whose photos passed the quality check (as advisor.context):
    a rejected, abandoned or failed one is neither "your last check-in" nor a pattern's reading."""
    if doc.get("status") != "done":
        return False
    result = measured_result(doc)
    return bool(result and (result.get("quality") or {}).get("passed"))


def _readings(result: dict[str, Any], metric_id: str) -> tuple[float, float | None, dict] | None:
    """(value, mdc95, by_zone values) of one metric in a measured result. Areas are the metric's
    own `extras.by_zone` (engine 0.4.1+, docs/CONTRACT.md 2.5)."""
    m = next((x for x in result.get("metrics", []) if x["id"] == metric_id), None)
    if not m or m.get("value") is None:
        return None
    zones = ((m.get("extras") or {}).get("by_zone")) or {}
    by_zone = {
        z: float(v["value"])
        for z, v in zones.items()
        if isinstance(v, dict) and v.get("value") is not None and z in ZONE_WORDS
    }
    return float(m["value"]), m.get("mdc95"), by_zone


def _comparable(sessions: list[tuple[str, dict[str, Any]]]) -> list[tuple[str, dict[str, Any]]]:
    """Answered, measured face check-ins of the person's main way of taking them (the capture
    mode most of their answered check-ins use), oldest first."""
    rows = [
        (sid, d)
        for sid, d in sessions
        if d.get("site") == "face_full" and groups_of(d) is not None and _passed(d)
    ]
    if not rows:
        return []
    modes = [d.get("capture_mode") or "" for _, d in rows]
    # most used; a tie goes to the mode of the latest check-in (the same on every instance)
    latest = max(rows, key=lambda r: r[1]["created_at"])[1].get("capture_mode") or ""
    main = max(sorted(set(modes)), key=lambda m: (modes.count(m), m == latest))
    rows = [(s, d) for s, d in rows if d.get("capture_mode") == main]
    return sorted(rows, key=lambda r: r[1]["created_at"])


def _label(results: list[dict[str, Any]], metric_id: str) -> str:
    """The reading's name as the app shows it, from the latest check-in that has it."""
    for result in reversed(results):
        m = next((x for x in result.get("metrics", []) if x["id"] == metric_id), None)
        if m:
            return explain.label_of(m)
    return metric_id


def _areas(tagged: list[dict], others: list[dict], higher: bool) -> list[str]:
    """Up to two face areas where the noted weeks sit furthest the same way."""
    gaps = []
    for z in ZONE_WORDS:
        a = [b[z] for b in tagged if z in b]
        o = [b[z] for b in others if z in b]
        if len(a) >= MIN_EACH and len(o) >= MIN_EACH:
            gap = mean(a) - mean(o)
            if (gap > 0) == higher and gap != 0:
                gaps.append((abs(gap), z))
    return [ZONE_WORDS[z] for _, z in sorted(gaps, reverse=True)[:2]]


def find(store: Store, uid: str) -> dict[str, Any]:
    return patterns_in(store.sessions_list(uid))


def patterns_in(sessions: list[tuple[str, dict[str, Any]]]) -> dict[str, Any]:
    """GET /v1/patterns. For each kind of change and each reading it is compared with: the
    check-ins where it was noted against the answered ones where it was not. A pattern needs
    MIN_EACH on each side, a gap of the means beyond the reading's normal range (its mdc95 on the
    latest check-in), and at least MIN_SHARE of the noted check-ins beyond the others' median the
    same way. Counts only compare with check-ins taken the same way (with or without cheeks).

    Without a pattern, a noted kind of change is `same` when at least one reading had enough
    check-ins on both sides and showed no clear difference (a real finding, said plainly), else
    `learning` (not enough check-ins yet; the app lists these without numbers)."""
    rows = _comparable(sessions)
    # each result parsed once (patterns run on every Wisp message, story and Progress load)
    results = [measured_result(d) or {} for _, d in rows]
    tags = [groups_of(d) or set() for _, d in rows]
    patterns, same, learning = [], [], []
    for group, metric_ids in WATCH.items():
        noted_n = sum(1 for t in tags if group in t)
        found_any = False
        compared: list[str] = []  # readings with enough check-ins on both sides
        for metric_id in metric_ids:
            cheeks = None
            if metric_id in baselines.CONFIRMED_COUNTS and rows:
                cheeks = baselines.with_cheeks(results[-1])
            tagged, others, band = [], [], None
            for result, t in zip(results, tags, strict=True):
                if cheeks is not None and baselines.with_cheeks(result) != cheeks:
                    continue
                r = _readings(result, metric_id)
                if r is None:
                    continue
                band = r[1] if r[1] is not None else band
                (tagged if group in t else others).append(r)
            if len(tagged) < MIN_EACH or len(others) < MIN_EACH or not band:
                continue
            compared.append(_label(results, metric_id))
            gap = mean(v for v, _, _ in tagged) - mean(v for v, _, _ in others)
            if abs(gap) <= band:
                continue
            mid = median(v for v, _, _ in others)
            same_side = sum(1 for v, _, _ in tagged if (v > mid) == (gap > 0) and v != mid)
            if same_side < MIN_SHARE * len(tagged):
                continue
            higher = gap > 0
            way = explain.way_of({"id": metric_id}, gap)
            label = _label(results, metric_id)
            areas = _areas([b for *_, b in tagged], [b for *_, b in others], higher)
            found_any = True
            patterns.append(
                {
                    "group": group,
                    "about": GROUP_WORDS[group],
                    "metric_id": metric_id,
                    "metric": label,
                    "higher": higher,
                    "way": way,
                    "noted": len(tagged),
                    "same_way": same_side,
                    "others": len(others),
                    "areas": areas,
                    "text": sentence(
                        label, GROUP_WORDS[group], higher, same_side, len(tagged), areas
                    ),
                }
            )
        if found_any or not noted_n:
            continue
        if compared:
            readings = _and([m.lower() for m in compared])
            same.append(
                {
                    "group": group,
                    "about": GROUP_WORDS[group],
                    "text": f"No clear difference in your {readings} on check-ins where you "
                    f"noted {GROUP_WORDS[group]}.",
                }
            )
        else:
            learning.append({"group": group, "about": GROUP_WORDS[group]})
    return {"answered": len(rows), "patterns": patterns, "same": same, "learning": learning}


def _and(words: list[str]) -> str:
    return words[0] if len(words) == 1 else f"{', '.join(words[:-1])} and {words[-1]}"


def sentence(label: str, about: str, higher: bool, same: int, of: int, areas: list[str]) -> str:
    """ "Blemishes were higher on 4 of the 5 check-ins where you noted your period, mostly on
    on your chin and along your left jaw." Never a cause."""
    where = f", mostly {' and '.join(areas)}" if areas else ""
    plural = label.lower().endswith(("spots", "blemishes", "pores", "lines", "circles"))
    return (
        f"{label} {'were' if plural else 'was'} {'higher' if higher else 'lower'} "
        f"on {same} of the {of} check-ins where you noted {about}{where}."
    )


def for_metric(sessions: list[tuple[str, dict[str, Any]]], metric_id: str) -> list[dict[str, Any]]:
    """The patterns about one reading (for its story)."""
    return [
        {k: p[k] for k in ("about", "higher", "same_way", "noted", "areas", "text")}
        for p in patterns_in(sessions)["patterns"]
        if p["metric_id"] == metric_id
    ]
