"""SessionView (CONTRACT.md section 3): {session, result, labels, explanation}.

`session` also carries what the Lens needs and the engine does not produce: a signed preview URL
(the engine's `{output_prefix}preview.jpg`, when present), signed overlay URLs, the hours since
the baseline for the scrubber, the person's note and deviation flag, and whether the
explanation came from Gemini or the template (`explanation_source`).
"""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any

from app import engine, storage
from app.store import iso


def results_prefix(uid: str, sid: str | None = None) -> str:
    return f"results/{uid}/{sid}/" if sid else f"results/{uid}/"


def preview_name(uid: str, sid: str) -> str:
    return f"{results_prefix(uid, sid)}preview.jpg"


def _hours_between(later: Any, earlier: Any) -> float | None:
    if not isinstance(later, datetime) or not isinstance(earlier, datetime):
        return None
    return round((later - earlier).total_seconds() / 3600, 1)


def sign_all(names: list[str]) -> dict[str, str]:
    unique = list(dict.fromkeys(names))
    if not unique:
        return {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        return dict(zip(unique, pool.map(storage.signed_get_url, unique), strict=True))


def measured_result(doc: dict[str, Any]) -> dict[str, Any] | None:
    """The stored result if it is a measurement; None for placeholders (old docs included)."""
    if not doc.get("result_json"):
        return None
    result = json.loads(doc["result_json"])
    measured = doc.get("measured")
    if measured is None:  # sessions analysed before the measured flag existed
        measured = not engine.is_placeholder(result)
    return result if measured else None


def wanted_urls(
    uid: str, sid: str, doc: dict[str, Any], existing: set[str], with_overlays: bool
) -> list[str]:
    result = measured_result(doc)
    names = []
    if result and preview_name(uid, sid) in existing:
        names.append(preview_name(uid, sid))
    if result and with_overlays:
        for overlay in result.get("overlays", []):
            name = storage.name_from_uri(overlay["uri"])
            if name and name in existing:
                names.append(name)
    return names


def session_view(
    uid: str,
    sid: str,
    doc: dict[str, Any],
    *,
    baseline: dict[str, Any] | None,
    signed: dict[str, str],
) -> dict[str, Any]:
    result = measured_result(doc)
    measured = result is not None
    analyzed = doc["status"] == "done"
    preview = None
    if result and preview_name(uid, sid) in signed:
        size = result.get("image_size") or {}
        preview = {
            "url": signed[preview_name(uid, sid)],
            "width": size.get("width"),
            "height": size.get("height"),
        }
    overlay_urls = {}
    for overlay in (result or {}).get("overlays", []):
        name = storage.name_from_uri(overlay["uri"])
        if name in signed:
            overlay_urls[overlay["metric_id"]] = signed[name]
    hours = None
    if baseline:
        hours = _hours_between(doc.get("created_at"), baseline.get("session_created_at"))
    return {
        "session": {
            "id": sid,
            "site": doc["site"],
            "capture_mode": doc["capture_mode"],
            "n_frames": doc["n_frames"],
            "created_at": iso(doc.get("created_at")),
            "status": doc["status"],
            "is_baseline": bool(doc.get("is_baseline")) and measured,
            # done but not measured: the engine cannot analyse this site yet; photos are kept.
            "measured": measured if analyzed else None,
            "baseline": (
                {
                    "session_id": baseline["session_id"],
                    "frames": baseline.get("frames"),
                    "has_noise_band": baseline.get("has_noise_band", True),
                }
                if baseline
                else None
            ),
            "note": doc.get("note"),
            "deviation": bool(doc.get("deviation")),
            "error": doc.get("error"),
            "explanation_source": doc.get("explanation_source"),
            "preview": preview,
            "overlay_urls": overlay_urls,
            "hours_since_baseline": hours,
        },
        "result": result,
        "labels": doc.get("labels") or {},
        "explanation": doc.get("explanation") if measured else None,
    }
