"""Similar formula: catalog products whose formula reads like this one's (07 §B4).

Each product's formula text (category, key actives with %, INCI head, concerns) was embedded once
with gemini-embedding-2 by scripts/embed_catalog.py into seed/catalog_embeddings.json (unit
vectors, 256 dimensions). Here it is plain cosine over those vectors, in memory: no model call
while serving, and nothing about a person is involved. A same-category neighbour gets a small
boost so a serum's neighbours are serums first. The score is formula likeness only: the web says
"Similar formula" / "similar ingredient list", never "works the same".

`GET /v1/catalog/{product_id}/similar?k=5&market=US` ->
{"items": [{"product": {...}, "score": 0.93}]}; with `market`, only products sold there (or
GLOBAL) and suggestible there, as swaps (app/plan.py);
the router is mounted by app/main.py (lead). Unknown product: 404; a product without a vector
(added after the seed was built) or with nothing above MIN_SCORE: an empty list.
"""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app import catalog, plan, regulatory
from app.auth import AuthUser, current_user

SEED = Path(__file__).resolve().parents[1] / "seed" / "catalog_embeddings.json"
# Added to the cosine of a same-category product for ranking only (the score shown is the
# plain cosine). Neighbours in the 256-d formula space sit about 0.8-0.95 apart, so 0.05 moves a
# same-category product ahead of a near tie without lifting an unrelated one over a close match.
SAME_CATEGORY_BOOST = 0.05
MAX_K = 10
# Below this cosine a neighbour is not a similar formula, only the nearest thing in the catalog
# (Nov 27: a hydrocolloid patch's nearest products are a retinol serum and an azelaic gel at about
# 0.8; two 10% niacinamide + zinc serums sit at 0.96). Such products get an empty list.
MIN_SCORE = 0.85


@lru_cache
def vectors() -> dict[str, list[float]]:
    """product_id -> unit vector; empty when the seed file is missing."""
    if not SEED.exists():
        return {}
    return json.loads(SEED.read_text())["items"]


def cosine(a: list[float], b: list[float]) -> float:
    """Dot product of unit vectors (the seed stores them normalised)."""
    return sum(x * y for x, y in zip(a, b, strict=True))


def similar_products(
    product_id: str, k: int = 5, market: regulatory.Market | None = None
) -> list[dict[str, Any]]:
    """Up to k other catalog products, most similar formula first, with the cosine as score.
    `market`: only those sold and suggestible there (the swaps' rule, plan.swaps)."""
    vecs = vectors()
    me = catalog.by_id(product_id)
    mine = vecs.get(product_id)
    if me is None or mine is None:
        return []
    ranked = []
    for other in catalog.products():
        pid = other["product_id"]
        if pid == product_id or pid not in vecs:
            continue
        if market and not (
            plan.sold_in(other, market) and regulatory.is_suggestible(other, market)
        ):
            continue
        score = cosine(mine, vecs[pid])
        if score < MIN_SCORE:
            continue
        boost = SAME_CATEGORY_BOOST if other["category"] == me["category"] else 0.0
        ranked.append((score + boost, score, pid, other))
    ranked.sort(key=lambda r: (-r[0], r[2]))
    return [{"product": p, "score": round(score, 3)} for _, score, _, p in ranked[:k]]


router = APIRouter(prefix="/v1", tags=["catalog"])


@router.get("/catalog/{product_id}/similar")
def catalog_similar(
    product_id: str,
    k: int = Query(default=5, ge=1, le=MAX_K),
    market: regulatory.Market | None = None,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    if catalog.by_id(product_id) is None:
        raise HTTPException(404, {"code": "not_found", "message": "product not found"})
    return {"items": similar_products(product_id, k, market)}
