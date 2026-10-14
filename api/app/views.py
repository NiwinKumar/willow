"""SessionView (CONTRACT.md section 3): {session, result, labels, explanation}.

`session` also carries what the Lens needs and the engine does not produce: a signed preview URL
(the engine's `{output_prefix}preview.jpg`, when present), signed overlay URLs, the hours since
the baseline for the scrubber, the person's note and deviation flag, and whether the
explanation came from Gemini or the template (`explanation_source`).
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any

from app import storage
from app.results import measured_result
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


def reference_index(result: dict[str, Any] | None) -> int:
    """Which uploaded photo the engine's rois, candidates and image_size belong to.

    Face (engine pipeline_face.py): the first photo that passed the quality checks, since spots
    are found on it; with none passed, the first photo with a face. Forearm (pipeline.py): the
    first photo whose pen-dot square was found, passed or not (a photo without the square has
    no reasons). A session whose first photos were blurry has its rings on a later photo.
    """
    frames = ((result or {}).get("quality") or {}).get("per_frame") or []
    if (result or {}).get("site") == "face_full":
        tests = [
            lambda f: f.get("passed"),
            lambda f: "face_not_found" not in (f.get("reasons") or []),
        ]
    else:
        tests = [lambda f: f.get("passed") or f.get("reasons")]
    for test in tests:
        for frame in frames:
            if test(frame):
                return int(frame.get("index", 0))
    return 0


def photo_name(uid: str, sid: str, doc: dict[str, Any], existing: set[str]) -> str | None:
    """The image shown on the stage: the engine's preview.jpg, else the person's own JPEG of the
    reference photo (a quick selfie is already viewable; a RAW frame is not)."""
    if preview_name(uid, sid) in existing:
        return preview_name(uid, sid)
    types, uris = doc.get("content_types") or [], doc.get("frame_uris") or []
    i = reference_index(measured_result(doc))
    if i < min(len(types), len(uris)) and types[i] == "image/jpeg":
        return storage.name_from_uri(uris[i])
    return None


def wanted_urls(
    uid: str, sid: str, doc: dict[str, Any], existing: set[str], with_overlays: bool
) -> list[str]:
    result = measured_result(doc)
    names = []
    photo = photo_name(uid, sid, doc, existing) if result else None
    if photo:
        names.append(photo)
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
    if result and doc.get("is_baseline"):
        # The baseline is the reference: deltas it carries from an older baseline (it was picked
        # with "Make this my baseline") would contradict "Your baseline" on screen.
        result = {
            **result,
            "metrics": [
                m
                if m.get("verdict") == "low_quality"
                else {**m, "delta": None, "verdict": "no_baseline", "direction": "none"}
                for m in result["metrics"]
            ],
        }
    preview = None
    photo = photo_name(uid, sid, doc, set(signed))
    photo = photo if photo in signed else None
    if result and photo:
        size = result.get("image_size") or {}
        preview = {
            "url": signed[photo],
            "width": size.get("width"),
            "height": size.get("height"),
        }
    overlay_urls = {}
    for overlay in (result or {}).get("overlays", []):
        name = storage.name_from_uri(overlay["uri"])
        if name in signed:
            overlay_urls[overlay["metric_id"]] = signed[name]
    # The baseline this session was actually compared with (stored at analysis time), so a later
    # "Make this my baseline" never relabels old results; older docs fall back to today's.
    if doc.get("is_baseline"):
        baseline = None if not baseline or baseline.get("session_id") != sid else baseline
    elif doc.get("compared_with") is not None or "compared_with" in doc:
        baseline = doc.get("compared_with")
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
            # Judge mode: which hosted sample these photos were copied from (else None).
            "sample_id": doc.get("sample_id"),
            # Gemini's spot labels with confidence and what it saw (AI-suggested, never measured).
            "label_details": (doc.get("label_details") or {}) if measured else {},
        },
        "result": result,
        "labels": doc.get("labels") or {},
        "explanation": doc.get("explanation") if measured else None,
    }
