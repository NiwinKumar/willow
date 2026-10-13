from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import limits, retailer, retailer_ask
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
    limits.take(store, user.uid, "retailer_ask")
    try:
        data = retailer.insights()
    except Exception as exc:
        raise HTTPException(
            503, {"code": "insights_unavailable", "message": "Insights are unavailable right now."}
        ) from exc
    return retailer_ask.ask(body.question, data)
