"""Which session is the baseline (the api decides; CONTRACT.md section 1).

One baseline per site *and* capture mode: a quick selfie is never compared with a calibrated RAW
photo, because their colours are not comparable. Firestore keeps the contract's
`baselines/{site}` id for calibrated sessions and uses `baselines/{site}__uncalibrated` for
quick selfies.

Auto rule (Oct 13): the first measured session whose photo quality passed becomes the baseline,
however many frames it has. With one frame there is no noise band yet (mdc95 is null), so the
engine reports deltas without a verdict and the web says so; a 5-frame baseline can be picked
later with POST /v1/baselines/{site}.
"""

import json
from datetime import UTC, datetime
from typing import Any

from app.results import measured_result
from app.store import Store

NOISE_BAND_FRAMES = 3  # engine config.MIN_FRAMES_FOR_BAND: a band needs 3 usable photos


def key(site: str, capture_mode: str) -> str:
    return site if capture_mode == "calibrated_raw" else f"{site}__uncalibrated"


def get(store: Store, uid: str, site: str, capture_mode: str) -> dict[str, Any] | None:
    doc = store.baseline_get(uid, key(site, capture_mode))
    if not doc or "capture_mode" in doc:
        return doc
    # Written before Oct 13: trust it only if its session is a real measurement, and work out
    # whether it has a noise band from the frame counts it recorded.
    session = store.session_get(uid, doc["session_id"])
    if session is None or measured_result(session) is None:
        return None
    frames = min((m.get("n_frames", 0) for m in doc.get("metrics", {}).values()), default=0)
    return {
        **doc,
        "capture_mode": session["capture_mode"],
        "frames": frames,
        "has_noise_band": frames >= NOISE_BAND_FRAMES,
    }


def compared_with(baseline: dict[str, Any] | None) -> dict[str, Any] | None:
    """What a session stores about the baseline it was compared with."""
    if not baseline:
        return None
    return {
        k: baseline.get(k) for k in ("session_id", "frames", "has_noise_band", "session_created_at")
    }


def for_request(baseline: dict[str, Any] | None) -> dict[str, Any] | None:
    """The `baseline` map for an AnalyzeRequest, or None."""
    if not baseline:
        return None
    return {
        metric_id: {
            "mean": m["mean"],
            "mdc95": m.get("mdc95"),
            "n_frames": m.get("n_frames", 0),
            "session_id": baseline["session_id"],
        }
        for metric_id, m in baseline.get("metrics", {}).items()
    }


def qualifies(result: dict[str, Any]) -> bool:
    return bool(result["quality"]["passed"]) and result["frames_used"] >= 1


