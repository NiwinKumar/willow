"""Freeze the inputs the retailer jobs need, so eval runs compare models on the same data.

    cd api && uv run python -m evals.snapshot

Writes evals/data/insights.json (the suppressed aggregates Ask sees, groups under 10 already
hidden) and evals/data/proof_views.json (the claim inputs for a few Proven/Promising products:
the product row, its evidence statements and the self-reported share). Both come from the
BigQuery tables the api serves (read-only); the cohort is the synthetic demo cohort plus any
opted-in people as aggregates, so no row about a person is written.
"""

import json
from pathlib import Path

from app import retail_intel, retailer

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


if __name__ == "__main__":
    main()
