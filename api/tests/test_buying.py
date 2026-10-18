"""Buying list (app/buying.py, GET /v1/retailer/buying-list): assortment gaps as briefs, with
under-used catalog products as candidates, never presented as proven."""

from datetime import date
from functools import lru_cache

import pytest
from fastapi.testclient import TestClient

from app import buying, catalog, cohort, retailer
from app.main import app


def _tier(options, rate, n):
    return {"options": options, "rate": rate, "n": n}


def _ins(gaps, demand):
    return {
        "gaps": [{"goal_id": g, "goal": retailer.GOAL_LABEL[g], **t} for g, t in gaps.items()],
        "needs": [{"goal_id": g, "n": n} for g, n in demand.items()],
    }


def test_each_kind_of_gap_is_found_and_ranked_by_people_and_severity():
    ins = _ins(
        {
            "redness": {
                "budget": _tier(0, None, 0),
                "mid": _tier(3, 0.42, 128),
                "premium": _tier(2, 0.6, 40),
            },
            "even_tone": {
                "budget": _tier(4, 0.1, 141),
                "mid": _tier(5, 0.15, 239),
                "premium": _tier(3, 0.07, 119),
            },
            "lines": {
                "budget": _tier(3, 0.39, 189),
                "mid": _tier(1, 0.36, 125),
                "premium": _tier(2, None, 4),
            },
            "under_eye": {
                "budget": _tier(0, None, 0),
                "mid": _tier(1, 0.4, 60),
                "premium": _tier(1, 0.4, 50),
            },
        },
        {"redness": 340, "even_tone": 443, "lines": 200, "under_eye": 9},
    )
    found = {g["id"]: g for g in buying.find_gaps(ins)}
    assert "even_tone:all:low_everywhere" in found  # one gap for the goal, not one per tier
    assert "redness:budget:missing" in found
    assert "redness:mid:weak" in found  # 18 points behind premium
    assert "lines:premium:unmeasured" in found and "lines:mid:thin" in found
    assert not any(g.startswith("under_eye") for g in found)  # 9 people: under 10
    order = [g["id"] for g in buying.find_gaps(ins)]
    assert order[0] == "even_tone:all:low_everywhere"  # 443 people x 0.9


def test_briefs_quote_only_the_aggregates():
    ins = _ins(
        {
            "redness": {
                "budget": _tier(0, None, 0),
                "mid": _tier(3, 0.31, 120),
                "premium": _tier(2, 0.6, 40),
            }
        },
        {"redness": 412},
    )
    missing = next(g for g in buying.find_gaps(ins) if g["kind"] == "missing")
    title, text = buying.brief(missing)
    assert title == "Add a budget redness product"
    assert text == (
        "412 people want help with redness; no option under ₹700; "
        "mid-price options: 31% visible change (n=120)."
    )
    weak = next(g for g in buying.find_gaps(ins) if g["kind"] == "weak")
    assert buying.brief(weak)[1] == (
        "412 people want help with redness; mid-price options (₹700–₹2,000): 31% visible "
        "change (n=120), against premium options: 60% visible change (n=40)."
    )


def _by(pid):
    return next(p for p in catalog.products() if p["product_id"] == pid)


def test_candidates_are_under_used_shelf_products_never_harsh_ones_for_redness():
    products = catalog.products()
    rows = {p["product_id"]: {"goal_ids": [], "tier": "proven"} for p in products}
    gap = {"id": "redness:mid:weak", "goal_id": "redness", "goal": "Redness", "tier": "mid"}
    pool = buying.pools(gap, rows)
    assert pool["fit"] and all(cohort.tier(p["price"]) == "mid" for p in pool["fit"])
    harsh = [p for p in pool["fit"] if any("retin" in i.lower() for i in p["inci"])]
    assert not harsh
    cats = [p["category"] in buying.RINSE_OFF for p in pool["fit"]]
    assert cats == sorted(cats)  # rinse-off last
    # a product sold for the goal with too few users is a `few` candidate
    pid = pool["fit"][0]["product_id"]
    rows[pid] = {"goal_ids": ["redness"], "tier": "too_few"}
    pool = buying.pools(gap, rows)
    assert [p["product_id"] for p in pool["few"]] == [pid]


@lru_cache
def _raw():
    return retailer.raw_from_tables(cohort.generate(date(2026, 10, 18)))


