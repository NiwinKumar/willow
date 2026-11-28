"""Sample campaigns on a Proof membership (app/proof_orgs.py): a join never fails because the
outcomes behind the samples are unavailable (seeded on a later visit instead), and a membership
with an older sample portfolio gets the current one, its old samples (only those) deleted first.
A sample on a product that is no longer Proven is replaced the same way."""

from app import dev_seed, proof_orgs, retail_intel


def _seeding(monkeypatch, fail: bool = False) -> list[tuple[str, str]]:
    calls: list[tuple[str, str]] = []

    def seed(store, owner, org_id):
        calls.append((owner, org_id))
        if fail:
            raise dev_seed.SamplesUnavailable("no BigQuery rows")
        return []

    monkeypatch.setattr(dev_seed, "seed_demo_campaigns", seed)
    return calls


def test_a_join_without_outcomes_succeeds_and_seeds_on_the_next_visit(client, fake, monkeypatch):
    calls = _seeding(monkeypatch, fail=True)
    body = {"instance": "northside", "org_id": "minimalist", "role": "analyst"}
    assert client.post("/v1/proof/join", json=body).status_code == 200
    saved = fake.store.proof_member_get("northside", "minimalist", "u_test")
    assert saved["role"] == "analyst" and "samples" not in saved
    assert calls == [("u_test", "minimalist")]

    calls = _seeding(monkeypatch)
    assert client.get("/v1/proof/me?instance=northside").status_code == 200
    assert calls == [("u_test", "minimalist")]
    saved = fake.store.proof_member_get("northside", "minimalist", "u_test")
    assert saved["samples"] == proof_orgs.SAMPLES_VERSION
    client.get("/v1/proof/me?instance=northside")
    assert len(calls) == 1  # done once per membership and version


def test_an_older_portfolio_is_replaced_and_only_its_samples_go(client, fake, monkeypatch):
    store = fake.store
    member = {
        "instance": "northside",
        "org_id": "northside",
        "uid": "u_test",
        "role": "admin",
        "demo": True,
        "samples": True,  # version 1: the old member-based samples
    }
    store.proof_member_set("northside", "northside", "u_test", member)

    def campaign(owner: str, org_id: str, sample: bool) -> dict:
        return {"owner_uid": owner, "org_id": org_id, "sample": sample, "status": "active"}

    store.campaign_set("c_old_sample", campaign("u_test", "northside", True))
    store.campaign_set("c_own_demo", campaign("u_test", "northside", False))
    store.campaign_set("c_other_org", campaign("u_test", "minimalist", True))
    store.campaign_set("c_other_owner", campaign("someone", "northside", True))
    calls = _seeding(monkeypatch)

    assert client.get("/v1/proof/me?instance=northside").status_code == 200
    assert calls == [("u_test", "northside")]
    assert set(store.campaigns) == {"c_own_demo", "c_other_org", "c_other_owner"}
    saved = store.proof_member_get("northside", "northside", "u_test")
    assert saved["samples"] == proof_orgs.SAMPLES_VERSION

    # a join of a membership already on the current version does not seed again
    body = {"instance": "northside", "org_id": "northside", "role": "viewer"}
    assert client.post("/v1/proof/join", json=body).status_code == 200
    assert len(calls) == 1
    saved = store.proof_member_get("northside", "northside", "u_test")
    assert saved["samples"] == proof_orgs.SAMPLES_VERSION


def test_a_sample_on_a_product_that_is_no_longer_proven_is_replaced(client, fake, monkeypatch):
    """Promote only Proven holds for samples: on every membership (the web keeps its own pick of
    org, so not only the one used last), a current-version portfolio with a sample on a product
    that lost Proven is re-seeded; a real campaign on such a product is never touched."""
    store = fake.store
    for org_id, active in (("northside", "2026-11-28"), ("minimalist", "2026-11-20")):
        member = {
            "instance": "northside",
            "org_id": org_id,
            "uid": "u_test",
            "role": "analyst",
            "demo": True,
            "samples": proof_orgs.SAMPLES_VERSION,
            "active_at": active,
        }
        store.proof_member_set("northside", org_id, "u_test", member)

    def campaign(org_id: str, product_id: str, sample: bool) -> dict:
        return {
            "owner_uid": "u_test",
            "org_id": org_id,
            "sample": sample,
            "status": "active",
            "product_id": product_id,
        }

    store.campaign_set("c_still_proven", campaign("northside", "p_proven", True))
    store.campaign_set("c_lost_proven", campaign("minimalist", "p_lost", True))
    store.campaign_set("c_real", campaign("minimalist", "p_lost", False))
    elig = [
        {"product_id": "p_proven", "eligible": True},
        {"product_id": "p_lost", "eligible": False},
    ]
    monkeypatch.setattr(retail_intel, "loaded", lambda *a: True)
    monkeypatch.setattr(retail_intel, "eligibility_all", lambda: elig)
    calls = _seeding(monkeypatch)

    assert client.get("/v1/proof/me?instance=northside").status_code == 200
    assert calls == [("u_test", "minimalist")]  # only the org with the stale sample
    assert set(store.campaigns) == {"c_still_proven", "c_real"}

    # outcomes not in memory: opening Proof never waits for them, nothing is checked
    store.campaign_set("c_lost_proven", campaign("minimalist", "p_lost", True))
    monkeypatch.setattr(retail_intel, "loaded", lambda *a: False)
    client.get("/v1/proof/me?instance=northside")
    assert len(calls) == 1
