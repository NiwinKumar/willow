"""Buying list (app/buying.py, GET /v1/retailer/buying-list): assortment gaps as briefs, with
under-used catalog products as candidates, never presented as proven."""

from datetime import date
from functools import lru_cache

import pytest
from fastapi.testclient import TestClient

from app import buying, catalog, cohort, gemini, retailer
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


NIA = "the-ordinary-niacinamide-10-zinc-1"


def _fit(**over):
    base = {
        "gap": "g",
        "product_id": NIA,
        "ingredient": "Niacinamide",
        "why": "Niacinamide is common in formulas for a more even-looking tone.",
    }
    return buying.Fit(**(base | over))


@pytest.mark.parametrize(
    ("over", "problem"),
    [
        ({}, None),
        ({"ingredient": "Tranexamic Acid"}, "the ingredient is not on its INCI list"),
        ({"ingredient": "Aqua"}, "not an ingredient Willow links to this goal"),
        ({"why": "Niacinamide at 10% is common here."}, "a number"),
        ({"why": "Niacinamide works for an even tone."}, "an efficacy claim"),
        ({"why": "Niacinamide is clinically shown to even tone."}, "an efficacy claim"),
        ({"why": "Niacinamide helps skin look brighter."}, "skin lightness wording"),
    ],
)
def test_each_gemini_reading_is_checked(over, problem):
    assert buying._fit_problem(_fit(**over), _by(NIA), "even_tone") == problem


def test_digits_inside_a_product_name_are_not_numbers():
    p = _by(NIA)
    why = f"{p['name']} contains niacinamide, common in formulas for an even-looking tone."
    assert buying._fit_problem(_fit(why=why), p, "even_tone") is None


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


def test_the_list_uses_checked_readings_and_drops_the_rest(rows, monkeypatch):
    seen = {}

    def fake(prompt_id, contents, schema, **kw):
        import json

        payload = json.loads(contents[0])["GAPS"]
        seen["gaps"] = payload
        first = payload[0]
        good, bad = first["candidates"][0], first["candidates"][-1]
        ing = buying.table_fit(_by(good["product_id"]), _gap_goal(first["gap"]))[0]
        return buying.Fits(
            fits=[
                buying.Fit(
                    gap=first["gap"],
                    product_id=good["product_id"],
                    ingredient=ing,
                    why=f"{ing} is a common choice in formulas for this goal.",
                ),
                buying.Fit(
                    gap=first["gap"],
                    product_id=bad["product_id"],
                    ingredient="Aqua",
                    why="It works.",
                ),
            ]
        )

    monkeypatch.setattr(gemini, "generate_json", fake)
    out = buying.buying_list()
    assert out["source"] == "gemini" and out["items"] and "not evidence" in out["caveat"]
    first = out["items"][0]
    c = first["candidates"][0]
    assert c["why"].endswith("a common choice in formulas for this goal.")
    assert all(x["ingredient"] != "Aqua" for x in first["candidates"])
    for it in out["items"]:
        for x in it["candidates"]:
            assert x["label"] in (
                "Too few users to measure yet",
                f"Not measured for {it['goal'].lower()} yet",
            )
            assert "proven" not in x["why"].lower()


def _gap_goal(gap_id):
    return gap_id.split(":")[0]


def test_without_gemini_the_fixed_table_gives_the_same_shape(rows, monkeypatch):
    def down(*a, **k):
        raise gemini.GeminiError("down")

    monkeypatch.setattr(gemini, "generate_json", down)
    out = buying.buying_list()
    assert out["source"] == "rules" and out["items"]
    assert all(
        c["ingredient"] for it in out["items"] for c in it["candidates"] if c["kind"] == "fit"
    )


def test_route_answers_and_degrades_to_503(rows, monkeypatch):
    def down(*a, **k):
        raise gemini.GeminiError("down")

    monkeypatch.setattr(gemini, "generate_json", down)
    client = TestClient(app)
    res = client.get("/v1/retailer/buying-list")
    assert res.status_code == 200 and res.json()["items"]
    monkeypatch.setattr(retailer, "_raw", {"at": 0.0, "data": None, "version": 0})
    monkeypatch.setattr(retailer, "_views", {})
    monkeypatch.setattr(buying, "_cache", {})
    monkeypatch.setattr(retailer, "fetch", lambda: (_ for _ in ()).throw(RuntimeError("bq")))
    assert client.get("/v1/retailer/buying-list").status_code == 503
