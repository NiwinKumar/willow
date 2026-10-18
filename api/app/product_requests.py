"""Product requests: a product someone uses that the catalog does not have yet.

The person sends its brand and name, or a photo of the pack, or both. Willow checks the product
(INCI from the official page, docs/CATALOG_SPEC.md), adds it to the catalog and tells everyone who
asked. Nothing a person types or photographs goes into the catalog as is: requests only queue the
work. The more people ask for a product, the earlier it is checked (`scripts/product_requests.py`).

users/{uid}/product_requests/{id}: {brand, name, key, status, product_id, photo_name, created_at,
resolved_at, seen}. product_requests/{key}: {brand, name, requesters[], count, status, product_id,
first_at, last_at}; `key` is the normalised brand + name, so the same product asked for twice is one
entry. A request with only a photo gets its own key until it is checked.
"""

import base64
import binascii
import hashlib
import re
import secrets
from datetime import UTC, datetime
from typing import Any, Literal

from app import catalog, storage
from app.store import Doc, Store, iso

Status = Literal["pending", "added", "declined"]
PHOTO_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


class BadPhoto(Exception):
    pass


def key_of(brand: str, name: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", f"{brand} {name}".lower()).strip("-")
    return text[:80] or f"photo-{secrets.token_hex(4)}"


def photo_name(uid: str, rid: str, mime_type: str) -> str:
    return f"requests/{uid}/{rid}.{PHOTO_TYPES[mime_type]}"


def decode(data_base64: str) -> bytes:
    try:
        return base64.b64decode(data_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise BadPhoto("not base64") from exc


def create(
    store: Store,
    uid: str,
    brand: str,
    name: str,
    photo: tuple[str, bytes] | None,
    now: datetime | None = None,
) -> tuple[str, Doc, Doc]:
    """Save one request and count the person once for that product. Returns (id, doc, wish)."""
    now = now or datetime.now(UTC)
    rid = f"pr_{secrets.token_hex(5)}"
    brand, name = " ".join(brand.split()), " ".join(name.split())
    key = key_of(brand, name) if (brand or name) else f"photo-{rid}"
    doc: Doc = {
        "brand": brand,
        "name": name,
        "key": key,
        "status": "pending",
        "product_id": None,
        "photo_name": None,
        "created_at": now,
        "resolved_at": None,
        "seen": False,
    }
    if photo:
        mime, data = photo
        doc["photo_name"] = photo_name(uid, rid, mime)
        storage.put_bytes(doc["photo_name"], data, mime)
    store.product_request_set(uid, rid, doc)
    wish = store.product_wish_add(
        key,
        uid,
        {
            "brand": brand,
            "name": name,
            "status": "pending",
            "product_id": None,
            "first_at": now,
            "last_at": now,
        },
    )
    return rid, doc, wish


def view(rid: str, doc: Doc, askers: int | None = None) -> dict[str, Any]:
    product = catalog.by_id(doc["product_id"]) if doc.get("product_id") else None
    return {
        "id": rid,
        "brand": doc.get("brand") or "",
        "name": doc.get("name") or "",
        "status": doc.get("status") or "pending",
        "product_id": doc.get("product_id"),
        # the catalog entry once it is added, so the app can offer "Add to routine" right away
        "product": product,
        "has_photo": bool(doc.get("photo_name")),
        "askers": askers,
        "created_at": iso(doc.get("created_at")),
        "resolved_at": iso(doc.get("resolved_at")),
        "seen": bool(doc.get("seen")),
    }


def list_views(store: Store, uid: str) -> list[dict[str, Any]]:
    rows = store.product_requests_of(uid)
    oldest = datetime.min.replace(tzinfo=UTC)
    rows.sort(key=lambda r: r[1].get("created_at") or oldest, reverse=True)
    out = []
    for rid, doc in rows:
        wish = store.product_wish_get(doc["key"]) if doc.get("status") == "pending" else None
        out.append(view(rid, doc, (wish or {}).get("count")))
    return out


def resolve(
    store: Store,
    key: str,
    status: Status,
    product_id: str | None,
    now: datetime | None = None,
) -> list[str]:
    """Mark a product request done for everyone who asked; answers their uids (to notify).
    Their photos are deleted: they were only needed to find the product."""
    now = now or datetime.now(UTC)
    wish = store.product_wish_get(key)
    if wish is None:
        raise KeyError(key)
    if status == "added" and (not product_id or catalog.by_id(product_id) is None):
        raise ValueError("an added request needs a product_id that is in the catalog")
    store.product_wish_update(key, {"status": status, "product_id": product_id, "resolved_at": now})
    for uid in wish.get("requesters", []):
        for rid, doc in store.product_requests_of(uid):
            if doc.get("key") != key or doc.get("status") != "pending":
                continue
            if doc.get("photo_name"):
                storage.delete_object(doc["photo_name"])
            store.product_request_update(
                uid,
                rid,
                {
                    "status": status,
                    "product_id": product_id,
                    "resolved_at": now,
                    "photo_name": None,
                    "seen": False,
                },
            )
    return list(wish.get("requesters", []))


def message(status: Status, brand: str, name: str) -> dict[str, str]:
    """The push note when a request is done. Calm; no claims about the product."""
    what = " ".join(x for x in (brand, name) if x) or "The product you asked for"
    if status == "added":
        return {
            "title": "Added to the catalog",
            "body": f"{what} is in Willow now. You can add it to your routine.",
            "url": "/routine",
            "tag": f"willow-request-{hashlib.sha256(what.encode()).hexdigest()[:8]}",
        }
    return {
        "title": "About your product request",
        "body": f"We couldn't add {what} to the catalog. Open Willow for details.",
        "url": "/routine",
        "tag": f"willow-request-{hashlib.sha256(what.encode()).hexdigest()[:8]}",
    }
