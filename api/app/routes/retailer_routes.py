from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app import limits, retailer, retailer_ask
from app.auth import AuthUser, current_user
from app.store import Store, get_store

router = APIRouter(prefix="/v1/retailer", tags=["retailer"])


@router.get("/insights")
def insights(
    cohort: retailer.Cohort = Query("mixed", description="simulated | mixed | real"),
    range_: retailer.Range = Query("all", alias="range", description="30d | 90d | all"),
) -> dict[str, Any]:
    """Aggregates only (groups under 10 suppressed), synthetic rows labelled: no sign-in needed.
    Defaults (every row, all time) are what the page showed before the filters existed."""
    try:
        return retailer.insights(cohort, range_)
    except Exception as exc:  # BigQuery unavailable
        raise HTTPException(
            503, {"code": "insights_unavailable", "message": "Insights are unavailable right now."}
        ) from exc


class AskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=300)
    # The filters on screen, so the answer uses the same aggregates the page shows.
    cohort: retailer.Cohort = "mixed"
    range: retailer.Range = "all"


@router.post("/ask")
def ask(
    body: AskRequest, user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """Gemini answers from the same aggregates as /insights; every number is checked."""
    limits.take(store, user.uid, "retailer_ask")
    try:
        data = retailer.insights(body.cohort, body.range)
    except Exception as exc:
        limits.refund(store, user.uid, "retailer_ask")
        raise HTTPException(
            503, {"code": "insights_unavailable", "message": "Insights are unavailable right now."}
        ) from exc
    try:
        return retailer_ask.ask(body.question, data)
    except retailer_ask.Unavailable as exc:
        limits.refund(store, user.uid, "retailer_ask")
        raise HTTPException(
            503,
            {
                "code": "assistant_unavailable",
                "message": "The assistant is unavailable right now. Try again in a minute.",
            },
        ) from exc
