"""Apply follow-up research to products already in the catalog (catalog growth, Nov 2026).

`merge_catalog_shards.py` only adds new products. This one upgrades existing ones from the same
shards folder:

- `facts-*.json`: full records for products already in the catalog as "index". A record replaces
  the index one only if it validates as a full record (INCI and a checked price) with the same
  product_id. A full product is never replaced, the brand keeps the catalog's spelling, and an
  image already on the product is kept when the new record has none.
- `images-*.json`: [{product_id, image_url, image_source}] for products without a photo. A product
  that already has one keeps it.

    cd api && uv run python scripts/apply_catalog_updates.py <shards folder>            # dry run
    cd api && uv run python scripts/apply_catalog_updates.py <shards folder> --write    # update
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parent))

from merge_catalog_shards import (  # noqa: E402
    CATALOG_PATH,
    CSV_PATH,
    URL,
    Record,
    _dump,
    _reason,
    write_csv,
)

URL_RE = re.compile(URL)


def apply(
    products: list[dict[str, Any]], facts: list[dict[str, Any]], images: list[dict[str, Any]]
) -> dict[str, list[str]]:
    """Update `products` in place; returns what happened, per outcome."""
    by_id = {p["product_id"]: p for p in products}
    out: dict[str, list[str]] = {
        "upgraded": [],
        "imaged": [],
        "skipped": [],
        "rejected": [],
    }
    for raw in facts:
        pid = raw.get("product_id") if isinstance(raw, dict) else None
        cur = by_id.get(pid or "")
        if cur is None:
            out["rejected"].append(f"{pid}: not in the catalog")
            continue
        if cur.get("detail", "full") == "full":
            out["skipped"].append(f"{pid}: already full")
            continue
        try:
            rec = Record.model_validate({**raw, "brand": cur["brand"], "detail": "full"})
        except ValidationError as exc:
            out["rejected"].append(f"{pid}: {_reason(exc)}")
            continue
        new = _dump(rec)
        if not new.get("image_url") and cur.get("image_url"):
            new["image_url"], new["image_source"] = cur["image_url"], cur.get("image_source")
        cur.clear()
        cur.update(new)
        out["upgraded"].append(pid)
    for raw in images:
        pid = raw.get("product_id") if isinstance(raw, dict) else None
        cur = by_id.get(pid or "")
        if cur is None:
            out["rejected"].append(f"{pid}: image for a product not in the catalog")
            continue
        url, source = raw.get("image_url"), raw.get("image_source")
        if not (isinstance(url, str) and URL_RE.match(url)):
            out["rejected"].append(f"{pid}: image_url is not an http(s) link")
            continue
        if cur.get("image_url"):
            out["skipped"].append(f"{pid}: already has a photo")
            continue
        cur["image_url"] = url
        if isinstance(source, str) and URL_RE.match(source):
            cur["image_source"] = source
        out["imaged"].append(pid)
    return out


def _read(folder: Path, pattern: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in sorted(folder.glob(pattern)):
        data = json.loads(path.read_text())
        if isinstance(data, list):
            rows.extend(r for r in data if isinstance(r, dict))
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("folder", type=Path)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--catalog", type=Path, default=CATALOG_PATH, help=argparse.SUPPRESS)
    ap.add_argument("--csv", type=Path, default=CSV_PATH, help=argparse.SUPPRESS)
    args = ap.parse_args()
    products = json.loads(args.catalog.read_text())
    report = apply(
        products, _read(args.folder, "facts-*.json"), _read(args.folder, "images-*.json")
    )
    for key, rows in report.items():
        print(f"{key}: {len(rows)}")
        if key == "rejected":
            for r in rows:
                print(f"  - {r}")
    full = sum(p.get("detail", "full") == "full" for p in products)
    photos = sum(bool(p.get("image_url")) for p in products)
    print(f"catalog: {len(products)} products, {full} full, {photos} with a photo")
    if args.write:
        args.catalog.write_text(json.dumps(products, indent=2, ensure_ascii=False) + "\n")
        write_csv(products, args.csv)
        print(f"wrote {args.catalog} and {args.csv}")
    else:
        print("dry run: nothing written (add --write)")


if __name__ == "__main__":
    main()
