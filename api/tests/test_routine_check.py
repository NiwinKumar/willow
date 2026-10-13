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
