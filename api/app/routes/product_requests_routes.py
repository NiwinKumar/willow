"""Product requests (app/product_requests.py): ask for a product the catalog does not have."""

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, model_validator

from app import catalog, limits, product_requests
from app.auth import AuthUser, current_user
from app.store import Store, get_store

router = APIRouter(prefix="/v1", tags=["product-requests"])

MAX_PHOTO_B64 = 8_000_000


class RequestPhoto(BaseModel):
    mime_type: Literal["image/jpeg", "image/png", "image/webp"]
    data_base64: str = Field(max_length=MAX_PHOTO_B64)


class ProductRequestIn(BaseModel):
    brand: str = Field(default="", max_length=80)
    name: str = Field(default="", max_length=120)
    photo: RequestPhoto | None = None
    # a catalog product known only by name (an index product): ask for its full facts
    product_id: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def _something(self) -> "ProductRequestIn":
        if self.product_id:
            return self
        if not self.photo and not (self.brand.strip() and self.name.strip()):
            raise ValueError("send the brand and name, or a photo of the product")
        return self


class ProductRequestPatch(BaseModel):
    seen: bool


@router.get("/product-requests")
def list_requests(
    user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    return {"requests": product_requests.list_views(store, user.uid)}


@router.post("/product-requests", status_code=201)
def create_request(
    body: ProductRequestIn,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Queue a product for Willow to check and add. A product the catalog already has in full is
    not queued: 409 `in_catalog` carries it, so the app can offer it instead. A product it knows
    only by name (an index product, by `product_id` or by brand and name) is queued as a request
    for its full facts (`kind: "facts"`); asking again while that is pending answers the same
    request and costs nothing."""
    if body.product_id:
        found = catalog.by_id(body.product_id)
        if found is None:
            raise HTTPException(404, {"code": "not_found", "message": "product not found"})
    else:
        found = product_requests.in_catalog(body.brand, body.name)
    facts_for = found if found is not None and not catalog.is_full(found) else None
    if facts_for is not None:
        key = product_requests.key_of(facts_for["brand"], facts_for["name"])
        mine = product_requests.pending_of(store, user.uid, key)
        if mine is not None and not body.photo:
            wish = store.product_wish_get(key) or {}
            return product_requests.view(*mine, wish.get("count"))
    elif found is not None:
        raise HTTPException(
            409,
            {
                "code": "in_catalog",
                "message": f"It's in the catalog: {found['name']}",
                "product": found,
            },
        )
    photo = None
    if body.photo:
        try:
            photo = (body.photo.mime_type, product_requests.decode(body.photo.data_base64))
        except product_requests.BadPhoto as exc:
            raise HTTPException(
                422, {"code": "bad_image", "message": "That photo could not be read. Try another."}
            ) from exc
    limits.take(store, user.uid, "product_request")
    rid, doc, wish = product_requests.create(
        store, user.uid, body.brand, body.name, photo, facts_for=facts_for
    )
    return product_requests.view(rid, doc, wish.get("count"))


@router.patch("/product-requests/{request_id}", status_code=204)
def patch_request(
    request_id: str,
    body: ProductRequestPatch,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> Response:
    """`seen: true` once the person has seen that a request was answered (the in-app note)."""
    if request_id not in dict(store.product_requests_of(user.uid)):
        raise HTTPException(404, {"code": "not_found", "message": "request not found"})
    store.product_request_update(user.uid, request_id, {"seen": body.seen})
    return Response(status_code=204)
