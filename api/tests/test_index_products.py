"""Index products (Nov 27): catalog records Willow knows by name, category and stores only, its
ingredient list not in Willow yet. They are found by search, checked as "unknown" (never clear),
and never suggested (plan, swaps, similar, Wisp, sponsored)."""

import time

import pytest

from app import advisor, campaigns, catalog, plan, safety, similar

REAL = catalog.products()


def _index(pid: str, brand: str, name: str, category: str = "serum", **extra) -> dict:
    return {
        "product_id": pid,
        "brand": brand,
        "name": name,
        "category": category,
        "concerns": ["dryness_barrier"],
        "key_actives": [],
        "inci": [],
        "price": None,
        "size": "",
        "region": ["GLOBAL"],
        "stores": [{"store": "Brand site", "url": "https://x.example/p", "region": "GLOBAL"}],
        "source_url": "https://x.example/p",
        "last_verified": "2026-11-27",
        "detail": "index",
        "notes": "Name and pack only.",
        **extra,
    }


TAMAGO = _index("hada-labo-tamagohada-peeling-lotion", "Hada Labo", "Tamagohada Peeling Lotion")
CLE = _index("cle-de-peau-the-serum", "Clé de Peau Beauté", "The Serum")
TWIN = _index(  # the same name as a full product, sold in a bigger size, known only by name
    "the-ordinary-niacinamide-10-zinc-1-60ml",
    "The Ordinary",
    "Niacinamide 10% + Zinc 1%",
    key_actives=[{"name": "niacinamide", "pct": 10}],
    concerns=["acne_blemishes", "oiliness_shine", "texture_pores"],
)
ADAPALENE = _index("generic-adapalene-gel", "Generic", "Adapalene Gel 0.1%", "treatment")
CATALOG = (*REAL, TAMAGO, CLE, TWIN, ADAPALENE)


@pytest.fixture(autouse=True)
def with_index_products(monkeypatch):
    monkeypatch.setattr(catalog, "products", lambda: CATALOG)


def _ids(found) -> list[str]:
    return [p["product_id"] for p in found]


def test_index_records_load_without_a_price_or_a_label_and_old_records_are_full():
    raw = {k: v for k, v in TAMAGO.items() if k not in ("inci", "key_actives", "stores")}
    tidy = catalog._tidy(raw)
    assert tidy["price"] is None and tidy["inci"] == [] and tidy["key_actives"] == []
    assert tidy["detail"] == "index" and not catalog.is_full(tidy)
    old = catalog._tidy({k: v for k, v in REAL[0].items() if k != "detail"})
    assert old["detail"] == "full" and catalog.is_full(old)


@pytest.mark.parametrize(
    "q",
    ["Tamagohada", "tamago", "hadalabo tamagohada", "HADA-LABO peeling", "hada labo tamagohada"],
)
def test_a_product_is_found_by_brand_and_name_words_parts_and_spellings(q):
    assert TAMAGO["product_id"] in _ids(catalog.search(q, limit=5))


def test_accents_and_apostrophes_do_not_matter():
    assert _ids(catalog.search("cle de peau serum"))[0] == CLE["product_id"]
    assert _ids(catalog.search("Clé de Peau"))[0] == CLE["product_id"]
    assert all(p["brand"] == "Paula's Choice" for p in catalog.search("paulas choice"))
    assert catalog.search("paulas choice")


def test_a_full_product_ranks_above_an_index_one_for_the_same_match():
    found = _ids(catalog.search("niacinamide 10% zinc the ordinary"))
    assert found[:2] == ["the-ordinary-niacinamide-10-zinc-1", TWIN["product_id"]]
    # browsing lists full products first too; index ones are still there
    every = _ids(catalog.search_all())
    assert every.index(TWIN["product_id"]) > max(every.index(p["product_id"]) for p in REAL)


def test_filters_that_need_facts_leave_index_products_out():
    assert TWIN["product_id"] not in _ids(catalog.search_all("niacinamide", max_price=1000))
    # without its ingredient list, Willow cannot tell it is free of fragrance
    assert TWIN["product_id"] not in _ids(
        catalog.search_all("niacinamide", exclude_ingredients=["fragrance"])
    )


def test_search_stays_fast_at_5000_products(monkeypatch):
    big = tuple(
        _index(f"brand-{i}-product-{i}", f"Brand {i % 400}", f"Product {i} Lotion")
        for i in range(5000)
    )
    monkeypatch.setattr(catalog, "products", lambda: big)
    started = time.perf_counter()
    for q in ("brand 12", "product 4999", "lotion", "brnd", "brand12 product"):
        catalog.search(q)
        catalog.by_id("brand-4999-product-4999")
    assert catalog.match("Brand 7", "Product 7 Lotion")[0]["product_id"] == "brand-7-product-7"
    assert time.perf_counter() - started < 2.0


