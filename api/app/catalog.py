"""Product catalog (docs/CATALOG_SPEC.md): facts only, served from `seed/products.json`.

The JSON file bundled in the image is what the api reads (fast, no Firestore round trip);
`scripts/seed_catalog.py` mirrors it into Firestore `products/` for the BigQuery export.
"""

import json
import math
import re
import unicodedata
from datetime import date
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
from typing import Any, NamedTuple

from pydantic import BaseModel, Field, field_validator

from app import regions

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


class StorePrice(BaseModel):
    """The price one store showed for this exact product and size, on the day it was checked.

    Read off the store's own page; never estimated, converted or copied from another store.
    A store entry without a verified price has `price: null`.
    """

    amount: float = Field(gt=0)
    currency: str = Field(pattern=r"^[A-Z]{3}$")  # ISO 4217, the page's own currency
    checked: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")  # YYYY-MM-DD

    @field_validator("checked")
    @classmethod
    def _real_date(cls, v: str) -> str:
        date.fromisoformat(v)  # raises ValueError for 2026-02-30
        return v


def _whole(x: Any) -> Any:
    return int(x) if isinstance(x, float) and x.is_integer() else x


def _tidy_store(s: dict[str, Any]) -> dict[str, Any]:
    price = s.get("price")
    return {**s, "price": {**price, "amount": _whole(price["amount"])} if price else None}


# One brand written several ways by the stores the catalog was gathered from: each spelling here
# reads (and groups) as the brand's main spelling. Only spellings checked by hand (Nov 29, the
# juror saw "DEAR KLAIRS DEAR KLAIRS" next to "Dear, Klairs" in Proof's brand picker); the seed
# file is left as gathered. Not here on purpose: "Holika Holika" (the brand's real name), "Allie"
# and "Allies of Skin", "Herbar" and "Herbario" (different brands).
BRAND_ALIASES = {
    "DEAR KLAIRS DEAR KLAIRS": "Dear, Klairs",
    "ILSO ILSO": "ILSO",
    "UAU UAU": "UAU",
    "Purito": "Purito Seoul",
    "Kiku-Masamune Sake Brewing": "Kikumasamune",
    "Black Friday I'm from": "I'm From",
    "Dr. Dennis Gross Skincare": "Dr. Dennis Gross",
    "D'ALBA": "d'Alba Piedmont",
}


def brand_name(brand: str) -> str:
    """The brand's main spelling (BRAND_ALIASES), else the name as it is."""
    return BRAND_ALIASES.get(brand, brand)


# A pack size at the very end of a name, with the store's batch code or offer after it
# ("Fermented Complex 94 Boosting Essence 150ml (22AD)", "... Face Wash - 80ml", "Toner Pad
# 10ea/"). A size followed by anything else stays: "100ml (2-Pack)" and "(3-Pack)" are
# different products, "50ml SPF50+" is part of the name.
_SIZE = r"\d+(?:[.,]\d+)?\s?(?:ml|g|oz|fl\.?\s?oz|l|pcs|ea|sheets)\.?"
_SKU = r"\((?:\d{2}AD|Worth [^()]{1,20})\)"
_PACK_TAIL = re.compile(
    rf"(?:\s*[-,|/]?\s+{_SIZE}(?:\s*{_SKU})?|\s*{_SKU})\s*[/,]?\s*$", re.IGNORECASE
)


def display_name(name: str) -> str:
    """A product name without the pack size and batch code at its end; never empty."""
    out = name
    while (cut := _PACK_TAIL.sub("", out).rstrip(" -,|/")) and cut != out:
        out = cut
    if out.count("(") > out.count(")"):  # a bracket the store cut off: "Spot Patch (3sheets,"
        out = out[: out.rindex("(")].rstrip(" -,|/")
    return out or name


