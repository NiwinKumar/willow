"""Which session is the baseline for a site (the api decides; CONTRACT.md section 1).

Auto rule: the first calibrated session whose quality passed with 5 usable frames. A person can
also pick one with POST /v1/baselines/{site}.
"""

import json
from datetime import UTC, datetime
from typing import Any

from app.store import Store

BASELINE_FRAMES = 5


def for_request(store: Store, uid: str, site: str) -> dict[str, Any] | None:
    """The `baseline` map for an AnalyzeRequest, or None."""
    doc = store.baseline_get(uid, site)
    if not doc:
        return None
    return {
        metric_id: {
            "mean": m["mean"],
            "mdc95": m.get("mdc95"),
            "n_frames": m.get("n_frames", 0),
            "session_id": doc["session_id"],
        }
        for metric_id, m in doc.get("metrics", {}).items()
    }


def qualifies(doc: dict[str, Any], result: dict[str, Any]) -> bool:
    return (
        doc.get("capture_mode") == "calibrated_raw"
        and result["quality"]["passed"]
        and result["frames_used"] >= BASELINE_FRAMES
    )


def build(session_id: str, session_doc: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    metrics = {
        m["id"]: {"mean": m["value"], "mdc95": m.get("mdc95"), "n_frames": result["frames_used"]}
        for m in result["metrics"]
        if m["value"] is not None and m["verdict"] != "low_quality"
    }
    return {
        "session_id": session_id,
        "session_created_at": session_doc.get("created_at"),
        "created_at": datetime.now(UTC),
        "metrics": metrics,
    }


def set_baseline(store: Store, uid: str, site: str, session_id: str, session_doc: dict) -> dict:
    result = json.loads(session_doc["result_json"])
    previous = store.baseline_get(uid, site)
    doc = build(session_id, session_doc, result)
    store.baseline_set(uid, site, doc)
    old = previous["session_id"] if previous else None
    if old and old != session_id and store.session_get(uid, old) is not None:
        store.session_update(uid, old, {"is_baseline": False})
    store.session_update(uid, session_id, {"is_baseline": True})
    return doc
