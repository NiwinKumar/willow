"""Checked for me (app/safety.py, app/regulatory.py), the safety profile, and the guardrails that
use it: Wisp's fixed medicine reply, its catalog search and the banned words."""

from types import SimpleNamespace

import pytest

from app import advisor, catalog, explain, gemini, regulatory, routine_check, safety

PREGNANT = {"life_stage": "pregnant", "adult": True, "reactive": False}


def product(pid="p1", category="serum", actives=(), inci=(), name="Serum"):
    return {
        "product_id": pid,
        "brand": "B",
        "name": name,
        "category": category,
        "concerns": [],
        "key_actives": [{"name": n, "pct": pct} for n, pct in actives],
        "inci": list(inci),
    }


def test_a_retinoid_is_not_advised_while_pregnant_with_its_source():
    serum = product(actives=[("retinol", 0.3)], inci=["Squalane", "Retinol"])
    result = safety.check(serum, PREGNANT)
    assert result["status"] == "avoid"
    [flag] = result["flags"]
    assert flag["rule"] == "retinoid_life_stage" and flag["level"] == "avoid"
    assert flag["source"]["url"].startswith("https://www.aad.org/") and flag["grade"] == "B"
    assert "retinol" in flag["detail"]
    # rules about a person never fire without their profile
    assert safety.check(serum, None)["status"] == "clear"


def test_the_avoid_list_outranks_the_reactive_check_and_names_what_is_listed():
    cream = product(category="moisturizer", inci=["Aqua", "Parfum", "Linalool", "Glycerin"])
    reactive = safety.check(cream, {"reactive": True})
    assert reactive["status"] == "check" and reactive["flags"][0]["level"] == "check"
    both = safety.check(cream, {"reactive": True, "avoid": ["fragrance"]})
    [flag] = both["flags"]  # one flag per group: the stronger one
    assert both["status"] == "avoid" and flag["detail"] == (
        "You said you avoid fragrance. It lists parfum, linalool."
    )


def test_a_strength_floor_never_guesses_a_missing_strength():
    leave_on = product(actives=[("salicylic acid", 2)], inci=["Aqua", "Salicylic Acid"])
    unknown = product(actives=[("salicylic acid", None)], inci=["Aqua", "Salicylic Acid"])
    wash = product(category="cleanser", actives=[("salicylic acid", 2)])
    assert [f["id"] for f in safety.flags(leave_on, PREGNANT)] == ["salicylic_leave_on_pregnant"]
    assert safety.flags(unknown, PREGNANT) == [] and safety.flags(wash, PREGNANT) == []
    # the key active is named once, with its strength
    assert "lists salicylic acid 2% and" in safety.flags(leave_on, PREGNANT)[0]["detail"]


def test_regulatory_class_and_what_willow_may_suggest():
    bpo = product(category="cleanser", actives=[("benzoyl peroxide", 4)], name="Foaming Wash")
    assert regulatory.of(bpo, "US") == {"class": "otc_drug", "market": "US"}
    assert regulatory.of(bpo, "UK")["class"] == "pharmacy"
    assert regulatory.of(bpo, None) == {"class": "pharmacy", "market": None}
    assert safety.check(bpo, {"market": "UK"})["status"] == "not_sold"
    assert not regulatory.is_suggestible(bpo, "US")
    azelaic10 = product(actives=[("azelaic acid", 10)])
    azelaic20 = product(actives=[("azelaic acid", 20)])
    assert regulatory.classify(azelaic10, "UK") == "cosmetic"
    assert regulatory.classify(azelaic20, "UK") == "rx"
    hq = product(inci=["Aqua", "Hydroquinone"])
    assert regulatory.never_suggest(hq) == ["hydroquinone"] and not regulatory.is_suggestible(
        hq, "US"
    )
    assert safety.check(hq, None)["status"] == "avoid"  # for everyone
    sunscreen = product(category="sunscreen", name="Sun Gel SPF 50")
    assert regulatory.classify(sunscreen, "US") == "otc_drug"
    assert regulatory.is_suggestible(sunscreen, "US") and regulatory.is_suggestible(sunscreen, None)
    # a product named for a condition is never suggested, whatever is in it
    assert not regulatory.is_suggestible(product(name="Anti-Acne Serum"), "IN")