def build(session_id: str, session_doc: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    metrics = {
        m["id"]: {"mean": m["value"], "mdc95": m.get("mdc95"), "n_frames": result["frames_used"]}
        for m in result["metrics"]
        if m["value"] is not None and m["verdict"] != "low_quality"
    }
    return {
        "session_id": session_id,
        "site": session_doc["site"],
        "capture_mode": session_doc["capture_mode"],
        "frames": result["frames_used"],
        "has_noise_band": result["frames_used"] >= NOISE_BAND_FRAMES,
        # taken with cheek photos (result.views): its spot counts cover the cheeks from the side
        "cheeks": with_cheeks(result),
        # numbers from another engine version are not comparable (guard_engine_version)
        "engine_version": result.get("engine_version"),
        "session_created_at": session_doc.get("created_at"),
        "created_at": datetime.now(UTC),
        "metrics": metrics,
    }


def set_baseline(store: Store, uid: str, session_id: str, session_doc: dict) -> dict:
    result = json.loads(session_doc["result_json"])
    k = key(session_doc["site"], session_doc["capture_mode"])
    previous = store.baseline_get(uid, k)
    doc = build(session_id, session_doc, result)
    store.baseline_set(uid, k, doc)
    old = previous["session_id"] if previous else None
    if old and old != session_id and store.session_get(uid, old) is not None:
        store.session_update(uid, old, {"is_baseline": False})
    store.session_update(uid, session_id, {"is_baseline": True})
    if session_doc["site"] == "face_full":  # picked by hand: its counts lead for its kind of photos
        store.baseline_set(uid, counts_key(k, doc["cheeks"]), _counts_doc(doc))
    return doc


# Face check-ins with cheek photos (front + left and right cheek) count marks on the cheeks from
# the side, so their blemish and dark-spot counts are compared only with an earlier check-in taken
# the same way: the first one of each kind (`{key}__counts_cheeks` / `{key}__counts_front`), unless
# the baseline itself is of that kind. Every other metric is read on the front photos: compared
# with the baseline as usual.
COUNTS_FIRST_CHEEKS = (
    "first check-in with cheek photos: from the next one, blemish and dark-spot counts are "
    "compared with this one"
)
COUNTS_FIRST_FRONT = (
    "first check-in without cheek photos since your baseline had them: from the next one, "
    "blemish and dark-spot counts are compared with this one"
)


def _view_kinds(result: dict[str, Any]) -> set[str]:
    return {v.get("view") for v in result.get("views") or []}


def with_cheeks(result: dict[str, Any]) -> bool:
    """A front photo plus at least one cheek photo (the counts then include the cheeks)."""
    kinds = _view_kinds(result)
    return "front" in kinds and len(kinds) > 1


def side_only(result: dict[str, Any]) -> bool:
    """Only cheek photos passed (the front one failed): its counts cover one side of the face."""
    kinds = _view_kinds(result)
    return bool(kinds) and "front" not in kinds


def counts_key(base_key: str, cheeks: bool) -> str:
    return f"{base_key}__counts_{'cheeks' if cheeks else 'front'}"


def _counts_doc(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "session_id": doc["session_id"],
        "session_created_at": doc.get("session_created_at"),
        "engine_version": doc.get("engine_version"),
        "frames": doc.get("frames"),
        "metrics": {k: v for k, v in doc.get("metrics", {}).items() if k in CONFIRMED_COUNTS},
    }


def _compare(m: dict[str, Any], ref: dict[str, Any] | None) -> None:
    """The engine's comparison (engine aggregate.summarize) of one metric with another reference."""
    if m.get("verdict") == "low_quality":
        return  # the photo was too poor to compare: keep saying so
    if not ref or m.get("value") is None:
        m.update(delta=None, verdict="no_baseline", direction="none")
        return
    delta = round(m["value"] - ref["mean"], 3) + 0.0
    mdc = ref.get("mdc95")
    m.update(
        delta=delta,
        direction="increase" if delta > 0 else "decrease" if delta < 0 else "none",
        verdict="no_baseline"
        if mdc is None
        else "real_change"
        if abs(delta) > mdc
        else "within_noise",
    )


def match_counts(
    store: Store,
    uid: str,
    session_id: str,
    doc: dict[str, Any],
    result: dict[str, Any],
    baseline: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Compare a face check-in's counts with one taken the same way (with or without cheek
    photos). Returns what they were compared with when that is not the baseline, else None."""
    if result.get("site") != "face_full" or not baseline or baseline["session_id"] == session_id:
        return None
    if side_only(result):  # one cheek's counts compare with nothing
        for m in result.get("metrics", []):
            if m["id"] in CONFIRMED_COUNTS:
                _compare(m, None)
        return None
    cheeks = with_cheeks(result)
    if bool(baseline.get("cheeks")) == cheeks:
        return None
    ref = store.baseline_get(uid, counts_key(key(doc["site"], doc["capture_mode"]), cheeks))
    if ref and (ref["session_id"] == session_id or not store.session_get(uid, ref["session_id"])):
        ref = None  # itself, or a check-in that was deleted
    if ref and _minor(ref.get("engine_version")) != _minor(result.get("engine_version")):
        ref = None
    for m in result.get("metrics", []):
        if m["id"] in CONFIRMED_COUNTS:
            _compare(m, (ref or {}).get("metrics", {}).get(m["id"]))
    if not ref:
        result.setdefault("warnings", []).append(
            COUNTS_FIRST_CHEEKS if cheeks else COUNTS_FIRST_FRONT
        )
        return None
    return {k: ref.get(k) for k in ("session_id", "session_created_at", "frames")}


def remember_counts(
    store: Store, uid: str, session_id: str, doc: dict[str, Any], result: dict[str, Any]
) -> None:
    """The first passing face check-in of each kind (with or without cheek photos) is what later
    ones of that kind compare their counts with."""
    if result.get("site") != "face_full" or not qualifies(result) or side_only(result):
        return
    k = counts_key(key(doc["site"], doc["capture_mode"]), with_cheeks(result))
    ref = store.baseline_get(uid, k)
    if ref and ref["session_id"] != session_id and store.session_get(uid, ref["session_id"]):
        return
    store.baseline_set(uid, k, _counts_doc(build(session_id, doc, result)))


# Face counts (engine, Oct 14): with 2+ usable photos only marks seen in at least two photos are
# counted; a single photo counts every mark. A count from one kind of session against the other
# would show a change made by the photo count, not the skin.
CONFIRMED_COUNTS = ("blemishes", "pigment_spots")
COUNTS_NOT_COMPARED = (
    "blemish and dark-spot counts are not compared with your baseline this time: one of the two "
    "sessions had a single usable photo, and counts are confirmed across photos only when there "
    "are two or more"
)


def guard_counts(result: dict[str, Any], baseline: dict[str, Any] | None) -> None:
    """Drop the comparison of confirmed counts when only one side had 2+ usable photos."""
    if not baseline or result.get("site") != "face_full":
        return
    base_frames, frames = baseline.get("frames") or 0, result.get("frames_used") or 0
    if not base_frames or not frames or (base_frames >= 2) == (frames >= 2):
        return
    touched = False
    for m in result.get("metrics", []):
        if m["id"] in CONFIRMED_COUNTS and m.get("delta") is not None:
            m.update(delta=None, verdict="no_baseline", direction="none")
            touched = True
    if touched:
        result.setdefault("warnings", []).append(COUNTS_NOT_COMPARED)


ENGINE_CHANGED = (
    "not compared with your baseline: it was measured by an earlier version of Willow's "
    "measurement, whose numbers differ. Measure the baseline again, or make a new one"
)


def _minor(version: str | None) -> str | None:
    """'0.3.1' -> '0.3': patch releases do not move numbers, minor ones may."""
    if not version:
        return None
    return ".".join(version.split(".")[:2])


def guard_engine_version(result: dict[str, Any], baseline: dict[str, Any] | None) -> None:
    """No comparison across engine versions (the engine changed, not the skin)."""
    if not baseline or _minor(result.get("engine_version")) == _minor(
        baseline.get("engine_version")
    ):
        return
    touched = False
    for m in result.get("metrics", []):
        if m.get("delta") is not None:
            m.update(delta=None, verdict="no_baseline", direction="none")
            touched = True
    if touched:
        result.setdefault("warnings", []).append(ENGINE_CHANGED)
