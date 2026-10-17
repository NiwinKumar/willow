"""Proof-gated promotion: retailer campaigns and the consumer's sponsored card (app/campaigns.py).
Sign-in required on every route (guest accounts included)."""

import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app import campaigns, catalog, limits
from app.auth import AuthUser, current_user
from app.routes.me_routes import Goal
from app.store import Store, get_store, iso

router = APIRouter(prefix="/v1", tags=["campaigns"])

SkinType = Literal["oily", "combination", "dry", "normal", "sensitive"]
CAMPAIGN_ID = re.compile(r"^c_[0-9a-f]{12}$")


@router.get("/retailer/eligibility")
def eligibility(user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    """Every catalog product with its Proof tier and whether it can be promoted (cohort=mixed,
    range=all: the evidence a consumer would see)."""
    try:
        return {"products": campaigns.eligibility_all()}
    except campaigns.Unavailable as exc:
        raise campaigns.unavailable() from exc


class CampaignCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: str = Field(min_length=1, max_length=80)
    workspace: str = Field(min_length=1, max_length=80)  # 'retailer' or a catalog brand
    goals: list[Goal] = Field(min_length=1, max_length=8)
    skin_types: list[SkinType] = Field(
        default_factory=list, max_length=5
    )  # [] = every eligible skin type
    days: Literal[7, 14, 30]
    placement: Literal["routine"] = "routine"
    # randomised holdout share (null: campaigns.HOLDOUT_PCT, 0.2)
    holdout_pct: float | None = Field(default=None, ge=0.1, le=0.5)

    @field_validator("goals", "skin_types")
    @classmethod
    def _unique(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(v))


def _owned(store: Store, uid: str, cid: str) -> dict[str, Any]:
    """The campaign, if this person owns it (anyone else gets the same 404 as a missing one)."""
    doc = store.campaign_get(cid) if CAMPAIGN_ID.match(cid) else None
    if doc is None or doc.get("owner_uid") != uid:
        raise HTTPException(404, {"code": "not_found", "message": "campaign not found"})
    return doc


def _not_eligible(reasons: list[str]) -> HTTPException:
    return HTTPException(
        422,
        {
            "code": "not_eligible",
            "message": "This product can't be promoted with these settings.",
            "reasons": reasons,
        },
    )


@router.post("/retailer/campaigns", status_code=201)
def create_campaign(
    body: CampaignCreate,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Proven products only, goals within the evidence, a brand only its own products; at most
    3 running per owner (429)."""
    product = catalog.by_id(body.product_id)
    if product is None:
        raise HTTPException(404, {"code": "not_found", "message": "product not found"})
    if body.workspace not in campaigns.workspaces():
        raise HTTPException(
            422,
            {"code": "bad_request", "message": "Unknown workspace.", "field": "workspace"},
        )
    try:
        reasons = campaigns.check(product, body.workspace, list(body.goals), list(body.skin_types))
    except campaigns.Unavailable as exc:
        raise campaigns.unavailable() from exc
    if reasons:
        raise _not_eligible(reasons)
    if campaigns.active_count(store, user.uid) >= campaigns.MAX_ACTIVE:
        raise campaigns.too_many()
    limits.take(store, user.uid, "campaign_create")
    cid, doc = campaigns.create(
        store,
        user.uid,
        product,
        body.workspace,
        list(body.goals),
        list(body.skin_types),
        body.days,
        body.holdout_pct,
    )
    return campaigns.view(store, cid, doc)


@router.get("/retailer/campaigns")
def list_campaigns(
    user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """This person's campaigns, newest first, each with its live stats."""
    rows = sorted(
        store.campaigns_of(user.uid),
        key=lambda c: iso(c[1].get("created_at")) or "",
        reverse=True,
    )
    return {"campaigns": [campaigns.view(store, cid, d) for cid, d in rows]}


class CampaignPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # ended: stop early, for good (ends_at moves to now; it cannot be resumed)
    status: Literal["active", "paused", "ended"]


@router.patch("/retailer/campaigns/{cid}")
def patch_campaign(
    cid: str,
    body: CampaignPatch,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Pause, resume or end early (owner only). Resuming checks the evidence and the running cap
    again; ending is final."""
    doc = _owned(store, user.uid, cid)
    if campaigns.status_of(doc) == "ended":
        raise HTTPException(409, {"code": "ended", "message": "This campaign has ended."})
    if body.status == "ended":
        return campaigns.view(store, cid, campaigns.end(store, cid, doc))
    if body.status == "active" and doc.get("status") != "active":
        product = catalog.by_id(doc["product_id"])
        try:
            reasons = (
                campaigns.check(
                    product,
                    doc["workspace"],
                    list(doc.get("goals") or []),
                    list(doc.get("skin_types") or []),
                )
                if product
                else ["This product is no longer in the catalog."]
            )
        except campaigns.Unavailable as exc:
            raise campaigns.unavailable() from exc
        if reasons:
            raise _not_eligible(reasons)
        if campaigns.active_count(store, user.uid, exclude=cid) >= campaigns.MAX_ACTIVE:
            raise campaigns.too_many()
    fields = {"status": body.status, "updated_at": campaigns.now()}
    store.campaign_update(cid, fields)
    return campaigns.view(store, cid, doc | fields)


@router.delete("/retailer/campaigns/{cid}", status_code=204)
def delete_campaign(
    cid: str, user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> Response:
    """Remove a campaign and its stats (owner only)."""
    _owned(store, user.uid, cid)
    store.campaign_delete(cid)
    return Response(status_code=204)


@router.get("/sponsored")
def sponsored(
    placement: Literal["routine"] = Query("routine"),
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """At most one sponsored product for this person today, or null."""
    return {"item": campaigns.sponsored(store, user.uid)}


class SponsoredEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["impression", "click", "add"]


@router.post("/sponsored/{cid}/events", status_code=204)
def sponsored_event(
    cid: str,
    body: SponsoredEvent,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> Response:
    """Impressions, clicks and adds; each person counts once a day for each kind."""
    if not CAMPAIGN_ID.match(cid):
        raise HTTPException(404, {"code": "not_found", "message": "campaign not found"})
    limits.take(store, user.uid, "sponsored_event")
    campaigns.record(store, user.uid, cid, body.kind)
    return Response(status_code=204)
