import json
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app import baselines, engine, explain, sessions, storage, views
from app.auth import AuthUser, current_user
from app.models import (
    CONTENT_TYPES,
    CreateSessionRequest,
    CreateSessionResponse,
    ObjectStatus,
    PatchSessionRequest,
    SessionObjectsResponse,
    Site,
    UploadTarget,
)
from app.settings import Settings, get_settings
from app.store import Store, get_store

router = APIRouter(prefix="/v1/sessions", tags=["sessions"])

# A session stuck in "processing" longer than this (crashed instance) may be analyzed again.
STALE_PROCESSING = timedelta(minutes=3)


def _not_found() -> HTTPException:
    return HTTPException(404, {"code": "not_found", "message": "session not found"})


def _load(store: Store, uid: str, session_id: str) -> dict[str, Any]:
    doc = store.session_get(uid, session_id)
    if doc is None:
        raise _not_found()
    return doc


def _upload_targets(doc: dict[str, Any], ttl: int) -> list[UploadTarget]:
    targets = []
    for i, (uri, content_type) in enumerate(
        zip(doc["frame_uris"], doc["content_types"], strict=True), start=1
    ):
        url = storage.signed_put_url(storage.name_from_uri(uri), content_type, ttl)
        targets.append(
            UploadTarget(index=i, object_uri=uri, url=url, headers={"Content-Type": content_type})
        )
    return targets


@router.post("", response_model=CreateSessionResponse)
def create_session(
    body: CreateSessionRequest,
    user: AuthUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
    store: Store = Depends(get_store),
) -> CreateSessionResponse:
    session_id = sessions.new_session_id()
    ext_for = CONTENT_TYPES[body.capture_mode]
    frame_uris = [
        storage.object_uri(sessions.frame_object_name(user.uid, session_id, i, ext_for[ct]))
        for i, ct in enumerate(body.content_types, start=1)
    ]
    doc = sessions.new_doc(
        {
            "site": body.site,
            "capture_mode": body.capture_mode,
            "n_frames": body.n_frames,
            "frame_uris": frame_uris,
            "content_types": body.content_types,
        }
    )
    store.session_set(user.uid, session_id, doc)
    return CreateSessionResponse(
        session_id=session_id,
        upload_urls=_upload_targets(doc, settings.upload_url_ttl_seconds),
        expires_in_seconds=settings.upload_url_ttl_seconds,
    )


@router.post("/{session_id}/upload-urls", response_model=CreateSessionResponse)
def reissue_upload_urls(
    session_id: str,
    user: AuthUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
    store: Store = Depends(get_store),
) -> CreateSessionResponse:
    """Fresh signed URLs for the same objects, for a retry after the first ones expired."""
    doc = _load(store, user.uid, session_id)
    if doc["status"] not in ("uploading", "failed"):
        raise HTTPException(409, {"code": "conflict", "message": "session already analyzed"})
    return CreateSessionResponse(
        session_id=session_id,
        upload_urls=_upload_targets(doc, settings.upload_url_ttl_seconds),
        expires_in_seconds=settings.upload_url_ttl_seconds,
    )


