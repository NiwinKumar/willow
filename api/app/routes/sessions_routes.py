import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app import analysis, baselines, engine, limits, metric_story, sessions, storage, views
from app.auth import AuthUser, current_user
from app.models import (
    CONTENT_TYPES,
    MAX_FRAMES,
    AddFramesRequest,
    AddFramesResponse,
    CreateSessionRequest,
    CreateSessionResponse,
    DuplicateOf,
    ObjectStatus,
    PatchSessionRequest,
    SessionObjectsResponse,
    Site,
    UploadTarget,
)
from app.results import measured_result
from app.settings import Settings, get_settings
from app.store import Store, get_store

log = logging.getLogger("willow.sessions")
router = APIRouter(prefix="/v1/sessions", tags=["sessions"])

# A session stuck in "processing" longer than this (crashed instance) may be analyzed again.
# Longer than the api's own 300 s request timeout, so a slow run is never started twice.
STALE_PROCESSING = timedelta(minutes=6)  # longer than Cloud Run's 300 s request limit
SESSION_ID = re.compile(r"^s_\d{8}_[0-9a-f]{8}$")


def _not_found() -> HTTPException:
    return HTTPException(404, {"code": "not_found", "message": "session not found"})


def _load(store: Store, uid: str, session_id: str) -> dict[str, Any]:
    if not SESSION_ID.match(session_id):  # never put arbitrary text into a Firestore path
        raise _not_found()
    doc = store.session_get(uid, session_id)
    if doc is None:
        raise _not_found()
    return doc


def _upload_targets(doc: dict[str, Any], ttl: int, first: int = 1) -> list[UploadTarget]:
    targets = []
    for i, (uri, content_type) in enumerate(
        zip(doc["frame_uris"], doc["content_types"], strict=True), start=1
    ):
        if i < first:
            continue
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
    infos = [storage.object_info(storage.name_from_uri(u)) for u in doc.get("frame_uris", [])]
    md5s = [info.md5_base64 if info.exists else None for info in infos]
    if md5s != doc.get("frame_md5s"):
        # Kept on the session, so later check-ins are compared with it even after the photos go.
        store.session_update(user.uid, session_id, {"frame_md5s": md5s})
    dups = _duplicates(store, user.uid, session_id, md5s)
    objects = [
        ObjectStatus(
            index=i,
            object_uri=info.object_uri,
            exists=info.exists,
            size=info.size,
            md5_base64=info.md5_base64,
            content_type=info.content_type,
            duplicate_of=dup,
        )
        for i, (info, dup) in enumerate(zip(infos, dups, strict=True), start=1)
    ]
    return SessionObjectsResponse(session_id=session_id, objects=objects)


def _duplicates(
    store: Store, uid: str, session_id: str, md5s: list[str | None]
) -> list[DuplicateOf | None]:
    """For each frame: a byte-identical frame (same GCS MD5) of the person's earliest other
    session, else an earlier frame of this session, else None. Sample runs are left out (two runs
    of one sample are the same photos by design). Sessions checked before frame_md5s existed are
    read from one listing of the person's uploads, and finished ones get their md5s stored."""
    if not any(md5s):
        return [None] * len(md5s)
    rows = [
        (sid, d)
        for sid, d in store.sessions_list(uid)
        if sid != session_id and not d.get("sample_id")
    ]
    rows.sort(key=lambda r: (r[1].get("created_at") or datetime.min.replace(tzinfo=UTC), r[0]))
    legacy = [(sid, d) for sid, d in rows if d.get("frame_md5s") is None]
    listed = storage.list_md5s(f"uploads/{uid}/") if legacy else {}
    for sid, d in legacy:
        found = [listed.get(storage.name_from_uri(u) or "") for u in d.get("frame_uris") or []]
        d["frame_md5s"] = found
        if d.get("status") == "done":  # finished uploading: what is missing now stays missing
            store.session_update(uid, sid, {"frame_md5s": found})
    earlier: dict[str, DuplicateOf] = {}
    for sid, d in rows:
        for i, m in enumerate(d.get("frame_md5s") or [], start=1):
            if m and m not in earlier:
                earlier[m] = DuplicateOf(session_id=sid, index=i)
    out: list[DuplicateOf | None] = []
    here: dict[str, int] = {}
    for i, m in enumerate(md5s, start=1):
        if not m:
            out.append(None)
            continue
        if m in earlier:
            out.append(earlier[m])
        elif m in here:
            out.append(DuplicateOf(session_id=session_id, index=here[m]))
        else:
            out.append(None)
        here.setdefault(m, i)
    return out


