"""Freeze the inputs the retailer jobs need, so eval runs compare models on the same data.

    cd api && uv run python -m evals.snapshot

Writes evals/data/insights.json (the suppressed aggregates Ask sees, groups under 10 already
hidden) and evals/data/proof_views.json (the claim inputs for a few Proven/Promising products:
the product row, its evidence statements and the self-reported share). Both come from the
BigQuery tables the api serves (read-only); the cohort is the synthetic demo cohort plus any
opted-in people as aggregates, so no row about a person is written.

    cd api && uv run python -m evals.snapshot ask

writes only evals/data/ask_pack.json: what Ask reads slice by slice (retailer_ask.Source) for the
seat cases (cases/retailer_ask_seats.json): today's aggregates and Proof views, cut down to a few
brands so the file stays small (the catalog has 3,200 products), and the sample campaigns of one
brand seat and of the retailer seat. Aggregates only, as above.
"""

import json
import sys
from pathlib import Path
from typing import Any

from app import campaigns, dev_seed, proof_ai, retail_intel, retailer
from app.store import MemoryStore

DATA = Path(__file__).resolve().parent / "data"
# The products the Proof claim cases use (two Proven, one Promising whose name holds a word the
# claim rules ban, which is the natural trap for a draft).
PROOF_PRODUCTS = (
    "the-derma-co-1-hyaluronic-sunscreen-aqua-gel-spf-50",
    "beauty-of-joseon-glow-deep-serum-rice-alpha-arbutin",
    "cosrx-acne-pimple-master-patch",
    "round-lab-mugwort-calming-toner",
)


def claim_view(view: dict) -> dict:
    """Only what proof_ai.claims reads."""
    p = view["product"]
    feel = view.get("feel") or {}
    return {
        "product": {k: p[k] for k in ("product_id", "brand", "product", "tier")},
        "evidence": [{k: e[k] for k in ("id", "kind", "text", "n")} for e in view["evidence"]],
        "evidence_caveat": view.get("evidence_caveat"),
        "feel": {"working": feel.get("working"), "n": feel.get("n")} if feel else None,
    }


def main() -> None:
    DATA.mkdir(exist_ok=True)
    insights = {k: v for k, v in retailer.insights().items() if k != "filters"}
    (DATA / "insights.json").write_text(json.dumps(insights, indent=1, default=str))
    f, _, _ = retail_intel.facts()
    views = {pid: claim_view(retail_intel.product_view(f, pid)) for pid in PROOF_PRODUCTS}
    (DATA / "proof_views.json").write_text(json.dumps(views, indent=1, default=str))
    for name in ("insights.json", "proof_views.json"):
        print(name, (DATA / name).stat().st_size, "bytes")


# -- what Ask reads (retailer_ask.Source), frozen for the seat cases -----------------------------

ASK_BRANDS = ("Minimalist", "The Ordinary", "COSRX", "CeraVe")  # the first is the brand seat
ASK_ORGS = {"Minimalist": "minimalist", "": "northside"}  # demo orgs whose sample campaigns
SLIM_KEYS = ["product", "brand", "tier_label", "n", "rate"]
ROW_KEYS = [
    "product_id",
    "product",
    "brand",
    "category",
    "category_label",
    "goal_ids",
    "n",
    "rate",
    "base_rate",
    "lift",
    "lift_lo",
    "weeks",
    "cont8",
    "tier",
    "tier_label",
    "reason",
    "to_proven",
]


def _row(r: dict[str, Any]) -> dict[str, Any]:
    return {k: r.get(k) for k in ROW_KEYS}


