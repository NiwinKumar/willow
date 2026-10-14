"""Product catalog (docs/CATALOG_SPEC.md): facts only, served from `seed/products.json`.

The JSON file bundled in the image is what the api reads (fast, no Firestore round trip);
`scripts/seed_catalog.py` mirrors it into Firestore `products/` for the BigQuery export.
"""

import json
import re
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
from typing import Any

CATALOG_PATH = Path(__file__).resolve().parent.parent / "seed" / "products.json"

CATEGORIES = (
    "cleanser",
    "toner",
    "serum",
    "treatment",
    "exfoliant",
    "moisturizer",
    "sunscreen",
    "eye_care",
    "mask",
)
CONCERNS = (
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
)


def _tidy(p: dict[str, Any]) -> dict[str, Any]:
    """Whole numbers as integers (prices and percentages read 445, not 445.0)."""

    def whole(x: Any) -> Any:
        return int(x) if isinstance(x, float) and x.is_integer() else x

    return {
        **p,
        "price": {**p["price"], "amount": whole(p["price"]["amount"])},
        "key_actives": [{**a, "pct": whole(a["pct"])} for a in p["key_actives"]],
    }


@lru_cache
def products() -> tuple[dict[str, Any], ...]:
    if not CATALOG_PATH.exists():
        return ()
    return tuple(_tidy(p) for p in json.loads(CATALOG_PATH.read_text()))


def by_id(product_id: str) -> dict[str, Any] | None:
    return next((p for p in products() if p["product_id"] == product_id), None)


def _norm(text: str) -> str:
    text = text.lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9%.]+", " ", text).strip()


def search(
    q: str | None = None,
    concern: str | None = None,
    category: str | None = None,
    max_price: float | None = None,
    currency: str | None = None,
    exclude_ingredients: list[str] | None = None,
    limit: int = 8,
) -> list[dict[str, Any]]:
    excluded = [_norm(x) for x in exclude_ingredients or [] if x.strip()]
    terms = _norm(q).split() if q else []
    scored = []
    for p in products():
        if concern and concern not in p["concerns"]:
            continue
        if category and p["category"] != category:
            continue
        if max_price is not None:
            if currency and p["price"]["currency"] != currency:
                continue
            if p["price"]["amount"] > max_price:
                continue
        haystack_inci = " | ".join(_norm(i) for i in p.get("inci", []))
        if any(x in haystack_inci for x in excluded):
            continue
        if terms:
            haystack = _norm(
                " ".join(
                    [p["brand"], p["name"], p["category"], *p["concerns"]]
                    + [a["name"] for a in p["key_actives"]]
                )
            )
            hits = sum(t in haystack for t in terms)
            if hits == 0:
                continue
            scored.append((-hits, p["price"]["amount"], p))
        else:
            # Browsing (no query): by brand then name; raw prices in different currencies
            # do not compare (sorting by them hid most INR products behind USD ones).
            scored.append((0, f"{p['brand']} {p['name']}".lower(), p))
    scored.sort(key=lambda s: (s[0], s[1]))
    return [p for _, _, p in scored[:limit]]


def match(brand: str | None, name: str | None) -> tuple[dict[str, Any], float] | None:
    """Best catalog product for a scanned label: same brand, closest name. None below 0.6."""
    if not brand or not name:
        return None
    b, n = _norm(brand), _norm(name)
    best: tuple[dict[str, Any], float] | None = None
    for p in products():
        if SequenceMatcher(None, b, _norm(p["brand"])).ratio() < 0.8:
            continue
        score = SequenceMatcher(None, n, _norm(p["name"])).ratio()
        if best is None or score > best[1]:
            best = (p, score)
    return best if best and best[1] >= 0.6 else None
