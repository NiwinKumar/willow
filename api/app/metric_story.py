"""What changed for one metric, in points (GET /v1/sessions/{id}/story/{metric_id}).

For a measured session and one of its metrics: the person's previous check-in (same site and
capture mode), this one, the verdict against the baseline, and the routine products aimed at that
metric with how often they were used in between. The numbers, dates, verdict and ticks are worked
out here and given to Gemini with the metric's whole history; Gemini writes the points and up to
two possible reasons. Every sentence is checked (numbers only from the facts, no jargon, no change
claimed without a real change, never a cause); if any point fails, or Gemini is down, the same
facts are written by code instead.

The story is kept on the session (`stories`), keyed by a fingerprint of its facts: a re-analysis
or a routine change makes a new one; reopening the same one never calls Gemini again.
"""

import hashlib
import json
import logging
import re
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, Field

from app import baselines, cohort, explain, gemini, limits, numbers, schedule
from app.results import measured_result
from app.store import Store

log = logging.getLogger("willow.story")
HISTORY = 12  # earlier check-ins Gemini reads

# words for a change in each direction (web/src/lib/metrics.ts METRIC_META)
WORDS = {
    "pigment_spots": ("fewer / fainter dark spots", "more visible dark spots"),
    "tone_evenness": ("more even tone", "less even tone"),
    "redness": ("calmer skin", "more redness"),
    "blemishes": ("fewer blemishes", "more blemishes"),
    "pores": ("less visible pores", "more visible pores"),
    "texture": ("smoother texture", "rougher texture"),
    "lines": ("softer lines", "more visible lines"),
    "dark_circles": ("darker under-eye", "brighter under-eye"),
    "shine": ("less shine", "more shine"),
    "glow": ("less glow", "more glow"),
}
# metric -> the catalog concerns aimed at it (cohort.CONCERN_METRICS, inverted)
CONCERNS_OF: dict[str, set[str]] = {}
for _concern, _metrics in cohort.CONCERN_METRICS.items():
    for _m in _metrics:
        CONCERNS_OF.setdefault(_m, set()).add(_concern)


class StoryGemini(BaseModel):
    points: list[str] = Field(default_factory=list, max_length=5)
    reasons: list[str] = Field(default_factory=list, max_length=2)


INSTRUCTIONS = """You explain one skin measurement to the person: how it looked at their earlier
check-ins and what changed this time. FACTS hold this check-in (value, this_day), the previous one
(previous_value, previous_day), every earlier check-in in history (oldest first), the verdict
against their baseline (real_change = changed by more than their photos usually vary; within_noise
= about the same as at their start; no_baseline = their first reading or a baseline with too few
photos), and the routine products aimed at this measurement with how often they were used since
the previous check-in.
Write "points": 3 to 5 short bullet sentences, in this order:
- how it looked last time, then this time, and the direction in everyday words (when_lower /
  when_higher, e.g. "a more even tone than last week"); a change smaller than normal_range is
  "about the same".
- the overall trend across history when there are 3 or more check-ins (steady, improving, back
  and forth).
- the verdict against the start, in plain words.
- each routine product, by name: when it started or stopped and how often it was used.
Write "reasons": at most 2 sentences on what MAY explain the change, or the lack of one.
Rules:
- Everyday words, short sentences. Never write delta, noise band, mdc, threshold, variance, a*,
  ΔL* or index.
- Quote numbers only as they appear in FACTS (values, days used, of_days, days of the month); no
  new numbers, percentages or estimates. Write dates as "23 Oct".
- Never claim a product caused a change: "lines up with", "may", "could". If use was low or a
  product started only days ago, say it is too early to tell. Light, distance and angle can also
  move a reading.
- Never call it a real change unless verdict_vs_baseline is real_change.
- Cosmetic language only; never diagnose. Skin tone (tone_ita) is descriptive: never better or
  worse, never lighter or darker as a goal.
- British spelling."""


def _day(ts: Any) -> date:
    if isinstance(ts, datetime):
        return ts.date()
    return date.fromisoformat(str(ts)[:10])


def _fmt_day(d: date) -> str:
    return f"{d.day} {d.strftime('%b')}"


