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
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, Field

from app import (
    baselines,
    cohort,
    explain,
    gemini,
    limits,
    numbers,
    schedule,
    story_insights,
    tracks,
)
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
    points: list[str] = Field(default_factory=list, max_length=7)
    reasons: list[str] = Field(default_factory=list, max_length=2)


INSTRUCTIONS = """You explain one skin measurement to the person: how it looked at their earlier
check-ins and what changed this time. FACTS hold this check-in (value, this_day), the previous one
(previous_value, previous_day), every earlier check-in in history (oldest first), the verdict
against their baseline (real_change = changed by more than their photos usually vary; within_noise
= about the same as at their start; no_baseline = their first reading or a baseline with too few
photos), and the routine products aimed at this measurement with how often they were used since
the previous check-in.
Write "points": 3 to 7 short bullet sentences, in this order:
- how it looked last time, then this time, and the direction in everyday words (when_lower /
  when_higher, e.g. "a more even tone than last week"); a change smaller than normal_range is
  "about the same".
- the overall trend across history when there are 3 or more check-ins (steady, improving, back
  and forth).
- the verdict against the start, in plain words: a real_change toward what people usually want
  (lower redness, spots, pores, texture, lines, shine, blemishes, evenness; higher under-eye
  brightness and glow) is an improvement, said warmly; the other way is said gently ("moved the
  other way"), never "worse", "worsened" or "declined".
- by area (when FACTS has "areas"): name the areas whose verdict_vs_baseline is real_change and
  which way each went (way improved = an improvement, other_way = moved the other way); say the
  other areas stayed within their normal range. Never call an area changed unless its own
  verdict_vs_baseline is real_change; no_band means it cannot be judged yet.
- spots (when FACTS has "spots"): which areas have new ones this time, which still have them,
  which are fading or not seen this time, using only those counts and area labels.
- each routine product, by name: when it started or stopped, how often it was used since the
  last check-in (use_since_last_check_in, never "since it started"), and its
  since_start: helping = moved beyond the normal range the way people usually want since it
  started; moving_other_way = moved beyond it the other way; no_change_yet = within the normal
  range so far (most changes take 4 to 8 weeks); too_early = fewer than 2 weeks or 2 check-ins
  since it started. Always say timing lines up, never that the product did it.
Write "reasons": at most 2 sentences on what MAY explain the change, or the lack of one.
Rules:
- Everyday words, short sentences. Never write delta, noise band, mdc, threshold, variance, a*,
  ΔL* or index.
- Quote numbers only as they appear in FACTS (values, days used, of_days, days of the month); no
  new numbers, percentages or estimates. Write dates as "23 Oct".
- Never claim a product caused a change: "lines up with", "may", "could". If use was low or a
  product started only days ago, say it is too early to tell. Light, distance and angle can also
  move a reading.
- Never call it a real change unless verdict_vs_baseline is real_change (or, for an area, that
  area's own verdict_vs_baseline; for a product, its since_start status helping or
  moving_other_way).
- Area names only as the "label" in FACTS (left and right are the person's own). Never name a
  condition, a cause, a treatment or a product the person does not already use.
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


def _same_way(this_result: dict[str, Any], other_result: dict[str, Any], metric_id: str) -> bool:
    """Blemish and dark-spot counts include the cheeks only when cheek photos were taken: such
    counts are only compared with a check-in taken the same way (app/baselines.match_counts)."""
    if metric_id not in baselines.CONFIRMED_COUNTS:
        return True
    return baselines.with_cheeks(this_result) == baselines.with_cheeks(other_result)


def _earlier(rows: list[tuple[str, dict[str, Any]]], sid: str, doc: dict[str, Any], metric_id: str):
    """Every earlier measured session of the same site and capture mode with this metric, taken
    the same way: [(session id, doc, its metric)]. One read of the sessions (`rows`) and one parse
    of each result, shared by the previous check-in, the history, the areas and the products."""
    this_at = doc.get("created_at")
    if not this_at:
        return []
    this_result = measured_result(doc) or {}
    out = []
    for other_id, other in rows:
        if other_id == sid or other.get("site") != doc.get("site"):
            continue
        if other.get("capture_mode") != doc.get("capture_mode"):
            continue
        if not other.get("created_at") or other["created_at"] >= this_at:
            continue
        result = measured_result(other)
        m = _metric(result, metric_id) if result else None
        if m is None or m.get("value") is None or not _same_way(this_result, result, metric_id):
            continue
        out.append((other_id, other, m))
    return out


def _previous(earlier: list[tuple[str, dict[str, Any], dict[str, Any]]]):
    """The latest earlier measured session of the same site and capture mode with this metric."""
    return max(earlier, key=lambda r: r[1]["created_at"], default=None)


def _history(
    earlier: list[tuple[str, dict[str, Any], dict[str, Any]]], m: dict[str, Any]
) -> list[dict[str, Any]]:
    """Every earlier measured check-in of this site and capture mode with this metric, oldest
    first (at most HISTORY), rounded as the app shows them: what Gemini reads the trend from."""
    rows = []
    for _, other, om in earlier:
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


def _baseline_metric(doc: dict[str, Any], earlier: list[tuple[str, dict, dict]]) -> dict | None:
    """The metric of the baseline session this check-in was compared with (its areas and band)."""
    want = ((doc.get("compared_with") or {}).get("session_id")) or None
    for other_id, other, om in earlier:
        if (want and other_id == want) or (not want and other.get("is_baseline")):
            return om
    return None


def _diary(rows: list[tuple[str, dict[str, Any]]], sid: str, doc: dict[str, Any]) -> list[dict]:
    """The spot diary's sessions up to and including this check-in (face only), oldest first."""
    if doc.get("site") != "face_full" or not doc.get("created_at"):
        return []
    used = []
    for other_id, other in rows:
        if other.get("site") != "face_full" or not other.get("created_at"):
            continue
        if other["created_at"] > doc["created_at"] or (
            other_id != sid and other.get("status") != "done"
        ):
            continue
        result = measured_result(other)
        if tracks.usable(result):
            used.append(
                {
                    "id": other_id,
                    "created_at": other["created_at"],
                    "marks": tracks.observations(result, other.get("labels") or {}),
                }
            )
    used.sort(key=lambda r: r["created_at"])
    return used if used and used[-1]["id"] == sid else []


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
        # the unwanted side is said gently ("moved the other way"), never "more redness"
        out["when_lower"], out["when_higher"] = explain.gentle_words({"id": metric_id})
    rows = store.sessions_list(uid)
    earlier = _earlier(rows, sid, doc, metric_id)
    out["history"] = _history(earlier, m)
    prev = _previous(earlier)
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
    base_m = _baseline_metric(doc, earlier)
    if metric_id != "tone_ita":  # skin tone is never split by area
        out["areas"] = story_insights.areas(m, prev[2] if prev else None, base_m)
    spot_facts = story_insights.spots(metric_id, _diary(rows, sid, doc))
    if spot_facts:
        out["spots"] = spot_facts
    places = explain.decimals(m)
    band = explain.shown_numbers({**base_m, "id": metric_id})["mdc95"] if base_m else shown["mdc95"]
    series = [
        (_day(o["created_at"]), om["value"]) for _, o, om in earlier if om.get("value") is not None
    ]
    concerns = CONCERNS_OF.get(metric_id, set())
    products = []
    if concerns:
        # the two reads side by side (each is a Firestore round trip)
        with ThreadPoolExecutor(max_workers=2) as pool:
            logs_f = pool.submit(store.routine_logs, uid, lo.isoformat(), now_day.isoformat())
            routine_f = pool.submit(store.routine_list, uid)
            logs, routine = logs_f.result(), routine_f.result()
        for entry_id, e in sorted(routine, key=lambda r: r[0]):
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
                    # days ticked since the previous check-in (not since the start)
                    "use_since_last_check_in": _usage(entry_id, e, logs, lo, now_day),
                    "since_start": story_insights.since_start(
                        started.isoformat() if started else None,
                        metric_id,
                        now_day,
                        m["value"],
                        series,
                        band,
                        places,
                    ),
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
    elif explain.way_of({"id": f["metric_id"]}, d) == "other_way":
        pts.append(f"{now}, {explain.OTHER_WAY} since last time.")
    else:
        pts.append(f"{now}, {down if d < 0 else up} than last time.")
    verdict = f.get("verdict_vs_baseline")
    if f.get("is_baseline"):
        pts.append("This is your baseline: later check-ins are compared with it.")
    elif verdict == "real_change":
        way = explain.way_of({"id": f["metric_id"]}, f.get("change_vs_baseline"))
        said = {"improved": "improved", "other_way": explain.OTHER_WAY}.get(way or "", "shifted")
        pts.append(f"Since your baseline: {said}, more than your photos usually vary.")
    elif verdict == "within_noise":
        pts.append("Since your baseline: no real change, within your normal photo variation.")
    pts += _area_points(f) + _spot_points(f)
    for p in f.get("routine", []):
        bits = []
        if p["started_since_last_check_in"] and p["started"]:
            bits.append(f"started {_fmt_day(date.fromisoformat(p['started']))}")
        if p["stopped"]:
            bits.append(f"stopped {_fmt_day(date.fromisoformat(p['stopped']))}")
        if p["use_since_last_check_in"]:
            u = p["use_since_last_check_in"]
            bits.append(f"used {u['days_used']} of {u['of_days']} planned days since last check-in")
        name = f"{p['brand']} {p['name']}".strip()
        pts.append(
            f"In your routine for this: {name}"
            + (f" ({', '.join(bits)})." if bits else ".")
            + _since_words(p.get("since_start"), f)
        )
    if any(
        (p.get("since_start") or {}).get("status") not in (None, "too_early")
        for p in f.get("routine", [])
    ):
        pts.append(
            "Timing is an association, not proof: light, angle and other products also play a part."
        )
    return pts