_FRAME_NUMBER = re.compile(r"/frame_(\d+)\.[a-z]+$")


def _analysis_running(doc: dict[str, Any]) -> bool:
    started = doc.get("processing_started_at")
    return (
        doc.get("status") == "processing"
        and isinstance(started, datetime)
        and datetime.now(UTC) - started < STALE_PROCESSING
    )


def _aligned_md5s(doc: dict[str, Any]) -> list[str | None]:
    n = len(doc["frame_uris"])
    return (list(doc.get("frame_md5s") or []) + [None] * n)[:n]


@router.post("/{session_id}/frames", response_model=AddFramesResponse)
def add_frames(
    session_id: str,
    body: AddFramesRequest,
    user: AuthUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
    store: Store = Depends(get_store),
) -> AddFramesResponse:
    """More photos for a session: an edit before analyze, or a top-up of a measured session (a
    baseline with too few usable photos for a normal range). New objects get fresh names and
    signed PUT URLs; n_frames grows. A measured session goes back to "uploading" (its result and
    its baseline stay as they are until POST .../analyze measures every frame again) and drops
    the frames the engine left out, which a new run would leave out again."""
    uid = user.uid
    doc = _load(store, uid, session_id)
    if doc.get("sample_id"):
        raise HTTPException(409, {"code": "conflict", "message": "sample photos can't be changed"})
    if _analysis_running(doc):
        raise HTTPException(409, {"code": "conflict", "message": "analysis already running"})
    allowed = CONTENT_TYPES[doc["capture_mode"]]
    bad = [c for c in body.content_types if c not in allowed]
    if bad:
        raise HTTPException(
            422,
            {
                "code": "bad_request",
                "message": f"content type not allowed for {doc['capture_mode']}: {bad[0]}",
                "field": "content_types",
            },
        )
    uris, types, md5s = list(doc["frame_uris"]), list(doc["content_types"]), _aligned_md5s(doc)
    keep = list(range(len(uris)))
    if doc["status"] == "done":
        frames = ((measured_result(doc) or {}).get("quality") or {}).get("per_frame") or []
        left_out = {int(f["index"]) for f in frames if not f.get("passed")}
        keep = [i for i in keep if i not in left_out]
        names = [storage.name_from_uri(uris[i]) for i in keep]
        if not all(storage.object_info(n).exists for n in names if n):
            # The bucket deletes photos after 30 days: nothing left to measure again.
            raise HTTPException(
                409,
                {
                    "code": "originals_deleted",
                    "message": "The original photos of this check-in were deleted after 30 "
                    "days, so it can't take more photos. Start a new check-in instead.",
                },
            )
    if len(keep) + body.add > MAX_FRAMES:
        raise HTTPException(
            409,
            {
                "code": "too_many_frames",
                "message": f"A check-in holds up to {MAX_FRAMES} photos; this one has "
                f"{len(keep)} already.",
            },
        )
    dropped = [i + 1 for i in range(len(uris)) if i not in keep]
    numbers = [int(m.group(1)) for u in uris if (m := _FRAME_NUMBER.search(u))]
    seq = max([doc.get("frame_seq") or 0, len(uris), *numbers])
    new_uris = [
        storage.object_uri(sessions.frame_object_name(uid, session_id, seq + k, allowed[ct]))
        for k, ct in enumerate(body.content_types, start=1)
    ]
    fields: dict[str, Any] = {
        "frame_uris": [uris[i] for i in keep] + new_uris,
        "content_types": [types[i] for i in keep] + body.content_types,
        "frame_md5s": [md5s[i] for i in keep] + [None] * body.add,
        "n_frames": len(keep) + body.add,
        "frame_seq": seq + body.add,
    }
    if doc["status"] != "uploading":
        fields.update(status="uploading", error=None, stage=None)
    store.session_update(uid, session_id, fields)
    for i in dropped:
        _delete_quietly(uris[i - 1])
    return AddFramesResponse(
        session_id=session_id,
        n_frames=fields["n_frames"],
        upload_urls=_upload_targets(
            {**doc, **fields}, settings.upload_url_ttl_seconds, first=len(keep) + 1
        ),
        expires_in_seconds=settings.upload_url_ttl_seconds,
        dropped=dropped,
    )


