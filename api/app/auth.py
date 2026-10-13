"""Firebase ID token verification as a FastAPI dependency."""

from dataclasses import dataclass

import firebase_admin
from fastapi import Depends, Header, HTTPException, Request
from firebase_admin import auth as fb_auth

from app.settings import Settings, get_settings


@dataclass(frozen=True)
class AuthUser:
    uid: str
    is_anonymous: bool


def _firebase_app(settings: Settings) -> firebase_admin.App:
    try:
        return firebase_admin.get_app()
    except ValueError:
        return firebase_admin.initialize_app(options={"projectId": settings.project_id})


def current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> AuthUser:
    if settings.auth_mode == "dev":
        uid = request.headers.get("x-dev-uid")
        if not uid:
            raise HTTPException(401, {"code": "unauthenticated", "message": "X-Dev-Uid missing"})
        return AuthUser(uid=uid, is_anonymous=False)

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, {"code": "unauthenticated", "message": "Bearer token required"})
    token = authorization.split(" ", 1)[1].strip()
    try:
        claims = fb_auth.verify_id_token(token, app=_firebase_app(settings))
    except Exception as exc:  # expired, revoked, malformed
        raise HTTPException(
            401, {"code": "unauthenticated", "message": "Invalid ID token"}
        ) from exc
    provider = (claims.get("firebase") or {}).get("sign_in_provider", "")
    return AuthUser(uid=claims["uid"], is_anonymous=provider == "anonymous")