def test_every_rule_is_sourced_graded_and_worded_cosmetically():
    rows = safety.rules()
    assert len(rows) >= 40 and len({r.id for r in rows}) == len(rows)
    for r in rows:
        assert r.source.url and r.source.url.startswith("https://"), r.id
        words = f"{r.title} {r.detail}".lower()
        assert " safe" not in words and "acne" not in words, r.id


def test_profile_safety_is_validated_saved_and_checked(client, fake):
    bad = client.put("/v1/me/profile", json={"safety": {"life_stage": "maybe"}})
    assert bad.status_code == 422
    extra = client.put("/v1/me/profile", json={"safety": {"allergies": ["nuts"]}})
    assert extra.status_code == 422
    body = {
        "adult": True,
        "life_stage": "pregnant",
        "reactive": False,
        "avoid": ["fragrance", "fragrance"],
        "market": "US",
    }
    saved = client.put("/v1/me/profile", json={"safety": body}).json()["profile"]["safety"]
    assert saved["avoid"] == ["fragrance"] and saved["avoid_products"] == []
    assert client.get("/v1/me").json()["profile"]["safety"]["life_stage"] == "pregnant"
    res = client.post(
        "/v1/safety/check",
        json={"product_ids": ["minimalist-retinol-0-3-face-serum", "no-such-product"]},
    ).json()
    assert res["profile_complete"] is True and res["unknown"] == ["no-such-product"]
    assert res["checks"]["minimalist-retinol-0-3-face-serum"]["status"] == "avoid"
    # another field's update keeps the safety profile; null clears it
    client.put("/v1/me/profile", json={"skin_type": "dry"})
    assert client.get("/v1/me").json()["profile"]["safety"]["market"] == "US"
    client.put("/v1/me/profile", json={"safety": None})
    assert client.get("/v1/me").json()["profile"]["safety"] is None


def test_catalog_search_carries_a_check_only_with_a_profile(client, fake):
    q = {"q": "retinol", "limit": 3}
    assert all(
        "check" not in p for p in client.get("/v1/catalog/search", params=q).json()["products"]
    )
    client.put("/v1/me/profile", json={"safety": {"life_stage": "trying"}})
    found = client.get("/v1/catalog/search", params=q).json()["products"]
    assert found and all(p["check"]["status"] == "avoid" for p in found)


def test_a_product_on_the_avoid_list_is_not_advised(fake):
    p = catalog.by_id("the-ordinary-niacinamide-10-zinc-1")
    result = safety.check(p, {"avoid_products": [p["product_id"]]})
    assert result["status"] == "avoid" and result["flags"][0]["rule"] == "avoid_product"


def test_banned_words_cover_medical_language_but_keep_the_forearm_test():
    for text in (
        "This may help your acne.",
        "It treats breakouts.",
        "A treatment for redness.",
        "It heals the barrier.",
        "Ask about a prescription.",
        "Clinically shown.",
        "Moderate redness.",
        "An anti-inflammatory serum.",
    ):
        assert explain.BANNED.search(text), text
    for text in (
        "The treated square moved more than the untreated one.",
        "A healthy barrier.",
        "Add a spot treatment at night.",
        "If it is severe, see a doctor.",
        "A mild cleanser.",
    ):
        assert not explain.BANNED.search(text), text


def test_a_medicine_question_gets_the_fixed_reply_without_the_model(client, fake, monkeypatch):
    def no_model():
        raise AssertionError("the model must not be asked")

    monkeypatch.setattr(gemini, "client", no_model)
    res = client.post(
        "/v1/advisor/chat",
        json={"messages": [{"role": "user", "text": "Should I get tretinoin for my spots?"}]},
    )
    assert res.status_code == 200, res.text
    assert res.json()["message"] == advisor.MEDICINE_REPLY and res.json()["products"] == []
    assert not explain.BANNED.search(advisor.MEDICINE_REPLY)


def test_a_diagnosis_question_with_the_model_down_gets_the_scope_reply(client, fake, monkeypatch):
    class Models:
        def generate_content(self, **kw):
            return SimpleNamespace(function_calls=None, candidates=[])

    monkeypatch.setattr(gemini, "client", lambda: SimpleNamespace(models=Models()))
    # generate_json stays offline (conftest): the reply call fails, the fixed reply answers
    res = client.post(
        "/v1/advisor/chat", json={"messages": [{"role": "user", "text": "Is this acne?"}]}
    )
    assert res.json()["message"] == advisor.SCOPE_REPLY


