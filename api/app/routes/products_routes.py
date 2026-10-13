import secrets
from datetime import UTC, date, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app import advisor, catalog, gemini, label_scan, routine_check
from app.auth import AuthUser, current_user
from app.store import Store, get_store, iso

router = APIRouter(prefix="/v1", tags=["catalog", "label-scan", "routine"])

Concern = Literal[
    "acne_blemishes",
    "dark_spots_pigmentation",
    "uneven_tone",
    "redness_sensitivity",
    "texture_pores",
    "oiliness_shine",
    "fine_lines",
    "dark_circles",
    "dryness_barrier",
    "dullness",
]


@router.get("/catalog/search")
def catalog_search(
    q: str | None = Query(default=None, max_length=100),
    concern: Concern | None = None,
    category: str | None = None,
    max_price: float | None = Query(default=None, ge=0),
    currency: str | None = Query(default=None, max_length=3),
    limit: int = Query(default=8, ge=1, le=60),
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    return {"products": catalog.search(q, concern, category, max_price, currency, limit=limit)}


@router.get("/catalog/{product_id}")
def catalog_product(product_id: str, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    product = catalog.by_id(product_id)
    if product is None:
        raise HTTPException(404, {"code": "not_found", "message": "product not found"})
    return product


@router.post("/label-scan", response_model=label_scan.LabelScanResponse)
def post_label_scan(
    body: label_scan.LabelScanRequest, user: AuthUser = Depends(current_user)
) -> label_scan.LabelScanResponse:
    """Read a product label. Nothing is saved: the person confirms, then POSTs /v1/routine."""
    try:
        return label_scan.scan(body.images)
    except gemini.GeminiError as exc:
        raise HTTPException(
            502, {"code": "label_scan_failed", "message": "Could not read the label. Try again."}
        ) from exc


class KeyActive(BaseModel):
    name: str = Field(max_length=80)
    pct: float | None = Field(default=None, ge=0, le=100)


class RoutineEntryIn(BaseModel):
    product_id: str | None = None
    custom_name: str = Field(default="", max_length=120)
    brand: str = Field(default="", max_length=80)
    category: str = Field(default="other", max_length=40)
    inci: list[str] = Field(default_factory=list, max_length=120)
    key_actives: list[KeyActive] = Field(default_factory=list, max_length=20)
    concerns: list[Concern] = Field(default_factory=list)
    slots: list[Literal["am", "pm"]] = Field(default_factory=list)
    applied_sites: list[str] = Field(default_factory=list)
    started_at: date | None = None
    source: Literal["catalog", "label_scan", "manual"] = "manual"


class RoutineEntryPatch(BaseModel):
    ended_at: date | None = None
    slots: list[Literal["am", "pm"]] | None = None


def _entry_view(entry_id: str, doc: dict[str, Any]) -> dict[str, Any]:
    return {"id": entry_id, **{k: iso(v) if isinstance(v, datetime) else v for k, v in doc.items()}}


@router.get("/routine")
def routine_list(
    user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    entries = sorted(store.routine_list(user.uid), key=lambda e: e[1].get("started_at") or "")
    return {"entries": [_entry_view(eid, d) for eid, d in entries]}


@router.post("/routine")
def routine_add(
    body: RoutineEntryIn,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    entry_id, doc = add_routine_entry(store, user.uid, body)
    return _entry_view(entry_id, doc)


def add_routine_entry(store: Store, uid: str, body: RoutineEntryIn) -> tuple[str, dict[str, Any]]:
    doc = body.model_dump(mode="json")
    if body.product_id:
        product = catalog.by_id(body.product_id)
        if product is None:
            raise HTTPException(404, {"code": "not_found", "message": "product not found"})
        # Catalog facts win over anything typed or scanned for a catalog product.
        doc.update(
            custom_name=product["name"],
            brand=product["brand"],
            category=product["category"],
            inci=product["inci"],
            key_actives=product["key_actives"],
            concerns=product["concerns"],
        )
    elif not body.custom_name.strip():
        raise HTTPException(422, {"code": "bad_request", "message": "custom_name is required"})
    doc["started_at"] = doc["started_at"] or datetime.now(UTC).date().isoformat()
    doc["ended_at"] = None
    doc["created_at"] = datetime.now(UTC)
    entry_id = f"r_{secrets.token_hex(4)}"
    store.routine_set(uid, entry_id, doc)
    return entry_id, doc


@router.patch("/routine/{entry_id}")
def routine_patch(
    entry_id: str,
    body: RoutineEntryPatch,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Stop a product (ended_at) or move it between AM and PM. History is kept for the charts."""
    doc = store.routine_get(user.uid, entry_id)
    if doc is None:
        raise HTTPException(404, {"code": "not_found", "message": "routine entry not found"})
    doc.update(body.model_dump(mode="json", exclude_unset=True))
    store.routine_set(user.uid, entry_id, doc)
    return _entry_view(entry_id, doc)


@router.delete("/routine/{entry_id}", status_code=204)
def routine_delete(
    entry_id: str,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> Response:
    """Remove an entry added by mistake. To stop using a product, PATCH ended_at instead."""
    store.routine_delete(user.uid, entry_id)
    return Response(status_code=204)


@router.post("/routine/check")
def routine_check_route(
    user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """Rule table first (always), then Gemini additions marked source=model."""
    entries = [{"id": eid, **e} for eid, e in store.routine_list(user.uid)]
    return routine_check.check(entries)


class ChatMessage(BaseModel):
    role: Literal["user", "willow"]
    text: str = Field(min_length=1, max_length=1000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=20)


@router.post("/advisor/chat")
def advisor_chat(
    body: ChatRequest,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    if body.messages[-1].role != "user":
        raise HTTPException(422, {"code": "bad_request", "message": "last message must be yours"})
    used = store.usage_incr(user.uid, datetime.now(UTC).date().isoformat(), "advisor")
    if used > advisor.DAILY_LIMIT:
        raise HTTPException(
            429, {"code": "daily_limit", "message": "That is 20 questions for today."}
        )
    try:
        reply = advisor.chat([m.model_dump() for m in body.messages], store, user.uid)
    except Exception as exc:  # Vertex unavailable, quota, safety block
        raise HTTPException(
            502, {"code": "advisor_unavailable", "message": "The advisor is unavailable right now."}
        ) from exc
    return {**reply, "remaining_today": max(0, advisor.DAILY_LIMIT - used)}