def _metric(result: dict[str, Any], metric_id: str) -> dict[str, Any] | None:
    return next((m for m in result.get("metrics", []) if m["id"] == metric_id), None)


def _same_way(doc: dict[str, Any], other_result: dict[str, Any], metric_id: str) -> bool:
    """Blemish and dark-spot counts include the cheeks only when cheek photos were taken: such
    counts are only compared with a check-in taken the same way (app/baselines.match_counts)."""
    if metric_id not in baselines.CONFIRMED_COUNTS:
        return True
    this = measured_result(doc) or {}
    return baselines.with_cheeks(this) == baselines.with_cheeks(other_result)


def _previous(store: Store, uid: str, sid: str, doc: dict[str, Any], metric_id: str):
    """The latest earlier measured session of the same site and capture mode with this metric."""
    this_at = doc.get("created_at")
    best = None
    for other_id, other in store.sessions_list(uid):
        if other_id == sid or other.get("site") != doc.get("site"):
            continue
        if other.get("capture_mode") != doc.get("capture_mode"):
            continue
        if not other.get("created_at") or not this_at or other["created_at"] >= this_at:
            continue
        result = measured_result(other)
        m = _metric(result, metric_id) if result else None
        if m is None or m.get("value") is None or not _same_way(doc, result, metric_id):
            continue
        if best is None or other["created_at"] > best[1]["created_at"]:
            best = (other_id, other, m)
    return best


def _history(
    store: Store, uid: str, doc: dict[str, Any], metric_id: str, m: dict[str, Any]
) -> list[dict[str, Any]]:
    """Every earlier measured check-in of this site and capture mode with this metric, oldest
    first (at most HISTORY), rounded as the app shows them: what Gemini reads the trend from."""
    rows = []
    for _, other in store.sessions_list(uid):
        if other.get("site") != doc.get("site") or other.get("capture_mode") != doc.get(
            "capture_mode"
        ):
            continue
        if not other.get("created_at") or other["created_at"] >= doc["created_at"]:
            continue
        result = measured_result(other)
        om = _metric(result, metric_id) if result else None
        if om is None or om.get("value") is None or not _same_way(doc, result, metric_id):
            continue
        value = explain.shown_numbers({**om, "mdc95": m.get("mdc95")})["value"]
        rows.append(
            {
                "day": _day(other["created_at"]).isoformat(),
                "value": value,
                "baseline": bool(other.get("is_baseline")),
            }
        )
    rows.sort(key=lambda r: r["day"])
    return rows[-HISTORY:]


def _usage(entry_id: str, entry: dict[str, Any], logs: list[dict[str, Any]], lo: date, hi: date):
    """Days used / days planned for a routine product between two days (inclusive)."""
    first = lo
    if entry.get("started_at"):
        first = max(first, date.fromisoformat(str(entry["started_at"])[:10]))
    last = hi
    if entry.get("ended_at"):
        last = min(last, date.fromisoformat(str(entry["ended_at"])[:10]))
    if last < first:
        return None
    a, b = first.isoformat(), last.isoformat()
    used = {d["date"] for d in logs if a <= d["date"] <= b and (d.get("used") or {}).get(entry_id)}
    days = (first + timedelta(days=i) for i in range((last - first).days + 1))
    planned = sum(
        1 for d in days if schedule.applies_on(entry.get("schedule"), d) or d.isoformat() in used
    )
    return {"days_used": len(used), "of_days": planned} if planned else None