def _tidy(p: dict[str, Any]) -> dict[str, Any]:
    """Whole numbers as integers (prices and percentages read 445, not 445.0). An index record
    may have no price (null), no ingredient list and no actives; `detail` defaults to "full"
    (records from before Nov 27 have none). The brand reads as its main spelling and the name
    without a trailing pack size (BRAND_ALIASES, display_name): a product's id never changes."""
    price = p.get("price")
    return {
        **p,
        "brand": brand_name(str(p.get("brand") or "")) if p.get("brand") else p.get("brand"),
        "name": display_name(str(p["name"])) if p.get("name") else p.get("name"),
        "detail": p.get("detail") or "full",
        "price": {**price, "amount": _whole(price["amount"])} if price else None,
        "inci": list(p.get("inci") or []),
        "key_actives": [{**a, "pct": _whole(a.get("pct"))} for a in p.get("key_actives") or []],
        "stores": [_tidy_store(s) for s in p.get("stores") or []],
    }


@lru_cache
def products() -> tuple[dict[str, Any], ...]:
    if not CATALOG_PATH.exists():
        return ()
    return tuple(_tidy(p) for p in json.loads(CATALOG_PATH.read_text()))


def detail(p: dict[str, Any]) -> str:
    """ "full": ingredient list, actives and a price, checked by hand; "index": name, category,
    stores and image only, its ingredient list not in Willow yet. Missing means "full"."""
    return p.get("detail") or "full"


def is_full(p: dict[str, Any]) -> bool:
    """Only full products are suggested (plan, swaps, similar, Wisp, sponsored): a suggestion
    has to be checked, and a check needs the ingredient list."""
    return detail(p) == "full"


def fold(text: str) -> str:
    """Lower case, accents removed ("Clé" -> "cle"), "&" as "and", apostrophes dropped
    ("Paula's" -> "paulas"), every other run of punctuation one space."""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().replace("&", " and ").replace("'", "").replace("\u2019", "")
    return re.sub(r"[^a-z0-9%.]+", " ", text).strip()


class _Entry(NamedTuple):
    """One product's search keys, computed once per catalog load."""

    product: dict[str, Any]
    haystack: str  # brand, name, category, concerns and key actives
    words: frozenset[str]  # brand and name words
    joined: str  # brand and name without spaces ("hadalabo")
    inci: str
    index: bool
    price: float
    sort_name: str


class _Index(NamedTuple):
    source: tuple[dict[str, Any], ...] | list[dict[str, Any]]
    by_id: dict[str, dict[str, Any]]
    entries: tuple[_Entry, ...]
    brands: dict[str, list[dict[str, Any]]]  # folded brand -> its products


_INDEX: list[_Index] = []


def _index() -> _Index:
    """Search keys and the id lookup, rebuilt only when the catalog object changes (tests swap
    `products` for a small catalog)."""
    source = products()
    if _INDEX and _INDEX[0].source is source:
        return _INDEX[0]
    entries = []
    brands: dict[str, list[dict[str, Any]]] = {}
    for p in source:
        brand, name = str(p.get("brand") or ""), str(p.get("name") or "")
        title = fold(f"{brand} {name}")
        actives = [a["name"] for a in p.get("key_actives") or []]
        price = p.get("price")
        entries.append(
            _Entry(
                product=p,
                haystack=fold(
                    " ".join(
                        [brand, name, str(p.get("category") or ""), *(p.get("concerns") or [])]
                    )
                    + " "
                    + " ".join(actives)
                ),
                words=frozenset(title.split()),
                joined=title.replace(" ", ""),
                inci=" | ".join(fold(str(i)) for i in p.get("inci") or []),
                index=not is_full(p),
                price=float(price["amount"]) if price else math.inf,
                sort_name=f"{brand} {name}".lower(),
            )
        )
        brands.setdefault(fold(brand), []).append(p)
    built = _Index(source, {p["product_id"]: p for p in source}, tuple(entries), brands)
    _INDEX[:] = [built]
    return built


def by_id(product_id: str) -> dict[str, Any] | None:
    return _index().by_id.get(product_id)


# a query word this long may match across the words of a name ("hadalabo" in "Hada Labo")
JOINED_MIN = 4


