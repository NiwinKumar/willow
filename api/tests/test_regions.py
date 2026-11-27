"""Where the person shops and the nearest products first (app/regions.py): the market table, the
distance helper, and the lists that use it (search, swaps, similar, plan alternatives)."""

from types import SimpleNamespace

import pytest

from app import catalog, plan, regions, similar


def _p(pid, brand, name, region, *, category="cleanser", detail="full", stores=(), **extra):
    return {
        "product_id": pid,
        "brand": brand,
        "name": name,
        "category": category,
        "concerns": ["dullness"],
        "key_actives": [],
        "inci": ["Aqua"] if detail == "full" else [],
        "price": None,
        "region": list(region),
        "stores": list(stores),
        "detail": detail,
        **extra,
    }


SEA_STORE = {"store": "Watsons", "url": "https://x", "region": "SEA", "price": None}
CATALOG = (
    _p("sea-gel", "Safi", "Gentle Gel Cleanser", ["SEA"]),
    _p("glob-gel", "Acme", "Gentle Gel Cleanser", ["GLOBAL"]),
    _p("kr-gel", "Beta", "Gentle Gel Cleanser", ["KR"]),
    _p("us-gel", "Zed", "Gentle Gel Cleanser", ["US"]),
    _p("store-gel", "Mira", "Gentle Gel Cleanser", [], stores=[SEA_STORE]),  # a SEA store only
    _p("far-gel", "Orb", "Gentle Gel Cleanser", []),  # no region at all
    _p("sea-index", "Safi", "Gentle Gel Toner", ["SEA"], category="toner", detail="index"),
    _p("sea-gelee", "Safi", "Gelee Mask", ["SEA"], category="mask"),
)


def _ids(products):
    return [p["product_id"] for p in products]


# -- the table and the helper -------------------------------------------------------------------


def test_every_market_has_one_region_currency_and_name():
    assert len(regions.MARKETS) == 18
    for m in regions.MARKETS:
        assert regions.MARKET_REGION[m] in regions.ORDER
        assert len(regions.MARKET_CURRENCY[m]) == 3 and regions.MARKET_WORDS[m]
    assert {m: regions.MARKET_REGION[m] for m in ("SG", "MY", "VN", "HK", "TW", "NZ", "GCC")} == {
        "SG": "SEA",
        "MY": "SEA",
        "VN": "SEA",
        "HK": "CN",
        "TW": "CN",
        "NZ": "AU",
        "GCC": "GCC",
    }
    # plan.py reads the same table (one place)
    assert plan.DEFAULT_CURRENCY is regions.MARKET_CURRENCY
    # every region lists every region once, its own first and GLOBAL second
    codes = set(regions.ORDER) | {"GLOBAL"}
    for region, order in regions.ORDER.items():
        assert set(order) == codes and len(order) == len(codes)
        assert order[:2] == (region, "GLOBAL")


@pytest.mark.parametrize(
    ("market", "expected"),
    [
        ("SG", {"sea-gel": 0, "store-gel": 0, "glob-gel": 1, "kr-gel": 2, "us-gel": 8}),
        ("NZ", {"sea-gel": 2, "glob-gel": 1, "kr-gel": 3, "us-gel": 7}),  # NZ shops in AU
        ("US", {"us-gel": 0, "glob-gel": 1, "kr-gel": 4, "sea-gel": 8}),
        ("IN", {"sea-gel": 2, "glob-gel": 1, "us-gel": 9}),
    ],
)
def test_distance_is_the_best_rank_of_the_products_and_its_stores_regions(market, expected):
    by_id = {p["product_id"]: p for p in CATALOG}
    assert {pid: regions.distance(by_id[pid], market) for pid in expected} == expected
    assert regions.distance(by_id["far-gel"], market) == regions.FAR  # no region: last


def test_no_market_leaves_every_product_at_the_same_distance():
    assert {regions.distance(p, None) for p in CATALOG} == {0}
    assert regions.nearest_first(list(CATALOG), None) == list(CATALOG)


# -- search ---------------------------------------------------------------------------------------


@pytest.fixture
def small(monkeypatch):
    monkeypatch.setattr(catalog, "products", lambda: CATALOG)


def test_browsing_lists_the_persons_region_and_global_first(small):
    sg = _ids(catalog.search_all(category="cleanser", market="SG"))
    assert sg == ["store-gel", "sea-gel", "glob-gel", "kr-gel", "us-gel", "far-gel"]
    # no market: as before (full first, then brand and name)
    assert _ids(catalog.search_all(category="cleanser")) == [
        "glob-gel",
        "kr-gel",
        "store-gel",
        "far-gel",
        "sea-gel",
        "us-gel",
    ]
    # distance comes before full/index: a SEA index product before a GLOBAL full one
    everything = _ids(catalog.search_all(market="SG"))
    assert everything.index("sea-index") < everything.index("glob-gel")


