"""Embed full catalog products' formulas, for "Similar formula" (app/similar.py).

    cd api && uv run python scripts/embed_catalog.py            # full products, writes the seed
    cd api && uv run python scripts/embed_catalog.py --check    # which products are missing/stale

The text embedded is the formula, not the marketing: category, key actives with their printed %,
the head of the INCI list and the concerns the catalog lists. One call per product (a list of
texts sent to gemini-embedding-2 comes back as ONE embedding, Nov 27), a few in parallel.
Vectors are cut to DIMENSIONS with the API's output_dimensionality and normalised, so cosine is a
dot product at runtime; no embedding call is ever made while serving. Run it again after the
catalog changes (the file records a hash of each product's text, so stale rows are visible).
"""

import argparse
import hashlib
import json
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from google.genai import types

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import catalog, gemini  # noqa: E402

MODEL = "gemini-embedding-2"
DIMENSIONS = 256
INCI_HEAD = 12
OUT = Path(__file__).resolve().parents[1] / "seed" / "catalog_embeddings.json"


def formula_text(p: dict[str, Any]) -> str:
    """category + key actives with % + INCI head + concerns (never brand, name or price: the
    neighbours should share a formula, not a brand)."""
    actives = ", ".join(
        f"{a['name']} {a['pct']:g}%" if a.get("pct") is not None else a["name"]
        for a in p.get("key_actives") or []
    )
    inci = ", ".join((p.get("inci") or [])[:INCI_HEAD])
    concerns = ", ".join(c.replace("_", " ") for c in p.get("concerns") or [])
    return (
        f"Category: {p['category']}. Key actives: {actives or 'none listed'}. "
        f"Ingredients: {inci}. Concerns: {concerns or 'none listed'}."
    )


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:12]


def _unit(v: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [round(x / norm, 5) for x in v]


def embed(text: str) -> list[float]:
    for attempt in range(3):
        try:
            res = gemini.client().models.embed_content(
                model=MODEL,
                contents=text,
                config=types.EmbedContentConfig(
                    output_dimensionality=DIMENSIONS, task_type="SEMANTIC_SIMILARITY"
                ),
            )
            return _unit(list(res.embeddings[0].values))
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    raise AssertionError("unreachable")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report missing or stale rows only")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    products = [product for product in catalog.products() if catalog.is_full(product)]
    texts = {p["product_id"]: formula_text(p) for p in products}
    old = json.loads(OUT.read_text()) if OUT.exists() else {"items": {}, "hashes": {}}
    stale = [pid for pid, t in texts.items() if old.get("hashes", {}).get(pid) != text_hash(t)]
    if args.check:
        print(f"{len(products)} full products, {len(stale)} missing or stale: {stale[:10]}")
        return 1 if stale else 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        vectors = dict(zip(texts, pool.map(embed, texts.values()), strict=True))
    out = {
        "model": MODEL,
        "dimensions": DIMENSIONS,
        "built_at": datetime.now(UTC).date().isoformat(),
        "text": "category + key actives with % + first 12 INCI + concerns (scripts/embed_catalog)",
        "hashes": {pid: text_hash(t) for pid, t in texts.items()},
        "items": vectors,
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {len(vectors)} vectors x {DIMENSIONS} to {OUT} ({OUT.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
