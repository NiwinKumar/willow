"""Pick the products the synthetic cohort uses (api/app/cohort.py) and what Proof measures them on.

    cd api && uv run python scripts/pick_cohort_products.py           # print the pick only
    cd api && uv run python scripts/pick_cohort_products.py --write   # write both seed files

Writes, from api/seed/products.json and research/finals/catalog-brands.json (brands found in
discovery: kind famous or niche, hero products most famous first):
- api/seed/cohort_products.json: TOTAL product ids, best known first.
- api/seed/cohort_concerns.json: {product_id: [concerns]} for picked products whose catalog
  record still has no concerns (since Nov 28 most index products carry the concerns their brand
  claims, scripts/fill_catalog_concerns.py; this overlay covers only those where no claim was
  found). Inferred from the product's name, else the most common measurable concern of full
  products in its category. Used only by the cohort and Proof (cohort.concerns_of), never by the
  consumer catalog.

Pick rule, deterministic (same files in, same files out):
1. The first CORE ids of the current cohort_products.json, in order (the demo journeys and tests
   name them).
2. Then every full product whose researched concerns map to a goal Willow measures.
3. Then index products, best known first: famous brands before niche brands before brands not
   in discovery; within that, the product's position in its brand's hero list (round robin, so
   every famous brand's best seller comes before any brand's second), then the brand's position.
   A product with no hero match comes after its brand's hero products.
Steps 2 and 3 fill quotas per category (CATEGORY_SHARE) and per region (REGION_SHARE, by the
product's nearest APAC region) on the first pass; later passes fill what is left by rank,
keeping only the region quotas, then only the category quotas, then none. A product that would
still map to no measured goal is skipped.
"""

import argparse
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import catalog, cohort, regions  # noqa: E402

BRANDS_PATH = ROOT.parent / "research" / "finals" / "catalog-brands.json"
OUT_IDS = ROOT / "seed" / "cohort_products.json"
OUT_CONCERNS = ROOT / "seed" / "cohort_concerns.json"
TOTAL = 1500
CORE = 48
CATEGORY_SHARE = {
    "serum": 0.25,
    "moisturizer": 0.17,
    "cleanser": 0.14,
    "sunscreen": 0.13,
    "toner": 0.09,
    "mask": 0.07,
    "eye_care": 0.06,
    "exfoliant": 0.06,
    "treatment": 0.03,
}
# A product's region bucket: the first of these it is sold in (own regions and store regions).
BUCKETS = ("KR", "JP", "CN", "SEA", "GCC", "IN", "AU", "GLOBAL", "WEST")
# Nov 28: KR, JP and CN are tagged by brand origin (scripts/tag_catalog_regions.py), so K- and
# J-beauty products moved out of GLOBAL into their own buckets; each bucket has a share now (CN
# has only 11 catalog products). Later passes fill what a short bucket leaves.
REGION_SHARE = {
    "KR": 0.20,
    "JP": 0.09,
    "CN": 0.01,
    "SEA": 0.06,
    "GLOBAL": 0.05,
    "IN": 0.17,
    "AU": 0.16,
    "WEST": 0.26,
}

# Name keywords -> catalog concerns (matched on the folded name; every rule that matches adds).
RULES: list[tuple[str, list[str]]] = [
    (
        r"\bacne|blemish|breakout|pimple|\bspot (patch|gel|treatment|corrector)|\bbha\b|salicyl"
        r"|tea tree|azelaic|benzoyl|clarif|\bclear\b|purif|anti-?bacterial",
        ["acne_blemishes"],
    ),
    (
        r"oil[ -]?control|oil[ -]?free|oily|matt|shine|sebum|\bclay\b|charcoal|mud\b",
        ["oiliness_shine"],
    ),
    (
        r"\bpore|blackhead|exfoliat|\baha\b|\bpha\b|glycolic|lactic|mandelic|peel|resurfac|scrub"
        r"|texture|smooth|enzyme|polish",
        ["texture_pores"],
    ),
    (
        r"vitamin c|vit c|\bc ?15|ascorb|arbutin|tranexamic|kojic|licorice|glutathione|dark spot"
        r"|pigment|melasma|whiten|d-?tan|de-?tan|spot correct|anti-?dark",
        ["dark_spots_pigmentation"],
    ),
    (
        r"bright|\beven\b|\btone\b|tone[ -]?up|radian|lumin|illumin|glow|dull|vitamin c|\brice\b"
        r"|niacinamide",
        ["uneven_tone", "dullness"],
    ),
    (
        r"retin|bakuchiol|peptide|collagen|wrinkle|firm|anti-?ag|\bage\b|ageing|aging|lift|youth"
        r"|renew|repair serum|plump",
        ["fine_lines"],
    ),
    (
        r"calm|sooth|cica|centella|heartleaf|houttuynia|madecass|sensitiv|redness|mugwort"
        r"|panthenol|azulene|chamomile|\bpure|gentle",
        ["redness_sensitivity"],
    ),
    (r"\beye|under ?eye|dark circle", ["dark_circles"]),
]


def fold(s: str) -> str:
    return catalog.fold(s)


