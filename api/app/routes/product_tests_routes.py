"""Product tests (docs/CONTRACT.md sections 3 and 4): a product tried on one forearm square, with
the other forearm's square left untouched as the control.

users/{uid}/product_tests/{test_id}:
  {entry_id | null, product_id | null, name, site_pair: "forearm", started_at (YYYY-MM-DD),
   length_days (7..56, default 28), ended_at (YYYY-MM-DD) | null, created_at, updated_at}

The test is the plan (what, since when, how long). The photos stay ordinary forearm_treated and
forearm_control sessions, and the treated-vs-control verdict is worked out from them as before;
the app gives it only after day 14. One test runs at a time (there is one pair of forearms).
"""

import re
import secrets
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator

from app import catalog
from app.auth import AuthUser, current_user
from app.store import Store, get_store, iso

router = APIRouter(prefix="/v1", tags=["product-tests"])

DEFAULT_DAYS = 28
MIN_DAYS, MAX_DAYS = 7, 56
VERDICT_AFTER_DAYS = 14  # the app shows "too early" before this many days (no api rule needed)
TEST_ID = re.compile(r"^pt_[0-9a-f]{8}$")


def _not_future(v: date | None) -> date | None:
    # One day of slack: the person's "today" can be ahead of UTC.
    if v is not None and v > datetime.now(UTC).date() + timedelta(days=1):
        raise ValueError("the date cannot be in the future")
    return v


class ProductTestIn(BaseModel):
    entry_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,64}$")
    product_id: str | None = Field(default=None, max_length=120)
    name: str = Field(default="", max_length=120)
    site_pair: Literal["forearm"] = "forearm"
    started_at: date | None = None
    length_days: int = Field(default=DEFAULT_DAYS, ge=MIN_DAYS, le=MAX_DAYS)

    @field_validator("started_at")
    @classmethod
    def _started(cls, v: date | None) -> date | None:
        return _not_future(v)


class ProductTestPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    length_days: int | None = Field(default=None, ge=MIN_DAYS, le=MAX_DAYS)
    ended_at: date | None = None

    @field_validator("ended_at")
    @classmethod
    def _ended(cls, v: date | None) -> date | None:
        return _not_future(v)


def _view(test_id: str, doc: dict[str, Any]) -> dict[str, Any]:
    return {"id": test_id, **{k: iso(v) if isinstance(v, datetime) else v for k, v in doc.items()}}


def _check_id(test_id: str) -> None:
    """Never put arbitrary text into a Firestore path."""
    if not TEST_ID.match(test_id):
        raise HTTPException(404, {"code": "not_found", "message": "product test not found"})


@router.get("/product-tests")
def product_tests_list(
    user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """Every product test, newest start first; the running one (ended_at null) is first."""
    tests = sorted(
        store.product_tests_list(user.uid),
        key=lambda t: (t[1].get("ended_at") is None, t[1].get("started_at") or ""),
        reverse=True,
    )
    return {"tests": [_view(tid, d) for tid, d in tests]}


@router.post("/product-tests")
def product_test_start(
    body: ProductTestIn,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Start a test for a routine product (entry_id), a catalog product (product_id) or anything
    named (a self-tanner). 409 while another test is running: end it first."""
    if any(d.get("ended_at") is None for _, d in store.product_tests_list(user.uid)):
        raise HTTPException(
            409,
            {"code": "conflict", "message": "A product test is already running. End it first."},
        )
    name, product_id = body.name.strip(), body.product_id
    if body.entry_id:
        entry = store.routine_get(user.uid, body.entry_id)
        if entry is None:
            raise HTTPException(404, {"code": "not_found", "message": "routine entry not found"})
        product_id = entry.get("product_id")
        name = name or entry.get("custom_name") or entry.get("brand") or ""
    if product_id:
        product = catalog.by_id(product_id)
        if product is None:
            raise HTTPException(404, {"code": "not_found", "message": "product not found"})
        name = name or product["name"]
    if not name:
        raise HTTPException(422, {"code": "bad_request", "message": "name the product you test"})
    now = datetime.now(UTC)
    doc = {
        "entry_id": body.entry_id,
        "product_id": product_id,
        "name": name,
        "site_pair": body.site_pair,
        "started_at": (body.started_at or now.date()).isoformat(),
        "length_days": body.length_days,
        "ended_at": None,
        "created_at": now,
        "updated_at": now,
    }
    test_id = f"pt_{secrets.token_hex(4)}"
    store.product_test_set(user.uid, test_id, doc)
    return _view(test_id, doc)


@router.patch("/product-tests/{test_id}")
def product_test_patch(
    test_id: str,
    body: ProductTestPatch,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Rename, change the length (7 to 56 days), or end the test (ended_at; null resumes it)."""
    _check_id(test_id)
    doc = store.product_test_get(user.uid, test_id)
    if doc is None:
        raise HTTPException(404, {"code": "not_found", "message": "product test not found"})
    change = body.model_dump(mode="json", exclude_unset=True)
    if "name" in change and change["name"] is None:
        del change["name"]
    if "length_days" in change and change["length_days"] is None:
        del change["length_days"]
    if change.get("ended_at") and change["ended_at"] < doc["started_at"]:
        raise HTTPException(
            422, {"code": "bad_request", "message": "a test cannot end before it started"}
        )
    if "ended_at" in change and change["ended_at"] is None:
        others = store.product_tests_list(user.uid)
        if any(tid != test_id and d.get("ended_at") is None for tid, d in others):
            raise HTTPException(
                409,
                {"code": "conflict", "message": "Another product test is running. End it first."},
            )
    doc.update(change, updated_at=datetime.now(UTC))
    store.product_test_set(user.uid, test_id, doc)
    return _view(test_id, doc)


@router.delete("/product-tests/{test_id}", status_code=204)
def product_test_delete(
    test_id: str,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> Response:
    """Remove a test started by mistake. Its forearm photos and readings are kept."""
    _check_id(test_id)
    store.product_test_delete(user.uid, test_id)
    return Response(status_code=204)
