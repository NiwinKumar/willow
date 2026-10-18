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

    @model_validator(mode="after")
    def _something(self) -> "ProductRequestIn":
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
    """Queue a product for Willow to check and add. A product the catalog already has is not
    queued: 409 `in_catalog` carries it, so the app can offer it instead."""
    found = catalog.match(body.brand, body.name)
    if found and found[1] >= 0.85:
        raise HTTPException(
            409,
            {
                "code": "in_catalog",
                "message": "That product is already in the catalog.",
                "product": found[0],
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
    rid, doc, wish = product_requests.create(store, user.uid, body.brand, body.name, photo)
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
