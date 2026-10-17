"""Spot diary: each mark followed across a person's face sessions (docs/METRICS.md "Face map").

The engine gives every face candidate its place on the canonical face (`face_x_mm`,
`face_y_mm`, `zone`); this module pairs marks session to session by that place and says,
for each one, when it was first and last seen, how it looked (Gemini's AI-suggested label),
and whether it is still there, fading or gone. Every number is computed here from dates and
engine features; Gemini only names what a crop shows.

Detection flickers between photos, so the rules are deliberately slow to conclude:
- a mark is "confirmed" once two sessions show it, or two photos of one session do;
- it is "gone" only after TRACK_GONE_AFTER good sessions in a row without it;
- a duration is a range ("between the last session it was seen and the first it was not"),
  and a typical duration for a zone needs TRACK_MIN_FOR_TYPICAL marks that have faded.
"""

from collections import Counter
from datetime import datetime
from statistics import median
from typing import Any

# same mark if within this on the canonical face (5 real selfies: same mark 0.7-2.4 mm apart)
TRACK_MATCH_MM = 4.0
TRACK_CAME_BACK_MM = 6.0  # a new mark this close to one that faded counts as "came back"
TRACK_GONE_AFTER = 2  # good sessions in a row without the mark before it counts as gone
TRACK_MIN_FOR_TYPICAL = 3  # faded marks in a zone before "marks here usually last ..." is said
TRACK_MIN_SEEN_IN = 0.5  # in a 2+ photo session, shown in at least half the photos
FADING_CONTRAST = 0.7  # contrast at or below this share of its peak reads as fading

ZONES = (  # engine/app/config.py FACE_ZONES; features carry 1-based codes
    "forehead",
    "nose",
    "right_cheek",
    "left_cheek",
    "around_mouth",
    "chin",
    "right_jaw",
    "left_jaw",
)
# Gemini labels that are not a passing mark: never followed
NOT_FOLLOWED = {"hair_or_artifact", "pore", "mole", "freckle", "scar"}
STAGE_BY_LABEL = {
    "papule_pustule": "bump",
    "open_comedone": "clogged_pore",
    "closed_comedone": "clogged_pore",
    "post_blemish_mark": "mark",
}


def days(later: datetime, earlier: datetime) -> float:
    return round((later - earlier).total_seconds() / 86400, 1)


def is_front(result: dict[str, Any]) -> bool:
    """Side-view sessions measure one cheek: they cannot say a mark elsewhere is gone. A session
    with a front photo (alone or with cheek photos) measures the whole face. Engines before
    result.views: the front view is the one with a forehead patch."""
    if result.get("views"):
        return any(v.get("view") == "front" for v in result["views"])
    return any(r.get("name") == "forehead" for r in result.get("rois") or [])


def observations(result: dict[str, Any], labels: dict[str, str]) -> list[dict[str, Any]]:
    """The followable marks of one session (engine 0.3.1+ candidates with a face position)."""
    many_photos = int(result.get("frames_used") or 0) >= 2
    out = []
    for c in result.get("candidates") or []:
        f = c.get("features") or {}
        label = labels.get(c["id"])
        if "face_x_mm" not in f or label in NOT_FOLLOWED:
            continue
        seen_in = f.get("seen_in_fraction")
        stage = STAGE_BY_LABEL.get(label or "") or (
            "red_spot" if c["kind"] == "blemish" else "dark_spot"
        )
        code = int(f.get("zone") or 0)
        out.append(
            {
                "candidate_id": c["id"],
                "kind": c["kind"],
                "x": float(f["face_x_mm"]),
                "y": float(f["face_y_mm"]),
                "zone": ZONES[code - 1] if 1 <= code <= len(ZONES) else None,
                "stage": stage,
                "label": label,
                "diameter_mm": f.get("diameter_mm"),
                # how much it stands out: redness for red marks, darkness for dark ones
                "contrast": round(
                    float(f.get("a_star_contrast") or 0)
                    if c["kind"] == "blemish"
                    else abs(float(f.get("l_star_contrast") or 0)),
                    2,
                ),
                "confirmed_here": many_photos and (seen_in or 0) >= TRACK_MIN_SEEN_IN,
                "bbox": c.get("bbox"),
                "crop_uri": c.get("crop_uri"),
                "context_crop_uri": c.get("context_crop_uri"),
            }
        )
    return out


