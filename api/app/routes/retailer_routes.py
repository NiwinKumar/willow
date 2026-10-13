from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import retailer, retailer_ask
from app.auth import AuthUser, current_user
from app.store import Store, get_store

router = APIRouter(prefix="/v1/retailer", tags=["retailer"])


@router.get("/insights")
def insights() -> dict[str, Any]:
    """Aggregates only (groups under 10 suppressed), synthetic rows labelled: no sign-in needed."""
    try:
        return retailer.insights()
    except Exception as exc:  # BigQuery unavailable
        raise HTTPException(
            503, {"code": "insights_unavailable", "message": "Insights are unavailable right now."}
        ) from exc


class AskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=300)


@router.post("/ask")
def ask(
    body: AskRequest, user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """Gemini answers from the same aggregates as /insights; every number is checked."""
    used = store.usage_incr(user.uid, datetime.now(UTC).date().isoformat(), "retailer_ask")
    if used > retailer_ask.DAILY_LIMIT:
        raise HTTPException(
            429, {"code": "daily_limit", "message": "That is 20 questions for today."}
        )
    try:
        data = retailer.insights()
    except Exception as exc:
        raise HTTPException(
            503, {"code": "insights_unavailable", "message": "Insights are unavailable right now."}
        ) from exc
    return retailer_ask.ask(body.question, data)
