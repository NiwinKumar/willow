import re
import secrets
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator

from app import advisor, catalog, gemini, label_scan, limits, routine_check, routine_log
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
    body: label_scan.LabelScanRequest,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> label_scan.LabelScanResponse:
    """Read a product label. Nothing is saved: the person confirms, then POSTs /v1/routine."""
    limits.take(store, user.uid, "label_scan")
    try:
        return label_scan.scan(body.images)
    except label_scan.BadImage as exc:
        limits.refund(store, user.uid, "label_scan")
        raise HTTPException(
            422, {"code": "bad_image", "message": "That photo could not be read. Try another."}
        ) from exc
    except gemini.GeminiError as exc:
        # Our side failed: the person keeps the scan.
        limits.refund(store, user.uid, "label_scan")
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

    @field_validator("started_at")
    @classmethod
    def _not_in_future(cls, v: date | None) -> date | None:
        # One day of slack: the person's "today" can be ahead of UTC.
        if v is not None and v > datetime.now(UTC).date() + timedelta(days=1):
            raise ValueError("the start date cannot be in the future")
        return v


class RoutineEntryPatch(BaseModel):
    ended_at: date | None = None
    slots: list[Literal["am", "pm"]] | None = None


def _entry_view(entry_id: str, doc: dict[str, Any]) -> dict[str, Any]:
    return {"id": entry_id, **{k: iso(v) if isinstance(v, datetime) else v for k, v in doc.items()}}


