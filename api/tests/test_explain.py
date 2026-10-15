import re

from app import engine, explain


def _numbers(text):
    return re.findall(r"[-+]?\d+(?:\.\d+)?", text)


def test_template_only_quotes_numbers_from_the_metrics():
    baseline = {"redness": {"mean": 10.0, "mdc95": 0.86}, "tone_ita": {"mean": 28.4, "mdc95": 2.0}}
    result = engine.fixture_result(
        {
            "schema_version": "1.0",
            "session_id": "s_1",
            "user_id": "u",
            "site": "forearm_treated",
            "capture_mode": "calibrated_raw",
            "frames": [{"uri": "gs://b/x"}] * 5,
            "baseline": baseline,
        }
    )
    exp = explain.template(result)
    assert exp["headline"] == "1 real change since your baseline"
    assert exp["items"][0]["metric_id"] == "redness"
    allowed = set()
    for m in result["metrics"]:
        for v in (m["delta"], m["mdc95"]):
            if v is not None:
                allowed |= {f"{v:g}", f"{abs(v):g}"}
    for it in exp["items"]:
        for n in _numbers(it["summary"]):
            assert n.lstrip("+-") in allowed, n
    assert exp["disclaimer"] == explain.DISCLAIMER


def test_first_reading_and_quality_failure_headlines():
    metric = {
        "id": "redness",
        "label": "Redness",
        "verdict": "no_baseline",
        "confidence": "measured",
    }
    first = explain.template({"metrics": [metric], "quality": {"passed": True}})
    assert first["headline"] == "Your first reading"
    failed = explain.template({"metrics": [metric], "quality": {"passed": False}})
    assert failed["headline"] == "These photos could not be measured"


def test_trend_wording_for_indicative_metrics():
    m = {
        "id": "shine",
        "label": "Shine",
        "verdict": "within_noise",
        "confidence": "indicative",
        "delta": 0.4,
        "mdc95": 1.9,
    }
    assert explain.item(m)["summary"] == (
        "Shine: within normal photo variation (trend only) (change +0.4, noise band ±1.9)."
    )


def _result_with_change():
    return engine.fixture_result(
        {
            "schema_version": "1.0",
            "session_id": "s_2",
            "user_id": "u",
            "site": "forearm_treated",
            "capture_mode": "calibrated_raw",
            "frames": [{"uri": "gs://b/x"}] * 5,
            "baseline": {
                "redness": {"mean": 10.0, "mdc95": 0.86},
                "tone_ita": {"mean": 28.4, "mdc95": 2.0},
            },
        }
    )


def _fake_gemini(monkeypatch, outputs):
    calls = []

    def fake(prompt_id, contents, schema, **kw):
        calls.append(prompt_id)
        return schema.model_validate(outputs[min(len(calls), len(outputs)) - 1])

    monkeypatch.setattr(explain.gemini, "generate_json", fake)
    return calls


def test_gemini_explanation_used_when_it_passes(monkeypatch):
    result = _result_with_change()
    red = next(m for m in result["metrics"] if m["id"] == "redness")
    good = {
        "headline": "Redness moved beyond normal photo variation",
        "items": [
            {
                "metric_id": "redness",
                "summary": f"Redness changed by {round(red['delta'], 1):g}, "
                "beyond the noise threshold of 0.9.",
                "quoted_numbers": [],
            }
        ],
        "next_steps": ["Keep the same lamp and distance."],
        "disclaimer": "anything",
    }
    _fake_gemini(monkeypatch, [good])
    exp, source = explain.generate(result, {"days_since_baseline": 21})
    assert source == "gemini"
    assert exp["disclaimer"] == explain.DISCLAIMER


def test_invented_numbers_or_disease_words_fall_back_to_the_template(monkeypatch):
    result = _result_with_change()
    invented = {
        "headline": "Redness down 40%",
        "items": [],
        "next_steps": [],
        "disclaimer": "x",
    }
    disease = {
        "headline": "Signs of rosacea",
        "items": [],
        "next_steps": [],
        "disclaimer": "x",
    }
    calls = _fake_gemini(monkeypatch, [invented, disease])
    exp, source = explain.generate(result, {})
    assert source == "template" and len(calls) == 2
    assert exp == explain.template(result)


def test_change_language_only_for_real_changes(monkeypatch):
    result = _result_with_change()
    claim = {
        "headline": "One real change",
        "next_steps": [],
        "disclaimer": "x",
        "items": [
            {"metric_id": "tone_ita", "summary": "Skin tone improved.", "quoted_numbers": []}
        ],
    }
    _fake_gemini(monkeypatch, [claim, claim])
    _, source = explain.generate(result, {})
    assert source == "template"


