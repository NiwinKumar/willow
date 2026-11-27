"""POST /v1/plan (app/plan.py), GET /v1/evidence-clock and the guest's sample routine."""

import json

import pytest

from app import catalog, plan, routine_check, safety

US = {
    "skin_type": "combination",
    "goals": ["blemishes", "dark_spots"],
    "budget": {"max_per_product": 25, "currency": "USD"},
    "steps": 4,
    "market": "US",
}


@pytest.fixture(autouse=True)
def no_outcome_tiers(monkeypatch):
    """Plans rank without outcome data unless a test gives some."""
    monkeypatch.setattr(plan, "proof_tiers", lambda: {})


def _texts(out) -> list[str]:
    """Every sentence the plan writes itself (not the catalog's product facts)."""
    p = out["profile"]
    texts = [p["title"], *p["focus"], *p["avoid"], *p["cautions"]]
    texts += [t["label"] for t in p["traits"]] + [t["detail"] for t in p["traits"]]
    texts += [f["label"] for f in out["funnel"]] + [s["text"] for s in out["schedule"]]
    texts += out["notes"] + [w for k in out["picks"] for w in k["why"]]
    return texts


def test_a_plan_has_the_base_one_active_and_a_funnel_that_narrows(client, fake):
    res = client.post("/v1/plan", json=US)
    assert res.status_code == 200, res.text
    out = res.json()
    assert [k["slot"] for k in out["picks"]] == ["cleanser", "moisturizer", "sunscreen", "active"]
    ns = [f["n"] for f in out["funnel"]]
    assert ns[0] == len(catalog.products()) and ns == sorted(ns, reverse=True) and ns[-1] > 0
    for k in out["picks"]:
        p = k["product"]
        price = plan.price_in(p, "USD")
        assert price is not None and price <= 25  # priced in the budget's currency, never converted
        assert (
            k["check"]["status"] in ("clear", "check")
            and k["check"]["regulatory"]["market"] == "US"
        )
    active = out["picks"][3]
    assert active["start_week"] == 2 and active["verdict_week"] > active["start_week"]
    assert active["evidence"]["source"] and active["check"]["status"] == "clear"
    total = sum(plan.price_in(k["product"], "USD") for k in out["picks"])
    assert out["total"] == {"amount": round(total, 2), "currency": "USD"}
    assert [s["week"] for s in out["schedule"]] == sorted(s["week"] for s in out["schedule"])
    # the plan's own words never name a condition
    assert not [t for t in _texts(out) if "acne" in t.lower()]


def test_the_profile_lists_typed_ingredients_as_left_out(client, fake):
    body = {**US, "safety": {"avoid": ["fragrance"], "avoid_ingredients": ["Linalool"]}}
    out = client.post("/v1/plan", json=body).json()
    assert out["profile"]["avoid"] == ["Fragrance", "Linalool"]


def test_pregnancy_leaves_retinoids_out_and_says_so(client, fake):
    body = {**US, "goals": ["lines"], "safety": {"life_stage": "pregnant"}}
    out = client.post("/v1/plan", json=body).json()
    assert "Retinoids are left out while pregnant" in out["profile"]["cautions"]
    for k in out["picks"]:
        assert "retinoid" not in routine_check.classes_of(k["product"])
        for alt in k["alternatives"]:
            assert safety.check(alt, {"life_stage": "pregnant"})["status"] != "avoid"


def test_reactive_skin_gets_fragrance_free_picks_and_one_active(client, fake):
    out = client.post("/v1/plan", json={**US, "reactive": True, "steps": 5}).json()
    assert out["profile"]["title"] == "Combination, easily irritated"
    assert all(not safety.has_fragrance(k["product"]) for k in out["picks"])
    assert [k["slot"] for k in out["picks"]].count("active") <= 1
    assert "Your skin reacts easily, so the plan starts with one active only." in out["notes"]


def test_two_actives_never_clash(client, fake):
    out = client.post("/v1/plan", json={**US, "steps": 5, "budget": None}).json()
    a, b = [k["product"] for k in out["picks"] if k["slot"] == "active"]
    assert plan._compatible(a, b)
    first, second = [k for k in out["picks"] if k["slot"] == "active"]
    assert second["start_week"] == first["start_week"] + 4  # one new active at a time


