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
    assert failed["headline"] == "These photos could not be compared"


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
        "Shine: within normal photo variation (trend only) (change +0.4, noise threshold 1.9)."
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
