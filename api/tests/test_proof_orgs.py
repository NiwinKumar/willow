"""Proof by Willow organisations (app/proof_orgs.py, routes/proof_routes.py): instance resolution,
'Try as' membership, roles, the brand-own rule and demo campaigns, decisions, evidence requests,
saved claims and their export guard, and the methodology facts."""

import pytest
from fastapi.testclient import TestClient

from app import campaigns, proof_ai, retail_intel, retailer
from app.contract import load
from app.main import app

MINIMALIST = "minimalist-alpha-arbutin-2-face-serum"
DERMA_CO = "the-derma-co-tran-zelaic-pigmentation-corrector-serum"
ORDINARY = "the-ordinary-alpha-arbutin-2-ha"


def _as(uid: str) -> TestClient:
    return TestClient(app, headers={"X-Dev-Uid": uid})


def _join(c: TestClient, org: str, role: str = "admin", instance: str = "northside") -> None:
    res = c.post("/v1/proof/join", json={"instance": instance, "org_id": org, "role": role})
    assert res.status_code == 200, res.text


def test_instance_resolves_by_slug_then_host_then_default():
    c = _as("anyone")
    north = c.get("/v1/proof/instance", params={"host": "Northside.localhost:5173"}).json()
    assert north["instance"]["id"] == "northside" and north["instance"]["demo"] is True
    orgs = {o["id"]: o for o in north["orgs"]}
    assert orgs["the-derma-co"]["brands"] == ["The Derma Co"]
    assert orgs["the-derma-co"]["verified"] == "Verified from Northside's supplier list"
    assert orgs["northside"]["kind"] == "retailer" and orgs["northside"]["verified"] is None
    assert c.get("/v1/proof/instance", params={"slug": "northside"}).json() == north
    fallback = c.get("/v1/proof/instance", params={"host": "willow.web.app"}).json()
    assert fallback["instance"]["id"] == "willow"
    # the default instance keeps today's 'view as any brand': one brand org per catalog brand
    assert {"willow", "willow-the-ordinary"} <= {o["id"] for o in fallback["orgs"]}


def test_try_as_joins_a_demo_org_and_becomes_current(client, fake):
    assert client.get("/v1/proof/me").json() == {"memberships": [], "current": None}
    _join(client, "northside", "admin")
    _join(client, "minimalist", "viewer")
    me = client.get("/v1/proof/me", params={"instance": "northside"}).json()
    assert me["current"] == {"org_id": "minimalist", "role": "viewer"}
    assert all(m["demo"] for m in me["memberships"]) and len(me["memberships"]) == 2
    # an org of another instance, or an unknown one
    bad = {"instance": "northside", "org_id": "willow", "role": "admin"}
    assert client.post("/v1/proof/join", json=bad).status_code == 404
    bad = {"instance": "northside", "org_id": "nobody", "role": "admin"}
    assert client.post("/v1/proof/join", json=bad).status_code == 404


def test_roles_gate_reads_writes_and_the_policy(client, fake):
    key = "/v1/proof/orgs/northside/decisions/shelf:serum"
    assert client.get("/v1/proof/orgs/northside/decisions").status_code == 403  # not a member
    _join(client, "northside", "viewer")
    assert client.get("/v1/proof/orgs/northside/decisions").status_code == 200
    assert client.put(key, json={"status": "accepted"}).status_code == 403
    _join(client, "northside", "analyst")
    assert client.put(key, json={"status": "accepted"}).status_code == 200
    policy = {"policy": {"competitor_names": True}}
    assert client.put("/v1/proof/orgs/northside/settings", json=policy).status_code == 403
    _join(client, "northside", "admin")
    res = client.put("/v1/proof/orgs/northside/settings", json=policy)
    assert res.status_code == 200 and res.json()["policy"]["competitor_names"] is True
    assert res.json()["policy"]["min_group"] == retailer.MIN_GROUP
    # a brand reads the retailer's policy and cannot change it, even as its admin
    brand = _as("brand_admin")
    _join(brand, "minimalist", "admin")
    got = brand.get("/v1/proof/orgs/minimalist/settings").json()
    assert got["policy"]["competitor_names"] is True and got["editable"] is False
    assert brand.put("/v1/proof/orgs/minimalist/settings", json=policy).status_code == 403
    assert client.get("/v1/proof/orgs/nowhere/decisions").status_code == 404