def _detail(view: dict[str, Any]) -> dict[str, Any]:
    """A product page, only what retailer_ask._focus and _cells read."""
    comp, sw = view["competitors"], view["switching"]
    near = [r for i, r in enumerate(comp["rows"]) if i < 5 or r.get("is_self")]
    return {
        "product": _row(view["product"]),
        "segments": {k: view["segments"][k] for k in ("skin", "goal")},
        "competitors": {
            "rank": comp["rank"],
            "of": comp["of"],
            "rows": [{**{k: r[k] for k in SLIM_KEYS}, "is_self": r["is_self"]} for r in near],
        },
        "co_used": [{k: c[k] for k in ("product", "brand", "n", "share")} for c in view["co_used"]],
        "switching": {k: sw[k] for k in ("stopped", "to_brands", "from_brands")},
        "conflicts": view["conflicts"],
        "eligibility": view["eligibility"],
        "feel": {k: view["feel"][k] for k in ("n", "working")} if view.get("feel") else None,
        "curve": view["curve"],
    }


def _brand(view: dict[str, Any]) -> dict[str, Any]:
    return {k: view[k] for k in ("brand", "goals", "share", "switching", "skin")}


def _segments(view: dict[str, Any]) -> dict[str, Any]:
    slim = ("product", "brand", "rate", "n", "lift")
    return {
        **{k: view[k] for k in ("skin_types", "goals")},
        "cells": [
            {**c, "best": c["best"] and {k: c["best"][k] for k in slim[:4]}, "runner_up": None}
            for c in view["cells"]
        ],
        "by_skin": [
            {**s, "top_products": [{k: p[k] for k in slim} for p in s["top_products"][:5]]}
            for s in view["by_skin"]
        ],
    }


def _sample_campaigns(org_id: str) -> list[dict[str, Any]]:
    """The sample portfolio a demo member of `org_id` gets (app/dev_seed.py), as their Campaigns
    page shows it: built in memory, nothing is written anywhere."""
    store = MemoryStore()
    dev_seed.seed_demo_campaigns(store, "eval", org_id)
    views = [campaigns.view(store, cid, d) for cid, d in store.campaigns_of("eval")]
    for v in views:
        v["stats"].pop("daily", None)
        v.pop("image_url", None)
    return views


def ask_pack() -> dict[str, Any]:
    f, _, _ = retail_intel.facts()
    rows = retail_intel.products()["products"]
    best = sorted((r for r in rows if r["tier"] == "proven"), key=lambda r: -r["lift"])[:30]
    near = sorted((r for r in rows if r["to_proven"]), key=lambda r: r["to_proven"])[:10]
    kept = {r["product_id"]: r for r in [*best, *near] if r["brand"] not in ASK_BRANDS}
    kept |= {r["product_id"]: r for r in rows if r["brand"] in ASK_BRANDS}
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["tier_label"]] = counts.get(r["tier_label"], 0) + 1
    # the product rows come from Proof (`rows`); the aggregates' own copies are not read
    insights = {
        k: v for k, v in retailer.insights().items() if k not in ("products", "product_outcomes")
    }
    insights["perception"] = [
        p for p in proof_ai.perception_rows("mixed", "all") if p["brand"] in ASK_BRANDS
    ]
    seat = [r for r in kept.values() if r["brand"] == ASK_BRANDS[0] and r["n"]]
    focus = [r["product_id"] for r in seat] + [r["product_id"] for r in best[:3]]
    return {
        "insights": insights,
        "rows": [_row(r) for r in kept.values()],
        "tier_counts": counts,
        "details": {pid: _detail(retail_intel.product_view(f, pid)) for pid in focus},
        "segments": _segments(retail_intel.segments()),
        "brands": {b: _brand(retail_intel.brand(b)) for b in ASK_BRANDS[:2]},
        "cards": {b: retail_intel.brief_cards(f, b or None) for b in ("", ASK_BRANDS[0])},
        "campaigns": {b: _sample_campaigns(org) for b, org in ASK_ORGS.items()},
    }


def write_ask_pack() -> None:
    DATA.mkdir(exist_ok=True)
    path = DATA / "ask_pack.json"
    path.write_text(json.dumps(ask_pack(), separators=(",", ":"), default=str))
    print(path.name, path.stat().st_size, "bytes")


if __name__ == "__main__":
    write_ask_pack() if sys.argv[1:] == ["ask"] else main()
