"""AutoCampaign (app/autopilot.py, /v1/retailer/autopilot/*): rules that start and manage
proof-gated campaigns. The evidence seams (autopilot.signals, campaigns.eligibility_*) are stubbed
from one table of products, so both always agree."""

import copy
from datetime import timedelta

import pytest

from app import autopilot, campaigns

SERUM = "the-ordinary-alpha-arbutin-2-ha"  # The Ordinary serum
SERUM_2 = "minimalist-alpha-arbutin-2-face-serum"  # Minimalist serum
SERUM_3 = "plum-15-vitamin-c-mandarin-glow-boost-serum"  # Plum serum
CREAM = "cerave-pm-facial-moisturizing-lotion"  # CeraVe moisturizer
ALL_SKIN = ["oily", "combination", "dry", "normal", "sensitive"]


def _p(pid, brand, category, tier="proven", goals=("dark_spots",), skins=ALL_SKIN, lift_lo=0.1):
    return {
        "product_id": pid,
        "product": pid,
        "brand": brand,
        "category": category,
        "tier": tier,
        "eligible": tier == "proven" and bool(goals),
        "reasons": [] if tier == "proven" else ["Promising, not yet Proven."],
        "goals": list(goals),
        "skin_types": list(skins),
        "evidence": f"Measured in 46 Willow users: 78% had a visible change. {pid}",
        "n": 46,
        "lift": lift_lo + 0.1,
        "lift_lo": lift_lo,
        "rate": 0.78,
        "base_rate": 0.53,
    }


def _signals():
    return {
        "version": 1,
        "cohort": "Simulated cohort",
        "products": [
            _p(SERUM, "The Ordinary", "serum", lift_lo=0.2),
            _p(SERUM_2, "Minimalist", "serum", lift_lo=0.1, skins=["oily", "combination"]),
            _p(SERUM_3, "Plum", "serum", tier="promising"),
            _p(CREAM, "CeraVe", "moisturizer", goals=("redness",), lift_lo=0.15),
        ],
        "rising": {},
        "unmet": [],
    }


@pytest.fixture
def sig(monkeypatch: pytest.MonkeyPatch):
    state = _signals()

    def by_id(pid):
        return next((p for p in state["products"] if p["product_id"] == pid), None)

    monkeypatch.setattr(campaigns, "HOLDOUT_PCT", 0.0)
    monkeypatch.setattr(autopilot, "signals", lambda: copy.deepcopy(state))
    monkeypatch.setattr(campaigns, "eligibility_of", lambda pid: copy.deepcopy(by_id(pid)))
    monkeypatch.setattr(campaigns, "eligibility_all", lambda: copy.deepcopy(state["products"]))
    state["by_id"] = by_id
    return state


