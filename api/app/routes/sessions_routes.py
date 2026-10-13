from fastapi import APIRouter, Depends, HTTPException

from app import sessions, storage
from app.auth import AuthUser, current_user
from app.models import (
    CONTENT_TYPES,
    CreateSessionRequest,
    CreateSessionResponse,
    ObjectStatus,
    SessionObjectsResponse,
    UploadTarget,
)
from app.settings import Settings, get_settings

router = APIRouter(prefix="/v1/sessions", tags=["sessions"])


@router.post("", response_model=CreateSessionResponse)
def create_session(
    body: CreateSessionRequest,
    user: AuthUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> CreateSessionResponse:
    session_id = sessions.new_session_id()
    ext_for = CONTENT_TYPES[body.capture_mode]
    targets: list[UploadTarget] = []
    frame_uris: list[str] = []
    for i, content_type in enumerate(body.content_types, start=1):
        name = sessions.frame_object_name(user.uid, session_id, i, ext_for[content_type])
        url = storage.signed_put_url(name, content_type, settings.upload_url_ttl_seconds)
        uri = storage.object_uri(name)
        frame_uris.append(uri)
        targets.append(
            UploadTarget(index=i, object_uri=uri, url=url, headers={"Content-Type": content_type})
        )
    sessions.create(
        user.uid,
        session_id,
        {
            "site": body.site,
            "capture_mode": body.capture_mode,
            "n_frames": body.n_frames,
            "frame_uris": frame_uris,
            "content_types": body.content_types,
        },
    )
    return CreateSessionResponse(
        session_id=session_id,
        upload_urls=targets,
        expires_in_seconds=settings.upload_url_ttl_seconds,
    )


@router.get("/{session_id}/objects", response_model=SessionObjectsResponse)
def session_objects(
    session_id: str,
    user: AuthUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> SessionObjectsResponse:
    """Size and MD5 of each uploaded frame, straight from GCS metadata (byte-identity check)."""
    doc = sessions.get(user.uid, session_id)
    if doc is None:
        raise HTTPException(404, {"code": "not_found", "message": "session not found"})
    prefix = f"gs://{settings.bucket}/"
    objects: list[ObjectStatus] = []
    for i, uri in enumerate(doc.get("frame_uris", []), start=1):
        info = storage.object_info(uri.removeprefix(prefix))
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
