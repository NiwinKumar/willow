"""Shelf vs results (app/shelf.py): the shares and flags per category, and the retailer's own
stock or facings file. Sign-in on every route (a guest account is enough), because the upload
belongs to the account; without an upload the view uses share of use."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field

from app import limits, retailer, shelf
from app.auth import AuthUser, current_user
from app.store import Store, get_store

router = APIRouter(prefix="/v1/retailer/shelf", tags=["shelf"])

UNAVAILABLE = {"code": "insights_unavailable", "message": "Insights are unavailable right now."}


@router.get("")
def shelf_view(
    cohort: retailer.Cohort = Query("mixed", description="simulated | mixed | real"),
    range_: retailer.Range = Query("all", alias="range", description="30d | 90d | all"),
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Per category, each measured product's share of use (and of stock, when uploaded) against
    its share of results, and the flags (Gemini's, or the fixed ones with `pending` while they
    are written)."""
    try:
        return shelf.view(cohort, range_, store.shelf_get(user.uid))
    except Exception as exc:  # BigQuery unavailable
        raise HTTPException(503, UNAVAILABLE) from exc


class StockUpload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filename: str = Field(min_length=1, max_length=200)
    csv: str = Field(min_length=1, max_length=200_000)


@router.put("/stock")
def upload_stock(
    body: StockUpload, user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """Replace this account's stock file: product_id (or product) and facings (or stock_units)."""
    try:
        rows, unmatched, column = shelf.parse_stock(body.csv)
    except shelf.BadUpload as exc:
        raise HTTPException(422, {"code": "bad_upload", "message": str(exc)}) from exc
    limits.take(store, user.uid, "shelf_upload")
    doc = shelf.stock_doc(body.filename, rows, unmatched, column)
    store.shelf_set(user.uid, doc)
    return {"stock": shelf.stock_view(doc)}


@router.delete("/stock", status_code=204)
def delete_stock(
    user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> Response:
    store.shelf_delete(user.uid)
    return Response(status_code=204)
