from typing import Any

from fastapi import APIRouter, HTTPException

from app import retailer

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
