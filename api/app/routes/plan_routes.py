"""Consumer endpoints added for the finals (build-spec, owner A1): safety checks, the routine
plan, the evidence clock, reactions, store clicks and swaps. All computed in code; no Gemini."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field

from app import catalog, clicks, plan, reactions, regulatory, safety
from app.auth import AuthUser, current_user
from app.safety import SafetyProfile
from app.store import Store, get_store

router = APIRouter(prefix="/v1", tags=["safety", "plan"])


def _saved_safety(store: Store, uid: str) -> dict[str, Any] | None:
    return safety.profile_of(store.user_get(uid))


class SafetyCheckIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_ids: list[str] = Field(min_length=1, max_length=80)
    # a profile not saved yet (onboarding); null: the saved one
    safety: SafetyProfile | None = None


@router.post("/safety/check")
def safety_check(
    body: SafetyCheckIn,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Each product against the person's safety profile: status, flags with sources, and its
    regulatory class in their market. Unknown ids are listed, not checked."""
    profile = body.safety.model_dump() if body.safety else _saved_safety(store, user.uid)
    checks, unknown = {}, []
    for pid in dict.fromkeys(body.product_ids):
        product = catalog.by_id(pid)
        if product is None:
            unknown.append(pid)
            continue
        checks[pid] = safety.check(product, profile)
    return {
        "profile_complete": safety.is_complete(profile),
        "checks": checks,
        "unknown": unknown,
        "note": safety.LABELS_NOTE,
    }


@router.get("/evidence-clock")
def evidence_clock() -> dict[str, Any]:
    """Weeks to a first look and to a verdict per active, with sources (public, static)."""
    return plan.evidence_clock()


@router.post("/plan")
def make_plan(
    body: plan.PlanRequest,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """A first routine from the catalog (deterministic). 422 nothing_fits names the step that
    left a base slot empty."""
    profile = body.safety.model_dump() if body.safety else _saved_safety(store, user.uid)
    return plan.build(body, profile)


@router.post("/me/reactions")
def reaction_add(
    body: reactions.ReactionIn,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Log a reaction to a product; answers fixed next steps. Anything beyond mild puts the
    product on the person's avoid list."""
    known = catalog.by_id(body.product_id) is not None
    if not known and not (body.entry_id and store.routine_get(user.uid, body.entry_id)):
        raise HTTPException(404, {"code": "not_found", "message": "product not found"})
    return reactions.record(store, user.uid, body)


@router.get("/me/reactions")
def reaction_list(
    user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    return {"reactions": reactions.listing(store, user.uid), "keep": reactions.KEEP}


@router.post("/clicks", status_code=204)
def click_add(
    body: clicks.ClickIn,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> Response:
    """Count a tap on a store link. No uid is stored."""
    product = catalog.by_id(body.product_id)
    if product is None or not clicks.known_store(product, body.store):
        raise HTTPException(404, {"code": "not_found", "message": "product or store not found"})
    clicks.add(store, body)
    return Response(status_code=204)


@router.get("/retailer/clicks")
def retailer_clicks(
    days: int = Query(default=30, ge=1, le=365), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """Store clicks per product and store (public aggregate; groups under 10 show as "<10")."""
    return clicks.summary(store, days)


@router.get("/catalog/{product_id}/swaps")
def catalog_swaps(
    product_id: str,
    market: regulatory.Market | None = None,
    max: int = Query(default=5, ge=1, le=20),
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    product = catalog.by_id(product_id)
    if product is None:
        raise HTTPException(404, {"code": "not_found", "message": "product not found"})
    profile = _saved_safety(store, user.uid)
    market = market or (profile or {}).get("market")
    return {
        "product_id": product_id,
        "market": market,
        "items": plan.swaps(product, market, profile, max),
    }
