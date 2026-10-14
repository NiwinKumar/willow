"""One analysis run: engine call, explanation, storing the result, the automatic baseline.

Shared by POST /v1/sessions/{id}/analyze and scripts/remeasure.py (which measures saved
sessions again once their site is measured, so photos taken early still become the baseline).
"""

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

from app import baselines, engine, explain, labeller, storage, views
from app.store import Store

log = logging.getLogger("willow.analysis")


class SessionGone(Exception):
    """The session was deleted while it was being measured."""


def run(store: Store, bucket: str, uid: str, session_id: str, doc: dict[str, Any]) -> dict:
    """Analyze one session whose frames are uploaded and return its updated doc.

    Raises engine.EngineError after marking the session failed.
    """
    store.session_update(
        uid,
        session_id,
        {"status": "processing", "processing_started_at": datetime.now(UTC), "error": None},
    )
    current = baselines.get(store, uid, doc["site"], doc["capture_mode"])
    baseline_map = None
    if current and current["session_id"] != session_id:
        baseline_map = baselines.for_request(current)
    request = {
        "schema_version": "1.0",
        "session_id": session_id,
        "user_id": uid,
        "site": doc["site"],
        "capture_mode": doc["capture_mode"],
        "frames": [
            {"uri": uri, "content_type": ct}
            for uri, ct in zip(doc["frame_uris"], doc["content_types"], strict=True)
        ],
        "baseline": baseline_map,
        "output_prefix": f"gs://{bucket}/{views.results_prefix(uid, session_id)}",
        "options": {"compute_overlays": True, "max_candidates": 40},
    }
    try:
        result = engine.analyze(request)
    except engine.EngineError as exc:
        log.warning("engine failed for %s/%s: %s %s", uid, session_id, exc.code, exc.message)
        store.session_update(
            uid,
            session_id,
            {"status": "failed", "error": {"code": exc.code, "message": exc.public_message}},
        )
        raise

    measured = not engine.is_placeholder(result)
    if measured and baseline_map:
        baselines.guard_engine_version(result, current)
        baselines.guard_counts(result, current)
    explanation, source, details = (None, None, {})
    if measured:
        # The explanation and the spot labels are independent Gemini calls: run them together.
        context = explain_context(store, uid, doc, current, session_id)
        with ThreadPoolExecutor(max_workers=2) as pool:
            explained = pool.submit(explain.generate, result, context)
            labelled = pool.submit(labeller.label_candidates, result)
            explanation, source = explained.result()
            details = labelled.result()
    if store.session_get(uid, session_id) is None:
        # "Delete my data" ran while the engine worked: remove what it wrote since, keep nothing.
        storage.delete_prefix(views.results_prefix(uid, session_id))
        raise SessionGone(session_id)
    store.session_update(
        uid,
        session_id,
        {
            "status": "done",
            "measured": measured,
            # Placeholder numbers are kept for debugging only; views never return them.
            "result_json": json.dumps(result),
            "explanation": explanation,
            "explanation_source": source,
            "compared_with": baselines.compared_with(current) if baseline_map else None,
            # CONTRACT.md: labels = {candidate_id: label}; the rest is for the "AI-suggested" UI.
            "labels": {cid: d["label"] for cid, d in details.items()},
            "label_details": details,
            "analyzed_at": datetime.now(UTC),
        },
    )
    doc = store.session_get(uid, session_id) or doc
    if measured and current is not None and current["session_id"] == session_id:
        # Measured again (a fix or a new engine): the baseline keeps up with its own session,
        # and stops being one if it no longer passes (a square found in hair, for example).
        if baselines.qualifies(result):
            baselines.set_baseline(store, uid, session_id, doc)
        else:
            store.baseline_delete(uid, baselines.key(doc["site"], doc["capture_mode"]))
            store.session_update(uid, session_id, {"is_baseline": False})
            current = None
        doc = store.session_get(uid, session_id) or doc
        return doc
    if measured and current is None and baselines.qualifies(result):
        try:
            baselines.set_baseline(store, uid, session_id, doc)
        except Exception:
            # The measurement is saved and shown; only the baseline pointer failed. The next
            # session becomes the baseline instead, never "failed" for a finished session.
            log.exception("could not set the baseline for %s/%s", uid, session_id)
        doc = store.session_get(uid, session_id) or doc
    return doc


def explain_context(
    store: Store, uid: str, doc: dict, baseline: dict | None, session_id: str
) -> dict[str, Any]:
    """What the explanation may refer to besides the metrics (all numbers here are quotable)."""
    is_baseline = baseline is None or baseline["session_id"] == session_id
    days = None
    created, base_created = doc.get("created_at"), (baseline or {}).get("session_created_at")
    if not is_baseline and isinstance(created, datetime) and isinstance(base_created, datetime):
        days = (created - base_created).days
    routine = [
        {
            "product": f"{e.get('brand', '')} {e.get('custom_name', '')}".strip(),
            "started_at": e.get("started_at"),
            "ended_at": e.get("ended_at"),
        }
        for _, e in store.routine_list(uid)
    ]
    return {
        "is_baseline": is_baseline,
        # the band each verdict was judged against (explain.with_bands; not sent to Gemini)
        "bands": None
        if is_baseline
        else {k: m.get("mdc95") for k, m in (baseline.get("metrics") or {}).items()},
        "baseline_has_noise_band": None if is_baseline else baseline.get("has_noise_band", True),
        "days_since_baseline": days,
        "routine": routine[:12],
    }


def remeasure(
    store: Store,
    bucket: str,
    uid: str,
    sites: set[str] | None = None,
    apply: bool = False,
    sessions: set[str] | None = None,
) -> list[str]:
    """Measure again, oldest first, the sessions saved while their site was not measured yet.

    Oldest first, so the earliest saved session becomes the baseline (the person's "before")
    and later ones are compared with it. `sessions` names sessions to run again even if already
    measured (after an engine or explanation fix). Returns one line per session; writes only
    with apply.
    """
    rows = [
        (sid, d)
        for sid, d in store.sessions_list(uid)
        if d.get("status") == "done"
        and (sid in sessions if sessions else d.get("measured") is False)
        and (sites is None or d["site"] in sites)
    ]
    rows.sort(key=lambda r: (r[1].get("created_at") or datetime.min.replace(tzinfo=UTC), r[0]))
    lines = []
    for sid, d in rows:
        label = f"{uid}/{sid} {d['site']} {d['capture_mode']} {d.get('n_frames')} photos"
        if not apply:
            lines.append(f"{label}: would measure")
            continue
        try:
            doc = run(store, bucket, uid, sid, d)
        except engine.EngineError as exc:
            # a re-run that fails leaves the session as it was (still on the timeline), not
            # "failed": the old result is the person's, the failure is ours
            store.session_update(uid, sid, {"status": d.get("status"), "error": d.get("error")})
            lines.append(f"{label}: failed, left as it was ({exc.code}: {exc.message})")
            continue
        state = "measured" if doc.get("measured") else "still not measured"
        lines.append(f"{label}: {state}{', now the baseline' if doc.get('is_baseline') else ''}")
    return lines