def usable(result: dict[str, Any] | None) -> bool:
    """A session that can say what is and is not on the face: measured, passed, front view,
    and analysed by an engine that places marks on the face map."""
    if not result or result.get("site") != "face_full":
        return False
    if not (result.get("quality") or {}).get("passed") or not is_front(result):
        return False
    # engine 0.3.1+ places every mark it can on the face map; a session with no marks (or
    # only marks off the mesh) is still evidence that earlier ones are gone
    return _engine_at_least(result.get("engine_version"), (0, 3, 1))


def _engine_at_least(version: str | None, want: tuple[int, int, int]) -> bool:
    try:
        parts = tuple(int(p) for p in str(version).split("-")[0].split(".")[:3])
    except ValueError:
        return False
    return parts >= want


def follow(sessions: list[dict[str, Any]]) -> dict[str, Any]:
    """sessions: oldest first, each {id, created_at: datetime, marks: observations(...)}.
    Returns {tracks, zones, sessions_used, days_covered, enough_data}."""
    if not sessions:
        return {
            "tracks": [],
            "unconfirmed": 0,
            "zones": [],
            "sessions_used": 0,
            "days_covered": 0,
            "enough_data": False,
        }
    t0, last = sessions[0]["created_at"], sessions[-1]["created_at"]
    tracks: list[dict[str, Any]] = []
    for si, s in enumerate(sessions):
        live = [t for t in tracks if t["misses"] < TRACK_GONE_AFTER]
        pairs = sorted(
            (
                (_dist(_where(t), (m["x"], m["y"])), ti, mi)
                for ti, t in enumerate(live)
                for mi, m in enumerate(s["marks"])
            ),
        )
        used_t: set[int] = set()
        used_m: set[int] = set()
        for d, ti, mi in pairs:  # greedy, closest first: a handful of marks per session
            if d > TRACK_MATCH_MM or ti in used_t or mi in used_m:
                continue
            used_t.add(ti)
            used_m.add(mi)
            t = live[ti]
            t["obs"].append({**s["marks"][mi], "session_index": si})
            t["misses"] = 0
        for ti, t in enumerate(live):
            if ti not in used_t:
                t["misses"] += 1
                if t["misses"] == TRACK_GONE_AFTER:
                    t["first_missing_index"] = si - TRACK_GONE_AFTER + 1
        for mi, m in enumerate(s["marks"]):
            if mi not in used_m:
                tracks.append(
                    {"obs": [{**m, "session_index": si}], "misses": 0, "first_missing_index": None}
                )
    out = [_summary(i, t, sessions) for i, t in enumerate(tracks)]
    _link_came_back(out)
    shown = [t for t in out if t["confirmed"]]
    return {
        "tracks": shown,
        "unconfirmed": len(out) - len(shown),
        "zones": _zones(shown),
        "sessions_used": len(sessions),
        "days_covered": days(last, t0),
        "enough_data": len(sessions) >= 3 and days(last, t0) >= 2,
    }


