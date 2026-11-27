"""Tag catalog products with their brand's home region: KR, JP or CN (catalog gap, Nov 28).

Almost no product carried KR, JP or CN although many brands are Korean, Japanese or Chinese, so
people in those regions never saw their own brands as nearby. For every product this adds:
- the brand's home region, from the brand's `origin` in research/finals/catalog-brands.json
  (South Korea -> KR, Japan -> JP, China, Hong Kong or Taiwan -> CN);
- for a brand with no origin there, the home region its pages show: a product, store or image
  link on a Korean, Japanese or Chinese site (.kr, .jp, .cn, .hk, .tw domains; Tmall, JD,
  Taobao) or on a store that sells only that country's brands (HOME_STORES). A brand whose links
  point to two home regions gets neither;
- any KR, JP or CN region one of the product's own store entries already carries.
Regions are only ever added, never removed or reordered (new ones go at the end).

    uv run python scripts/tag_catalog_regions.py           # dry run: counts before and after
    uv run python scripts/tag_catalog_regions.py --write   # also write products.json, catalog.csv
"""

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from app.catalog import CATALOG_PATH, fold  # noqa: E402

BRANDS_PATH = ROOT.parent / "research" / "finals" / "catalog-brands.json"
CSV_PATH = CATALOG_PATH.parent / "catalog.csv"
HOME = ("KR", "JP", "CN")
ORIGIN_REGION = {
    "south korea": "KR",
    "korea": "KR",
    "japan": "JP",
    "china": "CN",
    "hong kong": "CN",
    "taiwan": "CN",
}
# Country domains and marketplaces of a home region.
TLD_REGION = {".kr": "KR", ".jp": "JP", ".cn": "CN", ".hk": "CN", ".tw": "CN"}
MARKETPLACES = {"tmall.com": "CN", "jd.com": "CN", "taobao.com": "CN", "tmall.hk": "CN"}
# Stores that sell only one country's brands (checked: every brand of known origin the catalog
# links there is from that country; Nivea on Kokoro has its own origin, Germany, which wins).
HOME_STORES = {
    "jolse.com": "KR",
    "stylekorean.com": "KR",
    "oliveyoung.com": "KR",
    "kokorojapanstore.com": "JP",
}


def origins(brands: list[dict[str, Any]]) -> dict[str, str | None]:
    """folded brand -> home region for every brand with a known origin (None: not KR, JP or
    CN; then its links are not read either)."""
    return {
        fold(b["brand"]): ORIGIN_REGION.get(str(b["origin"]).strip().lower())
        for b in brands
        if b.get("origin")
    }


def host_region(url: str | None) -> str | None:
    host = (urlparse(url or "").hostname or "").lower()
    if not host:
        return None
    for domain, region in {**MARKETPLACES, **HOME_STORES}.items():
        if host == domain or host.endswith("." + domain):
            return region
    return next((r for tld, r in TLD_REGION.items() if host.endswith(tld)), None)


def links(p: dict[str, Any]) -> list[str]:
    return [p.get("source_url"), p.get("image_source")] + [
        s.get("url") for s in p.get("stores") or []
    ]


def brand_regions(products: list[dict[str, Any]], known: dict[str, str | None]) -> dict[str, str]:
    """folded brand -> home region: its known origin, else the one home region its links show."""
    seen: dict[str, set[str]] = defaultdict(set)
    for p in products:
        brand = fold(p["brand"])
        if brand in known:
            continue
        for url in links(p):
            if region := host_region(url):
                seen[brand].add(region)
    from_links = {b: next(iter(rs)) for b, rs in seen.items() if len(rs) == 1}
    return {**from_links, **{b: r for b, r in known.items() if r}}


def tag(products: list[dict[str, Any]], home: dict[str, str]) -> Counter:
    """Add home regions in place; returns how many products gained each region and why."""
    added: Counter = Counter()
    for p in products:
        want = []
        if region := home.get(fold(p["brand"])):
            want.append((region, "brand"))
        want += [(s["region"], "store") for s in p.get("stores") or [] if s.get("region") in HOME]
        for region, why in want:
            if region not in p["region"]:
                p["region"] = [*p["region"], region]
                added[f"{region} ({why})"] += 1
    return added


def counts(products: list[dict[str, Any]]) -> Counter:
    return Counter(r for p in products for r in p["region"])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true", help="write products.json and catalog.csv")
    args = ap.parse_args(argv)
    products = json.loads(CATALOG_PATH.read_text())
    before = counts(products)
    home = brand_regions(products, origins(json.loads(BRANDS_PATH.read_text())))
    added = tag(products, home)
    after = counts(products)
    print("added:", dict(sorted(added.items())))
    for r in sorted(set(before) | set(after), key=lambda r: -after[r]):
        print(f"  {r:6} {before[r]:5} -> {after[r]:5}")
    if not args.write:
        print("dry run: nothing written (add --write)")
        return 0
    from merge_catalog_shards import write_csv

    CATALOG_PATH.write_text(json.dumps(products, indent=2, ensure_ascii=False) + "\n")
    write_csv(products, CSV_PATH)
    print(f"wrote {CATALOG_PATH} and {CSV_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
