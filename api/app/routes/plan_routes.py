"""Consumer endpoints added for the finals (build-spec): safety checks, the routine plan, the
evidence clock, reactions, store clicks and swaps, all computed in code; and the one Gemini
reader here, the past-reactions note (app/safety_note.py), which only suggests."""

import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field

from app import (
    catalog,
    clicks,
    limits,
    plan,
    reactions,
    regulatory,
    routine_check,
    safety,
    safety_note,
)
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


@router.get("/safety/rules")
def safety_rules() -> dict[str, Any]:
    """The rule file as families with their sources and evidence grades (public; for /checks).
    No person data: who a family applies to is said in words."""
    families = safety.rule_families()
    return {
        "families": families,
        "rules": sum(len(f["rules"]) for f in families),
        "personal": [
            {
                "id": "avoid_ingredient",
                "label": "Ingredients you've reacted to",
                "applies": "Names you add under “Anything you've reacted to before?”",
                "level": "avoid",
            },
            {
                "id": "avoid_product",
                "label": "Products on your avoid list",
                "applies": "Added after a reaction, or by hand",
                "level": "avoid",
            },
        ],
        "note": safety.LABELS_NOTE,
    }


@router.get("/safety/ingredients")
def safety_ingredients() -> dict[str, Any]:
    """Every ingredient name on a catalog label or in the rule file (the "reacted to" typeahead)."""
    return {"names": list(safety.vocabulary())}


@router.post("/safety/note/read")
def safety_note_read(
    body: safety_note.NoteIn,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Suggestions from the person's note (nothing saved, nothing applied). Counts on the label
    scan cap; past it, or when Gemini fails, the keyword reading answers (and costs nothing)."""
    try:
        limits.take(store, user.uid, "label_scan")
    except HTTPException:
        return safety_note.read(body.note, use_model=False)
    out = safety_note.read(body.note)
    if out.pop("model_failed", False):
        limits.refund(store, user.uid, "label_scan")
    return out


class PreviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: str = Field(min_length=1, max_length=120)
    slots: list[Literal["am", "pm"]] = Field(default_factory=lambda: ["am", "pm"], min_length=1)


PROPOSED = "_proposed"
NOTE_CHECKED = "Checked by fixed rules, not by AI."
NOTE_NO_LABEL = "Its ingredient list isn't in Willow yet, so it can't be checked with your routine."


def _active_key(name: str) -> str:
    """ "Niacinamide 10%" and "niacinamide (vitamin B3)" are the same active."""
    return " ".join(re.sub(r"\([^)]*\)|\d+(?:\.\d+)?\s*%", " ", name.lower()).split())


@router.post("/routine/check/preview")
def routine_check_preview(
    body: PreviewIn,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """In-aisle check: what adding this product would newly bring to the person's routine, by the
    rule table only (no Gemini, no cap): clashes and gaps that appear only with it, and the key
    actives the routine already has. Nothing is saved. A product whose ingredient list Willow
    does not have yet (an index product) answers `checked: false`: no clash found is not "no
    clash"."""
    product = catalog.by_id(body.product_id)
    if product is None:
        raise HTTPException(404, {"code": "not_found", "message": "product not found"})
    entries = [{"id": eid, **e} for eid, e in store.routine_list(user.uid)]
    active = [e for e in entries if not e.get("ended_at")]
    profile = safety.profile_of(store.user_get(user.uid))
    in_routine = any(e.get("product_id") == body.product_id for e in active)
    proposed = {
        "id": PROPOSED,
        "product_id": product["product_id"],
        "custom_name": product["name"],
        "brand": product["brand"],
        "category": product["category"],
        "inci": product["inci"],
        "key_actives": product["key_actives"],
        "slots": body.slots,
    }
    names = {e["id"]: f"{e.get('brand', '')} {e.get('custom_name', '')}".strip() for e in active}
    before = routine_check.findings_for(entries, profile)
    after = routine_check.findings_for(entries + [proposed], profile)
    clashes = [
        {
            "issue": c["issue"],
            "suggestion": c["suggestion"],
            "severity": c["severity"],
            "with": [names[i] for i in c["products"] if i != PROPOSED and i in names],
        }
        for c in after["conflicts"]
        if PROPOSED in c["products"]
    ]
    gaps = [g for g in after["gaps"] if g not in before["gaps"]]
    # the same key active already in use: by name, and by class (any retinoid is a retinoid)
    already: dict[str, set[str]] = {}
    mine = {_active_key(a["name"]) for a in product["key_actives"]}
    for d in after["duplicates"]:
        if PROPOSED in d["products"]:
            others = [names[i] for i in d["products"] if i != PROPOSED and i in names]
            if others:
                already.setdefault(d["active"], set()).update(others)
    for e in active:
        if e.get("product_id") == body.product_id:
            continue
        for a in e.get("key_actives") or []:
            key = _active_key(a["name"])
            if key in mine and not any(names[e["id"]] in v for v in already.values()):
                already.setdefault(key, set()).add(names[e["id"]])
    return {
        "product_id": body.product_id,
        "in_routine": in_routine,
        "routine_size": len(active),
        "clashes": [] if in_routine else clashes,
        "gaps": [] if in_routine else gaps,
        "already_use": []
        if in_routine
        else [{"active": k, "products": sorted(v)} for k, v in already.items()],
        "checked": safety.has_label(product),
        "note": NOTE_CHECKED if safety.has_label(product) else NOTE_NO_LABEL,
    }
