"""POST /v1/waitlist: an email for early access, from the public /waitlist page. No sign-in."""

import hashlib
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app import survey
from app.routes.survey_routes import _address
from app.store import Store, get_store

router = APIRouter(prefix="/v1", tags=["waitlist"])


class WaitlistIn(BaseModel):
    email: str = Field(max_length=254)
    source: str = Field(default="direct", max_length=32, pattern=r"^[a-z0-9_-]*$")
    # A field people never see; anything in it came from a bot filling every input.
    website: str = Field(default="", max_length=200)


@router.post("/waitlist", status_code=201)
def join(body: WaitlistIn, request: Request, store: Store = Depends(get_store)) -> dict[str, Any]:
    if body.website:
        return {"ok": True}  # quietly dropped: a bot should not learn what gave it away
    email = body.email.strip().lower()
    if not survey.valid_email(email):
        raise HTTPException(422, {"code": "bad_email", "message": "Check the email address."})
    # One document per address, keyed by its hash, so joining twice is harmless and says so.
    key = hashlib.sha256(email.encode()).hexdigest()[:32]
    if store.waitlist_get(key) is not None:
        return {"ok": True, "already": True}
    if survey.over_limit(_address(request)):
        raise HTTPException(429, {"code": "daily_limit", "message": "Too many tries today."})
    store.waitlist_set(
        key,
        {"email": email, "source": body.source or "direct", "created_at": datetime.now(UTC)},
    )
    return {"ok": True, "already": False}