def facts(store: Store, uid: str, sid: str, doc: dict[str, Any], metric_id: str) -> dict | None:
    result = measured_result(doc)
    m = _metric(result, metric_id) if result else None
    if m is None or m.get("value") is None:
        return None
    now_day = _day(doc["created_at"])
    shown = explain.shown_numbers(m)
    out: dict[str, Any] = {
        "metric_id": metric_id,
        "label": explain.label_of(m),
        "unit": m.get("unit"),
        "this_day": now_day.isoformat(),
        "value": shown["value"],
        "verdict_vs_baseline": m.get("verdict"),
        "change_vs_baseline": shown["delta"],
        "normal_range": shown["mdc95"],
        "is_baseline": bool(doc.get("is_baseline")),
    }
    if metric_id in explain.DIRECTION_WORDS:
        out["when_lower"], out["when_higher"] = explain.DIRECTION_WORDS[metric_id]
    out["history"] = _history(store, uid, doc, metric_id, m)
    prev = _previous(store, uid, sid, doc, metric_id)
    lo = now_day - timedelta(days=13)
    if prev:
        _, prev_doc, pm = prev
        prev_day = _day(prev_doc["created_at"])
        prev_value = explain.shown_numbers({**pm, "mdc95": m.get("mdc95")})["value"]
        out |= {"previous_day": prev_day.isoformat(), "previous_value": prev_value}
        if prev_value is not None and shown["value"] is not None:
            places = explain.decimals(m)
            out["change_vs_previous"] = round(shown["value"] - prev_value, places)
        lo = prev_day + timedelta(days=1)
    concerns = CONCERNS_OF.get(metric_id, set())
    products = []
    if concerns:
        logs = store.routine_logs(uid, lo.isoformat(), now_day.isoformat())
        for entry_id, e in sorted(store.routine_list(uid), key=lambda r: r[0]):
            if not concerns & set(e.get("concerns") or []):
                continue
            started = e.get("started_at") and date.fromisoformat(str(e["started_at"])[:10])
            ended = e.get("ended_at") and date.fromisoformat(str(e["ended_at"])[:10])
            if (started and started > now_day) or (ended and ended < lo):
                continue  # not in the routine between these check-ins
            products.append(
                {
                    "name": e.get("custom_name") or "",
                    "brand": e.get("brand") or "",
                    "started": started.isoformat() if started else None,
                    "started_since_last_check_in": bool(started and started >= lo),
                    "stopped": ended.isoformat() if ended and ended <= now_day else None,
                    "use": _usage(entry_id, e, logs, lo, now_day),
                }
            )
    out["routine"] = products
    return out


def _points(f: dict[str, Any]) -> list[str]:
    """The story in points, from the facts only (no Gemini)."""
    unit = {"pct_area": "%", "deg": "°"}.get(f.get("unit") or "", "")
    v = lambda x: f"{x}{unit}"  # noqa: E731
    down, up = WORDS.get(f["metric_id"], ("lower", "higher"))
    pts = []
    if f.get("previous_day"):
        pts.append(
            f"Last check-in ({_fmt_day(date.fromisoformat(f['previous_day']))}): "
            f"{v(f['previous_value'])}."
        )
    now = f"This check-in ({_fmt_day(date.fromisoformat(f['this_day']))}): {v(f['value'])}"
    d, band = f.get("change_vs_previous"), f.get("normal_range")
    if d is None:
        pts.append(f"{now}.")
    elif band is not None and abs(d) <= band:
        pts.append(f"{now}, about the same as last time.")
    elif f["metric_id"] == "tone_ita":
        pts.append(f"{now}, a shift from last time (skin tone is descriptive only).")
    else:
        pts.append(f"{now}, {down if d < 0 else up} than last time.")
    verdict = f.get("verdict_vs_baseline")
    if f.get("is_baseline"):
        pts.append("This is your baseline: later check-ins are compared with it.")
    elif verdict == "real_change":
        pts.append("Since your baseline: a real change, bigger than your normal photo variation.")
    elif verdict == "within_noise":
        pts.append("Since your baseline: no real change, within your normal photo variation.")
    for p in f.get("routine", []):
        bits = []
        if p["started_since_last_check_in"] and p["started"]:
            bits.append(f"started {_fmt_day(date.fromisoformat(p['started']))}")
        if p["stopped"]:
            bits.append(f"stopped {_fmt_day(date.fromisoformat(p['stopped']))}")
        if p["use"]:
            bits.append(f"used {p['use']['days_used']} of {p['use']['of_days']} planned days")
        name = f"{p['brand']} {p['name']}".strip()
        pts.append(
            f"In your routine for this: {name}" + (f" ({', '.join(bits)})." if bits else ".")
        )
    return pts


def _fingerprint(f: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(f, sort_keys=True, default=str).encode()).hexdigest()[:16]


DATE_KEYS = {"this_day", "previous_day", "day", "started", "stopped"}
CAUSE = re.compile(r"\b(caus\w*|due to|thanks to|because of|result of|made your)\b", re.I)