def test_nothing_fits_names_the_step(client, fake):
    res = client.post("/v1/plan", json={**US, "budget": {"max_per_product": 1, "currency": "USD"}})
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["code"] == "nothing_fits" and detail["step"] == "budget"
    assert detail["message"] == "No cleanser in the catalog costs $1 or less."
    # one tap away: the cheapest cleanser the answers allow, and the budget that unlocks it
    assert (
        detail["nearest"]["price"] > 1 and detail["nearest"]["budget"] >= detail["nearest"]["price"]
    )


def test_a_market_without_local_prices_plans_in_usd_and_says_so(client, fake):
    body = {**US, "market": "UK", "budget": {"max_per_product": 30, "currency": "GBP"}}
    out = client.post("/v1/plan", json=body).json()
    assert out["currency_note"] == plan.CURRENCY_NOTE and out["total"]["currency"] == "USD"
    assert all(plan.sold_in(k["product"], "UK") for k in out["picks"])


def test_outcome_tiers_break_ties_and_are_labelled_simulated(client, fake, monkeypatch):
    first = client.post("/v1/plan", json=US).json()["picks"][0]
    runner_up = first["alternatives"][0]["product_id"]
    tiers = {runner_up: {"tier": "proven", "n": 214, "simulated": True}}
    monkeypatch.setattr(plan, "proof_tiers", lambda: tiers)
    again = client.post("/v1/plan", json=US).json()
    cleanser = again["picks"][0]
    assert cleanser["product"]["product_id"] == runner_up
    assert cleanser["proof"] == {"tier": "proven", "n": 214, "simulated": True}
    assert "Rated Proven in Willow's outcome data (simulated cohort)" in cleanser["why"]


def test_evidence_clock(client, fake):
    clock = client.get("/v1/evidence-clock").json()
    assert clock["actives"]["niacinamide"]["first_look_weeks"] == 4
    assert clock["actives"]["niacinamide"]["verdict_weeks"] == 8
    assert clock["basics"]["sunscreen"] is None
    for key in ("retinol", "vitamin_c", "azelaic_acid", "benzoyl_peroxide", "peptides"):
        assert clock["actives"][key]["grade"] in ("A", "B", "C")
    assert plan.clock_for(catalog.by_id("the-ordinary-niacinamide-10-zinc-1"))["active"] == (
        "niacinamide"
    )
    sunscreen = next(p for p in catalog.products() if p["category"] == "sunscreen")
    assert plan.clock_for(sunscreen) is None
    json.dumps(clock)  # served as is


def test_a_guest_starter_routine_is_marked_sample(client, fake):
    assert client.post("/v1/demo/judge-setup").json()["routine_added"] == 4
    entries = client.get("/v1/routine").json()["entries"]
    assert entries and all(e["sample"] is True for e in entries)
    mine = client.post(
        "/v1/routine",
        json={"product_id": "the-ordinary-niacinamide-10-zinc-1", "slots": ["am"]},
    ).json()
    assert mine["sample"] is False


def test_a_price_range_with_no_cleanser_falls_back_instead_of_dead_ending(client, fake):
    res = client.post("/v1/plan", json={**US, "tier": "premium"})
    assert res.status_code == 200, res.json()
    assert any("price range" in n for n in res.json()["notes"])


def test_nothing_fits_says_what_ruled_products_out(client, fake):
    safety_ = {**US.get("safety", {}), "avoid": ["fragrance"], "reactive": True}
    body = {
        **US,
        "reactive": True,
        "safety": safety_,
        "budget": {"max_per_product": 13.5, "currency": "USD"},
    }
    res = client.post("/v1/plan", json=body)
    assert res.status_code == 422
    d = res.json()["detail"]
    assert d["nearest"]["price"] > 13.5
    if d["step"] == "flags":
        assert "ruled out by your answers" in d["message"] and d["reasons"][0]["n"] >= 1
