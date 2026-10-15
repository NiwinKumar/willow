"""Check-in reminders: calendar file, Web Push subscriptions, and the Cloud Scheduler run.

The schedule itself is `users/{uid}.profile.checkin`, written by PUT /v1/me/profile.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field

from app import reminders
from app.auth import AuthUser, current_user
from app.settings import Settings, get_settings
from app.store import Store, get_store

router = APIRouter(prefix="/v1", tags=["reminders"])
log = logging.getLogger("willow.reminders")


def _checkin(store: Store, uid: str) -> reminders.Checkin | None:
    return reminders.checkin_of((store.user_get(uid) or {}).get("profile"))


@router.get("/me/reminder.ics")
def reminder_ics(
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
    settings: Settings = Depends(get_settings),
) -> Response:
    """The check-in schedule as one repeating calendar event with an alert, for any calendar."""
    c = _checkin(store, user.uid)
    if c is None:
        raise HTTPException(404, {"code": "not_found", "message": "No check-in days set yet."})
    return Response(
        content=reminders.calendar(c, user.uid, settings.app_url),
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="willow-check-in.ics"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/me/push/key")
def push_key(
    _: AuthUser = Depends(current_user), settings: Settings = Depends(get_settings)
) -> dict[str, Any]:
    """The VAPID public key the browser subscribes with; enabled false = calendar reminders only."""
    on = reminders.push_enabled(settings)
    return {"enabled": on, "public_key": settings.vapid_public_key if on else None}


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=16, max_length=200)
    auth: str = Field(min_length=8, max_length=100)


class PushSubscriptionBody(BaseModel):
    """A browser PushSubscription, as `subscription.toJSON()` gives it."""

    endpoint: str = Field(max_length=1000)
    keys: PushKeys
    expirationTime: int | None = None  # noqa: N815 (the browser's own field name)


class PushEndpointBody(BaseModel):
    endpoint: str = Field(max_length=1000)


def _require_push(settings: Settings) -> None:
    if not reminders.push_enabled(settings):
        raise HTTPException(
            503,
            {
                "code": "push_unavailable",
                "message": "Notifications aren't set up yet. Use the calendar.",
            },
        )


@router.post("/me/push")
def push_subscribe(
    body: PushSubscriptionBody,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Keep this device's push subscription (users/{uid}/push/{hash of endpoint}); idempotent."""
    _require_push(settings)
    if not reminders.allowed_endpoint(body.endpoint):
        raise HTTPException(
            422,
            {"code": "bad_request", "message": "Not a browser push address.", "field": "endpoint"},
        )
    sub_id = reminders.subscription_id(body.endpoint)
    now = datetime.now(UTC)
    previous = dict(store.push_list(user.uid)).get(sub_id) or {}
    store.push_set(
        user.uid,
        sub_id,
        {
            "endpoint": body.endpoint,
            "keys": body.keys.model_dump(),
            "created_at": previous.get("created_at") or now,
            "updated_at": now,
        },
    )
    return {"id": sub_id, "enabled": True}


@router.delete("/me/push", status_code=204)
def push_unsubscribe(
    body: PushEndpointBody | None = Body(default=None),
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> Response:
    """Forget this device's subscription; with no body, every device's."""
    if body is not None:
        store.push_delete(user.uid, reminders.subscription_id(body.endpoint))
    else:
        for sub_id, _ in store.push_list(user.uid):
            store.push_delete(user.uid, sub_id)
    return Response(status_code=204)


def _deliver(store: Store, uid: str, message: dict[str, str], settings: Settings) -> dict[str, int]:
    sent = removed = failed = 0
    for sub_id, sub in store.push_list(uid):
        status = reminders.send_push(sub, message, settings)
        if 200 <= status < 300:
            sent += 1
        elif reminders.gone(status):
            store.push_delete(uid, sub_id)
            removed += 1
        else:
            failed += 1
    return {"sent": sent, "removed": removed, "failed": failed}


@router.post("/me/push/test")
def push_test(
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
    settings: Settings = Depends(get_settings),
) -> dict[str, int]:
    """Send a test notification to every device this person turned reminders on for."""
    _require_push(settings)
    day = datetime.now(UTC).date().isoformat()
    if store.usage_incr(user.uid, day, "push_test") > reminders.TEST_CAP_PER_DAY:
        raise HTTPException(
            429, {"code": "daily_limit", "message": "That is enough test notifications for today."}
        )
    return _deliver(store, user.uid, reminders.payload("test"), settings)


def _scheduler(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    """Only Cloud Scheduler's own OIDC token (audience and service account checked) may run this."""
    if settings.auth_mode == "dev":
        return
    if not settings.reminders_audience:
        raise HTTPException(
            503, {"code": "unavailable", "message": "Reminder runs are not configured."}
        )
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, {"code": "unauthenticated", "message": "Bearer token required"})
    from google.auth.transport import requests as g_requests
    from google.oauth2 import id_token

    try:
        claims = id_token.verify_oauth2_token(
            authorization.split(" ", 1)[1].strip(),
            g_requests.Request(),
            audience=settings.reminders_audience,
        )
    except Exception as exc:  # expired, wrong audience, malformed
        raise HTTPException(401, {"code": "unauthenticated", "message": "Invalid token"}) from exc
    if claims.get("email") != settings.scheduler_service_account or not claims.get(
        "email_verified"
    ):
        raise HTTPException(403, {"code": "forbidden", "message": "Not the reminder scheduler"})


@router.post("/internal/reminders", dependencies=[Depends(_scheduler)])
def run_reminders(
    store: Store = Depends(get_store),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Cloud Scheduler, every 15 minutes: one push to each person whose check-in time has just
    come on a scheduled day and who has not checked in yet that (local) day. At most one per day."""
    if not reminders.push_enabled(settings):
        return {"enabled": False, "due": 0, "sent": 0, "skipped": 0, "removed": 0, "failed": 0}
    now = datetime.now(UTC)
    window = timedelta(minutes=settings.reminder_window_minutes)
    totals = {"due": 0, "sent": 0, "skipped": 0, "removed": 0, "failed": 0}
    for uid, doc in store.users_list():
        c = reminders.checkin_of(doc.get("profile"))
        day = reminders.due_day(c, now, window) if c else None
        if c is None or day is None:
            continue
        totals["due"] += 1
        if not store.push_list(uid) or reminders.checked_in_on(store.sessions_list(uid), c.tz, day):
            totals["skipped"] += 1
            continue
        if not store.reminder_claim(uid, day.isoformat(), {"day": day.isoformat(), "at": now}):
            totals["skipped"] += 1  # already reminded today
            continue
        result = _deliver(store, uid, reminders.payload("checkin"), settings)
        for k, v in result.items():
            totals[k] += v
    log.info("reminders run: %s", totals)
    return {"enabled": True, **totals}