def _names(labels: list[str]) -> str:
    return labels[0] if len(labels) == 1 else f"{', '.join(labels[:-1])} and {labels[-1]}"


def _on(labels: list[str]) -> str:
    """'on the nose and chin', 'around the mouth', 'on the nose and around the mouth'."""
    on = [x for x in labels if not x.startswith("around")]
    around = [x for x in labels if x.startswith("around")]
    parts = [f"on the {_names(on)}"] if on else []
    return " and ".join(parts + around)


def _area_points(f: dict[str, Any]) -> list[str]:
    """One line on the areas: those that changed beyond their own normal range, by way."""
    rows = [a for a in f.get("areas") or [] if a.get("verdict_vs_baseline")]
    if len(rows) < 2:
        return []
    better = [a["label"] for a in rows if a.get("way") == "improved"]
    other = [a["label"] for a in rows if a.get("way") == "other_way"]
    shifted = [a["label"] for a in rows if a.get("way") == "shifted"]
    steady = [a for a in rows if a["verdict_vs_baseline"] == "within_noise"]
    if len(better) == len(rows):
        return [
            "By area since your baseline: improved in every area, each beyond its own normal range."
        ]
    if len(other) == len(rows):
        return [f"By area since your baseline: {explain.OTHER_WAY} in every area."]
    bits = []
    if better:
        bits.append(f"improved {_on(better)}")
    if other:
        bits.append(f"{explain.OTHER_WAY} {_on(other)}")
    if shifted:
        bits.append(f"shifted {_on(shifted)}")
    if not bits:
        return ["By area: every area is within its own normal range since your baseline."]
    rest = " The other areas are within their normal range." if steady else ""
    return [f"By area since your baseline: {'; '.join(bits)}.{rest}"]