def test_one_photo_baseline_comparison_is_not_called_a_first_reading():
    m = {
        "id": "redness",
        "label": "Redness",
        "verdict": "no_baseline",
        "confidence": "measured",
        "delta": 0.4,
        "mdc95": None,
    }
    assert "no noise band yet" in explain.item(m)["summary"]
    exp = explain.template({"metrics": [m], "quality": {"passed": True}})
    assert exp["headline"] == "Compared with your baseline (no noise band yet)"


def test_hedged_mentions_of_real_change_are_not_claims():
    from app.explain import _claims_change

    assert not _claims_change("This change cannot be called real yet.")
    assert not _claims_change("Without a noise band it cannot be confirmed as a real change.")
    assert not _claims_change("It is not yet a real change.")
    assert _claims_change("Redness shows a real change since your baseline.")
    assert _claims_change("Your tone improved.")


def test_negation_anywhere_earlier_in_the_sentence():
    from app.explain import _claims_change

    assert not _claims_change(
        "The reading shows no measurable difference, though there is no noise band yet to "
        "determine a real change."
    )
    assert not _claims_change("Without a noise band yet to confirm a real change.")
    assert _claims_change("No noise band yet. This is a real change.")


def test_rounding_matches_the_screen():
    from app.explain import _shown, decimals, shown_numbers

    assert _shown(2.5, 0) == 3
    assert _shown(-0.04, 1) == 0
    assert _shown(1.25, 1) == 1.3  # never banker's 1.2
    # web/src/lib/metrics.ts decimalsFor: counts whole, then by noise band (none counts as 1)
    assert decimals({"unit": "count", "mdc95": 0.1}) == 0
    assert decimals({"unit": "index", "mdc95": None}) == 1
    assert decimals({"unit": "deg", "mdc95": 6.2}) == 0
    assert decimals({"unit": "index", "mdc95": 0.3}) == 2
    assert shown_numbers({"unit": "index", "value": 0.4237, "delta": None, "mdc95": None}) == {
        "value": 0.4,
        "delta": None,
        "mdc95": None,
    }


def test_failed_session_gets_the_template_with_site_advice(monkeypatch):
    from app import explain, gemini

    def never(*a, **k):
        raise AssertionError("Gemini must not be asked about a session that measured nothing")

    monkeypatch.setattr(gemini, "generate_json", never)
    result = {
        "site": "face_full",
        "quality": {"passed": False, "reasons": ["face_not_found"]},
        "metrics": [
            {
                "id": "redness",
                "label": "Redness",
                "verdict": "low_quality",
                "confidence": "indicative",
                "value": None,
                "delta": None,
                "mdc95": None,
                "unit": "a_star",
                "direction": "none",
            }
        ],
        "warnings": [],
    }
    exp, source = explain.generate(result, {"is_baseline": True})
    assert source == "template"
    assert "hands away" in exp["next_steps"][0] and "card" not in exp["next_steps"][0]


def _data(delta, verdict="within_noise", days=None, routine=()):
    return {
        "frames_used": 3,
        "days_since_baseline": days,
        "routine": list(routine),
        "metrics": [
            {
                "id": "redness",
                "label": "Redness",
                "verdict": verdict,
                "direction": "decrease" if delta < 0 else "increase",
                "confidence": "indicative",
                "unit": "a*",
                "value": 13.4,
                "delta": delta,
                "mdc95": 2.5,
            }
        ],
    }


def _exp(summary):
    return explain._Explanation(
        headline="Your redness reading.",
        items=[explain._Item(metric_id="redness", summary=summary)],
        next_steps=[],
        disclaimer="x",
    )


def test_a_change_quoted_with_the_wrong_sign_or_direction_is_rejected():
    data = _data(-0.8, days=None, routine=[{"product": "x", "started_at": "2026-10-01"}])
    bad = _exp("Redness increased by +0.8 a*, about 1 point higher after 10 days.")
    issues = explain.problems(bad, data)
    assert any("sign" in i or "direction" in i for i in issues)
    assert any("unknown number" in i for i in issues)  # 10 came only from a date


def test_the_right_sign_and_direction_pass():
    data = _data(-0.8, routine=[{"product": "Minimalist Retinol 0.3%", "started_at": "2026-10-01"}])
    ok = _exp("Redness went down by -0.8 a*, within normal photo variation (2.5).")
    assert explain.problems(ok, data) == []
    named = _exp("Redness is 13.4 a*, no clear change yet while using Minimalist Retinol 0.3%.")
    assert explain.problems(named, data) == []


def test_comparisons_and_ranges_are_not_direction_claims():
    data = _data(0.8)
    for ok in (
        "Redness changed by 0.8 a*, lower than the noise band of 2.5, so no clear change yet.",
        "Redness: no clear change yet (+0.8); lower values mean calmer skin.",
        "Redness rose by +0.8, within normal photo variation. Check again in 1-2 weeks.",
    ):
        assert not [
            i for i in explain.problems(_exp(ok), data) if "sign" in i or "direction" in i
        ], ok
