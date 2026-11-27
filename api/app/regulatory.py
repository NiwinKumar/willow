"""What a product is in law, per market, from its actives and INCI (research/finals/04 section 2).

Computed in code, never by Gemini. The class answers "is this sold as a cosmetic here?":
cosmetic, otc_drug (a non-prescription medicine, e.g. US sunscreen or benzoyl peroxide),
pharmacy (sold by a pharmacist) or rx (prescription only). Willow only ever suggests
cosmetics and sunscreens (plan, Wisp, swaps); everything else can be checked, never suggested.
"""

import re
from typing import Any, Literal

from app.regions import MARKETS, Market  # noqa: F401  (Market: re-exported for the routes)

RegClass = Literal["cosmetic", "otc_drug", "pharmacy", "rx"]
# strictest last: the class reported when the market is unknown
ORDER = {"cosmetic": 0, "otc_drug": 1, "pharmacy": 2, "rx": 3}

# Never suggested anywhere: prescription medicines, whatever the market.
NEVER = {
    "tretinoin": ("tretinoin", "retinoic acid"),
    "hydroquinone": ("hydroquinone",),
    "isotretinoin": ("isotretinoin",),
    "tazarotene": ("tazarotene",),
    "trifarotene": ("trifarotene",),
    "steroid": (
        "clobetasol",
        "betamethasone",
        "mometasone",
        "fluocinolone",
        "fluocinonide",
        "triamcinolone",
        "dexamethasone",
        "hydrocortisone",
        "desonide",
    ),
    "antibiotic": ("clindamycin", "erythromycin", "nadifloxacin", "fusidic acid", "mupirocin"),
    "minoxidil": ("minoxidil",),
    "mercury": ("mercury", "mercurous chloride", "calomel"),
}
# A product name that claims to act on a condition is a drug claim (US OTC acne monograph,
# UK ASA): Willow never suggests one, whatever is inside.
CLAIM_NAME = re.compile(r"\b(acne|pimples?|medicated|treat\w*|clinical\w*|therap\w*)\b", re.I)
AZELAIC_COSMETIC_MAX = 10.0  # 15% and 20% are medicines (04 section 2); 10% sells as a cosmetic


def _norm(text: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9%.\- ]+", " ", text.lower()).split())


def _has(names: list[str], term: str) -> bool:
    return any(re.search(rf"(?<![a-z]){re.escape(term)}(?![a-z])", n) for n in names)


def _names(product: dict[str, Any]) -> list[str]:
    """Key active names and every INCI entry, normalised (parenthesised words kept). Without an
    ingredient list (an index product), its name stands in: "Adapalene Gel 0.1%" is still
    adapalene."""
    actives = [_norm(a["name"]) for a in product.get("key_actives") or []]
    inci = [_norm(str(i)) for i in product.get("inci") or []]
    return actives + (inci or [_norm(str(product.get("name") or ""))])


def _pct(product: dict[str, Any], term: str) -> float | None:
    for a in product.get("key_actives") or []:
        if term in _norm(a["name"]) and a.get("pct") is not None:
            return float(a["pct"])
    return None


def is_sunscreen(product: dict[str, Any]) -> bool:
    return product.get("category") == "sunscreen" or bool(
        re.search(r"\bspf\b", str(product.get("name", "")), re.I)
    )


def never_suggest(product: dict[str, Any]) -> list[str]:
    """Which never-suggest families the product contains ([] = none)."""
    names = _names(product)
    return [fam for fam, terms in NEVER.items() if any(_has(names, t) for t in terms)]


def classify(product: dict[str, Any], market: str) -> str:
    """The product's class in one market."""
    names = _names(product)
    if never_suggest(product):
        # hydrocortisone up to 1% is sold without a prescription in the US (pharmacy in the UK)
        only_hc = never_suggest(product) == ["steroid"] and not any(
            _has(names, t) for t in NEVER["steroid"] if t != "hydrocortisone"
        )
        if only_hc:
            return {"US": "otc_drug", "UK": "pharmacy"}.get(market, "rx")
        return "rx"
    if _has(names, "adapalene"):
        return "otc_drug" if market == "US" else "rx"
    if _has(names, "benzoyl peroxide"):
        return "pharmacy" if market in ("UK", "EU") else "otc_drug"
    if _has(names, "azelaic acid"):
        pct = _pct(product, "azelaic acid")
        if pct is not None and pct > AZELAIC_COSMETIC_MAX:
            return "pharmacy" if market == "SG" else "rx"
    if is_sunscreen(product) and market == "US":
        return "otc_drug"
    return "cosmetic"


def of(product: dict[str, Any], market: str | None) -> dict[str, Any]:
    """{class, market}. Unknown market: the strictest class across the markets, market null."""
    if market in MARKETS:
        return {"class": classify(product, market), "market": market}
    worst = max((classify(product, m) for m in MARKETS), key=ORDER.__getitem__)
    return {"class": worst, "market": None}


def claim_named(product: dict[str, Any]) -> bool:
    return bool(CLAIM_NAME.search(str(product.get("name", ""))))


def is_suggestible(product: dict[str, Any], market: str | None) -> bool:
    """May Willow suggest it (plan, Wisp, swaps)? Cosmetics and sunscreens only, never a
    never-suggest ingredient, never a product named for a condition. Unknown market: it must be
    a cosmetic (or a sunscreen) in every market."""
    if never_suggest(product) or claim_named(product):
        return False
    markets = [market] if market in MARKETS else list(MARKETS)
    return all(
        classify(product, m) == "cosmetic" or (is_sunscreen(product) and m == "US") for m in markets
    )
