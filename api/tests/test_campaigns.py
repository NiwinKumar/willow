"""Proof-gated promotion: /v1/retailer/eligibility, /v1/retailer/campaigns, /v1/sponsored
(app/campaigns.py). The eligibility seam (slice A's retail_intel) is stubbed."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app import campaigns
from app.main import app

PROVEN = "the-ordinary-alpha-arbutin-2-ha"  # The Ordinary serum: dark_spots, even_tone
PROVEN_2 = "minimalist-alpha-arbutin-2-face-serum"  # Minimalist serum: dark_spots, even_tone
PROVEN_3 = "plum-15-vitamin-c-mandarin-glow-boost-serum"  # Plum: dark_spots, oil_glow
PROVEN_4 = "clinique-even-better-clinical-dark-spot-clearing-serum"
PROMISING = "cerave-resurfacing-retinol-serum"


ALL_SKIN = ["oily", "combination", "dry", "normal", "sensitive"]


def _elig(pid: str, tier: str, goals: list[str], skin: list[str] = ALL_SKIN) -> dict:
    return {
        "product_id": pid,
        "product": pid,
        "brand": "x",
        "tier": tier,
        "eligible": tier == "proven",
        "reasons": [] if tier == "proven" else ["Needs 30 people and a lift above zero."],
        "goals": goals,
        "skin_types": list(skin),
        "evidence": f"In the Willow cohort, 48% had a real change (n=212). {pid}",
    }


ELIG = {
    PROVEN: _elig(PROVEN, "proven", ["dark_spots", "even_tone"]),
    PROVEN_2: _elig(PROVEN_2, "proven", ["dark_spots"], ["oily", "combination"]),
    PROVEN_3: _elig(PROVEN_3, "proven", ["dark_spots", "oil_glow"]),
    PROVEN_4: _elig(PROVEN_4, "proven", ["dark_spots"]),
    PROMISING: _elig(PROMISING, "promising", ["blemishes"]),
}


REAL_OF, REAL_ALL = campaigns.eligibility_of, campaigns.eligibility_all


@pytest.fixture(autouse=True)
def stub_eligibility(monkeypatch: pytest.MonkeyPatch):
    # no holdout unless a test asks for one (the holdout tests below)
    monkeypatch.setattr(campaigns, "HOLDOUT_PCT", 0.0)
    monkeypatch.setattr(campaigns, "eligibility_of", lambda pid: ELIG.get(pid))
    monkeypatch.setattr(campaigns, "eligibility_all", lambda: list(ELIG.values()))


def _as(uid: str) -> TestClient:
    return TestClient(app, headers={"X-Dev-Uid": uid})


def _create(client, pid=PROVEN, workspace="retailer", goals=("dark_spots",), skin=(), days=14):
    return client.post(
        "/v1/retailer/campaigns",
        json={
            "product_id": pid,
            "workspace": workspace,
            "goals": list(goals),
            "skin_types": list(skin),
            "days": days,
        },
    )


def _shopper(uid="shopper", goals=("dark_spots",), skin="oily", **extra) -> TestClient:
    c = _as(uid)
    assert c.put(
        "/v1/me/profile", json={"goals": list(goals), "skin_type": skin, **extra}
    ).is_success
    return c


# -- eligibility ---------------------------------------------------------------------------------


def test_eligibility_lists_the_seam(client, fake):
    res = client.get("/v1/retailer/eligibility")
    assert res.status_code == 200
    rows = {r["product_id"]: r for r in res.json()["products"]}
    assert rows[PROVEN]["eligible"] and not rows[PROMISING]["eligible"]


def test_eligibility_needs_sign_in(fake):
    assert TestClient(app).get("/v1/retailer/eligibility").status_code == 401


def test_without_retail_intel_eligibility_is_503(client, fake, monkeypatch):
    # a running campaign made while the evidence was readable
    cid = _create(client).json()["id"]
    # then the real seam, with retail_intel missing (or BigQuery down)
    monkeypatch.setattr(campaigns, "eligibility_of", REAL_OF)
    monkeypatch.setattr(campaigns, "eligibility_all", REAL_ALL)

    def missing():
        raise campaigns.Unavailable("missing")

    monkeypatch.setattr(campaigns, "_intel", missing)
    res = client.get("/v1/retailer/eligibility")
    assert res.status_code == 503 and res.json()["detail"]["code"] == "insights_unavailable"
    assert _create(client, pid=PROVEN_2).status_code == 503
    # and nobody sees an unproven card: no card at all
    assert cid and _shopper().get("/v1/sponsored").json() == {"item": None}


def test_the_real_seam_reports_a_missing_module_as_unavailable(monkeypatch):
    import sys

    monkeypatch.setitem(sys.modules, "app.retail_intel", None)  # import raises ImportError
    with pytest.raises(campaigns.Unavailable):
        REAL_OF(PROVEN)
    with pytest.raises(campaigns.Unavailable):
        REAL_ALL()


# -- create: the evidence gate -------------------------------------------------------------------


def test_create_a_campaign(client, fake):
    res = _create(client, skin=("oily", "oily"))
    assert res.status_code == 201
    c = res.json()
    assert c["id"].startswith("c_") and c["status"] == "active" and c["placement"] == "routine"
    assert c["product"] and c["brand"] == "The Ordinary" and c["image_url"]
    assert c["skin_types"] == ["oily"] and c["days"] == 14
    assert c["stats"]["impressions"] == 0 and c["stats"]["ctr"] is None
    assert "suppressed" not in c["stats"]
    assert len(c["stats"]["daily"]) == 1
    doc = fake.store.campaigns[c["id"]]
    assert doc["owner_uid"] == "u_test" and doc["ends_at"] - doc["starts_at"] == timedelta(days=14)


def test_only_proven_products(client, fake):
    res = _create(client, pid=PROMISING, goals=("blemishes",))
    assert res.status_code == 422
    d = res.json()["detail"]
    assert d["code"] == "not_eligible"
    assert "Only products rated Proven can be promoted." in d["reasons"]
    assert "Needs 30 people and a lift above zero." in d["reasons"]
    assert not fake.store.campaigns


def test_goals_must_be_within_the_evidence(client, fake):
    res = _create(client, goals=("dark_spots", "redness"))
    assert res.status_code == 422
    assert res.json()["detail"]["reasons"] == ["The evidence does not cover these goals: Redness."]


def test_brand_workspace_promotes_only_its_own_brand(client, fake):
    assert _create(client, workspace="The Ordinary").status_code == 201
    res = _create(client, workspace="Minimalist")
    assert res.status_code == 422
    assert "own brand" in res.json()["detail"]["reasons"][0]
    assert _create(client, workspace="Nobody Cosmetics").status_code == 422
    assert _create(client, pid="no-such-product").status_code == 404


@pytest.mark.parametrize(
    "patch",
    [{"days": 10}, {"goals": []}, {"goals": ["clearer"]}, {"skin_types": ["very_dry"]}, {"x": 1}],
)
def test_bad_bodies(client, fake, patch):
    body = {"product_id": PROVEN, "workspace": "retailer", "goals": ["dark_spots"], "days": 7}
    assert client.post("/v1/retailer/campaigns", json=body | patch).status_code == 422


def test_at_most_three_running(client, fake):
    ids = [_create(client, pid=p).json()["id"] for p in (PROVEN, PROVEN_2, PROVEN_3)]
    res = _create(client, pid=PROVEN_4)
    assert res.status_code == 429 and res.json()["detail"]["code"] == "too_many_active"
    # someone else is not affected
    assert _create(_as("other"), pid=PROVEN_4).status_code == 201
    # a paused one frees a place; resuming it past the cap is refused
    assert client.patch(f"/v1/retailer/campaigns/{ids[0]}", json={"status": "paused"}).is_success
    assert _create(client, pid=PROVEN_4).status_code == 201
    res = client.patch(f"/v1/retailer/campaigns/{ids[0]}", json={"status": "active"})
    assert res.status_code == 429


def test_creation_is_rate_limited(client, fake, monkeypatch):
    from app import limits

    monkeypatch.setitem(limits.CAPS, "campaign_create", (1, 100))
    assert _create(client).status_code == 201
    assert _create(client, pid=PROVEN_2).status_code == 429


# -- list, patch, delete -------------------------------------------------------------------------


def test_list_is_mine_only_newest_first(client, fake):
    first = _create(client).json()["id"]
    second = _create(client, pid=PROVEN_2).json()["id"]
    _create(_as("other"), pid=PROVEN_3)
    rows = client.get("/v1/retailer/campaigns").json()["campaigns"]
    assert [r["id"] for r in rows] == [second, first]


def test_owner_only_patch_and_delete(client, fake):
    cid = _create(client).json()["id"]
    other = _as("other")
    assert (
        other.patch(f"/v1/retailer/campaigns/{cid}", json={"status": "paused"}).status_code == 404
    )
    assert other.delete(f"/v1/retailer/campaigns/{cid}").status_code == 404
    assert (
        client.patch("/v1/retailer/campaigns/c_nothere00000", json={"status": "paused"}).status_code
        == 404
    )

    res = client.patch(f"/v1/retailer/campaigns/{cid}", json={"status": "paused"})
    assert res.status_code == 200 and res.json()["status"] == "paused"
    assert (
        client.patch(f"/v1/retailer/campaigns/{cid}", json={"status": "deleted"}).status_code == 422
    )
    assert (
        client.patch(f"/v1/retailer/campaigns/{cid}", json={"status": "active"}).json()["status"]
        == "active"
    )

    assert client.delete(f"/v1/retailer/campaigns/{cid}").status_code == 204
    assert client.get("/v1/retailer/campaigns").json()["campaigns"] == []


def test_resume_rechecks_the_evidence(client, fake):
    cid = _create(client).json()["id"]
    client.patch(f"/v1/retailer/campaigns/{cid}", json={"status": "paused"})
    ELIG[PROVEN]["tier"], ELIG[PROVEN]["eligible"] = "promising", False
    try:
        res = client.patch(f"/v1/retailer/campaigns/{cid}", json={"status": "active"})
        assert res.status_code == 422 and res.json()["detail"]["code"] == "not_eligible"
    finally:
        ELIG[PROVEN]["tier"], ELIG[PROVEN]["eligible"] = "proven", True


def test_status_is_ended_past_ends_at(client, fake):
    cid = _create(client).json()["id"]
    doc = fake.store.campaigns[cid]
    doc["starts_at"] -= timedelta(days=20)
    doc["ends_at"] -= timedelta(days=20)
    [row] = client.get("/v1/retailer/campaigns").json()["campaigns"]
    assert row["status"] == "ended"
    assert len(row["stats"]["daily"]) == 14  # the campaign's own days, not up to today
    res = client.patch(f"/v1/retailer/campaigns/{cid}", json={"status": "paused"})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "ended"
    # an ended campaign no longer counts against the cap, and is never shown
    assert campaigns.active_count(fake.store, "u_test") == 0
    assert _shopper().get("/v1/sponsored").json()["item"] is None


def test_delete_me_removes_my_campaigns(client, fake):
    _create(client)
    client.delete("/v1/me")
    assert fake.store.campaigns == {}


# -- the consumer card ---------------------------------------------------------------------------


def test_sponsored_matches_goals_and_skin_type(client, fake):
    cid = _create(client, goals=("dark_spots",), skin=("oily",)).json()["id"]
    item = _shopper(goals=["dark_spots", "lines"], skin="oily").get("/v1/sponsored").json()["item"]
    assert item["campaign_id"] == cid and item["product_id"] == PROVEN
    assert item["label"] == "Sponsored" and item["cohort_label"] == campaigns.COHORT_LABEL
    assert item["evidence"] == ELIG[PROVEN]["evidence"] and item["image_url"]
    assert item["matched"] == {"goals": ["dark_spots"], "skin_type": "oily"}
    assert "never changes your recommendations" in item["disclosure"]

    # another skin type, or no overlapping goal: nothing
    assert _shopper("dry", skin="dry").get("/v1/sponsored").json()["item"] is None
    assert _shopper("lines", goals=["lines"]).get("/v1/sponsored").json()["item"] is None
    # no goals at all: nothing
    assert _shopper("none", goals=[]).get("/v1/sponsored").json()["item"] is None


def test_empty_skin_types_mean_every_eligible_skin_type(client, fake):
    _create(client, pid=PROVEN_2)  # evidence covers oily and combination only
    item = _shopper("c", skin="combination").get("/v1/sponsored").json()["item"]
    assert item and item["matched"]["skin_type"] == "combination"
    assert _shopper("s", skin="sensitive").get("/v1/sponsored").json()["item"] is None
    # no skin type on the profile: not in any eligible list
    nobody = _as("noskin")
    nobody.put("/v1/me/profile", json={"goals": ["dark_spots"]})
    assert nobody.get("/v1/sponsored").json()["item"] is None


def test_skin_types_must_be_within_the_evidence(client, fake):
    res = _create(client, pid=PROVEN_2, skin=("oily", "dry"))
    assert res.status_code == 422
    assert res.json()["detail"]["reasons"] == ["The evidence does not cover these skin types: dry."]
    assert _create(client, pid=PROVEN_2, skin=("combination",)).status_code == 201
    # no skin type with enough evidence: nothing can be promoted
    saved = ELIG[PROVEN]["skin_types"]
    ELIG[PROVEN]["skin_types"] = []
    try:
        res = _create(client)
        assert res.status_code == 422
        assert "No skin type has enough evidence" in res.json()["detail"]["reasons"][0]
    finally:
        ELIG[PROVEN]["skin_types"] = saved


def test_resume_rechecks_skin_types(client, fake):
    cid = _create(client, skin=("dry",)).json()["id"]
    client.patch(f"/v1/retailer/campaigns/{cid}", json={"status": "paused"})
    saved = ELIG[PROVEN]["skin_types"]
    ELIG[PROVEN]["skin_types"] = ["oily"]
    try:
        res = client.patch(f"/v1/retailer/campaigns/{cid}", json={"status": "active"})
        assert res.status_code == 422 and "dry" in res.json()["detail"]["reasons"][0]
    finally:
        ELIG[PROVEN]["skin_types"] = saved


def test_sponsored_skips_paused_and_no_longer_proven(client, fake):
    cid = _create(client).json()["id"]
    shopper = _shopper()
    client.patch(f"/v1/retailer/campaigns/{cid}", json={"status": "paused"})
    assert shopper.get("/v1/sponsored").json()["item"] is None
    client.patch(f"/v1/retailer/campaigns/{cid}", json={"status": "active"})
    ELIG[PROVEN]["eligible"] = False
    try:
        assert shopper.get("/v1/sponsored").json()["item"] is None
    finally:
        ELIG[PROVEN]["eligible"] = True
    assert shopper.get("/v1/sponsored").json()["item"]


def test_sponsored_excludes_products_in_my_routine(client, fake):
    _create(client)
    shopper = _shopper()
    assert shopper.post("/v1/routine", json={"product_id": PROVEN, "slots": ["pm"]}).is_success
    assert shopper.get("/v1/sponsored").json()["item"] is None


def test_hide_sponsored(client, fake):
    _create(client)
    shopper = _shopper(hide_sponsored=True)
    assert shopper.get("/v1/sponsored").json()["item"] is None
    shopper.put("/v1/me/profile", json={"hide_sponsored": False})
    assert shopper.get("/v1/sponsored").json()["item"]


def test_rotation_is_deterministic_per_person_and_day(client, fake):
    owners = [_as(f"brand{i}") for i in range(3)]
    for c, pid in zip(owners, (PROVEN, PROVEN_2, PROVEN_3), strict=True):
        assert _create(c, pid=pid).status_code == 201
    seen = set()
    for i in range(12):
        s = _shopper(f"p{i}")
        first = s.get("/v1/sponsored").json()["item"]["campaign_id"]
        assert all(s.get("/v1/sponsored").json()["item"]["campaign_id"] == first for _ in range(3))
        seen.add(first)
    assert len(seen) > 1  # different people see different campaigns

    cands = [("c_b", {}), ("c_a", {}), ("c_c", {})]
    assert campaigns.pick("u", "2026-10-16", cands) == campaigns.pick(
        "u", "2026-10-16", cands[::-1]
    )
    days = {campaigns.pick("u", f"2026-10-{d:02d}", cands)[0] for d in range(1, 29)}
    assert len(days) > 1  # and the same person rotates across days


# -- events and stats ----------------------------------------------------------------------------


def _event(c: TestClient, cid: str, kind: str) -> int:
    return c.post(f"/v1/sponsored/{cid}/events", json={"kind": kind}).status_code


def test_end_early_stops_for_good(client, fake):
    cid = _create(client).json()["id"]
    s = _shopper()
    assert s.get("/v1/sponsored").json()["item"]["campaign_id"] == cid
    res = client.patch(f"/v1/retailer/campaigns/{cid}", json={"status": "ended"})
    assert res.status_code == 200
    row = res.json()
    assert row["status"] == "ended" and row["ends_at"] <= campaigns.now().isoformat()
    assert len(row["stats"]["daily"]) == 1  # the day it ran
    assert campaigns.active_count(fake.store, "u_test") == 0  # frees a slot under the cap
    assert _shopper("shopper2").get("/v1/sponsored").json()["item"] is None
    for status in ("active", "paused", "ended"):
        res = client.patch(f"/v1/retailer/campaigns/{cid}", json={"status": status})
        assert res.status_code == 409 and res.json()["detail"]["code"] == "ended"
    assert (
        _as("other").patch(f"/v1/retailer/campaigns/{cid}", json={"status": "ended"}).status_code
        == 404
    )


def test_reach_counts_people_once_ever(client, fake, monkeypatch):
    cid = _create(client).json()["id"]
    a, b = _shopper("a"), _shopper("b")
    for c in (a, b):
        assert c.get("/v1/sponsored").json()["item"]["campaign_id"] == cid
        _event(c, cid, "impression")
        _event(c, cid, "impression")  # same day: one impression, one person
    st = client.get("/v1/retailer/campaigns").json()["campaigns"][0]["stats"]
    assert (st["reach"], st["impressions"]) == (2, 2)
    # the next day the same two people count as impressions again, not as new reach
    tomorrow = campaigns.today() + timedelta(days=1)
    monkeypatch.setattr(campaigns, "today", lambda: tomorrow)
    _event(a, cid, "impression")
    st = client.get("/v1/retailer/campaigns").json()["campaigns"][0]["stats"]
    assert (st["reach"], st["impressions"]) == (2, 3)
    assert "shopper" not in str(fake.store.campaign_member)  # members are hashed, never the uid


def test_impressions_count_once_per_person_per_day(client, fake):
    cid = _create(client).json()["id"]
    s = _shopper()
    for _ in range(3):
        assert _event(s, cid, "impression") == 204
    [(day, row)] = fake.store.campaign_days(cid)
    assert row["impressions"] == 1
    assert campaigns.seen_id("shopper", day) in {k for _, k in fake.store.campaign_seen}
    assert "shopper" not in str(fake.store.campaign_seen)  # hashed, never the uid


def test_clicks_and_adds_need_an_impression_and_the_routine(client, fake):
    cid = _create(client).json()["id"]
    s = _shopper()
    _event(s, cid, "click")  # never shown: not counted
    _event(s, cid, "impression")
    _event(s, cid, "click")
    _event(s, cid, "click")
    _event(s, cid, "add")  # not in the routine yet: not counted
    s.post("/v1/routine", json={"product_id": PROVEN, "slots": ["pm"]})
    _event(s, cid, "add")
    [(_, row)] = fake.store.campaign_days(cid)
    assert row == {"day": row["day"], "impressions": 1, "clicks": 1, "adds": 1}


def test_events_reject_bad_input(client, fake):
    cid = _create(client).json()["id"]
    s = _shopper()
    assert _event(s, cid, "purchase") == 422
    assert _event(s, "c_000000000000", "impression") == 404
    assert _event(s, "../etc", "impression") == 404
    assert (
        TestClient(app).post(f"/v1/sponsored/{cid}/events", json={"kind": "click"}).status_code
        == 401
    )


def test_delivery_counts_are_shown_as_counted(client, fake):
    cid = _create(client).json()["id"]
    s = _shopper("first")
    _event(s, cid, "impression")
    st = client.get("/v1/retailer/campaigns").json()["campaigns"][0]["stats"]
    # a judge sees "1 impression" right after viewing the card
    assert st["impressions"] == 1 and st["reach"] == 1 and st["clicks"] == 0 and st["ctr"] == 0.0
    assert st["daily"][-1] == {
        "day": st["daily"][-1]["day"],
        "impressions": 1,
        "clicks": 0,
        "adds": 0,
    }
    _event(s, cid, "click")
    s.post("/v1/routine", json={"product_id": PROVEN, "slots": ["pm"]})
    _event(s, cid, "add")
    st = client.get("/v1/retailer/campaigns").json()["campaigns"][0]["stats"]
    assert (st["impressions"], st["clicks"], st["adds"], st["ctr"]) == (1, 1, 1, 1.0)
    assert st["incrementality"] is None  # the holdout comparison waits for 10 per group


def test_ctr(client, fake):
    cid = _create(client).json()["id"]
    for i in range(20):
        s = _shopper(f"s{i}")
        _event(s, cid, "impression")
        if i < 5:
            _event(s, cid, "click")
    st = client.get("/v1/retailer/campaigns").json()["campaigns"][0]["stats"]
    assert (st["impressions"], st["clicks"], st["adds"], st["ctr"]) == (20, 5, 0, 0.25)
    assert "suppressed" not in st


def test_events_are_rate_limited(client, fake, monkeypatch):
    from app import limits

    cid = _create(client).json()["id"]
    monkeypatch.setitem(limits.CAPS, "sponsored_event", (2, 100))
    s = _shopper()
    assert _event(s, cid, "impression") == 204
    assert _event(s, cid, "click") == 204
    assert _event(s, cid, "click") == 429


# -- randomised holdout and incrementality -------------------------------------------------------


def test_assignment_is_stable_and_near_the_share():
    groups = [campaigns.group_of("c_abc", f"u{i}", 0.2) for i in range(2000)]
    assert all(campaigns.group_of("c_abc", f"u{i}", 0.2) == g for i, g in enumerate(groups))
    assert 0.16 < groups.count("holdout") / 2000 < 0.24
    assert campaigns.group_of("c_abc", "u1", 0.0) == "exposed"


def _holdout_campaign(client, fake, pct=0.5):
    res = client.post(
        "/v1/retailer/campaigns",
        json={
            "product_id": PROVEN,
            "workspace": "retailer",
            "goals": ["dark_spots"],
            "days": 14,
            "holdout_pct": pct,
        },
    )
    assert res.status_code == 201
    return res.json()["id"]


def _uid_in(cid: str, group: str, pct=0.5, start=0) -> str:
    return next(
        f"m{i}" for i in range(start, 10_000) if campaigns.group_of(cid, f"m{i}", pct) == group
    )


def test_holdout_members_get_no_card_and_membership_is_recorded(client, fake):
    cid = _holdout_campaign(client, fake)
    assert fake.store.campaigns[cid]["holdout_pct"] == 0.5
    held, shown = _uid_in(cid, "holdout"), _uid_in(cid, "exposed")
    assert _shopper(held).get("/v1/sponsored").json()["item"] is None
    assert _shopper(held).get("/v1/sponsored").json()["item"] is None  # stays held out
    assert _shopper(shown).get("/v1/sponsored").json()["item"]["campaign_id"] == cid
    members = {k[1]: d for k, d in fake.store.campaign_member.items() if k[0] == cid}
    assert members[campaigns.member_id(held)]["group"] == "holdout"
    assert members[campaigns.member_id(shown)] == {
        "group": "exposed",
        "first_day": campaigns.today().isoformat(),
        "added": False,
    }
    assert held not in str(members) and shown not in str(members)  # hashed uids only


def test_a_held_out_person_sees_the_next_matching_campaign(client, fake):
    first = _holdout_campaign(client, fake)
    second = _create(_as("other"), pid=PROVEN_2).json()["id"]  # holdout 0 in tests
    held = _uid_in(first, "holdout")
    item = _shopper(held).get("/v1/sponsored").json()["item"]
    assert item["campaign_id"] == second


def test_attribution_from_an_organic_add(client, fake):
    cid = _holdout_campaign(client, fake)
    held, shown = _uid_in(cid, "holdout"), _uid_in(cid, "exposed")
    for uid in (held, shown):
        s = _shopper(uid)
        s.get("/v1/sponsored")  # assigned
        # added through search, not the card
        assert s.post("/v1/routine", json={"product_id": PROVEN, "slots": ["am"]}).is_success
    members = {k[1]: d for k, d in fake.store.campaign_member.items() if k[0] == cid}
    assert members[campaigns.member_id(held)]["added"] is True
    assert members[campaigns.member_id(shown)]["added"] is True
    # a person never assigned is not a member, and their add changes nothing
    _shopper("stranger").post("/v1/routine", json={"product_id": PROVEN, "slots": ["am"]})
    assert len(members) == 2 and len(fake.store.campaign_members(cid)) == 2


def test_incrementality_is_null_under_ten_per_group(client, fake):
    cid = _holdout_campaign(client, fake)
    for i in range(12):
        _shopper(f"x{i}").get("/v1/sponsored")
    groups = [m["group"] for m in fake.store.campaign_members(cid)]
    assert min(groups.count("exposed"), groups.count("holdout")) < 10
    [row] = client.get("/v1/retailer/campaigns").json()["campaigns"]
    assert row["stats"]["incrementality"] is None
    assert row["stats"]["incrementality_note"].startswith("Adoption lift vs a randomised holdout")


def test_incrementality_lift_and_ci():
    members = [{"group": "exposed", "added": i < 12} for i in range(40)] + [
        {"group": "holdout", "added": i < 2} for i in range(20)
    ]
    inc = campaigns.incrementality(members)
    assert inc["exposed"] == {"n": 40, "added": 12, "rate": 0.3}
    assert inc["holdout"] == {"n": 20, "added": 2, "rate": 0.1}  # a rate of a group of 20
    # 0.3 - 0.1 +- 1.96 * sqrt(.3*.7/40 + .1*.9/20) = 0.2 +- 0.1935
    assert inc["lift"] == 0.2 and inc["lift_lo"] == 0.01 and inc["lift_hi"] == 0.39
    assert campaigns.incrementality(members[:40] + members[40:49]) is None  # 9 held out


def test_incrementality_in_the_campaign_stats(client, fake):
    cid = _holdout_campaign(client, fake)
    i = 0
    while (
        min(
            sum(m["group"] == g for m in fake.store.campaign_members(cid))
            for g in ("exposed", "holdout")
        )
        < 10
    ):
        _shopper(f"y{i}").get("/v1/sponsored")
        i += 1
    [row] = client.get("/v1/retailer/campaigns").json()["campaigns"]
    inc = row["stats"]["incrementality"]
    assert inc["exposed"]["n"] >= 10 and inc["holdout"]["n"] >= 10
    assert inc["lift"] == 0.0 and inc["lift_lo"] == 0.0 and inc["lift_hi"] == 0.0


def test_dev_seed_gives_each_kind_of_campaign_with_history():
    from app import dev_seed
    from app.store import MemoryStore

    store = MemoryStore()
    ids = dev_seed.seed_demo_campaigns(store)
    assert len(ids) == 3 and dev_seed.seed_demo_campaigns(store) == []  # once
    by = {cid: campaigns.view(store, cid, store.campaign_get(cid)) for cid in ids}
    clear, collecting, ended = (by[s["id"]] for s in dev_seed.SPECS)
    assert clear["status"] == "active" and len(clear["stats"]["daily"]) == 12
    inc = clear["stats"]["incrementality"]
    assert inc["lift"] > 0 and inc["lift_lo"] > 0 and inc["exposed"]["n"] == 640
    assert collecting["status"] == "active" and collecting["stats"]["incrementality"] is None
    assert ended["status"] == "ended" and len(ended["stats"]["daily"]) == 14
    inc = ended["stats"]["incrementality"]
    assert inc["lift_lo"] < 0 < inc["lift_hi"]
    assert campaigns.active_count(store, dev_seed.DEV_OWNER) == 2
