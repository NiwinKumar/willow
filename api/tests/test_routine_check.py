from app import gemini, numbers, routine_check


def e(id_, name, actives=(), inci=(), slots=("pm",), category="serum"):
    return {
        "id": id_,
        "brand": "B",
        "custom_name": name,
        "category": category,
        "key_actives": [{"name": a, "pct": None} for a in actives],
        "inci": list(inci),
        "slots": list(slots),
        "ended_at": None,
    }


def test_retinoid_and_acid_in_the_same_evening_is_a_caution():
    r = routine_check.rule_findings(
        [
            e("r1", "Retinol 0.3%", ["retinol"]),
            e("r2", "2% BHA", ["salicylic acid"], category="exfoliant"),
        ]
    )
    assert len(r["conflicts"]) == 1
    c = r["conflicts"][0]
    assert (
        c["severity"] == "caution" and c["source"] == "rule" and set(c["products"]) == {"r1", "r2"}
    )
    assert r["gaps"][0]["need"] == "Daily sunscreen in the morning"


def test_different_slots_do_not_clash_and_am_spf_closes_the_gap():
    r = routine_check.rule_findings(
        [
            e("r1", "Retinol", ["retinol"], slots=["pm"]),
            e("r2", "Glycolic toner", ["glycolic acid"], slots=["am"]),
            e("r3", "Sunscreen SPF 50", category="sunscreen", slots=["am"]),
        ]
    )
    assert r["conflicts"] == [] and r["gaps"] == []


def test_benzoyl_peroxide_pairs_and_duplicates():
    r = routine_check.rule_findings(
        [
            e("a", "Acne wash", ["benzoyl peroxide"], slots=["am", "pm"]),
            e("b", "Retinal", ["retinal"], slots=["pm"]),
            e("c", "C15", ["ascorbic acid"], slots=["am"]),
            e("d", "Niacinamide 10%", ["niacinamide"], slots=["am"]),
            e("f", "Niacinamide 15", ["niacinamide"], slots=["pm"]),
        ]
    )
    issues = {frozenset(c["products"]) for c in r["conflicts"]}
    assert frozenset({"a", "b"}) in issues and frozenset({"a", "c"}) in issues
    assert [d["active"] for d in r["duplicates"]] == ["niacinamide"]
    # The common myth is never flagged; a note says so.
    assert not any({"c", "d"} <= set(c["products"]) for c in r["conflicts"])
    assert any("Niacinamide and vitamin C" in n for n in r["notes"])


def test_ascorbic_derivatives_are_not_l_ascorbic_acid():
    assert "laa" not in routine_check.classes_of(e("x", "Vit C", ["3-o-ethyl ascorbic acid"]))
    assert "laa" not in routine_check.classes_of(e("x", "Vit C", ["ascorbyl glucoside"]))
    assert "laa" in routine_check.classes_of(e("x", "C15", ["l-ascorbic acid"]))


def test_two_exfoliants_and_ended_products():
    entries = [
        e("a", "Glycolic", ["glycolic acid"], slots=["am"]),
        e("b", "BHA", ["salicylic acid"], slots=["pm"]),
    ]
    r = routine_check.rule_findings(entries)
    assert any(set(c["products"]) == {"a", "b"} for c in r["conflicts"])
    entries[1]["ended_at"] = "2026-10-01"
    assert routine_check.rule_findings(entries)["conflicts"] == []


def test_model_additions_are_validated(monkeypatch):
    def fake(prompt_id, contents, schema, **kw):
        return schema(
            conflicts=[
                {
                    "products": ["a", "b"],
                    "issue": "Both strong.",
                    "severity": "info",
                    "suggestion": "Space them.",
                },
                {
                    "products": ["a", "zz"],
                    "issue": "Unknown product.",
                    "severity": "info",
                    "suggestion": "x",
                },
                {
                    "products": ["b", "c"],
                    "issue": "Niacinamide reduces vitamin C.",
                    "severity": "caution",
                    "suggestion": "Separate.",
                },
                {
                    "products": ["a", "c"],
                    "issue": "Use 37% less.",
                    "severity": "info",
                    "suggestion": "x",
                },
            ],
            notes=["Patch test new products."],
        )

    monkeypatch.setattr(gemini, "generate_json", fake)
    entries = [
        e("a", "Azelaic 10%", ["azelaic acid"], slots=["am"]),
        e("b", "Niacinamide 10%", ["niacinamide"], slots=["am"]),
        e("c", "C15", ["ascorbic acid"], slots=["am"]),
    ]
    r = routine_check.check(entries)
    model = [c for c in r["conflicts"] if c["source"] == "model"]
    assert [c["products"] for c in model] == [["a", "b"]]
    assert "Patch test new products." in r["notes"]


def test_gemini_failure_keeps_the_rules(monkeypatch):
    def boom(*a, **k):
        raise gemini.GeminiError("down")

    monkeypatch.setattr(gemini, "generate_json", boom)
    r = routine_check.check([e("r1", "Retinol", ["retinol"]), e("r2", "BHA", ["salicylic acid"])])
    assert len(r["conflicts"]) == 1


def test_number_validator():
    allowed = numbers.collect({"delta": -0.8, "mdc95": 0.86, "days": 21})
    assert numbers.only_known("Redness moved -0.8 against a band of 0.86 over 21 days", allowed)
    assert not numbers.only_known("Redness improved 12%", allowed)
    assert numbers.only_known("SPF 50", numbers.in_text("Sunscreen SPF 50"))


