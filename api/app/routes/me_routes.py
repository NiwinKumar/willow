from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app import baselines, storage
from app.auth import AuthUser, current_user
from app.models import SetBaselineRequest, Site
from app.results import measured_result
from app.store import Store, get_store, iso

router = APIRouter(prefix="/v1", tags=["timeline", "baselines", "me"])


@router.get("/timeline")
def timeline(
    site: Site = Query(),
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Per-metric series for one site, oldest first, from analyzed sessions only."""
    rows = [
        (sid, d)
        for sid, d in store.sessions_list(user.uid)
        if d["site"] == site and d.get("status") == "done" and measured_result(d) is not None
    ]
    rows.sort(key=lambda r: r[1].get("created_at") or datetime.min.replace(tzinfo=UTC))
    series: dict[str, list[dict[str, Any]]] = {}
    for sid, d in rows:
        for m in measured_result(d)["metrics"]:
            series.setdefault(m["id"], []).append(
                {
                    "session_id": sid,
                    "created_at": iso(d.get("created_at")),
                    "value": m["value"],
                    "delta": m.get("delta"),
                    "mdc95": m.get("mdc95"),
                    "verdict": m["verdict"],
                    "confidence": m["confidence"],
                    "capture_mode": d["capture_mode"],
                }
            )
    calibrated = baselines.get(store, user.uid, site, "calibrated_raw")
    quick = baselines.get(store, user.uid, site, "uncalibrated")
    return {
        "site": site,
        "baseline_session_id": calibrated["session_id"] if calibrated else None,
        "baseline_session_ids": {
            "calibrated_raw": calibrated["session_id"] if calibrated else None,
            "uncalibrated": quick["session_id"] if quick else None,
        },
        "metrics": series,
    }


@router.post("/baselines/{site}")
def set_baseline(
    site: Site,
    body: SetBaselineRequest,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    doc = store.session_get(user.uid, body.session_id)
    if doc is None or doc["site"] != site:
        raise HTTPException(404, {"code": "not_found", "message": "session not found for site"})
    if doc.get("status") != "done" or not doc.get("result_json"):
        raise HTTPException(409, {"code": "conflict", "message": "session not analyzed yet"})
    result = measured_result(doc)
    if result is None:
        raise HTTPException(409, {"code": "conflict", "message": "this session is not measured"})
    if not result["quality"]["passed"]:
        raise HTTPException(409, {"code": "conflict", "message": "photo quality too low"})
    saved = baselines.set_baseline(store, user.uid, body.session_id, doc)
    return {
        "site": site,
        "capture_mode": saved["capture_mode"],
        "has_noise_band": saved["has_noise_band"],
        "session_id": saved["session_id"],
        "created_at": iso(saved["created_at"]),
        "metrics": saved["metrics"],
    }


@router.delete("/me", status_code=204)
def delete_me(
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> Response:
    """Delete everything stored for this person: photos, results, sessions, baselines.

    Records first, so the app forgets them at once even if removing many files takes a while."""
    store.delete_user(user.uid)
    storage.delete_prefix(f"uploads/{user.uid}/")
    storage.delete_prefix(f"results/{user.uid}/")
    return Response(status_code=204)


class ConsentRequest(BaseModel):
    version: str = Field(min_length=1, max_length=20)
    aggregate_insights_opt_in: bool


@router.put("/me/consent")
def put_consent(
    body: ConsentRequest,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """CONTRACT section 4 users/{uid}.consent; the retailer export reads the opt-in from here."""
    previous = (store.user_get(user.uid) or {}).get("consent") or {}
    consent = {
        "version": body.version,
        "accepted_at": previous.get("accepted_at")
        if previous.get("version") == body.version
        else datetime.now(UTC),
        "aggregate_insights_opt_in": body.aggregate_insights_opt_in,
        "updated_at": datetime.now(UTC),
    }
    store.user_merge(user.uid, {"consent": consent, "is_demo": False})
    return {"consent": {k: iso(v) if isinstance(v, datetime) else v for k, v in consent.items()}}


@router.get("/me")
def get_me(
    user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    doc = store.user_get(user.uid) or {}
    consent = doc.get("consent")
    return {
        "uid": user.uid,
        "consent": {k: iso(v) if isinstance(v, datetime) else v for k, v in consent.items()}
        if consent
        else None,
    }