@router.delete("/{session_id}/frames/{index}", response_model=CreateSessionResponse)
def delete_frame(
    session_id: str,
    index: int,
    user: AuthUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
    store: Store = Depends(get_store),
) -> CreateSessionResponse:
    """Remove one photo before the session is measured (the check-in's Remove and Replace).
    Later frames move up one place; the answer carries fresh upload links for every frame."""
    uid = user.uid
    doc = _load(store, uid, session_id)
    if doc.get("sample_id") or doc["status"] not in ("uploading", "failed"):
        raise HTTPException(
            409, {"code": "conflict", "message": "photos can only be removed before measuring"}
        )
    uris = list(doc["frame_uris"])
    if not 1 <= index <= len(uris):
        raise HTTPException(404, {"code": "not_found", "message": "no such photo"})
    if len(uris) == 1:
        raise HTTPException(
            409, {"code": "last_frame", "message": "A check-in needs at least one photo."}
        )
    md5s, i = _aligned_md5s(doc), index - 1
    fields = {
        "frame_uris": uris[:i] + uris[i + 1 :],
        "content_types": doc["content_types"][:i] + doc["content_types"][i + 1 :],
        "frame_md5s": md5s[:i] + md5s[i + 1 :],
        "n_frames": len(uris) - 1,
        "frame_seq": max(doc.get("frame_seq") or 0, len(uris)),
    }
    store.session_update(uid, session_id, fields)
    _delete_quietly(uris[i])
    return CreateSessionResponse(
        session_id=session_id,
        upload_urls=_upload_targets({**doc, **fields}, settings.upload_url_ttl_seconds),
        expires_in_seconds=settings.upload_url_ttl_seconds,
    )


def _delete_quietly(uri: str) -> None:
    name = storage.name_from_uri(uri)
    if not name:
        return
    try:
        storage.delete_object(name)
    except Exception:  # an orphan photo goes with the 30-day lifecycle anyway
        log.warning("could not delete %s", name)


@router.post("/{session_id}/analyze")
def analyze_session(
    session_id: str,
    user: AuthUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
    store: Store = Depends(get_store),
    force: bool = Query(default=False),
) -> dict[str, Any]:
    started = time.monotonic()  # Cloud Run's 300 s count from about here (analysis.run)
    uid = user.uid
    doc = _load(store, uid, session_id)
    # A forced re-run of a measured session that fails leaves it as it was (still measured, on
    # the timeline): the old result is the person's, the failure is ours (as remeasure.py does).
    before = (
        {"status": "done", "error": doc.get("error"), "stage": None}
        if doc.get("status") == "done"
        else None
    )
    if before and not force:
        # Already measured (a reload, a second tab, a direct call): show it. Running again would
        # spend a daily analysis and could drop a baseline whose re-run fails the quality gate;
        # ?force=1 measures every frame again (a re-analyzed baseline rebuilds its baseline doc).
        return _detail_view(store, uid, session_id, doc)

    names = [storage.name_from_uri(uri) for uri in doc["frame_uris"]]
    with ThreadPoolExecutor(max_workers=max(1, min(8, len(names)))) as pool:
        infos = list(pool.map(storage.object_info, names))  # one metadata read per frame, at once
    missing = [i for i, info in enumerate(infos, start=1) if not info.exists or not info.size]
    if missing:
        raise HTTPException(
            409,
            {"code": "frames_missing", "message": f"frames not uploaded yet: {missing}"},
        )
    limits.take(store, uid, "analyze")
    # Atomic: of two tabs (or a reload) only one runs the engine; the other waits and reads.
    try:
        claimed = store.session_claim(uid, session_id, STALE_PROCESSING)
    except Exception as exc:  # deleted between the load and the claim ("delete my data")
        limits.refund(store, uid, "analyze")
        if store.session_get(uid, session_id) is None:
            raise _not_found() from exc
        raise
    if not claimed:
        limits.refund(store, uid, "analyze")
        raise HTTPException(409, {"code": "conflict", "message": "analysis already running"})

    try:
        doc = analysis.run(store, settings.bucket, uid, session_id, doc, started=started)
    except engine.EngineError as exc:
        limits.refund(store, uid, "analyze")  # our failure: it does not use up a daily analysis
        if before:
            store.session_update(uid, session_id, before)
        raise HTTPException(exc.status, {"code": exc.code, "message": exc.public_message}) from exc
    except analysis.SessionGone as exc:
        raise _not_found() from exc
    except Exception as exc:
        # Anything else (token minting, Firestore, a malformed engine answer): never leave the
        # session "processing" for minutes; mark it failed so "Try again" works at once.
        log.exception("analysis crashed for %s/%s", uid, session_id)
        current = store.session_get(uid, session_id) or {}
        if current.get("status") == "done":  # finished before the error: show the result
            return _detail_view(store, uid, session_id, current)
        limits.refund(store, uid, "analyze")
        try:
            store.session_update(
                uid,
                session_id,
                before
                or {
                    "status": "failed",
                    "error": {"code": "internal", "message": engine.GENERIC_MESSAGE},
                    "stage": None,
                },
            )
        except Exception:
            log.exception("could not mark %s/%s failed", uid, session_id)
        raise HTTPException(502, {"code": "internal", "message": engine.GENERIC_MESSAGE}) from exc
    return _detail_view(store, uid, session_id, doc)


