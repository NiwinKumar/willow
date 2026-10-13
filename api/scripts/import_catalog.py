"""Catalog sheet <-> api/seed/products.json <-> Firestore products/ (docs/CATALOG_SPEC.md).

    uv run python scripts/import_catalog.py from-csv catalog.csv   # sheet export -> products.json
    uv run python scripts/import_catalog.py to-csv catalog.csv     # products.json -> sheet import
    uv run python scripts/import_catalog.py seed                   # products.json -> Firestore

Sheet columns: list fields are separated by " | "; key_actives are "name:pct" (pct may be empty);
stores take four column triples store_N_name, store_N_url, store_N_region. image_url is the
brand's own product image, linked (never copied); image_source is the page it is shown on.
"""

import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.catalog import CATALOG_PATH, CATEGORIES, CONCERNS  # noqa: E402

SEP = " | "
REGIONS = {"IN", "US", "UK", "EU", "KR", "SEA", "GCC", "GLOBAL"}
STORE_SLOTS = 4
COLUMNS = [
    "product_id",
    "brand",
    "name",
    "category",
    "concerns",
    "key_actives",
    "inci",
    "price_amount",
    "price_currency",
    "size",
    "region",
    "source_url",
    "last_verified",
    "image_url",
    "image_source",
] + [f"store_{i}_{f}" for i in range(1, STORE_SLOTS + 1) for f in ("name", "url", "region")]


def _split(cell: str) -> list[str]:
    return [x.strip() for x in (cell or "").split(SEP.strip()) if x.strip()]


def validate(p: dict) -> list[str]:
    problems = []
    if p["category"] not in CATEGORIES:
        problems.append(f"category {p['category']!r}")
    problems += [f"concern {c!r}" for c in p["concerns"] if c not in CONCERNS]
    problems += [f"region {r!r}" for r in p["region"] if r not in REGIONS]
    if not p["stores"]:
        problems.append("no store links")
    problems += [
        f"store url {s['url']!r}" for s in p["stores"] if not s["url"].startswith("https://")
    ]
    if not p["source_url"].startswith("https://"):
        problems.append("source_url")
    if p.get("image_url") and not p["image_url"].startswith("https://"):
        problems.append("image_url")
    if p.get("image_url") and not (p.get("image_source") or "").startswith("https://"):
        problems.append("image_source (the page the image is shown on)")
    return problems


def from_row(row: dict[str, str]) -> dict:
    actives = []
    for item in _split(row["key_actives"]):
        name, _, pct = item.partition(":")
        actives.append({"name": name.strip().lower(), "pct": float(pct) if pct.strip() else None})
    stores = [
        {
            "store": row[f"store_{i}_name"].strip(),
            "url": row[f"store_{i}_url"].strip(),
            "region": row[f"store_{i}_region"].strip(),
        }
        for i in range(1, STORE_SLOTS + 1)
        if row.get(f"store_{i}_url", "").strip()
    ]
    return {
        "product_id": row["product_id"].strip(),
        "brand": row["brand"].strip(),
        "name": row["name"].strip(),
        "category": row["category"].strip(),
        "concerns": _split(row["concerns"]),
        "key_actives": actives,
        "inci": _split(row["inci"]),
        "price": {"amount": float(row["price_amount"]), "currency": row["price_currency"].strip()},
        "size": row["size"].strip(),
        "region": _split(row["region"]),
        "stores": stores,
        "image_url": (row.get("image_url") or "").strip() or None,
        "image_source": (row.get("image_source") or "").strip() or None,
        "source_url": row["source_url"].strip(),
        "last_verified": row["last_verified"].strip(),
    }


def _pct(pct: float | None) -> str:
    return "" if pct is None else f"{pct:g}"


def to_row(p: dict) -> dict[str, str]:
    row = {
        "product_id": p["product_id"],
        "brand": p["brand"],
        "name": p["name"],
        "category": p["category"],
        "concerns": SEP.join(p["concerns"]),
        "key_actives": SEP.join(f"{a['name']}:{_pct(a['pct'])}" for a in p["key_actives"]),
        "inci": SEP.join(p["inci"]),
        "price_amount": f"{p['price']['amount']:g}",
        "price_currency": p["price"]["currency"],
        "size": p["size"],
        "region": SEP.join(p["region"]),
        "source_url": p["source_url"],
        "last_verified": p["last_verified"],
        "image_url": p.get("image_url") or "",
        "image_source": p.get("image_source") or "",
    }
    for i in range(1, STORE_SLOTS + 1):
        s = p["stores"][i - 1] if i <= len(p["stores"]) else {"store": "", "url": "", "region": ""}
        row.update(
            {
                f"store_{i}_name": s["store"],
                f"store_{i}_url": s["url"],
                f"store_{i}_region": s["region"],
            }
        )
    return row


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "from-csv":
        with open(sys.argv[2], newline="") as f:
            products = [from_row(r) for r in csv.DictReader(f) if r.get("product_id", "").strip()]
        bad = {p["product_id"]: validate(p) for p in products}
        bad = {k: v for k, v in bad.items() if v}
        ids = [p["product_id"] for p in products]
        dupes = {i for i in ids if ids.count(i) > 1}
        if bad or dupes:
            for pid, problems in bad.items():
                print(f"{pid}: {', '.join(problems)}", file=sys.stderr)
            for pid in dupes:
                print(f"{pid}: duplicate product_id", file=sys.stderr)
            return 1
        CATALOG_PATH.write_text(json.dumps(products, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {len(products)} products to {CATALOG_PATH}")
    elif cmd == "to-csv":
        products = json.loads(CATALOG_PATH.read_text())
        with open(sys.argv[2], "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=COLUMNS)
            writer.writeheader()
            writer.writerows(to_row(p) for p in products)
        print(f"wrote {len(products)} rows to {sys.argv[2]}")
    elif cmd == "seed":
        from app import gcp

        db = gcp.firestore_client()
        products = json.loads(CATALOG_PATH.read_text())
        batch = db.batch()
        for p in products:
            batch.set(db.document(f"products/{p['product_id']}"), p)
        batch.commit()
        print(f"seeded {len(products)} products into Firestore products/")
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