@pytest.fixture
def proven(monkeypatch):
    monkeypatch.setattr(campaigns, "HOLDOUT_PCT", 0.0)
    monkeypatch.setattr(
        campaigns,
        "eligibility_of",
        lambda pid: {
            "product_id": pid,
            "tier": "proven",
            "eligible": True,
            "goals": ["dark_spots"],
            "skin_types": ["oily"],
            "evidence": "measured",
        },
    )


def _campaign(c: TestClient, pid: str, workspace: str = "retailer"):
    body = {"product_id": pid, "workspace": workspace, "goals": ["dark_spots"], "days": 7}
    return c.post("/v1/retailer/campaigns", json=body)


def test_campaigns_need_a_membership_and_a_brand_promotes_only_its_own(client, fake, proven):
    res = _campaign(client, MINIMALIST)
    assert res.status_code == 403  # no organisation: the open door is closed
    _join(client, "minimalist", "viewer")
    assert _campaign(client, MINIMALIST).status_code == 403  # viewers cannot create
    _join(client, "minimalist", "analyst")
    res = _campaign(client, ORDINARY, workspace="The Ordinary")
    assert res.status_code == 403 and "own brand" in res.json()["detail"]["message"]
    made = _campaign(client, MINIMALIST)  # a brand promotes as its brand, whatever the page
    assert made.status_code == 201
    assert made.json()["workspace"] == "Minimalist" and made.json()["org_id"] == "minimalist"
    assert made.json()["demo"] is True


def test_demo_campaigns_reach_guests_only(client, fake, proven):
    _join(client, "northside", "analyst")
    cid = _campaign(client, MINIMALIST).json()["id"]
    shopper = _as("shopper")
    assert shopper.put(
        "/v1/me/profile",
        json={"goals": ["dark_spots"], "skin_type": "oily", "hide_sponsored": False},
    ).is_success
    assert campaigns.sponsored(fake.store, "shopper", guest=True)["campaign_id"] == cid
    assert campaigns.sponsored(fake.store, "shopper", guest=False) is None
    # one made under a real membership reaches real users too
    fake.store.campaigns[cid]["demo"] = False
    assert campaigns.sponsored(fake.store, "shopper", guest=False)["campaign_id"] == cid
    # one made before organisations existed (no flag) counts as demo
    del fake.store.campaigns[cid]["demo"]
    assert campaigns.sponsored(fake.store, "shopper", guest=False) is None


def test_decisions_keep_state_and_a_log_per_org(client, fake):
    _join(client, "northside", "analyst")
    url = "/v1/proof/orgs/northside/decisions/shelf:serum-x"
    snap = {"title": "Serum X: 14% of shelf, 6% of results", "figure": "14% vs 6%", "n": 212}
    assert client.put(url, json={"status": "accepted", "snapshot": snap}).status_code == 200
    assert client.put(url, json={"status": "done", "reason": "Range review booked"}).is_success
    got = client.get("/v1/proof/orgs/northside/decisions").json()
    item = got["items"]["shelf:serum-x"]
    assert item["status"] == "done" and item["reason"] == "Range review booked"
    assert [e["status"] for e in got["log"]] == ["done", "accepted"]
    assert got["log"][1]["snapshot"] == snap and got["log"][0]["by_role"] == "analyst"
    bad_key = url.replace("shelf:serum-x", "__reserved__")
    assert client.put(bad_key, json={"status": "done"}).status_code == 422
    other = _as("brand")
    _join(other, "minimalist", "analyst")
    assert other.get("/v1/proof/orgs/minimalist/decisions").json() == {"items": {}, "log": []}