@pytest.fixture
def rows(monkeypatch):
    from app import retail_intel

    monkeypatch.setattr(retailer, "fetch", _raw)
    monkeypatch.setattr(retailer, "_raw", {"at": 0.0, "data": None, "version": 0})
    monkeypatch.setattr(retailer, "_views", {})
    monkeypatch.setattr(retail_intel, "_facts", {})
    monkeypatch.setattr(buying, "_cache", {})
    monkeypatch.setattr(buying, "_inflight", {})


class Script:
    """Plays the model: each round returns the next list of (tool, args); records the answers."""

    def __init__(self, rounds):
        self.rounds = list(rounds)
        self.answers: list[tuple[str, dict]] = []

    def __call__(self, contents, config):
        for part in contents[-1].parts or []:
            fr = getattr(part, "function_response", None)
            if fr is not None:
                self.answers.append((fr.name, dict(fr.response)))
        if not self.rounds:
            return [], "Done.", None
        step = self.rounds.pop(0)
        if isinstance(step, Exception):
            raise step
        return step, None, None

    def errors(self, tool):
        return [a["error"] for n, a in self.answers if n == tool and not a.get("ok", True)]


def _episode():
    from app import buying_agent, retail_intel

    ins = retailer.insights("mixed", "all")
    prods = {r["product_id"]: r for r in retail_intel.products("mixed", "all")["products"]}
    return buying_agent.Episode(ins, prods, "mixed", "all"), prods


def _unused_fit(ep, prods, goal, tier):
    """A shelf product in the tier, not sold for the goal, with an ingredient the table links."""
    for p in catalog.products():
        r = prods.get(p["product_id"]) or {}
        if cohort.tier(p["price"]) == tier and goal not in (r.get("goal_ids") or []):
            fit = buying.table_fit(p, goal)
            if fit and not buying._avoid(p, goal):
                return p, fit[0]
    raise AssertionError("no candidate in the catalog")


def test_the_agent_writes_the_list_and_code_checks_every_part(rows):
    ep, prods = _episode()
    gaps = ep.call("get_gaps", {})
    pores = next(g for g in gaps["goals"] if g["goal"] == "pores_texture")
    people, budget = pores["people"], pores["tiers"]["budget"]
    ep.call("list_products", {"tier": "budget", "goal": "pores_texture"})
    title = "Strengthen the budget pores range"
    good = (
        f"{people} people want help with pores and texture; budget options reach "
        f"{round(budget['rate'] * 100)}% visible change (n={budget['n']})."
    )
    # an invented number is refused, the tools' numbers pass
    assert (
        "number no tool returned"
        in ep.call(
            "add_brief",
            {
                "goal": "pores_texture",
                "tier": "budget",
                "title": title,
                "brief": "91% of shoppers are unhappy.",
                "priority": 1,
            },
        )["error"]
    )
    bid = ep.call(
        "add_brief",
        {"goal": "pores_texture", "tier": "budget", "title": title, "brief": good, "priority": 2},
    )["brief_id"]
    p, ing = _unused_fit(ep, prods, "pores_texture", "budget")
    ep.call("get_ingredients", {"product_id": p["product_id"]})
    # off its INCI list, a base, an efficacy claim, skin-lightness wording: refused
    assert (
        "INCI"
        in ep.call(
            "add_candidate",
            {
                "brief_id": bid,
                "product_id": p["product_id"],
                "ingredient": "Tranexamic Acid",
                "why": "Worth a look.",
            },
        )["error"]
    )
    assert (
        "base"
        in ep.call(
            "add_candidate",
            {
                "brief_id": bid,
                "product_id": p["product_id"],
                "ingredient": "Aqua",
                "why": "Worth a look.",
            },
        )["error"]
    )
    assert (
        ep.call(
            "add_candidate",
            {
                "brief_id": bid,
                "product_id": p["product_id"],
                "ingredient": ing,
                "why": "It works on pores.",
            },
        )["ok"]
        is False
    )
    assert (
        ep.call(
            "add_candidate",
            {
                "brief_id": bid,
                "product_id": p["product_id"],
                "ingredient": ing,
                "why": "Gives a brighter look.",
            },
        )["ok"]
        is False
    )
    assert ep.call(
        "add_candidate",
        {
            "brief_id": bid,
            "product_id": p["product_id"],
            "ingredient": ing,
            "why": f"Its {ing} is common in formulas aimed at pores.",
        },
    )["ok"]
    # a product already measured for the goal is part of the gap: refused
    measured = next(
        pid
        for pid, r in prods.items()
        if "pores_texture" in (r.get("goal_ids") or [])
        and r.get("tier") != "too_few"
        and cohort.tier(catalog.by_id(pid)["price"]) == "budget"
    )
    assert (
        "already measured"
        in ep.call(
            "add_candidate", {"brief_id": bid, "product_id": measured, "why": "Sold for pores."}
        )["error"]
    )
    (item,) = ep.items()
    assert item["title"] == title and item["brief"] == good and item["kind"] in buying.KIND_WORDS
    (c,) = item["candidates"]
    assert c["label"] == "Not measured for pores and texture yet" and c["ingredient"] == ing


