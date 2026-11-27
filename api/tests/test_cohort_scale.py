"""The scaled synthetic cohort (app/cohort.py, scripts/pick_cohort_products.py): its 1,500
products, what Proof measures index products on, routines that lean to products sold nearby, and
a realistic spread of Proof tiers (not every product Proven)."""

import json
from collections import Counter
from datetime import date

import pytest

from app import catalog, cohort, regions, retail_intel, retailer

TODAY = date(2026, 11, 28)


def test_cohort_products_keep_the_first_48_and_are_all_measured():
    ids = json.loads(cohort.COHORT_PRODUCTS.read_text())
    assert len(ids) == len(set(ids)) == 1500
    assert ids[0] == "the-ordinary-niacinamide-10-zinc-1"  # the Oct 15 cohort leads, in order
    by_id = {p["product_id"]: p for p in catalog.products()}
    assert all(i in by_id for i in ids)
    # after the first 48, every product maps to a goal Willow measures
    assert all(cohort.product_goals(by_id[i]) for i in ids[48:])
    # every category is there, none dominates
    cats = Counter(by_id[i]["category"] for i in ids)
    assert len(cats) == 9 and max(cats.values()) < 0.3 * len(ids)
    # products sold in Southeast Asia or everywhere are well covered (a Singapore retailer)
    near = sum(1 for i in ids if regions.distance(by_id[i], "SG") <= 1)
    assert near > 400


def test_inferred_concerns_are_only_for_products_without_any_and_stay_out_of_the_catalog():
    inferred = json.loads(cohort.COHORT_CONCERNS.read_text())
    ids = json.loads(cohort.COHORT_PRODUCTS.read_text())
    # since Nov 28 most products carry their brand's claims; the overlay covers the rest only
    assert 0 < len(inferred) < 0.25 * len(ids)
    assert all(catalog.by_id(i)["concerns"] == [] for i in inferred)
    pid, concerns = next(iter(sorted(inferred.items())))
    p = catalog.by_id(pid)
    assert p["concerns"] == []  # the consumer catalog is unchanged
    assert cohort.concerns_of(p) == concerns
    assert retailer.product_targets(p) == cohort.product_metrics(p) != []
    # a product with researched concerns keeps them
    niac = catalog.by_id("the-ordinary-niacinamide-10-zinc-1")
    assert niac["product_id"] not in inferred and cohort.concerns_of(niac) == niac["concerns"]


def test_routines_lean_to_products_sold_where_people_live():
    t = cohort.generate(TODAY)
    region = {u["user_hash"]: u["region"] for u in t["users_flat"]}
    sold_in_india = {
        p["product_id"] for p in cohort.cohort_products() if "IN" in regions.regions(p)
    }
    uses: dict[bool, list[bool]] = {True: [], False: []}
    for r in t["routine_flat"]:
        uses[region[r["user_hash"]] == "IN"].append(r["product_id"] in sold_in_india)
    share = {k: sum(v) / len(v) for k, v in uses.items()}
    assert share[True] > share[False] + 0.1
    assert {u["region"] for u in t["users_flat"]} == {r for r, _ in cohort.REGIONS}


@pytest.fixture
def wider_cohort(monkeypatch: pytest.MonkeyPatch):
    """More people over more products than the default test cohort (still about 2 s)."""
    monkeypatch.setattr(cohort, "USERS", 5000)
    monkeypatch.setattr(cohort, "PRODUCT_LIMIT", 150)


def test_tiers_come_out_of_the_simulation_with_a_realistic_spread(wider_cohort):
    raw = retailer.raw_from_tables(cohort.generate(TODAY))
    f = retail_intel.build_facts(retailer.select(raw, "mixed", "all", TODAY))
    ids = set(cohort.cohort_product_ids())
    rows = [r for r in retail_intel.rows(f) if r["product_id"] in ids]
    tiers = Counter(r["tier"] for r in rows)
    measured = len(rows) - tiers["too_few"]
    assert measured > 100
    # Proven is earned (n >= 30 and the lift's interval above zero), not stamped
    assert 0.3 < tiers["proven"] / measured < 0.8
    assert tiers["unclear"] > 0.15 * measured  # about 3 in 10 products have no effect
    assert all(
        r["n"] >= retail_intel.PROVEN_N and r["lift_lo"] > 0 for r in rows if r["tier"] == "proven"
    )


def test_facts_keep_only_the_most_recently_used_filters(monkeypatch: pytest.MonkeyPatch):
    raw = retailer.raw_from_tables(cohort.generate(TODAY))
    monkeypatch.setattr(retailer, "fetch", lambda: raw)
    monkeypatch.setattr(retailer, "_raw", {"at": 0.0, "data": None, "version": 0})
    monkeypatch.setattr(retail_intel, "_facts", {})
    for c in ("mixed", "simulated", "real"):
        retail_intel.facts(c, "all")
    assert len(retail_intel._facts) == retail_intel.FACTS_KEEP
    assert ("mixed", "all") not in retail_intel._facts  # the oldest went first
    retail_intel.facts("simulated", "all")  # a hit moves it to the newest
    assert list(retail_intel._facts)[-1] == ("simulated", "all")