def _without_dates(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _without_dates(v) for k, v in obj.items() if k not in DATE_KEYS}
    if isinstance(obj, list):
        return [_without_dates(v) for v in obj]
    return obj


def _dates(obj: Any) -> list[str]:
    if isinstance(obj, dict):
        return [v for k, v in obj.items() if k in DATE_KEYS and isinstance(v, str)] + [
            d for v in obj.values() for d in _dates(v)
        ]
    if isinstance(obj, list):
        return [d for v in obj for d in _dates(v)]
    return []


def _allowed(f: dict[str, Any]) -> set[str]:
    """Numbers a sentence may quote: the measured ones, and a date only as its day of the month
    ("12 Oct"), never a year or a month number that could pass for a measurement."""
    allowed = numbers.collect(_without_dates(f))
    for d in _dates(f):
        if len(d) >= 10 and d[8:10].isdigit():
            allowed.add(str(int(d[8:10])))
    return allowed


def _problem(text: str, f: dict[str, Any], allowed: set[str]) -> str | None:
    if not numbers.only_known(text, allowed):
        return "unknown number"
    if explain.BANNED.search(text) or explain.JARGON.search(text):
        return "banned or jargon word"
    if f.get("verdict_vs_baseline") != "real_change" and explain._claims_change(text):
        return "change claimed without a real change"
    if CAUSE.search(text):
        return "claims a cause"
    d = f.get("change_vs_previous")
    words = WORDS.get(f["metric_id"])
    if d and words:
        wrong = words[1] if d < 0 else words[0]  # the phrase for the other direction
        if wrong.split(" / ")[0].lower() in text.lower():
            return "wrong direction"
    return None


def _gemini_story(f: dict[str, Any]) -> tuple[list[str], list[str]] | None:
    """Gemini's points and reasons, or None when it failed or any point broke a rule (then the
    points are built from the facts instead; a broken reason is just dropped)."""
    try:
        out = gemini.generate_json(
            "metric_story",
            [json.dumps({"FACTS": f})],
            StoryGemini,
            instructions=INSTRUCTIONS,
            temperature=0.3,
            max_output_tokens=1200,
        )
    except gemini.GeminiError:
        return None
    allowed = _allowed(f)
    points = [p.strip() for p in out.points if p.strip()]
    bad = [(p, why) for p in points if (why := _problem(p, f, allowed))]
    if not points or bad:
        log.warning("metric_story: points rejected %s", bad[:2])
        return None
    reasons = [r.strip() for r in out.reasons if r.strip() and not _problem(r.strip(), f, allowed)]
    return points, reasons[:2]


def _within_cap(store: Store, uid: str) -> bool:
    """One Gemini story counts against the person's daily cap; past it, the facts version."""
    try:
        limits.take(store, uid, "metric_story")
    except HTTPException:
        return False
    return True


def story(store: Store, uid: str, sid: str, doc: dict[str, Any], metric_id: str) -> dict | None:
    """Skin tone is always written from the facts (descriptive only, never judged by Gemini)."""
    f = facts(store, uid, sid, doc, metric_id)
    if f is None:
        return None
    key = _fingerprint(f)
    cached = (doc.get("stories") or {}).get(metric_id)
    if cached and cached.get("key") == key and cached.get("points"):
        points, reasons, source = cached["points"], cached.get("reasons") or [], "gemini"
    elif f["metric_id"] != "tone_ita" and _within_cap(store, uid) and (got := _gemini_story(f)):
        points, reasons, source = got[0], got[1], "gemini"
        stories = dict(doc.get("stories") or {})
        stories[metric_id] = {"key": key, "points": points, "reasons": reasons}
        store.session_update(uid, sid, {"stories": stories})
    else:  # Gemini down or a point failed the checks: the same facts, written by code
        points, reasons, source = _points(f), [], "facts"
    return {
        "metric_id": metric_id,
        "points": points,
        "reasons": reasons,
        "source": source,
        "products": [
            {"name": p["name"], "brand": p["brand"], "use": p["use"]} for p in f["routine"]
        ],
        "has_previous": "previous_day" in f,
    }
