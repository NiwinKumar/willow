"""Sample campaigns seeded on a first 'Try as' (app/dev_seed.py via proof_orgs.join): once per
person and org, demo + sample, display only (never served, never block a product or a slot)."""

import pytest
from fastapi.testclient import TestClient

from app import campaigns
from app.main import app

NIAC = "cosrx-the-niacinamide-15-serum"  # a SPECS product (COSRX)
SUN = "the-derma-co-1-hyaluronic-sunscreen-aqua-gel-spf-50"  # the Derma Co's SPECS product


@pytest.fixture(autouse=True)
def _samples(samples_on, fake):
    """Seeding on (conftest turns it off for every other test), in a fresh store."""


def _as(uid: str) -> TestClient:
    return TestClient(app, headers={"X-Dev-Uid": uid})


def _join(c: TestClient, org: str = "northside", role: str = "admin") -> None:
    res = c.post("/v1/proof/join", json={"instance": "northside", "org_id": org, "role": role})
    assert res.status_code == 200, res.text


def _campaigns(c: TestClient) -> list[dict]:
    return c.get("/v1/retailer/campaigns").json()["campaigns"]


def test_first_join_seeds_a_finished_result_and_a_running_campaign_once():
    guest = _as("guest_a")
    _join(guest)
    rows = _campaigns(guest)
    assert len(rows) == 3
    assert all(r["sample"] and r["demo"] and r["org_id"] == "northside" for r in rows)
    assert {r["workspace"] for r in rows} == {"retailer"}
    ended = [r for r in rows if r["status"] == "ended"]
    running = [r for r in rows if r["status"] == "active"]
    assert len(ended) == 1 and len(running) == 2
    inc = ended[0]["stats"]["incrementality"]
    assert inc["holdout"]["n"] >= 10 and inc["lift_lo"] <= inc["lift"] <= inc["lift_hi"]
    # joining again (another role) or coming back to the org never seeds a second time
    _join(guest, role="analyst")
    _join(guest)
    assert sorted(r["id"] for r in _campaigns(guest)) == sorted(r["id"] for r in rows)


def test_samples_never_block_a_guest_or_reach_a_shopper(monkeypatch: pytest.MonkeyPatch):
    elig = {"eligible": True, "tier": "proven", "goals": ["dark_spots"], "skin_types": ["oily"]}
    monkeypatch.setattr(campaigns, "eligibility_of", lambda pid: {**elig, "product_id": pid})
    monkeypatch.setattr(campaigns, "HOLDOUT_PCT", 0.0)  # the shopper is always exposed
    a, b = _as("guest_a"), _as("guest_b")
    _join(a)
    _join(b)
    # b has their own samples, on NIAC too, and a's: neither blocks b's own campaign on it
    assert any(r["product_id"] == NIAC for r in _campaigns(b))
    body = {"product_id": NIAC, "workspace": "retailer", "goals": ["dark_spots"], "days": 14}
    res = b.post("/v1/retailer/campaigns", json=body)
    assert res.status_code == 201, res.text
    assert res.json()["sample"] is False
    # samples are never served: a matching shopper gets b's real (demo) campaign only
    shopper = _as("shopper")
    assert shopper.put("/v1/me/profile", json={"goals": ["dark_spots"], "skin_type": "oily"})
    assert shopper.get("/v1/sponsored").json()["item"]["campaign_id"] == res.json()["id"]
    b.delete(f"/v1/retailer/campaigns/{res.json()['id']}")
    assert _as("shopper2").put(
        "/v1/me/profile", json={"goals": ["dark_spots"], "skin_type": "oily"}
    )
    assert _as("shopper2").get("/v1/sponsored").json()["item"] is None


def test_a_brand_org_gets_only_its_brand_and_switching_never_duplicates():
    guest = _as("guest_c")
    _join(guest, "the-derma-co", "analyst")
    rows = _campaigns(guest)
    assert {r["brand"] for r in rows} == {"The Derma Co"}
    assert {r["workspace"] for r in rows} == {"The Derma Co"}
    assert SUN in {r["product_id"] for r in rows} and len(rows) == 3
    assert any(r["status"] == "ended" and r["stats"]["incrementality"] for r in rows)
    # Minimalist has no SPECS product: its own catalog products stand in
    _join(guest, "minimalist", "analyst")
    # then the retailer: its SPECS products, minus the sunscreen the brand seat already has
    _join(guest)
    rows = _campaigns(guest)
    by_org = {o: [r for r in rows if r["org_id"] == o] for o in ("minimalist", "northside")}
    assert {r["brand"] for r in by_org["minimalist"]} == {"Minimalist"}
    assert SUN not in {r["product_id"] for r in by_org["northside"]}
    products = [r["product_id"] for r in rows]
    assert len(products) == len(set(products)) == 3 + 3 + 2
