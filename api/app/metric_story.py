"""What changed for one metric, in points (GET /v1/sessions/{id}/story/{metric_id}).

For a measured session and one of its metrics: the person's previous check-in (same site and
capture mode), this one, the verdict against the baseline, and the routine products aimed at that
metric with how often they were used in between. Every point is built here from the numbers, dates
and ticks; Gemini only adds up to two "possible reasons" sentences, which may quote only numbers
from its input (numbers.only_known) and never claim a cause. Without Gemini the points stand
alone.

The story is kept on the session (`stories`), keyed by a fingerprint of its facts: a re-analysis
or a routine change makes a new one; reopening the same one never calls Gemini again.
"""

import hashlib
import json
import logging
from datetime import date, datetime, timedelta
from typing import Any

from pydantic import BaseModel, Field

from app import cohort, explain, gemini, numbers, schedule
from app.results import measured_result
from app.store import Store

log = logging.getLogger("willow.story")

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
    reasons: list[str] = Field(default_factory=list, max_length=2)


INSTRUCTIONS = """You are given the facts about one skin measurement between two check-ins: its
value last time and
now, whether the change is bigger than the person's normal photo-to-photo variation, and the
routine products aimed at it with how often they were used in between.
Write "reasons": at most 2 short sentences (each under 30 words) on what MAY explain the change,
or the lack of one, for this person. Rules:
- Cosmetic language only. Never diagnose, never name a condition.
- Never claim a product caused a change: say it "lines up with", "may", "could".
- If use was low or a product started only days ago, say it is too early to tell.
- Light, camera distance and angle can also move a reading: mention it when the change is small or
  when no product explains it.
- Quote only numbers that appear in the facts. Write no other digits.
- Skin tone (tone_ita) is descriptive: never better or worse, never lighter or darker as a goal.
Return {"reasons": []} if nothing useful can be said."""


def _day(ts: Any) -> date:
    if isinstance(ts, datetime):
        return ts.date()
    return date.fromisoformat(str(ts)[:10])


def _fmt_day(d: date) -> str:
    return f"{d.day} {d.strftime('%b')}"


def _metric(result: dict[str, Any], metric_id: str) -> dict[str, Any] | None:
    return next((m for m in result.get("metrics", []) if m["id"] == metric_id), None)


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
        if m is None or m.get("value") is None:
            continue
        if best is None or other["created_at"] > best[1]["created_at"]:
            best = (other_id, other, m)
    return best


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
        pts.append(f"{now}: {down if d < 0 else up} than last time.")
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


def _reasons(f: dict[str, Any]) -> list[str]:
    try:
        out = gemini.generate_json(
            "metric_story",
            [json.dumps({"facts": f})],
            StoryGemini,
            instructions=INSTRUCTIONS,
            max_output_tokens=600,
        )
    except gemini.GeminiError:
        return []
    allowed = numbers.collect(f)
    kept = [r.strip() for r in out.reasons if r.strip() and numbers.only_known(r, allowed)]
    if len(kept) != len([r for r in out.reasons if r.strip()]):
        log.warning("metric_story: a reason quoted a number not in its facts; dropped")
    return kept[:2]


def story(store: Store, uid: str, sid: str, doc: dict[str, Any], metric_id: str) -> dict | None:
    f = facts(store, uid, sid, doc, metric_id)
    if f is None:
        return None
    key = _fingerprint(f)
    cached = (doc.get("stories") or {}).get(metric_id)
    if cached and cached.get("key") == key:
        reasons = cached.get("reasons") or []
    else:
        reasons = _reasons(f)
        if reasons:  # an empty answer (Gemini down) is not kept: the next open tries again
            stories = dict(doc.get("stories") or {})
            stories[metric_id] = {"key": key, "reasons": reasons}
            store.session_update(uid, sid, {"stories": stories})
    return {
        "metric_id": metric_id,
        "points": _points(f),
        "reasons": reasons,
        "products": [
            {"name": p["name"], "brand": p["brand"], "use": p["use"]} for p in f["routine"]
        ],
        "has_previous": "previous_day" in f,
    }