def test_gemini_sentences_name_products_never_ids(monkeypatch):
    def fake(prompt_id, contents, schema, **kw):
        return schema(
            notes=[
                "Applying sunscreen like r_57cc2366 is meant for daytime.",
                "Ask about r_unknown before use.",
            ]
        )

    monkeypatch.setattr(gemini, "generate_json", fake)
    entries = [
        e("r_57cc2366", "Sun Gel SPF 50", category="sunscreen"),
        e("r_2", "Retinol 0.3%", ["retinol"]),
    ]
    notes = routine_check.check(entries)["notes"]
    assert "Applying sunscreen like B Sun Gel SPF 50 is meant for daytime." in notes
    assert not any("r_" in n for n in notes)


def test_every_clashing_pair_is_reported_not_only_the_first():
    from app.routine_check import rule_findings

    entries = [
        {
            "id": "r1",
            "brand": "A",
            "custom_name": "Retinol",
            "slots": ["pm"],
            "key_actives": [{"name": "retinol"}],
            "inci": ["retinol"],
        },
        {
            "id": "r2",
            "brand": "B",
            "custom_name": "Adapalene",
            "slots": ["pm"],
            "key_actives": [{"name": "adapalene"}],
            "inci": ["adapalene"],
        },
        {
            "id": "b1",
            "brand": "C",
            "custom_name": "BHA",
            "slots": ["pm"],
            "key_actives": [{"name": "salicylic acid"}],
            "inci": ["salicylic acid"],
        },
    ]
    pairs = [
        set(c["products"]) for c in rule_findings(entries)["conflicts"] if "retinoid" in c["issue"]
    ]
    assert {"r1", "b1"} in pairs and {"r2", "b1"} in pairs


def _uses(fake, uid="u_test"):
    from datetime import UTC, datetime

    return fake.store.usage.get((uid, datetime.now(UTC).date().isoformat(), "routine_check"), 0)


def test_a_routine_of_one_product_uses_no_daily_check(client, fake):
    doc = {k: v for k, v in e("r1", "Retinol", ["retinol"]).items() if k != "id"}
    fake.store.routine_set("u_test", "r1", doc)
    assert client.post("/v1/routine/check").status_code == 200
    assert _uses(fake) == 0


def test_a_gemini_failure_gives_the_use_back(client, fake):
    client.post("/v1/demo/judge-setup")  # four products; Gemini is offline in tests
    out = client.post("/v1/routine/check").json()
    assert any(c["source"] == "rule" for c in out["conflicts"])
    assert _uses(fake) == 0


def test_the_same_routine_answers_from_the_kept_check_without_a_use(client, fake, monkeypatch):
    calls = []

    def fake_gemini(prompt_id, contents, schema, **kw):
        calls.append(1)
        return routine_check.ModelAdditions(notes=["Patch test new products first."])

    monkeypatch.setattr(gemini, "generate_json", fake_gemini)
    client.post("/v1/demo/judge-setup")
    first = client.post("/v1/routine/check").json()
    second = client.post("/v1/routine/check").json()
    assert first == second and "Patch test new products first." in second["notes"]
    assert len(calls) == 1 and _uses(fake) == 1
    # a changed routine is a new check
    fake.store.routine_delete("u_test", "r_judge4")
    client.post("/v1/routine/check")
    assert len(calls) == 2 and _uses(fake) == 2


def test_the_demo_routine_check_runs_gemini_once_for_judges_arriving_together(
    client, fake, monkeypatch
):
    import threading
    import time

    from app import demo
    from app.settings import get_settings

    demo.clear_cache()
    demo_uid = get_settings().demo_user_id
    client.post("/v1/demo/judge-setup", headers={"X-Dev-Uid": demo_uid})
    gate, calls = threading.Event(), []

    def slow(prompt_id, contents, schema, **kw):
        calls.append(1)
        gate.wait(5)
        return routine_check.ModelAdditions()

    monkeypatch.setattr(gemini, "generate_json", slow)
    results = []
    judges = [
        threading.Thread(target=lambda: results.append(client.get("/v1/demo/routine/check")))
        for _ in range(3)
    ]
    for t in judges:
        t.start()
    while not calls:  # the first judge is waiting on Gemini...
        time.sleep(0.01)
    time.sleep(0.2)  # ...and the others have arrived meanwhile
    gate.set()
    for t in judges:
        t.join(5)
    assert len(calls) == 1 and [r.status_code for r in results] == [200, 200, 200]
    demo.clear_cache()


def test_the_demo_routine_check_keeps_a_rules_only_answer_one_minute(client, fake, monkeypatch):
    from app import demo
    from app.routes import demo_routes
    from app.settings import get_settings

    demo.clear_cache()
    client.post("/v1/demo/judge-setup", headers={"X-Dev-Uid": get_settings().demo_user_id})
    client.get("/v1/demo/routine/check")  # Gemini offline: the rules alone
    key = f"routine-check:{get_settings().demo_user_id}"
    assert demo._ttl[key] == demo_routes.ROUTINE_CHECK_RETRY_S
    monkeypatch.setattr(gemini, "generate_json", lambda *a, **k: routine_check.ModelAdditions())
    demo._cache[key] = (demo._cache[key][0] - 61, demo._cache[key][1])  # a minute later
    client.get("/v1/demo/routine/check")
    assert demo._ttl[key] == demo_routes.ROUTINE_CHECK_KEEP_S
    demo.clear_cache()