def _where(t: dict[str, Any]) -> tuple[float, float]:
    recent = t["obs"][-2:]  # the last two sightings: steadier than one, follows slow drift
    return (
        sum(o["x"] for o in recent) / len(recent),
        sum(o["y"] for o in recent) / len(recent),
    )


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def _summary(i: int, t: dict[str, Any], sessions: list[dict[str, Any]]) -> dict[str, Any]:
    obs = t["obs"]
    first, last_seen = obs[0]["session_index"], obs[-1]["session_index"]
    latest = len(sessions) - 1
    at = [sessions[o["session_index"]]["created_at"] for o in obs]
    ended = t["first_missing_index"] is not None
    x, y = _where(t)
    zones = [o["zone"] for o in obs if o["zone"]]
    if ended:
        status = "gone"
    elif first == latest:
        status = "new"
    elif last_seen < latest:
        status = "not_seen_last_time"
    elif _fading(obs):
        status = "fading"
    else:
        status = "still_there"
    t_first = sessions[first]["created_at"]
    visible: dict[str, Any]
    if ended:
        gone_at = sessions[t["first_missing_index"]]["created_at"]
        visible = {"at_least": days(at[-1], t_first), "at_most": days(gone_at, t_first)}
    else:
        # last seen, not the latest session: a spot missed last time is not "still" visible
        visible = {"at_least": days(at[-1], t_first), "at_most": None}
    return {
        "id": f"t_{i + 1:03d}",
        # most sightings; a tie goes to the latest (the same answer on every server)
        "zone": Counter(reversed(zones)).most_common(1)[0][0] if zones else None,
        "x_mm": round(x, 1),
        "y_mm": round(y, 1),
        "status": status,
        "confirmed": len(obs) >= 2 or any(o["confirmed_here"] for o in obs),
        # there at the first session: its start is not known, so it says nothing about how
        # long marks last
        "there_from_start": first == 0,
        "first_seen_session": sessions[first]["id"],
        "last_seen_session": sessions[last_seen]["id"],
        "first_seen_index": first,  # column in the diary (sessions oldest first)
        "last_seen_index": last_seen,
        "days_visible": visible,
        "came_back": False,
        "earlier_track": None,
        "observations": [
            {
                "session_id": sessions[o["session_index"]]["id"],
                "candidate_id": o["candidate_id"],
                "stage": o["stage"],
                "label": o["label"],
                "kind": o["kind"],
                "diameter_mm": o["diameter_mm"],
                "contrast": o["contrast"],
                "bbox": o["bbox"],
                "crop_uri": o["crop_uri"],
                "context_crop_uri": o["context_crop_uri"],
            }
            for o in obs
        ],
    }


def _fading(obs: list[dict[str, Any]]) -> bool:
    """A raised or red mark that now reads as a flat mark, or one whose contrast stayed at or
    below FADING_CONTRAST of its earlier peak for two sightings (within one kind of mark)."""
    now = obs[-1]
    if now["stage"] in ("mark", "dark_spot") and any(
        o["stage"] in ("bump", "red_spot", "clogged_pore") for o in obs[:-1]
    ):
        return True
    # contrast jitters between photos: the last two sightings must both sit well below the
    # peak before it
    same = [o["contrast"] for o in obs if o["kind"] == now["kind"]]
    if len(same) < 3 or max(same[:-2]) <= 0:
        return False
    return all(c <= FADING_CONTRAST * max(same[:-2]) for c in same[-2:])


def _link_came_back(tracks: list[dict[str, Any]]) -> None:
    """A mark that appears where an earlier one faded: the place it 'came back' to."""
    order = {t["id"]: i for i, t in enumerate(tracks)}
    for t in tracks:
        if t["there_from_start"]:
            continue
        for e in tracks:
            if (
                e["status"] == "gone"
                and e["confirmed"]  # a one-off sighting that ended is flicker, not a mark
                and order[e["id"]] < order[t["id"]]
                and _dist((e["x_mm"], e["y_mm"]), (t["x_mm"], t["y_mm"])) <= TRACK_CAME_BACK_MM
                and t["first_seen_index"] > e["last_seen_index"]
            ):
                t["came_back"], t["earlier_track"] = True, e["id"]
                break


def _zones(tracks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for zone in ZONES:
        here = [t for t in tracks if t["zone"] == zone]
        if not here:
            continue
        faded = [t for t in here if t["status"] == "gone" and not t["there_from_start"]]
        typical = None
        if len(faded) >= TRACK_MIN_FOR_TYPICAL:
            typical = {
                "at_least": round(median(t["days_visible"]["at_least"] for t in faded), 1),
                "at_most": round(median(t["days_visible"]["at_most"] for t in faded), 1),
                "from": len(faded),
            }
        out.append(
            {
                "zone": zone,
                "visible_now": sum(t["status"] in ("new", "still_there", "fading") for t in here),
                "appeared": sum(not t["there_from_start"] for t in here),
                "faded": sum(t["status"] == "gone" for t in here),
                "came_back": sum(t["came_back"] for t in here),
                "typical_days_visible": typical,
            }
        )
    return out