def test_evidence_requests_reach_the_brand_inbox_and_only_it_answers(client, fake):
    _join(client, "northside", "analyst")
    brand = _as("derma")
    _join(brand, "the-derma-co", "analyst")
    body = {"to_org": "the-derma-co", "product_id": DERMA_CO, "message": "Evidence by skin type?"}
    sent = client.post("/v1/proof/orgs/northside/requests", json=body)
    assert sent.status_code == 201 and sent.json()["status"] == "open"
    rid = sent.json()["id"]
    wrong = body | {"product_id": MINIMALIST}  # not one of The Derma Co's products
    assert client.post("/v1/proof/orgs/northside/requests", json=wrong).status_code == 422
    assert [r["id"] for r in brand.get("/v1/proof/orgs/the-derma-co/requests").json()["inbox"]] == [
        rid
    ]
    assert client.get("/v1/proof/orgs/northside/requests").json()["outbox"][0]["id"] == rid
    # the sender cannot answer its own request; another brand cannot even read the inbox
    patch = {"status": "answered", "reply": "Attached."}
    assert client.patch(f"/v1/proof/orgs/northside/requests/{rid}", json=patch).status_code == 404
    rival = _as("rival")
    _join(rival, "minimalist", "admin")
    assert rival.get("/v1/proof/orgs/the-derma-co/requests").status_code == 403
    done = brand.patch(f"/v1/proof/orgs/the-derma-co/requests/{rid}", json=patch)
    assert done.status_code == 200 and done.json()["reply"] == "Attached."
    assert client.get("/v1/proof/orgs/northside/requests").json()["outbox"][0]["status"] == (
        "answered"
    )


def test_claims_from_simulated_or_mixed_data_cannot_be_exported(client, fake, monkeypatch):
    _join(client, "minimalist", "analyst")
    url = "/v1/proof/orgs/minimalist/claims"
    body = {"product_id": MINIMALIST, "text": "Measured in Willow users.", "cohort": "mixed"}
    saved = client.post(url, json=body | {"statements": ["efficacy"]})
    assert saved.status_code == 201 and saved.json()["exportable"] is False
    cid = saved.json()["id"]
    assert client.patch(f"{url}/{cid}", json={"status": "approved"}).is_success
    res = client.get(f"{url}/{cid}/export")
    assert res.status_code == 403
    assert res.json()["detail"]["message"] == "Claims from simulated data can't be exported"
    # a brand cannot save a claim about another brand's product
    assert client.post(url, json=body | {"product_id": ORDINARY}).status_code == 403
    # real-only rows that hold the cited statement: exportable once approved
    real_view = {"cohort": {"real": 12, "synthetic": 0}, "evidence": [{"id": "efficacy"}]}
    monkeypatch.setattr(
        retail_intel, "product", lambda pid, c, r: real_view | {"product": {"n": 12}}
    )
    real = client.post(url, json=body | {"cohort": "real", "statements": ["efficacy"]}).json()
    assert real["exportable"] is True and real["n"] == 12
    assert client.get(f"{url}/{real['id']}/export").status_code == 409  # approve first
    client.patch(f"{url}/{real['id']}", json={"status": "approved"})
    assert client.get(f"{url}/{real['id']}/export").status_code == 200


def test_generated_claims_carry_cohort_n_window_and_export_flag():
    from tests.test_proof_ai import _view

    view = _view()
    out = proof_ai.claims(view, "pdp")  # Gemini offline: the statements themselves
    assert out["observational"] is True and out["window"] == retail_intel.WINDOW
    assert out["n"] == view["product"]["n"] and out["caveat"]
    kind = proof_ai.cohort_of(view["cohort"])["kind"]
    assert out["cohort"]["kind"] == kind and out["exportable"] is (kind == "real")
    assert proof_ai.cohort_of({"real": 0, "synthetic": 9})["kind"] == "simulated"
    assert proof_ai.cohort_of({"real": 3, "synthetic": 9})["kind"] == "mixed"


def test_research_facts_come_from_the_code(client):
    got = client.get("/v1/proof/research").json()
    assert got["suppression"]["min_group"] == retailer.MIN_GROUP
    assert got["holdout"]["share"] == campaigns.HOLDOUT_PCT
    assert {t["id"]: t["min_n"] for t in got["tiers"]}["proven"] == retail_intel.PROVEN_N
    ids = load("analysis_result.schema.json")["$defs"]["metric_id"]["enum"]
    metrics = {m["id"]: m for m in got["metrics"]}
    assert list(metrics) == ids and all(m["unit"] for m in metrics.values())
    assert metrics["glow"]["better"] == "higher" and metrics["redness"]["better"] == "lower"
    assert metrics["tone_ita"]["better"] is None and metrics["tone_ita"]["outcome"] is False
    # BigQuery is offline in tests: the counts are null, the method still stands
    assert got["data_available"] is False and got["cohort"] is None