def _detail_view(store: Store, uid: str, session_id: str, doc: dict) -> dict[str, Any]:
    result = measured_result(doc)
    crops = any(c.get("crop_uri") for c in (result or {}).get("candidates", []))
    # The person's own photos (frame_urls): only JPEG/HEIC, only those in the bucket.
    viewable = any(ct in views.VIEWABLE_FRAMES for ct in doc.get("content_types") or [])
    with ThreadPoolExecutor(max_workers=2) as pool:  # the two listings at once
        results_listed = (
            pool.submit(
                storage.list_names,
                views.results_prefix(uid, session_id),
                storage.DISPLAYABLE + (views.CROP_GLOBS if crops else ()),
            )
            if doc.get("result_json")
            else None
        )
        uploads_listed = (
            pool.submit(
                storage.list_names, views.uploads_prefix(uid, session_id), views.FRAME_GLOBS
            )
            if viewable
            else None
        )
        existing = results_listed.result() if results_listed else set()
        uploaded = uploads_listed.result() if uploads_listed else set()
    media = views.media_names(doc, uploaded, existing)
    wanted = views.wanted_urls(uid, session_id, doc, existing, with_overlays=True)
    signed = views.sign_all(wanted + views.media_urls(media))
    return views.session_view(
        uid,
        session_id,
        doc,
        baseline=baselines.get(store, uid, doc["site"], doc["capture_mode"]),
        signed=signed,
        media=media,
    )


@router.get("")
def list_sessions(
    site: Site | None = Query(default=None),
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Every session of a person (optionally one site), oldest first: the scrubber's ticks."""
    return {"sessions": list_views(store, user.uid, site)}


def list_views(store: Store, uid: str, site: str | None = None) -> list[dict[str, Any]]:
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
    return out


@router.get("/{session_id}")
def get_session(
    session_id: str,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    doc = _load(store, user.uid, session_id)
    return _detail_view(store, user.uid, session_id, doc)


@router.get("/{session_id}/story/{metric_id}")
def get_metric_story(
    session_id: str,
    metric_id: str,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """What changed for one metric since the previous check-in, in points, with the routine
    products aimed at it and up to two AI-suggested possible reasons (app/metric_story.py)."""
    if not re.fullmatch(r"[a-z_]{2,32}", metric_id):
        raise HTTPException(404, {"code": "not_found", "message": "metric not found"})
    doc = _load(store, user.uid, session_id)
    out = metric_story.story(store, user.uid, session_id, doc, metric_id)
    if out is None:
        raise HTTPException(404, {"code": "not_found", "message": "no reading for this metric"})
    return out


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