def test_strong_actives_are_never_candidates_for_redness(rows):
    ep, prods = _episode()
    ep.call("get_gaps", {})
    bid = ep.call(
        "add_brief",
        {
            "goal": "redness",
            "tier": None,
            "title": "Find calmer options",
            "brief": "Redness options could be wider.",
            "priority": 1,
        },
    )["brief_id"]
    harsh = next(
        p
        for p in catalog.products()
        if any("retin" in i.lower() for i in p["inci"])
        and "redness" not in (prods.get(p["product_id"], {}).get("goal_ids") or [])
    )
    out = ep.call(
        "add_candidate",
        {
            "brief_id": bid,
            "product_id": harsh["product_id"],
            "ingredient": "Retinol",
            "why": "Worth a look.",
        },
    )
    assert "strong active" in out["error"]


def test_the_route_answers_at_once_then_the_agents_list_replaces_it(rows, monkeypatch):
    from app import buying_agent

    def scripted():
        ep, prods = _episode()
        gaps = ep.call("get_gaps", {})
        tone = next(g for g in gaps["goals"] if g["goal"] == "even_tone")
        return Script(
            [
                [("get_gaps", {})],
                [
                    (
                        "add_brief",
                        {
                            "goal": "even_tone",
                            "tier": None,
                            "priority": 1,
                            "title": "Find a stronger tone evenness option",
                            "brief": f"{tone['people']} people want help with tone evenness.",
                        },
                    )
                ],
                [("finish", {"summary": "One gap stands out."})],
            ]
        )

    script = scripted()
    monkeypatch.setattr(buying_agent, "model_round", script)
    monkeypatch.setattr(buying, "WAIT_S", 10.0)
    client = TestClient(app)
    out = client.get("/v1/retailer/buying-list").json()
    assert out["source"] == "gemini" and out["pending"] is False
    assert [i["title"] for i in out["items"]] == ["Find a stronger tone evenness option"]
    assert out["summary"] == "One gap stands out." and "not evidence" in out["caveat"]


def test_without_gemini_the_fixed_list_is_shown(rows, monkeypatch):
    monkeypatch.setattr(buying, "WAIT_S", 10.0)
    out = TestClient(app).get("/v1/retailer/buying-list").json()
    assert out["source"] == "rules" and out["items"] and out["pending"] is False
    assert all(
        c["ingredient"] for it in out["items"] for c in it["candidates"] if c["kind"] == "fit"
    )


def test_while_the_agent_works_the_fixed_list_is_pending(rows, monkeypatch):
    import threading

    from app import buying_agent

    gate = threading.Event()

    def slow(contents, config):
        gate.wait(5)
        raise RuntimeError("released")

    monkeypatch.setattr(buying_agent, "model_round", slow)
    monkeypatch.setattr(buying, "WAIT_S", 0.05)
    out = TestClient(app).get("/v1/retailer/buying-list").json()
    gate.set()
    assert out["pending"] is True and out["source"] == "rules" and out["items"]


def test_route_degrades_to_503(rows, monkeypatch):
    monkeypatch.setattr(retailer, "fetch", lambda: (_ for _ in ()).throw(RuntimeError("bq")))
    assert TestClient(app).get("/v1/retailer/buying-list").status_code == 503


def test_the_trend_tool_reads_monthly_demand(rows):
    ep, _ = _episode()
    goals = ep.call("get_trends", {})["goals"]
    assert goals and all(
        set(g) >= {"goal", "from_share_pct", "to_share_pct", "rising"} for g in goals
    )
    assert any(g["rising"] for g in goals)  # the simulated cohort's dark spots demand grows
