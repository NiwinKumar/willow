"""Sample campaigns seeded on a first 'Try as' (app/dev_seed.py via proof_orgs.join): a portfolio
on Proven products, once per person and org, demo + sample, display only (never served, never
block a product or a slot). Built from the test cohort's outcomes (conftest samples_on)."""

import pytest
from fastapi.testclient import TestClient

from app import campaigns
from app.main import app


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


def test_first_join_seeds_a_portfolio_on_proven_products_once():
    guest = _as("guest_a")
    _join(guest)
    rows = _campaigns(guest)
    # the test cohort has 6 eligible Proven products sold in SEA or GLOBAL, one per brand
    assert len(rows) == 6
    assert all(r["sample"] and r["demo"] and r["org_id"] == "northside" for r in rows)
    assert {r["workspace"] for r in rows} == {"retailer"}
    assert len({r["brand"] for r in rows}) == len(rows)  # one per brand
    elig = {e["product_id"]: e for e in campaigns.eligibility_all()}
    assert all(elig[r["product_id"]]["tier"] == "proven" for r in rows)
    ended = [r for r in rows if r["status"] == "ended"]
    assert len(ended) == 3 and [r for r in rows if r["status"] == "active"]
    for r in rows:
        st, inc = r["stats"], r["stats"]["incrementality"]
        assert 0.18 <= st["ctr"] <= 0.33 and st["adds"] <= st["clicks"] <= st["impressions"]
        assert inc["holdout"]["n"] * 4 == pytest.approx(inc["exposed"]["n"], abs=3)
        assert st["reach"] == inc["exposed"]["n"] and inc["lift_lo"] <= inc["lift"]
    # the finished clear results sit above zero
    assert sum(1 for r in ended if r["stats"]["incrementality"]["lift_lo"] > 0) >= 2
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
    NIAC = _campaigns(a)[0]["product_id"]
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
    # one campaign per Proven product of the brand, up to 5 (Nov 28: fewer products are Proven
    # since effects are scaled by category and Proven needs false-discovery control); the first
    # slot is a finished campaign with a clear lift
    assert 1 <= len(rows) <= 5
    assert any(r["status"] == "ended" and r["stats"]["incrementality"] for r in rows)
    brand_products = {r["product_id"] for r in rows}
    # Minimalist's samples (if it has a Proven product it can promote in the test cohort) are
    # only its own products
    _join(guest, "minimalist", "analyst")
    # then the retailer: its portfolio, never on a product the brand seat already promotes
    _join(guest)
    rows = _campaigns(guest)
    by_org = {o: [r for r in rows if r["org_id"] == o] for o in ("minimalist", "northside")}
    assert {r["brand"] for r in by_org["minimalist"]} <= {"Minimalist"}
    assert not brand_products & {r["product_id"] for r in by_org["northside"]}
    products = [r["product_id"] for r in rows]
    assert len(products) == len(set(products))


def test_a_membership_from_before_samples_gets_them_when_proof_opens(fake):
    from datetime import UTC, datetime

    # a membership written before sample campaigns existed: no `samples` mark, no campaigns
    at = datetime.now(UTC)
    old = {
        "instance": "northside",
        "org_id": "northside",
        "uid": "old_judge",
        "role": "admin",
        "demo": True,
        "joined_at": at,
        "active_at": at,
    }
    fake.store.proof_member_set("northside", "northside", "old_judge", old)
    c = _as("old_judge")
    assert _campaigns(c) == []
    assert c.get("/v1/proof/me", params={"instance": "northside"}).status_code == 200
    first = _campaigns(c)
    assert len(first) == 6 and all(k["sample"] for k in first)
    c.get("/v1/proof/me", params={"instance": "northside"})  # opening Proof again adds nothing
    assert len(_campaigns(c)) == 6