def measurable(concerns: list[str]) -> bool:
    return any(cohort.CONCERN_GOAL.get(c) for c in concerns)


def category_defaults(products: list[dict[str, Any]]) -> dict[str, str]:
    """The most common measurable concern of full products in each category."""
    counts: dict[str, Counter] = defaultdict(Counter)
    for p in products:
        if catalog.is_full(p):
            for c in p["concerns"]:
                if cohort.CONCERN_GOAL.get(c):
                    counts[p["category"]][c] += 1
    return {cat: c.most_common(1)[0][0] for cat, c in counts.items()}


def infer(p: dict[str, Any], defaults: dict[str, str]) -> list[str]:
    """Concerns for a product with none in the catalog: from its name, else its category's."""
    name = fold(p["name"])
    out: list[str] = []
    for pattern, concerns in RULES:
        if re.search(pattern, name):
            out += [c for c in concerns if c not in out]
    if p["category"] == "eye_care" and "dark_circles" not in out:
        out.append("dark_circles")
    if p["category"] == "sunscreen" and not measurable(out):
        out.append("dark_spots_pigmentation")  # daily SPF: fewer new dark spots
    if not measurable(out) and p["category"] in defaults:
        out.append(defaults[p["category"]])
    return out[:3]


def bucket(p: dict[str, Any]) -> str:
    rs = regions.regions(p)
    for b in BUCKETS[:-1]:
        if b in rs:
            return b
    return "WEST"


def fame_ranks(products: list[dict[str, Any]]) -> dict[str, tuple]:
    """product_id -> sort key for index products: (brand kind, hero position, brand position,
    catalog position)."""
    brands = json.loads(BRANDS_PATH.read_text())
    kind = {fold(b["brand"]): (0 if b["kind"] == "famous" else 1, i) for i, b in enumerate(brands)}
    hero: dict[str, int] = {}
    for b in brands:
        for pos, h in enumerate(b["products"]):
            m = catalog.match(b["brand"], h["name"])
            if m and m[1] >= 0.75 and m[0]["product_id"] not in hero:
                hero[m[0]["product_id"]] = pos
    out = {}
    for i, p in enumerate(products):
        k, bpos = kind.get(fold(p["brand"]), (2, 10_000))
        out[p["product_id"]] = (k, hero.get(p["product_id"], 100), bpos, i)
    return out


def pick(total: int = TOTAL) -> tuple[list[str], dict[str, list[str]]]:
    products = list(catalog.products())
    by_id = {p["product_id"]: p for p in products}
    defaults = category_defaults(products)
    core = [i for i in json.loads(OUT_IDS.read_text())[:CORE] if i in by_id]
    concerns = {p["product_id"]: (p["concerns"] or infer(p, defaults)) for p in products}
    full = [p for p in products if catalog.is_full(p) and measurable(p["concerns"])]
    ranks = fame_ranks(products)
    index = sorted(
        (p for p in products if not catalog.is_full(p) and measurable(concerns[p["product_id"]])),
        key=lambda p: ranks[p["product_id"]],
    )
    ranked = [p for p in full + index if p["product_id"] not in core]

    chosen = list(core)
    taken = set(core)
    cat_n = Counter(by_id[i]["category"] for i in chosen)
    reg_n = Counter(bucket(by_id[i]) for i in chosen)
    cat_cap = {c: math.ceil(s * total) for c, s in CATEGORY_SHARE.items()}
    reg_cap = {r: math.ceil(s * total) for r, s in REGION_SHARE.items()}

    def fill(use_cat: bool, use_reg: bool) -> None:
        for p in ranked:
            if len(chosen) >= total:
                return
            pid, cat, reg = p["product_id"], p["category"], bucket(p)
            if pid in taken:
                continue
            if use_cat and cat_n[cat] >= cat_cap.get(cat, 0):
                continue
            if use_reg and reg in reg_cap and reg_n[reg] >= reg_cap[reg]:
                continue
            chosen.append(pid)
            taken.add(pid)
            cat_n[cat] += 1
            reg_n[reg] += 1

    fill(True, True)
    fill(False, True)
    fill(True, False)
    fill(False, False)
    inferred = {pid: concerns[pid] for pid in chosen if not by_id[pid]["concerns"]}
    return chosen, inferred


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--total", type=int, default=TOTAL)
    args = ap.parse_args(argv)
    ids, inferred = pick(args.total)
    by_id = {p["product_id"]: p for p in catalog.products()}
    print(f"{len(ids)} products, {len(inferred)} with inferred concerns")
    print("by category:", dict(Counter(by_id[i]["category"] for i in ids).most_common()))
    print("by region:", dict(Counter(bucket(by_id[i]) for i in ids).most_common()))
    print("by detail:", dict(Counter(catalog.detail(by_id[i]) for i in ids)))
    if args.write:
        OUT_IDS.write_text(json.dumps(ids, indent=2) + "\n")
        OUT_CONCERNS.write_text(json.dumps(inferred, indent=1, sort_keys=True) + "\n")
        print(f"wrote {OUT_IDS.name} and {OUT_CONCERNS.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
