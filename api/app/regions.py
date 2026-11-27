"""Where the person shops (`profile.safety.market`) and how near each catalog region is to it.

The one place the api maps a market to its catalog region and currency (app/plan.py, app/regulatory
.py, app/catalog.py read from here). Catalog products and their stores carry region codes (GLOBAL,
US, UK, EU, IN, KR, JP, CN, AU, SEA, GCC). A product's distance from a market is the best rank of
its own regions and its stores' regions in that region's fixed nearest-first order: the person's
own region 0, GLOBAL 1 (sold everywhere, so sold here too), then the others by rough geography and
shopping ties; a product with no known region comes last. Lists that show products without the
person naming one (browse, suggestions, swaps, similar, Wisp, sponsored) put the nearest first.
"""

from typing import Any, Literal

Market = Literal[
    "SG", "MY", "TH", "ID", "PH", "VN", "IN", "KR", "JP", "CN", "HK", "TW", "AU", "NZ", "US",
    "UK", "EU", "GCC",
]  # fmt: skip
MARKETS: tuple[str, ...] = Market.__args__  # type: ignore[attr-defined]

MARKET_REGION: dict[str, str] = {
    **{m: "SEA" for m in ("SG", "MY", "TH", "ID", "PH", "VN")},
    "HK": "CN",
    "TW": "CN",
    "NZ": "AU",
    **{m: m for m in ("IN", "KR", "JP", "CN", "AU", "US", "UK", "EU", "GCC")},
}
MARKET_CURRENCY: dict[str, str] = {
    "SG": "SGD",
    "MY": "MYR",
    "TH": "THB",
    "ID": "IDR",
    "PH": "PHP",
    "VN": "VND",
    "IN": "INR",
    "KR": "KRW",
    "JP": "JPY",
    "CN": "CNY",
    "HK": "HKD",
    "TW": "TWD",
    "AU": "AUD",
    "NZ": "NZD",
    "US": "USD",
    "UK": "GBP",
    "EU": "EUR",
    "GCC": "AED",
}
MARKET_WORDS: dict[str, str] = {
    "SG": "Singapore",
    "MY": "Malaysia",
    "TH": "Thailand",
    "ID": "Indonesia",
    "PH": "the Philippines",
    "VN": "Vietnam",
    "IN": "India",
    "KR": "South Korea",
    "JP": "Japan",
    "CN": "China",
    "HK": "Hong Kong",
    "TW": "Taiwan",
    "AU": "Australia",
    "NZ": "New Zealand",
    "US": "the US",
    "UK": "the UK",
    "EU": "the EU",
    "GCC": "the Gulf",
}

# Nearest first, per region. Every list holds all 11 codes; GLOBAL always second.
ORDER: dict[str, tuple[str, ...]] = {
    "SEA": ("SEA", "GLOBAL", "KR", "JP", "CN", "AU", "IN", "GCC", "US", "UK", "EU"),
    "IN": ("IN", "GLOBAL", "SEA", "GCC", "KR", "JP", "CN", "AU", "UK", "US", "EU"),
    "KR": ("KR", "GLOBAL", "JP", "CN", "SEA", "AU", "IN", "US", "UK", "EU", "GCC"),
    "JP": ("JP", "GLOBAL", "KR", "CN", "SEA", "AU", "IN", "US", "UK", "EU", "GCC"),
    "CN": ("CN", "GLOBAL", "KR", "JP", "SEA", "AU", "IN", "US", "UK", "EU", "GCC"),
    "AU": ("AU", "GLOBAL", "SEA", "KR", "JP", "CN", "IN", "US", "UK", "EU", "GCC"),
    "US": ("US", "GLOBAL", "UK", "EU", "KR", "JP", "CN", "AU", "SEA", "IN", "GCC"),
    "UK": ("UK", "GLOBAL", "EU", "US", "GCC", "IN", "KR", "JP", "CN", "SEA", "AU"),
    "EU": ("EU", "GLOBAL", "UK", "US", "GCC", "IN", "KR", "JP", "CN", "SEA", "AU"),
    "GCC": ("GCC", "GLOBAL", "IN", "UK", "EU", "SEA", "KR", "JP", "CN", "AU", "US"),
}
RANK = {region: {r: i for i, r in enumerate(order)} for region, order in ORDER.items()}
FAR = len(ORDER["US"])  # a product with no known region


def region_of(market: str | None) -> str | None:
    return MARKET_REGION.get(market or "")


def regions(product: dict[str, Any]) -> set[str]:
    """The product's own regions and its stores' regions."""
    own = set(product.get("region") or [])
    return own | {s.get("region") for s in product.get("stores") or [] if s.get("region")}


def distance(product: dict[str, Any], market: str | None) -> int:
    """0 = sold in the person's region, 1 = GLOBAL, up to FAR (no known region). Unknown or no
    market: 0 for every product, so a sort by distance keeps the order it had."""
    region = region_of(market)
    if region is None:
        return 0
    rank = RANK[region]
    return min((rank[r] for r in regions(product) if r in rank), default=FAR)


def sold_in(product: dict[str, Any], market: str | None) -> bool:
    """Sold in the person's region or GLOBAL (no market: everywhere counts)."""
    return market is None or distance(product, market) <= 1


def nearest_first(products: list[dict[str, Any]], market: str | None) -> list[dict[str, Any]]:
    """A stable sort by distance: within one distance the order given stays."""
    return sorted(products, key=lambda p: distance(p, market))