def test_wisp_search_only_offers_products_it_may_suggest(fake):
    fake.store.user_merge("u1", {"profile": {"safety": {"life_stage": "pregnant", "market": "US"}}})
    anyone = advisor.run_tool("search_catalog", {"query": "retinol"}, fake.store, "u0")
    assert any("retinol" in p["name"].lower() for p in anyone["products"])
    found = advisor.run_tool("search_catalog", {"query": "retinol"}, fake.store, "u1")["products"]
    assert all("retinol" not in p["name"].lower() for p in found)
    wash = advisor.run_tool("search_catalog", {"query": "benzoyl peroxide"}, fake.store, "u1")
    assert all(p["product_id"] != "cerave-acne-foaming-cream-cleanser" for p in wash["products"])
    # compare shows what the person asked about, with its check
    asked = advisor.run_tool(
        "compare_products",
        {"product_ids": ["minimalist-retinol-0-3-face-serum"]},
        fake.store,
        "u1",
    )["products"]
    assert asked[0]["check"]["status"] == "avoid"


def test_a_product_name_with_a_condition_word_does_not_sink_the_answer():
    text = "The CeraVe Acne Foaming Cream Cleanser is gentle."
    left = advisor._without_names(text, {"cerave-acne-foaming-cream-cleanser"})
    assert not explain.BANNED.search(left)


def e(id_, actives=(), inci=(), slots=("pm",), category="serum"):
    return {
        "id": id_,
        "brand": "B",
        "custom_name": id_,
        "category": category,
        "key_actives": [{"name": a, "pct": None} for a in actives],
        "inci": list(inci),
        "slots": list(slots),
        "ended_at": None,
    }


def test_routine_check_adds_what_applies_to_the_person():
    entries = [
        e("r1", ["retinol"], slots=["pm"]),
        e("r2", ["glycolic acid"], slots=["am"]),
        e("r3", inci=["Aqua", "Parfum"], category="moisturizer", slots=["am", "pm"]),
    ]
    plain = routine_check.findings_for(entries)
    assert plain["conflicts"] == []  # different slots: the shared table is quiet
    mine = routine_check.findings_for(entries, {"reactive": True, "rx_treatment": True})
    issues = [c["issue"] for c in mine["conflicts"]]
    assert any("retinoid and an exfoliating acid" in i for i in issues)
    assert any(c["products"] == ["r3"] and "fragrance" in c["issue"] for c in mine["conflicts"])
    assert any("skin medicine from a doctor" in i for i in issues)
    # the synthetic cohort's table is unchanged
    assert routine_check.rule_findings(entries)["conflicts"] == []


@pytest.mark.parametrize(
    ("entries", "why"),
    [
        ([e("a", ["benzoyl peroxide"], slots=["am"])], "Benzoyl peroxide"),
        ([e("a", ["niacinamide"], slots=["am"])], "any active"),
        ([e("a", ["azelaic acid"]), e("b", ["azelaic acid"])], "any active"),
    ],
)
def test_sunscreen_gap_with_any_active_and_azelaic_duplicates(entries, why):
    found = routine_check.findings_for(entries)
    assert why in found["gaps"][0]["why"]
    if len(entries) == 2:
        assert found["duplicates"][0]["active"] == "azelaic acid"


def test_a_repeated_check_is_answered_from_the_kept_one_and_follows_the_profile(monkeypatch):
    """Home, the routine and Wisp ask about the same products on every load (Nov 28: 3 s each)."""
    from app import regulatory, safety

    product = {
        "product_id": "kept-1",
        "category": "serum",
        "name": "Serum",
        "inci": ["Aqua", "Parfum"],
        "key_actives": [],
    }
    calls = []
    real = regulatory.classify
    monkeypatch.setattr(regulatory, "classify", lambda p, m: calls.append(m) or real(p, m))
    first = safety.check(product, None)
    asked = len(calls)
    assert asked > 0
    again = safety.check(product, None)
    assert again == first and len(calls) == asked  # no second pass over the rules or markets
    again["flags"].append("mine")  # a caller's change never reaches the kept answer
    assert safety.check(product, None) == first
    # another person: the market classification is shared, their own flags are their own
    avoids = safety.check(product, {"avoid": ["fragrance"], "reactive": False})
    assert len(calls) == asked and avoids["status"] != first["status"]
    # a newer catalog object under the same id is checked again
    newer = {**product, "inci": ["Aqua"]}
    assert safety.check(newer, {"avoid": ["fragrance"], "reactive": False})["status"] == "clear"
