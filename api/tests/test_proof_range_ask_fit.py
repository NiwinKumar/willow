"""Proof by Willow, finals F2 (routes/proof_routes.py, app/retailer_ask.py): the range saved per
organisation, Ask scoped to the organisation (other brands' names hidden by the retailer's policy),
and the fit view (what opted-in shoppers avoid and react to, groups under 10 left out)."""

import pytest
from fastapi.testclient import TestClient

from app import gemini, retailer, retailer_ask
from app.main import app
from app.retailer_ask import Answer, Bar, Chart
from app.routes import proof_routes

MINIMALIST = "minimalist-alpha-arbutin-2-face-serum"
ORDINARY = "the-ordinary-alpha-arbutin-2-ha"
ORDINARY_NAME = "Alpha Arbutin 2% + HA"
MINIMALIST_NAME = "Alpha Arbutin 2% Face Serum"


@pytest.fixture(autouse=True)
def fresh_caches():
    proof_routes._answers.clear()
    proof_routes._fit_cache.clear()
    yield
    proof_routes._answers.clear()
    proof_routes._fit_cache.clear()


def _as(uid: str) -> TestClient:
    return TestClient(app, headers={"X-Dev-Uid": uid})


def _join(c: TestClient, org: str, role: str = "admin") -> None:
    res = c.post("/v1/proof/join", json={"instance": "northside", "org_id": org, "role": role})
    assert res.status_code == 200, res.text


def _row(line: int, match: str | None, status: str, **kw) -> dict:
    return {"line": line, "match": match, "status": status, **kw}


# -- range --------------------------------------------------------------------------------------


def test_the_range_is_saved_per_org_and_reaches_a_brand_filtered(client, fake):
    _join(client, "northside", "analyst")
    url = "/v1/proof/orgs/northside/range"
    assert client.get(url).json() == {"range": None, "from": None}
    body = {
        "filename": "items.csv",
        "rows": [
            _row(2, MINIMALIST, "measured", brand="Minimalist", gtin="890123"),
            _row(3, ORDINARY, "measured"),
            _row(4, "not-a-catalog-id", "measured", brand="Minimalist", name="New Mist"),
            _row(5, None, "unrecognised", brand="Acme", name="Gel"),
        ],
    }
    saved = client.put(url, json=body)
    assert saved.status_code == 200, saved.text
    rows = saved.json()["range"]["rows"]
    # an unknown match is dropped: the row is unrecognised, whatever the client said
    assert [(r["match"], r["status"]) for r in rows][2] == (None, "unrecognised")
    assert client.get(url).json()["range"]["filename"] == "items.csv"

    # the brand reads the retailer's file filtered to its own products (matched or by name)
    brand = _as("brand-analyst")
    _join(brand, "minimalist", "analyst")
    seen = brand.get("/v1/proof/orgs/minimalist/range").json()
    assert seen["from"] == {"org_id": "northside", "name": "Northside Beauty"}
    assert [r["line"] for r in seen["range"]["rows"]] == [2, 4]
    # and cannot write or delete it
    assert brand.put("/v1/proof/orgs/minimalist/range", json=body).status_code == 403
    assert brand.delete("/v1/proof/orgs/minimalist/range").status_code == 403

    assert client.delete(url).status_code == 204
    assert client.get(url).json()["range"] is None


def test_range_writes_need_an_analyst(client, fake):
    _join(client, "northside", "viewer")
    body = {"filename": "f.csv", "rows": [_row(2, MINIMALIST, "measured")]}
    assert client.put("/v1/proof/orgs/northside/range", json=body).status_code == 403
    assert client.get("/v1/proof/orgs/northside/range").status_code == 200
    too_many = {
        "filename": "f.csv",
        "rows": [_row(i + 2, None, "unrecognised") for i in range(501)],
    }
    _join(client, "northside", "admin")
    assert client.put("/v1/proof/orgs/northside/range", json=too_many).status_code == 422


# -- Ask scoped to the organisation --------------------------------------------------------------

INSIGHTS = {
    "cohort": {"synthetic": 500, "real": 0, "weeks": 8},
    "tiles": [],
    "needs": [{"goal": "Dark spots", "n": 100, "real": 24, "none": 61, "early": 15}],
    "products": [
        {
            "product_id": MINIMALIST,
            "product": MINIMALIST_NAME,
            "brand": "Minimalist",
            "concern": "dark spots",
            "n": 40,
            "cells": [],
            "rate": 0.61,
            "lift": 0.26,
            "weeks": 6,
            "cont": 0.77,
        },
        {
            "product_id": ORDINARY,
            "product": ORDINARY_NAME,
            "brand": "The Ordinary",
            "concern": "dark spots",
            "n": 30,
            "cells": [],
            "rate": 0.5,
            "lift": 0.1,
            "weeks": 7,
            "cont": 0.5,
        },
    ],
    "brands": [{"brand": "The Ordinary", "n": 30}, {"brand": "Minimalist", "n": 40}],
    "gaps": [],
    "conflicts": [{"pair": "No SPF", "n": 50, "share": 0.2, "resolves": [ORDINARY_NAME]}],
}