def _spot_points(f: dict[str, Any]) -> list[str]:
    """Where spots are new this time, and where they are fading or not seen."""
    rows = (f.get("spots") or {}).get("areas") or []
    new = [f"{r['new_this_time']} {_on([r['label']])}" for r in rows if r["new_this_time"]]
    gone = [r["label"] for r in rows if r["fading"] or r["not_seen_this_time"]]
    out = []
    if new:
        out.append(f"New since last check-in: {_names(new)}.")
    if gone:
        out.append(f"Fading or not seen this time {_on(gone)}.")
    return out


def _since_words(s: dict[str, Any] | None, f: dict[str, Any]) -> str:
    if not s:
        return ""
    if s["status"] == "too_early":
        return " Too early to tell: it needs at least 2 weeks and 2 check-ins since it started."
    label = f["label"].lower()
    weeks = f"{s['weeks']} weeks"
    if s["status"] == "no_change_yet":
        return f" Since it started ({weeks}): {label} within your normal range so far."
    if s["status"] == "helping":
        return f" Since it started ({weeks}): {label} improved beyond your normal range."
    if s["status"] == "moving_other_way":
        return (
            f" Since it started ({weeks}): {label} {explain.OTHER_WAY}, beyond your normal range."
        )
    if s["status"] == "changed":
        return f" Since it started ({weeks}): {label} shifted beyond your normal range."
    return ""


