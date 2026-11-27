"""Similar formula (app/similar.py): cosine over the seed vectors, no model call."""

import json
import math

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import catalog, similar


def _p(pid: str, category: str, region: str = "GLOBAL") -> dict:
    return {
        "product_id": pid,
        "category": category,
        "brand": "B",
        "name": pid,
        "region": [region],
        "stores": [],
        "inci": [],
        "key_actives": [],
    }


def _unit(*xs: float) -> list[float]:
    n = math.sqrt(sum(x * x for x in xs))
    return [x / n for x in xs]


PRODUCTS = (
    _p("serum_a", "serum"),
    _p("serum_b", "serum", "IN"),  # sold in India only
    _p("toner_c", "toner"),
    _p("patch_d", "treatment"),
    _p("new_e", "serum"),  # added after the seed was built: no vector
)
VECTORS = {
    "serum_a": _unit(1, 0, 0),
    "serum_b": _unit(0.9, 0.3, 0),  # cos 0.949 with serum_a
    "toner_c": _unit(0.95, 0.2, 0),  # cos 0.979: closer, but another category
    "patch_d": _unit(0, 0, 1),  # nothing like the others
}


@pytest.fixture
def tiny(monkeypatch):
    monkeypatch.setattr(catalog, "products", lambda: PRODUCTS)
    monkeypatch.setattr(similar, "vectors", lambda: VECTORS)


def test_neighbours_exclude_itself_and_the_same_category_wins_a_near_tie(tiny):
    got = similar.similar_products("serum_a", 5)
    assert [g["product"]["product_id"] for g in got] == ["serum_b", "toner_c"]
    # the score shown is the plain cosine, not the boosted ranking value
    assert got[0]["score"] == pytest.approx(0.949, abs=1e-3)
    assert got[1]["score"] == pytest.approx(0.979, abs=1e-3)


def test_unlike_formulas_unknown_and_unembedded_products_get_nothing(tiny):
    assert similar.similar_products("patch_d") == []  # all below MIN_SCORE
    assert similar.similar_products("new_e") == []
    assert similar.similar_products("no_such") == []
    assert len(similar.similar_products("serum_a", 1)) == 1


def test_a_market_keeps_only_products_sold_there_or_everywhere(tiny):
    def ids(market):
        return [g["product"]["product_id"] for g in similar.similar_products("serum_a", 5, market)]

    assert ids(None) == ["serum_b", "toner_c"]
    assert ids("IN") == ["serum_b", "toner_c"]
    assert ids("US") == ["toner_c"]  # serum_b is sold in India only; toner_c is GLOBAL


def test_route_answers_items_and_404s_an_unknown_product(tiny):
    app = FastAPI()
    app.include_router(similar.router)
    c = TestClient(app)
    res = c.get("/v1/catalog/serum_a/similar?k=1", headers={"X-Dev-Uid": "u1"})
    assert res.status_code == 200, res.text
    assert [i["product"]["product_id"] for i in res.json()["items"]] == ["serum_b"]
    res = c.get("/v1/catalog/serum_a/similar?market=US", headers={"X-Dev-Uid": "u1"})
    assert [i["product"]["product_id"] for i in res.json()["items"]] == ["toner_c"]
    assert c.get("/v1/catalog/no_such/similar", headers={"X-Dev-Uid": "u1"}).status_code == 404


def test_seed_vectors_are_unit_vectors_for_full_catalog_products():
    seed = json.loads(similar.SEED.read_text())
    ids = {p["product_id"] for p in catalog.products() if catalog.is_full(p)}
    assert seed["items"] and set(seed["items"]) <= ids
    for v in seed["items"].values():
        assert len(v) == seed["dimensions"]
        assert math.sqrt(sum(x * x for x in v)) == pytest.approx(1.0, abs=1e-3)
