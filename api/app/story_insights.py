"""What a metric's story can say beyond the whole-face number (app/metric_story.py): where on the
face it moved, which spots came and went, and how it moved since each routine product started.

Every fact is worked out here from measurements and dates; nothing is estimated:
- areas: the engine's `extras.by_zone` (engine 0.4.1+, docs/METRICS.md "Readings by area"), each
  zone compared with the same zone of the baseline session against that zone's own noise band;
- spots: the spot diary (app/tracks.py) up to this check-in, by face zone;
- since_start: this check-in against the last one before a product started, against the
  baseline's whole-face band, only after MIN_WEEKS and MIN_CHECK_INS (the app's outcome rule,
  web/src/lib/outcome.ts). Timing is an association, never a cause.
Pure functions over plain dicts, so the tests read them without a store.
"""

from datetime import date
from typing import Any

from app import explain, tracks

AREA_LABEL = {
    "forehead": "forehead",
    "nose": "nose",
    "right_cheek": "right cheek",
    "left_cheek": "left cheek",
    "around_mouth": "around the mouth",
    "chin": "chin",
    "right_jaw": "right jawline",
    "left_jaw": "left jawline",
    "right_under_eye": "right under-eye",
    "left_under_eye": "left under-eye",
}
# the diary's mark kind behind each count metric
SPOT_KIND = {"blemishes": "blemish", "pigment_spots": "spot"}
MIN_WEEKS = 2  # most changes take at least two weeks to show (outcome.ts)
MIN_CHECK_INS = 2  # check-ins after the start date before anything is judged


def _zones(metric: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    return ((metric or {}).get("extras") or {}).get("by_zone") or {}


def _round(x: float | None, places: int) -> float | None:
    return None if x is None else round(x, places) + 0.0  # never -0.0


def areas(
    metric: dict[str, Any], previous: dict[str, Any] | None, baseline: dict[str, Any] | None
) -> list[dict[str, Any]]:
    """Each face zone of this check-in's metric: its value, the previous check-in's and the
    baseline's, and the verdict against the baseline zone's own band (real_change,
    within_noise, or no_band when that zone had too few photos for one). Real changes first."""
    places = explain.decimals(metric)
    band_places = max(places, 1)  # a band of 1.5 blemishes is not "±2"
    rows = []
    for zone, cur in _zones(metric).items():
        if zone not in AREA_LABEL or cur.get("value") is None:
            continue
        row: dict[str, Any] = {
            "area": zone,
            "label": AREA_LABEL[zone],
            "value": _round(cur["value"], places),
        }
        prev = _zones(previous).get(zone)
        if prev and prev.get("value") is not None:
            row["previous_value"] = _round(prev["value"], places)
            row["change_vs_previous"] = _round(cur["value"] - prev["value"], places)
        base = _zones(baseline).get(zone)
        if base and base.get("value") is not None:
            delta = cur["value"] - base["value"]
            band = base.get("mdc95")
            row["baseline_value"] = _round(base["value"], places)
            row["change_vs_baseline"] = _round(delta, places)
            row["normal_range"] = _round(band, band_places)
            if band is None:
                row["verdict_vs_baseline"] = "no_band"
            elif abs(delta) > band:
                row["verdict_vs_baseline"] = "real_change"
                row["way"] = explain.way_of({"id": metric["id"]}, delta)
            else:
                row["verdict_vs_baseline"] = "within_noise"
        rows.append(row)
    order = {"other_way": 0, "improved": 1}
    rows.sort(
        key=lambda r: (
            r.get("verdict_vs_baseline") != "real_change",
            order.get(r.get("way") or "", 2),
            -abs(r.get("change_vs_baseline") or 0),
        )
    )
    return rows


def spots(metric_id: str, used: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Blemishes or dark spots by face zone from the spot diary, `used` being its sessions oldest
    first and ending with this check-in (tracks.follow). Per zone: new this time, still there,
    fading, not seen this time, faded so far, and how long marks there usually stay visible.
    None for other metrics or before there is an earlier check-in to compare with."""
    kind = SPOT_KIND.get(metric_id)
    if not kind or len(used) < 2:
        return None
    diary = tracks.follow(used)
    latest = len(used) - 1
    mine = [t for t in diary["tracks"] if t["observations"][-1]["kind"] == kind]
    rows = []
    for z in tracks._zones(mine):
        here = [t for t in mine if t["zone"] == z["zone"]]
        row = {
            "area": z["zone"],
            "label": AREA_LABEL.get(z["zone"], z["zone"]),
            "new_this_time": sum(
                t["first_seen_index"] == latest and not t["there_from_start"] for t in here
            ),
            "still_there": sum(
                t["status"] == "still_there" and t["first_seen_index"] < latest for t in here
            ),
            "fading": sum(t["status"] == "fading" for t in here),
            "not_seen_this_time": sum(t["status"] == "not_seen_last_time" for t in here),
            "faded_so_far": z["faded"],
            "typical_days_visible": z["typical_days_visible"],
        }
        if any(v for k, v in row.items() if k not in ("area", "label", "typical_days_visible")):
            rows.append(row)
    rows.sort(key=lambda r: (-r["new_this_time"], -r["still_there"]))
    return {"check_ins": len(used), "days_covered": diary["days_covered"], "areas": rows}


def since_start(
    started: str | None,
    metric_id: str,
    this_day: date,
    value: float | None,
    earlier: list[tuple[date, float]],
    band: float | None,
    places: int,
) -> dict[str, Any] | None:
    """How this metric moved since a routine product started. `earlier`: (day, value) of the
    earlier measured check-ins (same site, mode and way of counting), any order; `band`: the
    baseline's whole-face noise band. The reference is the last check-in before the start day
    (else the first one). status: too_early | helping | moving_other_way | changed (skin tone) |
    no_change_yet | no_band."""
    if not started or value is None:
        return None
    start = date.fromisoformat(started[:10])
    if start > this_day:
        return None
    weeks = (this_day - start).days // 7
    rows = sorted(earlier)
    before = [r for r in rows if r[0] < start]
    after = [r for r in rows if r[0] >= start]
    check_ins = len(after) + 1  # and this one
    out: dict[str, Any] = {"started": start.isoformat(), "weeks": weeks, "check_ins": check_ins}
    if weeks < MIN_WEEKS or check_ins < MIN_CHECK_INS:
        return {**out, "status": "too_early"}
    ref = before[-1] if before else rows[0] if rows else None
    if ref is None:
        return {**out, "status": "too_early"}
    delta = _round(value - ref[1], places)
    out |= {
        "from_day": ref[0].isoformat(),
        "from_value": _round(ref[1], places),
        "value": _round(value, places),
        "change": delta,
        "normal_range": _round(band, max(places, 1)),
    }
    if band is None:
        return {**out, "status": "no_band"}
    if abs(value - ref[1]) <= band:
        return {**out, "status": "no_change_yet"}
    way = explain.way_of({"id": metric_id}, value - ref[1])
    status = {"improved": "helping", "other_way": "moving_other_way"}.get(way or "", "changed")
    return {**out, "status": status}
