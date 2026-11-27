"""GET /v1/proof/research: the methodology page of Proof by Willow, read from the code.

Every threshold here is the constant the aggregates actually use (retail_intel, retailer,
campaigns, baselines), and the metric dictionary is built from the contract schema, the engine
fixture's metric records and the explanation word tables: nothing is retyped, so the page cannot
drift from what the numbers mean. The cohort counts and the data dates come from the live rows;
when BigQuery is unavailable they are null and `data_available` is false (the method still
stands).
"""

import copy
import logging
from typing import Any

from app import baselines, campaigns, cohort, engine, explain, retail_intel, retailer
from app.contract import load

log = logging.getLogger("willow.proof_research")

# What the consent covers (scripts/export_bq.py real_rows reads exactly this flag).
CONSENT_BASIS = (
    "Only people who opted in to sharing anonymised results, a choice separate from the app's "
    "terms (users/{uid}.consent.aggregate_insights_opt_in), are included, "
    "under a one-way hash, with their goals and skin type. Photos, names and emails never leave "
    "Willow. Switching it off removes the person from the next data export."
)
# research/finals/06 section 4.2: the rule set between the retailer, its brands and anyone.
BRANDS_SEE = [
    "Their own products by name, with every aggregate above the minimum group",
    "Category median and best in category",
    "Competitors as historical outcome aggregates, named only if the retailer's policy allows it",
    "Requests sent to them, and their own campaigns, claims and decisions",
]
BRANDS_NEVER_SEE = [
    "Any person, photo or per-person result",
    "Any group smaller than the minimum group",
    "Another organisation's campaigns, spend, targeting, holdout results, claim drafts, "
    "evidence requests, stock file or plans",
]
RETAILER_SEES = [
    "Every product and brand in its range by name, with every aggregate above the minimum group",
]
RETAILER_NEVER_SEES = ["Any person, photo or per-person result", "Any group under the minimum"]


def tiers() -> list[dict[str, Any]]:
    """The Proof tier rule (retail_intel.tier_of), from its constants."""
    n_min, n_proven = retail_intel.MIN, retail_intel.PROVEN_N
    rules = {
        "proven": f"At least {n_proven} people reached week {retail_intel.WEEKS}, and the lower "
        "end of the 95% interval of the lift over non-users with the same goals is above zero.",
        "promising": f"At least {n_min} people reached week {retail_intel.WEEKS} and the lift "
        "over non-users is above zero, but it is not Proven yet (fewer than "
        f"{n_proven} people, or the interval still includes zero).",
        "unclear": f"At least {n_min} people, and the lift is zero or below (or no comparison "
        "group of non-users).",
        "too_few": f"Fewer than {n_min} people reached week {retail_intel.WEEKS}: no outcome "
        "numbers are shown.",
    }
    order = sorted(retail_intel.TIER_ORDER, key=retail_intel.TIER_ORDER.get)
    return [
        {
            "id": t,
            "label": retail_intel.TIER_LABEL[t],
            "rule": rules[t],
            "min_n": n_proven if t == "proven" else n_min,
        }
        for t in order
    ]


def metric_dictionary() -> list[dict[str, Any]]:
    """id, name, unit, desired direction and what a change means, for every metric id in the
    contract schema."""
    ids = load("analysis_result.schema.json")["$defs"]["metric_id"]["enum"]
    records = copy.deepcopy(load("analysis_result.sample.json")["metrics"])
    records += copy.deepcopy(engine._FIXTURE_EXTRA_METRICS)
    by_id = {m["id"]: m for m in records}
    out = []
    for mid in ids:
        rec = by_id.get(mid, {})
        words = explain.DIRECTION_WORDS.get(mid)
        unit = rec.get("unit")
        out.append(
            {
                "id": mid,
                "name": rec.get("label") or mid.replace("_", " ").capitalize(),
                "group": rec.get("group"),
                "unit": unit,
                "unit_display": explain.METRIC_UNIT_DISPLAY.get(mid)
                or explain.UNIT_DISPLAY.get(unit or "", "").strip()
                or None,
                # skin tone is descriptive: it has no better direction, and is never an outcome
                "better": None
                if words is None
                else ("higher" if mid in explain.WANTED_HIGHER else "lower"),
                "lower_means": words[0] if words else None,
                "higher_means": words[1] if words else None,
                "outcome": mid in retail_intel.METRIC_WORDS,
            }
        )
    return out


def _data() -> dict[str, Any]:
    """Cohort counts and the data dates from the live rows (mixed cohort, all time)."""
    try:
        f, _, _ = retail_intel.facts("mixed", "all")
    except Exception:  # BigQuery unavailable and nothing cached
        log.warning("proof_research: rows unavailable", exc_info=True)
        return {"data_available": False, "cohort": None, "data_from": None, "data_to": None}
    starts = [t for t in (retailer._ts(u.get("started_at")) for u in f.users.values()) if t]
    ends = [t for t in (retailer._ts(u.get("last_ts")) for u in f.users.values()) if t]
    counts = f.cohort
    return {
        "data_available": True,
        "cohort": {
            "real": counts.get("real", 0),
            "simulated": counts.get("synthetic", 0),
            "label": retail_intel.cohort_label(counts),
        },
        "data_from": min(starts).date().isoformat() if starts else None,
        "data_to": max(ends).date().isoformat() if ends else None,
    }


def research() -> dict[str, Any]:
    return {
        "method": retail_intel.METHOD,
        "window": retail_intel.WINDOW,
        "weeks": retail_intel.WEEKS,
        "caveat": retail_intel.CAVEAT,
        "tiers": tiers(),
        "noise": {
            "rule": "A metric counts as changed only when it moves beyond the person's own noise "
            "band (MDC95, the smallest change their repeated photos can tell apart from noise) "
            f"in the better direction, and still holds at week {retailer.WEEKS}.",
            "band_photos": baselines.NOISE_BAND_FRAMES,
            "confidence": 0.95,
        },
        "suppression": {
            "min_group": retailer.MIN_GROUP,
            "rule": f"Every group of fewer than {retailer.MIN_GROUP} people is hidden in the "
            "data layer, before any view, export or answer sees it. When exactly one cell of a "
            "breakdown is hidden, the next smallest is hidden too, so the hidden count cannot be "
            "worked out from the total.",
        },
        "holdout": {
            "share": campaigns.HOLDOUT_PCT,
            "min_group": campaigns.MIN_GROUP,
            "rule": f"{round(campaigns.HOLDOUT_PCT * 100)}% of the people a campaign matches "
            "are picked at random never to see its card; adoption among those who could see it "
            "is compared with the holdout once both groups have "
            f"{campaigns.MIN_GROUP} people.",
        },
        "simulated": {
            "people": cohort.USERS,
            "weeks": cohort.WEEKS,
            "seed": cohort.SEED,
            "note": "A simulated cohort fills the dashboards until enough real people opt in; "
            "it is labelled wherever it is shown, and claims from it cannot be exported.",
        },
        **_data(),
        "metrics": metric_dictionary(),
        "consent": CONSENT_BASIS,
        "visibility": {
            "retailer_sees": RETAILER_SEES,
            "retailer_never_sees": RETAILER_NEVER_SEES,
            "brands_see": BRANDS_SEE,
            "brands_never_see": BRANDS_NEVER_SEE,
        },
    }
