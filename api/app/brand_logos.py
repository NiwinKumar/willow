"""Brand logos for Proof by Willow: each catalog brand's own logo, as its own site declares it
(apple-touch-icon, icon, or the Organization logo). Found by scripts/find_brand_logos.py and
seeded in api/seed/brand_logos.json as `{brand: {logo_url, source, kind}}`. The image stays on the
brand's site (linked, never copied). A brand with no entry has no logo: callers show its initials.
"""

import json
from functools import cache
from pathlib import Path

SEED = Path(__file__).resolve().parent.parent / "seed" / "brand_logos.json"


@cache
def _seed() -> dict[str, dict[str, str]]:
    if not SEED.exists():
        return {}
    raw = json.loads(SEED.read_text())
    return {b: v for b, v in raw.items() if isinstance(v, dict) and v.get("logo_url")}


def logos() -> dict[str, str]:
    """Every brand with a logo -> its URL."""
    return {b: v["logo_url"] for b, v in _seed().items()}


def logo_of(brand: str | None) -> str | None:
    return _seed().get(brand or "", {}).get("logo_url")
