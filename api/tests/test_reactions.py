"""Reactions (app/reactions.py), store clicks (app/clicks.py) and swaps (plan.swaps)."""

from datetime import UTC, datetime

import pytest

from app import catalog, clicks, reactions

PID = "the-ordinary-niacinamide-10-zinc-1"


def react(client, **body):
    return client.post("/v1/me/reactions", json={"product_id": PID, **body})


@pytest.mark.parametrize(
    ("signs", "strength", "since_days", "level"),
    [
        (["stinging", "hives"], "mild", 0, "urgent"),
        (["eyes_lips"], "mild", 0, "urgent"),
        (["redness"], "strong", 0, "stop"),
        (["itch"], "mild", 3, "stop"),
        (["stinging", "dryness"], "mild", 1, "mild"),
        (["breakouts"], "strong", 0, "mild"),
    ],
)
def test_the_outcome_follows_the_fixed_rule(signs, strength, since_days, level):
    assert reactions.level_of(signs, strength, since_days) == level


def test_a_serious_reaction_gets_fixed_steps_and_puts_the_product_on_the_avoid_list(client, fake):
    client.put("/v1/me/profile", json={"skin_type": "dry", "safety": {"life_stage": "none"}})
    res = react(client, signs=["swelling"], strength="strong", since_days=0)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["outcome"]["title"] == "Stop using it and get medical help now."
    assert body["outcome"]["report"] == reactions.REPORT and body["reaction"]["level"] == "urgent"
    profile = client.get("/v1/me").json()["profile"]
    assert profile["safety"]["avoid_products"] == [PID]
    assert profile["safety"]["life_stage"] == "none" and profile["skin_type"] == "dry"
    check = client.post("/v1/safety/check", json={"product_ids": [PID]}).json()["checks"][PID]
    assert check["status"] == "avoid" and check["flags"][0]["rule"] == "avoid_product"


def test_a_mild_reaction_is_logged_but_does_not_rule_the_product_out(client, fake):
    body = react(client, signs=["dryness"], strength="mild", since_days=1).json()
    assert body["outcome"]["title"].startswith("Mild stinging or dryness can settle.")
    assert client.get("/v1/me").json()["profile"] is None  # nothing added to an avoid list
    listed = client.get("/v1/me/reactions").json()["reactions"]
    assert [r["level"] for r in listed] == ["mild"] and listed[0]["created_at"]


def test_reactions_validate_and_keep_the_last_fifty(client, fake):
    assert react(client, signs=["burning"]).status_code == 422
    assert react(client, signs=[]).status_code == 422
    missing = client.post(
        "/v1/me/reactions", json={"product_id": "no-such-product", "signs": ["itch"]}
    )
    assert missing.status_code == 404
    for _ in range(reactions.KEEP + 2):
        react(client, signs=["dryness"])
    assert len(client.get("/v1/me/reactions").json()["reactions"]) == reactions.KEEP


def test_swaps_share_the_main_active_at_a_similar_strength_cheapest_first(client, fake):
    res = client.get("/v1/catalog/cosrx-the-niacinamide-15-serum/swaps", params={"market": "US"})
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    assert items
    for item in items:
        p = item["product"]
        assert p["category"] == "serum" and "acne" not in p["name"].lower()
        main = next(a for a in p["key_actives"] if a["name"] == "niacinamide")
        assert 7.5 <= main["pct"] <= 22.5  # within ±50% of 15%
        assert item["why"].startswith(f"Same active (niacinamide {main['pct']:g}%)")
    prices = [i["price"]["amount"] for i in items if i["price"]]
    assert prices == sorted(prices)
    assert items[0]["why"].endswith("76% cheaper ($6 against $25)")


def test_swap_prices_are_compared_in_one_currency_only(client, fake):
    # a rupee-priced product in the US: no US-dollar price on its side, so no price words
    items = client.get(
        "/v1/catalog/minimalist-niacinamide-10-face-serum/swaps", params={"market": "US"}
    ).json()["items"]
    assert items and all(i["price"] is None and i["why"].endswith("%)") for i in items)
    assert client.get("/v1/catalog/no-such/swaps").status_code == 404


def test_store_clicks_are_counted_without_a_uid_and_shown_only_in_groups_of_ten(client, fake):
    store = catalog.by_id(PID)["stores"][0]["store"]
    for _ in range(10):
        res = client.post("/v1/clicks", json={"product_id": PID, "store": store, "surface": "plan"})
        assert res.status_code == 204
    other = catalog.by_id("cosrx-the-niacinamide-15-serum")
    client.post(
        "/v1/clicks",
        json={
            "product_id": other["product_id"],
            "store": other["stores"][0]["store"],
            "surface": "wisp",
        },
    )
    assert all("uid" not in d and "u_test" not in str(d) for d in fake.store.clicks)
    bad = client.post("/v1/clicks", json={"product_id": PID, "store": "Nowhere", "surface": "plan"})
    assert bad.status_code == 404
    summary = client.get("/v1/retailer/clicks", params={"days": 7}).json()
    assert summary["items"][0] == {
        "product_id": PID,
        "product": catalog.by_id(PID)["name"],
        "brand": catalog.by_id(PID)["brand"],
        "store": store,
        "clicks": 10,
    }
    assert summary["items"][1]["clicks"] == "<10" and summary["surfaces"]["wisp"] == "<10"


def test_old_clicks_fall_outside_the_window(fake):
    old = datetime(2026, 1, 1, tzinfo=UTC)
    body = clicks.ClickIn(product_id=PID, store="Ulta", surface="sponsored")
    clicks.add(fake.store, body, now=old)
    assert clicks.summary(fake.store, 30)["items"] == []
    assert clicks.summary(fake.store, 30, now=old)["total"] == "<10"