def test_a_query_keeps_relevance_first_and_nearest_among_equal_matches(small):
    # a US-only product still shows for someone in Singapore when they ask for it
    assert _ids(catalog.search_all(q="zed", market="SG")) == ["us-gel"]
    # equally good matches: nearest first
    same = _ids(catalog.search_all(q="gentle gel cleanser", market="SG"))
    assert same == ["store-gel", "sea-gel", "glob-gel", "kr-gel", "us-gel", "far-gel"]
    # a better match beats distance: "gel" is a whole word in Zed's name, only a word start in
    # the SEA "Gelee Mask"
    gel = _ids(catalog.search_all(q="gel", market="SG"))
    assert gel.index("us-gel") < gel.index("sea-gelee")


def test_search_route_uses_the_saved_market_else_the_param(client, fake, small):
    got = client.get("/v1/catalog/search", params={"category": "cleanser", "market": "SG"}).json()
    assert got["market"] == "SG" and _ids(got["products"])[:2] == ["store-gel", "sea-gel"]
    assert client.get("/v1/catalog/search", params={"market": "XX"}).status_code == 422

    saved = client.put("/v1/me/profile", json={"safety": {"market": "US"}})
    assert saved.status_code == 200, saved.text
    # the saved market wins over the browser's guess
    got = client.get("/v1/catalog/search", params={"category": "cleanser", "market": "SG"}).json()
    assert got["market"] == "US" and _ids(got["products"])[:2] == ["us-gel", "glob-gel"]


def test_the_profile_accepts_the_apac_markets(client, fake):
    for m in ("MY", "TH", "ID", "PH", "VN", "KR", "JP", "CN", "HK", "TW", "AU", "NZ", "GCC"):
        res = client.put("/v1/me/profile", json={"safety": {"market": m}})
        assert res.status_code == 200 and res.json()["profile"]["safety"]["market"] == m
    assert client.put("/v1/me/profile", json={"safety": {"market": "MARS"}}).status_code == 422


# -- swaps, similar, plan alternatives, sponsored --------------------------------------------------


def _serum(pid, region, sgd):
    return _p(
        pid,
        "B",
        f"Niacinamide Serum {pid}",
        region,
        category="serum",
        key_actives=[{"name": "niacinamide", "pct": 10}],
        inci=["Aqua", "Niacinamide"],
        price={"amount": sgd, "currency": "SGD"},
    )


def test_swaps_list_the_persons_region_before_global_then_cheapest(monkeypatch):
    base = _serum("base", ["SEA"], 30)
    cheap_global, local = _serum("cheap-global", ["GLOBAL"], 10), _serum("local", ["SEA"], 20)
    monkeypatch.setattr(catalog, "products", lambda: (base, cheap_global, local))
    got = [s["product"]["product_id"] for s in plan.swaps(base, "SG", None)]
    assert got == ["local", "cheap-global"]
    # no market: cheapest first, as before
    assert [s["product"]["product_id"] for s in plan.swaps(base, None, None)] == [
        "cheap-global",
        "local",
    ]


SIMILAR = (("a", "GLOBAL"), ("kr", "KR"), ("sea", "SEA"))


def test_similar_lists_the_nearest_first_then_the_closest_formula(monkeypatch):
    three = tuple(_p(pid, "B", pid, [r], category="serum") for pid, r in SIMILAR)
    monkeypatch.setattr(catalog, "products", lambda: three)
    monkeypatch.setattr(
        similar, "vectors", lambda: {"a": [1.0, 0.0], "kr": [0.99, 0.141], "sea": [0.9, 0.436]}
    )

    def ids(near):
        return [i["product"]["product_id"] for i in similar.similar_products("a", 5, near=near)]

    assert ids(None) == ["kr", "sea"]  # closest formula first
    assert ids("SG") == ["sea", "kr"]  # someone in Singapore: the SEA one first


def test_plan_alternatives_put_the_persons_region_first_without_passing_a_flag():
    status = {"glob": "clear", "sea": "clear", "sea-flagged": "check"}
    ctx = SimpleNamespace(market="SG", check=lambda p: {"status": status[p["product_id"]]})
    rest = [_p("glob", "A", "x", ["GLOBAL"]), _p("sea-flagged", "B", "x", ["SEA"])]
    rest.append(_p("sea", "C", "x", ["SEA"]))
    assert _ids(plan._alternatives(ctx, rest)) == ["sea", "glob"]


def test_each_market_says_which_currency_its_plan_is_priced_in(client):
    out = {m["market"]: m for m in client.get("/v1/markets").json()["markets"]}
    assert set(out) == set(regions.MARKETS)
    assert out["US"]["priced_currency"] == "USD"
    # a market with too few local prices plans in USD, so the web sets its budget in USD
    assert all(m["priced_currency"] in (m["currency"], "USD") for m in out.values())
    assert out["NZ"]["priced_currency"] == "USD"