def _fingerprint(f: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(f, sort_keys=True, default=str).encode()).hexdigest()[:16]


DATE_KEYS = {"this_day", "previous_day", "day", "started", "stopped", "from_day"}
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
    ("12 Oct", "01 Aug" or "1 Aug"), never a year or a month number that could pass for a
    measurement."""
    allowed = numbers.collect(_without_dates(f))
    for d in _dates(f):
        if len(d) >= 10 and d[8:10].isdigit():
            allowed |= {d[8:10], str(int(d[8:10]))}
    return allowed


def _mentions(text: str, f: dict[str, Any]) -> tuple[list[dict], list[dict]]:
    """The areas (by label) and routine products (by name) a sentence talks about."""
    low = text.lower()
    rows = [*(f.get("areas") or []), *((f.get("spots") or {}).get("areas") or [])]
    areas = [a for a in rows if a["label"] in low]
    products = [p for p in f.get("routine") or [] if p["name"] and p["name"].lower() in low]
    return areas, products


def _change_ok(text: str, f: dict[str, Any]) -> bool:
    """A sentence may claim a change only when what it is about really changed: the areas it
    names (their own verdict), else the products it names (since_start), else the whole face."""
    areas, products = _mentions(text, f)
    if areas:
        return all(a.get("verdict_vs_baseline") == "real_change" for a in areas)
    if products:
        return any(
            (p.get("since_start") or {}).get("status") in ("helping", "moving_other_way", "changed")
            for p in products
        )
    return f.get("verdict_vs_baseline") == "real_change"


def _problem(text: str, f: dict[str, Any], allowed: set[str]) -> str | None:
    if not numbers.only_known(text, allowed):
        return "unknown number"
    if explain.BANNED.search(text) or explain.JARGON.search(text):
        return "banned or jargon word"
    if explain._claims_change(text) and not _change_ok(text, f):
        return "change claimed without a real change"
    if CAUSE.search(text):
        return "claims a cause"
    if _mentions(text, f)[0]:
        return None  # an area may move the other way from the whole face
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


def _keep(
    store: Store, uid: str, sid: str, doc: dict[str, Any], metric_id: str, entry: dict[str, Any]
) -> None:
    """Write one metric's story into the session's `stories` as a field-path update, so a story
    another request kept for another metric meanwhile is not overwritten (metric_id is [a-z_]).
    Best effort: the story is shown either way (Oct 20: the session was deleted while its story
    was written, and the failed update answered 500)."""
    try:
        store.session_update(uid, sid, {f"stories.{metric_id}": entry})
    except Exception as exc:
        log.warning("could not keep the %s story for %s: %s", metric_id, sid, exc)


def story(store: Store, uid: str, sid: str, doc: dict[str, Any], metric_id: str) -> dict | None:
    """Skin tone is always written from the facts (descriptive only, never judged by Gemini)."""
    f = facts(store, uid, sid, doc, metric_id)
    if f is None:
        return None
    key = _fingerprint(f)
    cached = (doc.get("stories") or {}).get(metric_id)
    if cached and cached.get("key") == key and cached.get("points"):
        points, reasons, source = cached["points"], cached.get("reasons") or [], "gemini"
    elif f["metric_id"] != "tone_ita" and _within_cap(store, uid):
        got = _gemini_story(f)
        if got:
            points, reasons, source = got[0], got[1], "gemini"
            _keep(
                store, uid, sid, doc, metric_id, {"key": key, "points": points, "reasons": reasons}
            )
        else:  # Gemini down or a point failed the checks: the use goes back
            limits.refund(store, uid, "metric_story")
            points, reasons, source = _points(f), [], "facts"
    else:  # past the cap, or skin tone: the same facts, written by code
        points, reasons, source = _points(f), [], "facts"
    return {
        "metric_id": metric_id,
        "points": points,
        "reasons": reasons,
        "source": source,
        "products": [
            {
                "name": p["name"],
                "brand": p["brand"],
                "use": p["use_since_last_check_in"],
                "since_start": p.get("since_start"),
            }
            for p in f["routine"]
        ],
        "areas": f.get("areas") or [],
        "spots": f.get("spots"),
        "has_previous": "previous_day" in f,
    }
