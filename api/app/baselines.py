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

from app.store import Store

NOISE_BAND_FRAMES = 2  # the engine needs at least two frames to measure photo-to-photo noise


def key(site: str, capture_mode: str) -> str:
    return site if capture_mode == "calibrated_raw" else f"{site}__uncalibrated"


def get(store: Store, uid: str, site: str, capture_mode: str) -> dict[str, Any] | None:
    return store.baseline_get(uid, key(site, capture_mode))


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
    return doc