@router.get("/routine")
def routine_list(
    today: str | None = Query(default=None, description="the person's own day, YYYY-MM-DD"),
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    entries = sorted(store.routine_list(user.uid), key=lambda e: e[1].get("started_at") or "")
    # each product's recent use, from the person's ticks (Home's "routine today"), counted up to
    # the person's own day (the app sends it; a day either side of UTC)
    now = routine_log.local_today(today)
    first = now - timedelta(days=routine_log.RECENT_DAYS)
    logs = store.routine_logs(user.uid, first.isoformat(), now.isoformat()) if entries else []
    since = (store.user_get(user.uid) or {}).get("routine_log_since") if entries else None
    return {
        "entries": [
            {
                **_entry_view(eid, d),
                "recent_use": routine_log.recent_use(d, eid, logs, now, since),
            }
            for eid, d in entries
        ]
    }


@router.get("/routine/log")
def routine_log_list(
    first: str | None = Query(default=None, alias="from"),
    last: str | None = Query(default=None, alias="to"),
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Ticked routine use per day, oldest first (default: the last 14 days). Days with no ticks
    are left out."""
    utc_today = routine_log.today()
    # default: the last 14 days, plus tomorrow's UTC date for anyone whose day is already there
    end = routine_log.parse_day(last, "to") if last else utc_today + timedelta(days=1)
    start = (
        routine_log.parse_day(first, "from")
        if first
        else utc_today - timedelta(days=routine_log.RECENT_DAYS)  # covers a day behind UTC
    )
    if start > end or (end - start).days >= routine_log.MAX_RANGE_DAYS:
        raise HTTPException(
            422,
            {
                "code": "bad_request",
                "message": f"from must be before to, at most {routine_log.MAX_RANGE_DAYS} days",
            },
        )
    docs = store.routine_logs(user.uid, start.isoformat(), end.isoformat())
    days = [v for v in (routine_log.day_view(d) for d in docs) if v["used"]]
    return {"from": start.isoformat(), "to": end.isoformat(), "days": days}


def _mark(store: Store, uid: str, day: str, entry_id: str, slot: str, used: bool) -> dict:
    _check_entry_id(entry_id)
    if used:
        checked = routine_log.check_tick(day, store.routine_get(uid, entry_id), slot)
        # the day the person started ticking: recent use counts from here (a later gap in
        # ticking stays a gap, never "used every day")
        since = (store.user_get(uid) or {}).get("routine_log_since")
        if not since or checked.isoformat() < since:
            store.user_merge(uid, {"routine_log_since": checked.isoformat()})
    else:
        checked = routine_log.check_untick(day, slot)
        [doc] = store.routine_logs(uid, checked.isoformat(), checked.isoformat()) or [
            {"date": checked.isoformat(), "used": {}}
        ]
        if slot not in ((doc.get("used") or {}).get(entry_id) or []):
            return routine_log.day_view(doc)  # nothing to remove: no write
    return routine_log.day_view(
        store.routine_log_mark(uid, checked.isoformat(), entry_id, slot, used)
    )


@router.put("/routine/log/{day}/{entry_id}/{slot}")
def routine_log_tick(
    day: str,
    entry_id: str,
    slot: str,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Mark a routine product used on a day (am or pm). Idempotent; answers the day's ticks."""
    return _mark(store, user.uid, day, entry_id, slot, True)


@router.delete("/routine/log/{day}/{entry_id}/{slot}")
def routine_log_untick(
    day: str,
    entry_id: str,
    slot: str,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Undo a tick. Idempotent; answers the day's ticks."""
    return _mark(store, user.uid, day, entry_id, slot, False)


@router.post("/routine")
def routine_add(
    body: RoutineEntryIn,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    entry_id, doc = add_routine_entry(store, user.uid, body)
    return _entry_view(entry_id, doc)


def add_routine_entry(
    store: Store, uid: str, body: RoutineEntryIn, entry_id: str | None = None
) -> tuple[str, dict[str, Any]]:
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
    entry_id = entry_id or f"r_{secrets.token_hex(4)}"
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
    _check_entry_id(entry_id)
    doc = store.routine_get(user.uid, entry_id)
    if doc is None:
        raise HTTPException(404, {"code": "not_found", "message": "routine entry not found"})
    doc.update(body.model_dump(mode="json", exclude_unset=True))
    store.routine_set(user.uid, entry_id, doc)
    return _entry_view(entry_id, doc)


ENTRY_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _check_entry_id(entry_id: str) -> None:
    """Never put arbitrary text into a Firestore path."""
    if not ENTRY_ID.match(entry_id):
        raise HTTPException(404, {"code": "not_found", "message": "routine entry not found"})


@router.delete("/routine/{entry_id}", status_code=204)
def routine_delete(
    entry_id: str,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> Response:
    """Remove an entry added by mistake. To stop using a product, PATCH ended_at instead."""
    _check_entry_id(entry_id)
    store.routine_delete(user.uid, entry_id)
    # a removed product's ticks go too (they would outlive the remove, and a reused id would
    # inherit them): the whole log, since ticks age past the window they were written in
    tomorrow = routine_log.today() + timedelta(days=1)
    logs = store.routine_logs(user.uid, "0000-01-01", tomorrow.isoformat())
    days = [d["date"] for d in logs if entry_id in (d.get("used") or {})]
    store.routine_log_forget(user.uid, entry_id, days)
    return Response(status_code=204)


@router.post("/routine/check")
def routine_check_route(
    user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """Rule table first (always), then Gemini additions marked source=model. Past the daily cap
    the rule table still answers, without the AI additions."""
    entries = [{"id": eid, **e} for eid, e in store.routine_list(user.uid)]
    try:
        limits.take(store, user.uid, "routine_check")
    except HTTPException:
        return routine_check.check(entries, use_model=False)
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
    used = limits.take(store, user.uid, "advisor")
    try:
        reply = advisor.chat([m.model_dump() for m in body.messages], store, user.uid)
    except Exception as exc:  # Vertex unavailable, quota, safety block
        limits.refund(store, user.uid, "advisor")
        raise HTTPException(
            502, {"code": "advisor_unavailable", "message": "The advisor is unavailable right now."}
        ) from exc
    return {**reply, "remaining_today": max(0, advisor.DAILY_LIMIT - used)}