def test_a_masked_scope_hides_other_brands_in_the_inputs_and_rejects_names():
    scope = retailer_ask.scope_for("Minimalist", hide_others=True)
    alias = scope.hidden["The Ordinary"]
    assert alias.startswith("Brand ") and "Minimalist" not in scope.hidden
    masked = retailer_ask.mask(INSIGHTS, scope)
    text = str(masked)
    assert "The Ordinary" not in text and ORDINARY_NAME not in text
    assert MINIMALIST_NAME in text and f"{alias}'s" in text  # products read "Brand X's ... serum"
    # an answer, follow-up or chart label naming another brand is rejected
    named = Answer(answer="The Ordinary reached 50%.", follow_ups=["What about Minimalist?"])
    assert retailer_ask.problems(named, masked, "q", scope) == ["names another brand: The Ordinary"]
    other = masked["products"][1]["product"]
    ok = Answer(
        answer=f"{MINIMALIST_NAME} reached 61%; {other} 50%.",
        chart=Chart(
            title="Still improved",
            unit="percent",
            bars=[Bar(label=MINIMALIST_NAME, value=61), Bar(label=other, value=50)],
        ),
    )
    assert retailer_ask.problems(ok, masked, "q", scope) == []
    # names allowed (the retailer, or the policy on): no masking
    open_scope = retailer_ask.scope_for("Minimalist", hide_others=False)
    assert retailer_ask.mask(INSIGHTS, open_scope) is INSIGHTS
    assert retailer_ask.problems(named, INSIGHTS, "q", open_scope) == []


def test_a_brand_org_asks_about_its_own_brand_without_competitor_names(client, fake, monkeypatch):
    seen: list[dict] = []

    def gen(*a, **k):
        seen.append({"prompt": a[1][0], "instructions": k["instructions"]})
        return Answer(answer="The Ordinary reached 50%.")

    monkeypatch.setattr(gemini, "generate_json", gen)
    monkeypatch.setattr(retailer, "insights", lambda *a: INSIGHTS)
    _join(client, "minimalist", "viewer")
    body = client.post("/v1/proof/orgs/minimalist/ask", json={"question": "How do we compare?"})
    assert body.status_code == 200, body.text
    out = body.json()
    # both drafts named a competitor: refused with the policy's wording, nothing kept
    assert out["refused"] is True and "policy" in out["answer"]
    assert out["scope"] == {"brand": "Minimalist", "names_hidden": True}
    assert (
        "The Ordinary" not in seen[0]["prompt"]
        and "Minimalist's own team" in seen[0]["instructions"]
    )
    assert proof_routes._answers == {}

    # the retailer turns names on: the brand's question is answered with them
    admin = _as("retailer-admin")
    _join(admin, "northside", "admin")
    put = admin.put(
        "/v1/proof/orgs/northside/settings", json={"policy": {"competitor_names": True}}
    )
    assert put.status_code == 200
    again = client.post("/v1/proof/orgs/minimalist/ask", json={"question": "How do we compare?"})
    assert again.json()["refused"] is False and again.json()["scope"]["names_hidden"] is False


def test_the_retailer_asks_with_names_and_a_brand_in_focus(client, fake, monkeypatch):
    monkeypatch.setattr(
        gemini, "generate_json", lambda *a, **k: Answer(answer="The Ordinary reached 50%.")
    )
    monkeypatch.setattr(retailer, "insights", lambda *a: INSIGHTS)
    assert client.post("/v1/proof/orgs/northside/ask", json={"question": "hi?"}).status_code == 403
    _join(client, "northside", "viewer")
    res = client.post(
        "/v1/proof/orgs/northside/ask", json={"question": "How is it?", "brand": "minimalist"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["refused"] is False
    assert res.json()["scope"] == {"brand": "Minimalist", "names_hidden": False}


# -- fit --------------------------------------------------------------------------------------


def _shopper(fake, uid: str, opted: bool, avoid=(), products=(), reactions=()) -> None:
    fake.store.user_merge(
        uid,
        {
            "consent": {"aggregate_insights_opt_in": opted},
            "profile": {"safety": {"avoid": list(avoid), "avoid_products": list(products)}},
            "reactions": [{"product_id": p, "level": lvl} for p, lvl in reactions],
        },
    )


def test_fit_counts_opted_in_people_only_and_hides_small_groups(client, fake):
    for i in range(12):
        _shopper(fake, f"in{i}", True, ["fragrance"], [MINIMALIST], [(MINIMALIST, "stop")])
    for i in range(9):  # under 10: left out
        _shopper(fake, f"few{i}", True, ["lanolin"], [ORDINARY])
    for i in range(30):  # not opted in: never counted
        _shopper(fake, f"out{i}", False, ["nut_oils"], [ORDINARY], [(ORDINARY, "mild")])
    _join(client, "northside", "viewer")
    out = client.get("/v1/proof/orgs/northside/fit").json()
    assert out["profiled"] == 21 and out["min_group"] == 10
    assert [g["id"] for g in out["avoid"]] == ["fragrance"]
    rows = [(p["product_id"], p["avoided"], p["reacted"], p["stopped"]) for p in out["products"]]
    assert rows == [(MINIMALIST, 12, 12, 12)]
    assert out["hidden"] == 1
    # a brand sees its own products only
    brand = _as("brand-viewer")
    _join(brand, "the-derma-co", "viewer")
    assert brand.get("/v1/proof/orgs/the-derma-co/fit").json()["products"] == []