def _quality(e: _Entry, terms: list[str]) -> tuple[int, int]:
    """(words matched, how well): a whole brand or name word 3, the start of one or a match
    across words 2, anywhere else (category, concern, active, inside a word) 1; the whole query
    as one run of the brand and name ("hada labo" in "Hada Labo Gokujyun") adds 2."""
    hits = quality = 0
    for t in terms:
        if t in e.words:
            hits, quality = hits + 1, quality + 3
        elif any(w.startswith(t) for w in e.words) or (len(t) >= JOINED_MIN and t in e.joined):
            hits, quality = hits + 1, quality + 2
        elif t in e.haystack:
            hits, quality = hits + 1, quality + 1
    together = "".join(terms)
    if len(terms) > 1 and len(together) >= JOINED_MIN and together in e.joined:
        quality += 2
    return hits, quality


def search(
    q: str | None = None,
    concern: str | list[str] | None = None,
    category: str | None = None,
    max_price: float | None = None,
    currency: str | None = None,
    exclude_ingredients: list[str] | None = None,
    limit: int = 8,
    market: str | None = None,
) -> list[dict[str, Any]]:
    return search_all(q, concern, category, max_price, currency, exclude_ingredients, market)[
        :limit
    ]


def search_all(
    q: str | None = None,
    concern: str | list[str] | None = None,
    category: str | None = None,
    max_price: float | None = None,
    currency: str | None = None,
    exclude_ingredients: list[str] | None = None,
    market: str | None = None,
) -> list[dict[str, Any]]:
    """Every match, best first. Several concerns: products made for all of them. `market` (where
    the person shops, app/regions.py): browsing (no query) lists the nearest products first; a
    query keeps the best matches first and puts the nearest first among equally good ones; no
    product is left out for its region. Then, for the same match, a full product before an
    index one. A price filter
    leaves out products with no price, and an ingredient filter leaves out products whose
    ingredient list Willow does not have (it cannot tell they are free of it)."""
    excluded = [fold(x) for x in exclude_ingredients or [] if x.strip()]
    terms = fold(q).split() if q else []
    wanted = [concern] if isinstance(concern, str) else list(concern or [])
    scored = []
    for e in _index().entries:
        p = e.product
        if any(c not in p["concerns"] for c in wanted):
            continue
        if category and p["category"] != category:
            continue
        if max_price is not None:
            price = p.get("price")
            if price is None or (currency and price["currency"] != currency):
                continue
            if price["amount"] > max_price:
                continue
        if excluded and (not e.inci or any(x in e.inci for x in excluded)):
            continue
        if terms:
            hits, quality = _quality(e, terms)
            if hits == 0:
                continue
            near = regions.distance(p, market)
            scored.append(((-hits, -quality, near, e.index, e.price, e.sort_name), p))
        else:
            # Browsing (no query): nearest first, then full products, then by brand and name; raw
            # prices in different currencies do not compare (sorting by them hid most INR
            # products).
            near = regions.distance(p, market)
            scored.append(((0, 0, near, e.index, 0.0, e.sort_name), p))
    scored.sort(key=lambda s: s[0])
    if terms and scored:
        # Only the products matching the most words ("vitamin c" is not every product with a "c").
        best = scored[0][0][0]
        scored = [s for s in scored if s[0][0] == best]
    return [p for _, p in scored]


def match(brand: str | None, name: str | None) -> tuple[dict[str, Any], float] | None:
    """Best catalog product for a scanned label: same brand, closest name. None below 0.6.
    Brands compare with and without spaces ("HadaLabo" is "Hada Labo")."""
    if not brand or not name:
        return None
    b, n = fold(brand), fold(name)
    best: tuple[dict[str, Any], float] | None = None
    for key, group in _index().brands.items():
        same = max(
            SequenceMatcher(None, b, key).ratio(),
            SequenceMatcher(None, b.replace(" ", ""), key.replace(" ", "")).ratio(),
        )
        if same < 0.8:
            continue
        for p in group:
            score = SequenceMatcher(None, n, fold(p["name"])).ratio()
            if best is None or score > best[1]:
                best = (p, score)
    return best if best and best[1] >= 0.6 else None
