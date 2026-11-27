"""Store clicks (build-spec): a tap on "Buy at <store>" is counted, never tied to a person.

Each click is one doc in store_clicks/{auto} {product_id, store, surface, day, at}; no uid. The
retailer view is an aggregate per product and store; a group under 10 clicks shows as "<10"
(the same minimum group as every other retailer number).
"""

from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app import catalog
from app.store import Store

MIN_GROUP = 10
Surface = Literal["product_sheet", "wisp", "plan", "sponsored"]


class ClickIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: str = Field(min_length=1, max_length=120)
    store: str = Field(min_length=1, max_length=80)
    surface: Surface


def known_store(product: dict[str, Any], store_name: str) -> bool:
    return any(s["store"] == store_name for s in product.get("stores") or [])


def add(store: Store, body: ClickIn, now: datetime | None = None) -> None:
    now = now or datetime.now(UTC)
    store.click_add(
        now.date().isoformat(),
        {"product_id": body.product_id, "store": body.store, "surface": body.surface, "at": now},
    )


def _shown(n: int) -> int | str:
    return n if n >= MIN_GROUP else "<10"


def summary(store: Store, days: int, now: datetime | None = None) -> dict[str, Any]:
    """Clicks per product and store over the last `days` days (today included)."""
    today = (now or datetime.now(UTC)).date()
    first = today - timedelta(days=days - 1)
    docs = store.clicks_since(first.isoformat())
    pairs = Counter((d.get("product_id"), d.get("store")) for d in docs)
    per_product = Counter(d.get("product_id") for d in docs)
    surfaces = Counter(d.get("surface") for d in docs)

    def name(pid: str) -> dict[str, Any]:
        p = catalog.by_id(pid) or {}
        return {"product_id": pid, "product": p.get("name"), "brand": p.get("brand")}

    by_pair = sorted(pairs.items(), key=lambda kv: (-kv[1], str(kv[0][0]), str(kv[0][1])))
    return {
        "days": days,
        "from": first.isoformat(),
        "to": today.isoformat(),
        "total": _shown(len(docs)),
        "min_group": MIN_GROUP,
        "items": [{**name(pid), "store": s, "clicks": _shown(n)} for (pid, s), n in by_pair if pid],
        "products": [
            {**name(pid), "clicks": _shown(n)}
            for pid, n in sorted(per_product.items(), key=lambda kv: (-kv[1], str(kv[0])))
            if pid
        ],
        "surfaces": {s: _shown(n) for s, n in sorted(surfaces.items()) if s},
    }
