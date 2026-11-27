"""Merge catalog shards (JSON arrays of product records) into api/seed/products.json.

    uv run python scripts/merge_catalog_shards.py <shards_dir>            # dry run: report only
    uv run python scripts/merge_catalog_shards.py <shards_dir> --write    # also write the files

Every `*.json` file in the folder (sorted by name) must be a JSON array of records shaped like
`seed/products.json` (docs/CATALOG_SPEC.md) plus `detail` ("full" or "index", default "full") and
`notes` (what was checked, and any caveat: the shard's notes replace VERIFY.md for new products).
Each record is validated (enums, ISO currencies, http(s) links, a slug product_id, real dates;
a full record needs an ingredient list and a price), its region codes normalised (SG, MY, TH,
VN, PH and ID are SEA), and dropped when it repeats a product already in the catalog or earlier
in the shards, by product_id or by brand + name (case, accents and punctuation aside). An
existing product is never overwritten. The report lists what each shard added and every
rejection with its reason. `--write` appends the accepted records to products.json and rewrites
seed/catalog.csv from it (the sheet view stays the same data).
"""

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any, Literal

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from import_catalog import COLUMNS, to_row  # noqa: E402
from pydantic import (  # noqa: E402
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

from app.catalog import CATALOG_PATH, CATEGORIES, CONCERNS, StorePrice, fold  # noqa: E402

CSV_PATH = CATALOG_PATH.parent / "catalog.csv"
Region = Literal["IN", "US", "UK", "EU", "KR", "JP", "CN", "AU", "SEA", "GCC", "GLOBAL"]
Category = Literal[CATEGORIES]  # type: ignore[valid-type]
Concern = Literal[CONCERNS]  # type: ignore[valid-type]
# Country codes the catalog files under one region tag.
REGION_ALIASES = {
    "SG": "SEA",
    "MY": "SEA",
    "TH": "SEA",
    "VN": "SEA",
    "PH": "SEA",
    "ID": "SEA",
    "HK": "CN",
    "TW": "CN",
    "NZ": "AU",
    "GB": "UK",
}
SLUG = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
URL = r"^https?://[^\s/$.?#][^\s]*$"
DAY = r"^\d{4}-\d{2}-\d{2}$"


def _region(code: Any) -> Any:
    if not isinstance(code, str):
        return code
    code = code.strip().upper()
    return REGION_ALIASES.get(code, code)


class KeyActive(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    pct: float | None = Field(default=None, ge=0, le=100)


class Price(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount: float = Field(gt=0)
    currency: str = Field(pattern=r"^[A-Z]{3}$")  # ISO 4217


class StoreLink(BaseModel):
    model_config = ConfigDict(extra="forbid")
    store: str = Field(min_length=1, max_length=80)
    url: str = Field(pattern=URL)
    region: Region
    price: StorePrice | None = None

    @field_validator("region", mode="before")
    @classmethod
    def _norm_region(cls, v: Any) -> Any:
        return _region(v)


class Record(BaseModel):
    """One products.json record as a shard must write it."""

    model_config = ConfigDict(extra="forbid")
    product_id: str = Field(pattern=SLUG, max_length=120)
    brand: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=160)
    category: Category
    concerns: list[Concern] = Field(default_factory=list)
    # How empty concerns were filled (scripts/fill_catalog_concerns.py); missing: researched.
    concerns_source: Literal["brand_page", "name"] | None = None
    key_actives: list[KeyActive] = Field(default_factory=list)
    inci: list[str] = Field(default_factory=list)
    price: Price | None = None
    size: str = Field(default="", max_length=40)
    region: list[Region] = Field(min_length=1)
    stores: list[StoreLink] = Field(default_factory=list)
    image_url: str | None = Field(default=None, pattern=URL)
    image_source: str | None = Field(default=None, pattern=URL)
    source_url: str = Field(pattern=URL)
    last_verified: str = Field(pattern=DAY)
    detail: Literal["full", "index"] = "full"
    notes: str = Field(default="", max_length=2000)

    @field_validator("region", mode="before")
    @classmethod
    def _regions(cls, v: Any) -> Any:
        if not isinstance(v, list):
            return v
        return list(dict.fromkeys(_region(r) for r in v))

    @field_validator("inci")
    @classmethod
    def _inci(cls, v: list[str]) -> list[str]:
        if any(not i.strip() for i in v):
            raise ValueError("empty ingredient name")
        return [i.strip() for i in v]

    @field_validator("last_verified")
    @classmethod
    def _day(cls, v: str) -> str:
        date.fromisoformat(v)  # 2026-02-30 is not a day
        return v

    @model_validator(mode="after")
    def _complete(self) -> "Record":
        if self.detail == "full" and not self.inci:
            raise ValueError("a full record needs its ingredient list (inci)")
        if self.detail == "full" and self.price is None:
            raise ValueError("a full record needs a price")
        if self.image_url and not self.image_source:
            raise ValueError("image_source (the page the image is shown on) is missing")
        return self


def name_key(brand: str, name: str) -> str:
    """Brand + name with case, accents, punctuation and spaces aside."""
    return fold(f"{brand} {name}").replace(" ", "")


def _reason(exc: ValidationError) -> str:
    out = []
    for e in exc.errors():
        where = ".".join(str(x) for x in e["loc"])
        msg = e["msg"].removeprefix("Value error, ")
        out.append(f"{where}: {msg}" if where else msg)
    return "; ".join(out)


def _dump(r: Record) -> dict[str, Any]:
    """The record as products.json writes it: no empty notes, no empty image fields."""
    out = r.model_dump()
    if not out["notes"]:
        del out["notes"]
    for k in ("image_url", "image_source", "concerns_source"):
        if out[k] is None:
            del out[k]
    return out


def _filled(r: dict[str, Any]) -> tuple[int, int, int, int, int]:
    return (
        r.get("detail") == "full",
        bool(r.get("inci")),
        bool(r.get("price")),
        bool(r.get("image_url")),
        sum(1 for st in r.get("stores") or [] if st.get("price")),
    )


def _better(new: dict[str, Any], old: dict[str, Any]) -> bool:
    return _filled(new) > _filled(old)


def _brand_slug(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def canonical_brands(
    existing: list[dict[str, Any]], shards: list[tuple[str, Any]]
) -> dict[str, str]:
    """One spelling per brand ("NIVEA" and "Nivea" are one brand; Proof makes one organisation per
    brand). The catalog's existing spelling wins; otherwise the most used spelling, and on a tie
    the one that is not all capitals."""
    seen: dict[str, Counter] = {}
    for _, data in shards:
        for r in data if isinstance(data, list) else []:
            if isinstance(r, dict) and isinstance(r.get("brand"), str) and r["brand"].strip():
                seen.setdefault(_brand_slug(r["brand"]), Counter())[r["brand"].strip()] += 1
    canon = {_brand_slug(p["brand"]): p["brand"] for p in existing}
    for slug, names in seen.items():
        if slug not in canon:
            canon[slug] = max(names, key=lambda n: (names[n], not n.isupper(), n != n.lower()))
    return canon


def merge(
    existing: list[dict[str, Any]], shards: list[tuple[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(accepted records in shard order, one report row per shard). `shards` holds each shard's
    name and its parsed JSON (or the error text when it did not parse)."""
    ids = {p["product_id"] for p in existing}
    names = {name_key(p["brand"], p["name"]): p["product_id"] for p in existing}
    old_ids = set(ids)
    canon = canonical_brands(existing, shards)
    accepted: list[dict[str, Any]] = []
    where: dict[str, int] = {}  # product_id of a new record -> its index in `accepted`
    report = []
    for shard, data in shards:
        row: dict[str, Any] = {"shard": shard, "accepted": 0, "full": 0, "index": 0, "rejected": []}
        report.append(row)
        if isinstance(data, str) or not isinstance(data, list):
            row["error"] = data if isinstance(data, str) else "not a JSON array"
            continue
        for i, raw in enumerate(data):
            label = raw.get("product_id") if isinstance(raw, dict) else None
            label = label or f"#{i}"
            if not isinstance(raw, dict):
                row["rejected"].append({"record": label, "reason": "not an object"})
                continue
            if isinstance(raw.get("brand"), str):
                raw = {**raw, "brand": canon.get(_brand_slug(raw["brand"]), raw["brand"].strip())}
            try:
                rec = Record.model_validate(raw)
            except ValidationError as exc:
                row["rejected"].append({"record": label, "reason": _reason(exc)})
                continue
            key = name_key(rec.brand, rec.name)
            twin = rec.product_id if rec.product_id in ids else names.get(key)
            if twin is not None:
                # The same product twice in the new shards: keep the better record (full facts
                # over index, then the one with more filled in). Never replace an existing product.
                if (
                    twin not in old_ids
                    and twin in where
                    and _better(_dump(rec), accepted[where[twin]])
                ):
                    accepted[where[twin]] = {**_dump(rec), "product_id": twin}
                    row["replaced"] = row.get("replaced", 0) + 1
                else:
                    reason = (
                        "duplicate product_id"
                        if rec.product_id in ids
                        else f"same brand and name as {twin}"
                    )
                    row["rejected"].append({"record": label, "reason": reason})
                continue
            ids.add(rec.product_id)
            names[key] = rec.product_id
            where[rec.product_id] = len(accepted)
            accepted.append(_dump(rec))
            row["accepted"] += 1
            row[rec.detail] += 1
    return accepted, report


def read_shards(folder: Path) -> list[tuple[str, Any]]:
    out: list[tuple[str, Any]] = []
    for path in sorted(folder.glob("*.json")):
        try:
            out.append((path.name, json.loads(path.read_text())))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            out.append((path.name, f"unreadable: {exc}"))
    return out


def print_report(report: list[dict[str, Any]], existing: int, accepted: int) -> None:
    for row in report:
        if "error" in row:
            print(f"{row['shard']}: skipped ({row['error']})")
            continue
        print(
            f"{row['shard']}: {row['accepted']} accepted ({row['full']} full, "
            f"{row['index']} index), {len(row['rejected'])} rejected"
        )
        for r in row["rejected"]:
            print(f"  - {r['record']}: {r['reason']}")
    print(f"catalog: {existing} existing + {accepted} new = {existing + accepted} products")


def write_csv(products: list[dict[str, Any]], path: Path) -> None:
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(to_row(p) for p in products)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("shards", type=Path, help="folder of *.json shards")
    ap.add_argument("--write", action="store_true", help="write products.json and catalog.csv")
    ap.add_argument("--catalog", type=Path, default=CATALOG_PATH, help=argparse.SUPPRESS)
    ap.add_argument("--csv", type=Path, default=CSV_PATH, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    if not args.shards.is_dir():
        print(f"{args.shards} is not a folder", file=sys.stderr)
        return 2
    existing = json.loads(args.catalog.read_text())
    accepted, report = merge(existing, read_shards(args.shards))
    print_report(report, len(existing), len(accepted))
    if not args.write:
        print("dry run: nothing written (add --write)")
        return 0
    merged = existing + accepted
    args.catalog.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n")
    write_csv(merged, args.csv)
    print(f"wrote {len(merged)} products to {args.catalog} and {args.csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