@router.get("/{session_id}/objects", response_model=SessionObjectsResponse)
def session_objects(
    session_id: str,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> SessionObjectsResponse:
    """Size and MD5 of each uploaded frame, straight from GCS metadata (byte-identity check)."""
    doc = _load(store, user.uid, session_id)
    objects: list[ObjectStatus] = []
    for i, uri in enumerate(doc.get("frame_uris", []), start=1):
        info = storage.object_info(storage.name_from_uri(uri))
        objects.append(
            ObjectStatus(
                index=i,
                object_uri=info.object_uri,
                exists=info.exists,
                size=info.size,
                md5_base64=info.md5_base64,
                content_type=info.content_type,
            )
        )
    return SessionObjectsResponse(session_id=session_id, objects=objects)


@router.post("/{session_id}/analyze")
def analyze_session(
    session_id: str,
    user: AuthUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    uid = user.uid
    doc = _load(store, uid, session_id)
    started = doc.get("processing_started_at")
    now = datetime.now(UTC)
    if doc["status"] == "processing" and started and now - started < STALE_PROCESSING:
        raise HTTPException(409, {"code": "conflict", "message": "analysis already running"})

    missing = []
    for i, uri in enumerate(doc["frame_uris"], start=1):
        info = storage.object_info(storage.name_from_uri(uri))
        if not info.exists or not info.size:
            missing.append(i)
    if missing:
        raise HTTPException(
            409,
            {"code": "frames_missing", "message": f"frames not uploaded yet: {missing}"},
        )

    store.session_update(
        uid, session_id, {"status": "processing", "processing_started_at": now, "error": None}
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
        "output_prefix": f"gs://{settings.bucket}/{views.results_prefix(uid, session_id)}",
        "options": {"compute_overlays": True, "max_candidates": 40},
    }
    try:
        result = engine.analyze(request)
    except engine.EngineError as exc:
        store.session_update(
            uid,
            session_id,
            {"status": "failed", "error": {"code": exc.code, "message": exc.message}},
        )
        raise HTTPException(exc.status, {"code": exc.code, "message": exc.message}) from exc

    measured = not engine.is_placeholder(result)
    store.session_update(
        uid,
        session_id,
        {
            "status": "done",
            "measured": measured,
            # Placeholder numbers are kept for debugging only; views never return them.
            "result_json": json.dumps(result),
            "explanation": explain.template(result) if measured else None,
            "explanation_source": "template" if measured else None,
            "labels": {},
            "analyzed_at": datetime.now(UTC),
        },
    )
    doc = _load(store, uid, session_id)
    if measured and current is None and baselines.qualifies(result):
        baselines.set_baseline(store, uid, session_id, doc)
        doc = _load(store, uid, session_id)
    return _detail_view(store, uid, session_id, doc)


def _detail_view(store: Store, uid: str, session_id: str, doc: dict) -> dict[str, Any]:
    existing = (
        storage.list_names(views.results_prefix(uid, session_id))
        if doc.get("result_json")
        else set()
    )
    signed = views.sign_all(views.wanted_urls(uid, session_id, doc, existing, with_overlays=True))
    return views.session_view(
        uid,
        session_id,
        doc,
        baseline=baselines.get(store, uid, doc["site"], doc["capture_mode"]),
        signed=signed,
    )


@router.get("")
def list_sessions(
    site: Site | None = Query(default=None),
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Every session of a person (optionally one site), oldest first: the scrubber's ticks."""
    uid = user.uid
    rows = [(sid, d) for sid, d in store.sessions_list(uid) if site is None or d["site"] == site]
    rows.sort(key=lambda r: r[1].get("created_at") or datetime.min.replace(tzinfo=UTC))
    existing = (
        storage.list_names(views.results_prefix(uid))
        if any(d.get("result_json") for _, d in rows)
        else set()
    )
    wanted = [
        name
        for sid, d in rows
        for name in views.wanted_urls(uid, sid, d, existing, with_overlays=False)
    ]
    signed = views.sign_all(wanted)
    baseline_by_key: dict[str, dict | None] = {}
    out = []
    for sid, d in rows:
        k = baselines.key(d["site"], d["capture_mode"])
        if k not in baseline_by_key:
            baseline_by_key[k] = baselines.get(store, uid, d["site"], d["capture_mode"])
        out.append(views.session_view(uid, sid, d, baseline=baseline_by_key[k], signed=signed))
    return {"sessions": out}


@router.get("/{session_id}")
def get_session(
    session_id: str,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    doc = _load(store, user.uid, session_id)
    return _detail_view(store, user.uid, session_id, doc)


@router.patch("/{session_id}")
def patch_session(
    session_id: str,
    body: PatchSessionRequest,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """The person's own note and the "something was different" flag on a session."""
    _load(store, user.uid, session_id)
    fields = body.model_dump(exclude_unset=True)
    if fields:
        store.session_update(user.uid, session_id, fields)
    return _detail_view(store, user.uid, session_id, _load(store, user.uid, session_id))
