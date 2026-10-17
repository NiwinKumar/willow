from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app import limits, proof_ai, retail_intel, retailer, retailer_ask
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
        data = {**data, "perception": proof_ai.perception_rows(body.cohort, body.range)}
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


# ── Willow Proof views (docs/RETAILER_INSIGHTS.md "Willow Proof views") ─────────────────────
# Public like /insights (aggregates only, groups under 10 suppressed in retail_intel), same
# filters, 503 when the rows are unavailable, 404 for an unknown product or brand.

UNAVAILABLE = {"code": "insights_unavailable", "message": "Insights are unavailable right now."}


def _proof(build, *args: Any) -> Any:
    try:
        return build(*args)
    except Exception as exc:  # BigQuery unavailable
        raise HTTPException(503, UNAVAILABLE) from exc


@router.get("/products")
def proof_products(
    cohort: retailer.Cohort = Query("mixed", description="simulated | mixed | real"),
    range_: retailer.Range = Query("all", alias="range", description="30d | 90d | all"),
) -> dict[str, Any]:
    """Every catalog product with its Proof tier, rate, lift and CIs."""
    return _proof(retail_intel.products, cohort, range_)


@router.get("/products/{product_id}")
def proof_product(
    product_id: str,
    cohort: retailer.Cohort = Query("mixed", description="simulated | mixed | real"),
    range_: retailer.Range = Query("all", alias="range", description="30d | 90d | all"),
) -> dict[str, Any]:
    """One product: curve, segments, competitors, co-use, switching, evidence, eligibility."""
    out = _proof(retail_intel.product, product_id, cohort, range_)
    if out is None:
        raise HTTPException(404, {"code": "unknown_product", "message": "No such product."})
    return out


@router.get("/segments")
def proof_segments(
    cohort: retailer.Cohort = Query("mixed", description="simulated | mixed | real"),
    range_: retailer.Range = Query("all", alias="range", description="30d | 90d | all"),
) -> dict[str, Any]:
    """Skin type x goal: demand, unmet share, best products."""
    return _proof(retail_intel.segments, cohort, range_)


@router.get("/brands")
def proof_brands(
    cohort: retailer.Cohort = Query("mixed", description="simulated | mixed | real"),
    range_: retailer.Range = Query("all", alias="range", description="30d | 90d | all"),
) -> dict[str, Any]:
    """Every catalog brand: users, outcome rate with CI, continuation, share of routines."""
    return _proof(retail_intel.brands_list, cohort, range_)


@router.get("/brands/{brand}")
def proof_brand(
    brand: str,
    cohort: retailer.Cohort = Query("mixed", description="simulated | mixed | real"),
    range_: retailer.Range = Query("all", alias="range", description="30d | 90d | all"),
) -> dict[str, Any]:
    """One brand against the market: goals, share, switching, positioning, skin types."""
    out = _proof(retail_intel.brand, brand, cohort, range_)
    if out is None:
        raise HTTPException(404, {"code": "unknown_brand", "message": "No such brand."})
    return out


@router.get("/brief")
def proof_brief(
    cohort: retailer.Cohort = Query("mixed", description="simulated | mixed | real"),
    range_: retailer.Range = Query("all", alias="range", description="30d | 90d | all"),
    brand: str | None = Query(None, max_length=80, description="a catalog brand (optional)"),
) -> dict[str, Any]:
    """Deterministic insight cards plus a validated Gemini summary (null if unavailable)."""
    out = _proof(retail_intel.brief, cohort, range_, brand or None)
    if out is None:
        raise HTTPException(404, {"code": "unknown_brand", "message": "No such brand."})
    return out


# ── AI in Willow Proof (app/proof_ai.py) ───────────────────────────────────────────────────


def _view(product_id: str, cohort: str, range_: str) -> dict[str, Any]:
    out = _proof(retail_intel.product, product_id, cohort, range_)
    if out is None:
        raise HTTPException(404, {"code": "unknown_product", "message": "No such product."})
    return out


@router.get("/products/{product_id}/actions")
def proof_actions(
    product_id: str,
    cohort: retailer.Cohort = Query("mixed", description="simulated | mixed | real"),
    range_: retailer.Range = Query("all", alias="range", description="30d | 90d | all"),
) -> dict[str, Any]:
    """The three next steps for this product, from the facts on its page (Gemini picks and
    explains; the fixed priority without it)."""
    view = _view(product_id, cohort, range_)
    return proof_ai.actions(view, (product_id, cohort, range_))


class ClaimsRequest(BaseModel):
    channel: proof_ai.Channel = "pdp"
    cohort: retailer.Cohort = "mixed"
    range: retailer.Range = "all"


@router.post("/products/{product_id}/claims")
def proof_claims(
    product_id: str,
    body: ClaimsRequest,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Claim drafts for one channel, each citing the evidence statements it rests on and checked
    (numbers, overclaims, self-reported wording). Sign-in and a daily cap: it calls Gemini."""
    view = _view(product_id, body.cohort, body.range)
    limits.take(store, user.uid, "proof_claims")
    out = proof_ai.claims(view, body.channel)
    if out["source"] != "gemini":
        limits.refund(store, user.uid, "proof_claims")
    return out
