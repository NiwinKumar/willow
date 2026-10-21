"""POST /v1/survey: the public validation survey (docs/SURVEY.md). No sign-in."""

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app import survey, survey_sheet
from app.store import Store, get_store

router = APIRouter(prefix="/v1", tags=["survey"])


class SurveyIn(BaseModel):
    version: Literal["v1"]
    answers: dict[str, str | list[str]] = Field(max_length=40)
    screened_out: Literal["no_routine"] | None = None
    email: str | None = Field(default=None, max_length=254)
    email_consent: bool = False
    source: str = Field(default="direct", max_length=32, pattern=r"^[a-z0-9_-]*$")
    duration_s: int = Field(ge=0, le=86_400)
    # A field people never see; anything in it came from a bot filling every input.
    website: str = Field(default="", max_length=200)


def _address(request: Request) -> str:
    # Cloud Run appends the caller's address to X-Forwarded-For; anything before it came from the
    # caller and can be made up, so the last entry is the one to count.
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


@router.post("/survey", status_code=201)
def submit(body: SurveyIn, request: Request, store: Store = Depends(get_store)) -> dict[str, Any]:
    if body.website:
        return {"ok": True}  # quietly dropped: a bot should not learn what gave it away
    try:
        answers = survey.clean(body.answers)
    except survey.Invalid as exc:
        raise HTTPException(422, {"code": "bad_answer", "message": str(exc)}) from exc
    if answers.get("age") == "under_18":
        # Under-18s are thanked and nothing they answered is kept (the page never sends it).
        raise HTTPException(422, {"code": "under_18", "message": "The survey is for adults."})
    email = (body.email or "").strip().lower() or None
    if email and not (body.email_consent and survey.valid_email(email)):
        raise HTTPException(
            422, {"code": "bad_email", "message": "Check the email address and the consent box."}
        )
    if survey.over_limit(_address(request)):
        raise HTTPException(
            429, {"code": "daily_limit", "message": "Thanks, we already have your answers."}
        )
    rid, doc, contact = survey.save(
        store,
        answers=answers,
        source=body.source or "direct",
        duration_s=body.duration_s,
        screened_out=body.screened_out,
        email=email,
    )
    if survey_sheet.copy(rid, doc, contact):
        store.survey_response_update(rid, {"sheet_synced": True})
    return {"ok": True, "id": rid}