def _rule(client, **over):
    body = {
        "name": "Dark-spot serums",
        "workspace": "retailer",
        "level": "suggest",
        "scope": {"category": "serum"},
        "trigger": {"kind": "proven", "goals": ["dark_spots"]},
        "action": {"days": 14, "holdout_pct": 0.2, "max_running": 2},
    }
    for k, v in over.items():
        body[k] = v
    res = client.post("/v1/retailer/autopilot/rules", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def _run(client):
    res = client.post("/v1/retailer/autopilot/run")
    assert res.status_code == 200, res.text
    return res.json()


def _kinds(out):
    return [a["kind"] for a in out["activity"]]


def test_the_template_rule_reads_back_as_a_sentence(client, fake, sig):
    r = _rule(client, workspace="The Ordinary")
    assert r["sentence"] == (
        "When any of my serums becomes Proven for dark spots, promote it to the skin types it "
        "works for, for 14 days, with a 20% holdout, max 2 at a time. Suggest it and ask me first."
    )


def test_suggest_proposes_and_approval_starts_the_campaign(client, fake, sig):
    rule = _rule(client)
    out = _run(client)
    assert out["result"]["proposed"] == 2  # both Proven serums; the Promising one is not
    assert not fake.store.campaigns
    props = [a for a in out["activity"] if a["kind"] == "proposed"]
    assert {a["product_id"] for a in props} == {SERUM, SERUM_2}
    first = props[-1] if props[-1]["product_id"] == SERUM else props[0]
    assert "lift +30 pts over non-users, at least +20 pts, n=46" in first["text"]
    res = client.post(f"/v1/retailer/autopilot/activity/{first['id']}/approve")
    assert res.status_code == 200, res.text
    cid = res.json()["campaign_id"]
    camp = next(
        c for c in client.get("/v1/retailer/campaigns").json()["campaigns"] if c["id"] == cid
    )
    assert camp["rule"] == {"id": rule["id"], "name": "Dark-spot serums"}
    assert camp["holdout_pct"] == 0.2 and camp["days"] == 14 and camp["skin_types"] == []
    again = client.post(f"/v1/retailer/autopilot/activity/{first['id']}/approve")
    assert again.status_code == 409


def test_a_second_check_the_same_day_adds_nothing(client, fake, sig):
    _rule(client)
    _run(client)
    out = _run(client)
    assert out["result"]["proposed"] == 0 and _kinds(out).count("proposed") == 2


def test_auto_starts_and_undo_deletes_an_unseen_campaign(client, fake, sig):
    _rule(client, level="auto")
    out = _run(client)
    assert out["result"]["started"] == 2 and len(fake.store.campaigns) == 2
    started = next(a for a in out["activity"] if a["kind"] == "started")
    assert started["can_undo"] and started["campaign_id"] in fake.store.campaigns
    res = client.post(f"/v1/retailer/autopilot/activity/{started['id']}/undo")
    assert res.status_code == 200 and res.json()["outcome"] == "deleted"
    assert started["campaign_id"] not in fake.store.campaigns
    assert "undone" in _kinds(res.json())


def test_caps_hold_the_rest_back_strongest_lift_first(client, fake, sig):
    _rule(client, level="auto", action={"days": 7, "holdout_pct": 0.1, "max_running": 1})
    out = _run(client)
    assert out["result"]["started"] == 1 and out["result"]["held"] == 1
    (only,) = fake.store.campaigns.values()
    assert only["product_id"] == SERUM  # lift_lo 0.2 beats 0.1
    held = next(a for a in out["activity"] if a["kind"] == "held")
    assert "its limit of 1 at a time" in held["text"]


def test_the_owner_cap_of_three_applies_across_rules(client, fake, sig):
    _rule(client, level="auto", action={"max_running": 3})
    _rule(
        client,
        name="Redness",
        level="auto",
        scope={},
        trigger={"kind": "proven", "goals": []},
        action={"max_running": 3},
    )
    _run(client)
    running = [d for d in fake.store.campaigns.values() if campaigns.status_of(d) == "active"]
    assert len(running) == 3  # two serums and the moisturizer, never a fourth


def test_a_brand_rule_only_touches_its_own_products(client, fake, sig):
    _rule(client, workspace="Minimalist", level="auto")
    _run(client)
    assert [d["product_id"] for d in fake.store.campaigns.values()] == [SERUM_2]


def test_slipping_below_proven_pauses_even_on_suggest_and_comes_back_on_autopilot(
    client, fake, sig
):
    rule = _rule(client, level="auto")
    _run(client)
    sig["by_id"](SERUM).update(tier="promising", eligible=False)
    out = _run(client)
    paused = [d for d in fake.store.campaigns.values() if d["product_id"] == SERUM]
    assert paused[0]["status"] == "paused" and paused[0]["paused_by_agent"]
    assert (
        "no longer rated Proven"
        in next(a for a in out["activity"] if a["kind"] == "paused")["text"]
    )
    sig["by_id"](SERUM).update(tier="proven", eligible=True)
    out = _run(client)  # level auto: resuming is proposed
    prop = next(
        a
        for a in out["activity"]
        if a["kind"] == "proposed" and a["proposal"]["action"] == "resume"
    )
    assert (
        client.put(
            f"/v1/retailer/autopilot/rules/{rule['id']}",
            json={
                **{
                    k: rule[k]
                    for k in ("name", "workspace", "scope", "trigger", "conditions", "action")
                },
                "level": "autopilot",
            },
        ).status_code
        == 200
    )
    client.post(f"/v1/retailer/autopilot/activity/{prop['id']}/dismiss")
    out = _run(client)
    assert out["result"]["resumed"] == 1
    assert (
        next(d for d in fake.store.campaigns.values() if d["product_id"] == SERUM)["status"]
        == "active"
    )


def test_new_segment_waits_one_check_then_targets_only_the_new_skin_type(client, fake, sig):
    _rule(client, level="auto", trigger={"kind": "new_segment", "goals": []})
    assert _run(client)["result"]["started"] == 0  # first sight is remembered
    sig["by_id"](SERUM_2)["skin_types"] = ["oily", "combination", "dry"]
    out = _run(client)
    assert out["result"]["started"] == 1
    (c,) = fake.store.campaigns.values()
    assert c["product_id"] == SERUM_2 and c["skin_types"] == ["dry"]


def test_rising_demand_and_unmet_need_explain_with_their_numbers(client, fake, sig):
    sig["rising"] = {"dark_spots": {"from": 22, "to": 37, "n": 900}}
    sig["unmet"] = [{"skin": "oily", "goal": "redness", "unmet": 0.62, "users": 40}]
    _rule(client, trigger={"kind": "rising_demand", "goals": []})
    _rule(
        client,
        name="Unmet",
        scope={},
        level="auto",
        trigger={"kind": "unmet_need", "goals": ["redness"], "unmet_min": 0.5},
    )
    out = _run(client)
    texts = [a["text"] for a in out["activity"]]
    assert any(
        "Dark spots demand is rising: 37% of people in the latest month, up from 22%" in t
        for t in texts
    )
    cream = next(d for d in fake.store.campaigns.values() if d["product_id"] == CREAM)
    assert cream["skin_types"] == ["oily"] and cream["goals"] == ["redness"]
    assert any("62% of people with oily skin who want redness" in t for t in texts)


def _members(store, cid, exposed_added, holdout_added, n=10):
    for i in range(n):
        store.campaign_member_join(cid, f"e{i}", {"group": "exposed", "added": i < exposed_added})
        store.campaign_member_join(cid, f"h{i}", {"group": "holdout", "added": i < holdout_added})


def test_autopilot_ends_a_campaign_with_no_lift_and_never_restarts_it(client, fake, sig):
    _rule(client, level="autopilot", action={"max_running": 1})
    _run(client)
    (cid,) = fake.store.campaigns
    _members(fake.store, cid, exposed_added=0, holdout_added=5)
    out = _run(client)
    assert out["result"]["ended"] == 1 and fake.store.campaigns[cid]["ended_reason"] == "no_lift"
    assert "no higher than the randomised holdout" in out["activity"][0]["text"] or any(
        a["kind"] == "ended" for a in out["activity"]
    )
    started = [d for d in fake.store.campaigns.values() if d["product_id"] == SERUM]
    assert len(started) == 1  # not started again for the same product


def test_autopilot_extends_a_campaign_that_works_near_its_end(client, fake, sig):
    _rule(client, level="autopilot", action={"days": 7, "holdout_pct": 0.1, "max_running": 1})
    _run(client)
    (cid,) = fake.store.campaigns
    doc = fake.store.campaigns[cid]
    doc["ends_at"] = campaigns.now() + timedelta(days=1)
    _members(fake.store, cid, exposed_added=9, holdout_added=1)
    out = _run(client)
    assert out["result"]["extended"] == 1
    assert fake.store.campaigns[cid]["days"] == 14
    assert fake.store.campaigns[cid]["ends_at"] > campaigns.now() + timedelta(days=7)


def test_autopilot_narrows_an_audience_the_evidence_no_longer_covers(client, fake, sig):
    sig["unmet"] = [
        {"skin": "oily", "goal": "dark_spots", "unmet": 0.7, "users": 40},
        {"skin": "dry", "goal": "dark_spots", "unmet": 0.6, "users": 40},
    ]
    _rule(client, level="autopilot", trigger={"kind": "unmet_need", "goals": ["dark_spots"]})
    _run(client)
    c = next(d for d in fake.store.campaigns.values() if d["product_id"] == SERUM)
    assert c["skin_types"] == ["oily", "dry"]
    sig["by_id"](SERUM)["skin_types"] = ["oily", "combination", "normal", "sensitive"]
    out = _run(client)
    assert out["result"]["narrowed"] == 1
    assert next(d for d in fake.store.campaigns.values() if d["product_id"] == SERUM)[
        "skin_types"
    ] == ["oily"]


def test_typing_the_template_fills_the_form(client, fake, sig):
    res = client.post(
        "/v1/retailer/autopilot/parse",
        json={
            "text": "When any of my serums becomes Proven for dark spots, promote it to the skin "
            "types it works for, for 14 days, with a 20% holdout, max 2 at a time.",
            "workspace": "The Ordinary",
        },
    )
    assert res.status_code == 200
    r = res.json()["rule"]
    assert r["trigger"] == {"kind": "proven", "goals": ["dark_spots"], "unmet_min": 0.5}
    assert r["scope"]["category"] == "serum" and r["level"] == "suggest"
    assert r["action"] == {"days": 14, "holdout_pct": 0.2, "max_running": 2}
    assert res.json()["missed"] == []
    auto = client.post(
        "/v1/retailer/autopilot/parse",
        json={
            "text": "When redness demand is rising, start it automatically for two weeks",
            "workspace": "retailer",
        },
    ).json()["rule"]
    assert auto["trigger"]["kind"] == "rising_demand" and auto["level"] == "auto"
    assert auto["action"]["days"] == 14 and auto["trigger"]["goals"] == ["redness"]


def test_rules_are_private_and_deleting_one_closes_its_proposals(client, fake, sig):
    from fastapi.testclient import TestClient

    from app.main import app

    rule = _rule(client)
    out = _run(client)
    other = TestClient(app, headers={"X-Dev-Uid": "someone_else"})
    assert other.get("/v1/retailer/autopilot").json() == {"rules": [], "activity": []}
    assert (
        other.patch(
            f"/v1/retailer/autopilot/rules/{rule['id']}", json={"enabled": False}
        ).status_code
        == 404
    )
    prop = next(a for a in out["activity"] if a["kind"] == "proposed")
    assert other.post(f"/v1/retailer/autopilot/activity/{prop['id']}/approve").status_code == 404
    assert client.delete(f"/v1/retailer/autopilot/rules/{rule['id']}").status_code == 204
    left = client.get("/v1/retailer/autopilot").json()["activity"]
    assert all(a["status"] != "open" for a in left)


def test_a_switched_off_rule_does_nothing(client, fake, sig):
    rule = _rule(client, level="auto")
    client.patch(f"/v1/retailer/autopilot/rules/{rule['id']}", json={"enabled": False})
    assert _run(client)["result"]["started"] == 0 and not fake.store.campaigns


def test_the_scheduler_run_covers_every_owner(client, fake, sig):
    _rule(client, level="auto")
    res = client.post("/v1/internal/autopilot")  # AUTH_MODE=dev in tests: no token needed
    assert res.status_code == 200 and res.json()["owners"] == 1 and res.json()["started"] == 2


def test_evidence_unavailable_answers_503_and_changes_nothing(client, fake, sig, monkeypatch):
    _rule(client, level="auto")

    def down():
        raise campaigns.Unavailable("bq down")

    monkeypatch.setattr(autopilot, "signals", down)
    assert client.post("/v1/retailer/autopilot/run").status_code == 503
    assert not fake.store.campaigns


# The web's four templates (web/src/features/retail/autopilot.ts TEMPLATES), word for word.
TEMPLATE_TEXTS = [
    (
        "When any of my serums becomes Proven for dark spots, promote it to the skin types it "
        "works for, for 14 days, with a 20% holdout, max 2 at a time.",
        ("proven", "suggest", 14, 2, ["dark_spots"]),
    ),
    (
        "When any of my products gains a new skin type with a positive lift, suggest a 7-day "
        "campaign for that group, with a 20% holdout, max 1 at a time.",
        ("new_segment", "suggest", 7, 1, []),
    ),
    (
        "When demand for redness is rising and one of my products is Proven for it, start it "
        "automatically for 14 days, with a 20% holdout, max 2 at a time.",
        ("rising_demand", "auto", 14, 2, ["redness"]),
    ),
    (
        "When 50% or more of a skin type see no change yet for blemishes and one of my products "
        "works for them, run it on autopilot for 30 days, with a 20% holdout, max 1 at a time.",
        ("unmet_need", "autopilot", 30, 1, ["blemishes"]),
    ),
]


@pytest.mark.parametrize(("text", "want"), TEMPLATE_TEXTS)
def test_every_web_template_is_read_back_as_written(text, want):
    out = autopilot.parse(text, "The Ordinary")
    r = out["rule"]
    got = (r["level"], r["action"]["days"], r["action"]["max_running"], r["trigger"]["goals"])
    assert (r["trigger"]["kind"], *got) == want
    assert r["action"]["holdout_pct"] == 0.2 and out["missed"] == []