def test_no_ingredient_list_is_not_checked_yet_never_clear():
    out = safety.check(TAMAGO, None)
    assert out == {
        "status": "unknown",
        "flags": [],
        "regulatory": None,  # not known to be a cosmetic without its label
        "explanation": safety.NO_LABEL,
    }
    full_profile = {"adult": True, "life_stage": "none", "reactive": False, "market": "US"}
    assert safety.check(TAMAGO, full_profile)["status"] == "unknown"
    # what is known without the label still counts: the person's own avoid list ...
    mine = safety.check(TAMAGO, {"avoid_products": [TAMAGO["product_id"]]})
    assert mine["status"] == "avoid" and mine["flags"][0]["rule"] == "avoid_product"
    # ... and a name that makes it a medicine where they are
    india = safety.check(ADAPALENE, {"market": "IN"})
    assert india["status"] == "not_sold" and india["regulatory"]["class"] == "rx"


def test_plans_swaps_and_similar_only_suggest_full_products(client, fake, monkeypatch):
    out = client.post(
        "/v1/plan",
        json={
            "skin_type": "combination",
            "goals": ["blemishes"],
            "steps": 4,
            "market": "US",
            "budget": {"max_per_product": 40, "currency": "USD"},
        },
    ).json()
    assert out["picks"] and all(catalog.is_full(k["product"]) for k in out["picks"])
    assert out["funnel"][0]["n"] == len(REAL)

    base = catalog.by_id("the-ordinary-niacinamide-10-zinc-1")
    assert TWIN["product_id"] not in _ids(s["product"] for s in plan.swaps(base, None, None, 20))
    assert plan.swaps(TWIN, None, None) is not None  # an index product's own swaps: no crash

    vecs = {base["product_id"]: [1.0, 0.0], TWIN["product_id"]: [1.0, 0.0]}
    monkeypatch.setattr(similar, "vectors", lambda: vecs)
    assert similar.similar_products(base["product_id"]) == []


def test_wisp_talks_about_a_named_index_product_but_never_suggests_it(fake):
    out = advisor.run_tool("search_catalog", {"query": "hada labo tamagohada"}, fake.store, "u1")
    assert TAMAGO["product_id"] not in _ids(out["products"])
    named = out["not_checked"][0]
    assert named["product_id"] == TAMAGO["product_id"]
    assert named["check"]["status"] == "unknown"
    assert "not in Willow yet" in named["ingredient_list"]
    browse = advisor.run_tool("search_catalog", {"concern": "dryness_barrier"}, fake.store, "u1")
    assert "not_checked" not in browse and all(catalog.is_full(p) for p in browse["products"])


def test_an_index_product_cannot_be_sponsored(monkeypatch):
    monkeypatch.setattr(
        campaigns,
        "eligibility_of",
        lambda pid: {"eligible": True, "tier": "proven", "goals": ["blemishes"], "skin_types": []},
    )
    reasons = campaigns.check(TWIN, "retailer", ["blemishes"], [])
    assert any("full ingredient list" in r for r in reasons)
    assert not any(
        "full ingredient list" in r for r in campaigns.check(REAL[0], "retailer", [], [])
    )


def test_the_in_aisle_check_says_an_index_product_was_not_checked(client, fake):
    res = client.post("/v1/routine/check/preview", json={"product_id": TAMAGO["product_id"]})
    assert res.status_code == 200 and res.json()["checked"] is False
    full = client.post("/v1/routine/check/preview", json={"product_id": REAL[0]["product_id"]})
    assert full.json()["checked"] is True
    added = client.post("/v1/routine", json={"product_id": TAMAGO["product_id"], "slots": ["am"]})
    assert added.status_code == 200 and added.json()["inci"] == []


def test_full_facts_are_requested_for_an_index_product_once(client, fake):
    res = client.post("/v1/product-requests", json={"product_id": TAMAGO["product_id"]})
    assert res.status_code == 201, res.text
    first = res.json()
    assert first["kind"] == "facts" and first["for_product_id"] == TAMAGO["product_id"]
    assert first["status"] == "pending" and "ingredient list" in first["status_text"]
    # asking again (or by its brand and name) answers the same request
    again = client.post("/v1/product-requests", json={"product_id": TAMAGO["product_id"]})
    named = client.post(
        "/v1/product-requests", json={"brand": "Hada Labo", "name": "Tamagohada Peeling Lotion"}
    )
    assert again.json()["id"] == named.json()["id"] == first["id"]
    # still pending: an index product is not "in the catalog" for the request
    listed = client.get("/v1/product-requests").json()["requests"]
    assert [r["status"] for r in listed] == ["pending"]
    # a full product is offered instead, an unknown id is not found
    full = client.post("/v1/product-requests", json={"product_id": REAL[0]["product_id"]})
    assert full.status_code == 409 and full.json()["detail"]["code"] == "in_catalog"
    assert client.post("/v1/product-requests", json={"product_id": "nope"}).status_code == 404
