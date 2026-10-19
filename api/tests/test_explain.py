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
    # the fixture's redness went up: said gently, never "worse"
    assert exp["headline"] == "1 moved the other way since your baseline"
    assert exp["items"][0]["metric_id"] == "redness"
    allowed = set()
    for m in result["metrics"]:
        # the template quotes numbers as the app shows them (rounded to the band's precision)
        shown = explain.shown_numbers(m)
        for v in (shown["delta"], shown["mdc95"]):
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
    # no number for a metric that did not change: people read words, not figures
    assert explain.item(m)["summary"] == "Shine: about the same as at your start (indicative)."


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
                "summary": f"Redness changed by {round(red['delta'], 1):g}: calmer skin.",
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
    assert "needs more photos" in explain.item(m)["summary"]
    exp = explain.template({"metrics": [m], "quality": {"passed": True}})
    assert exp["headline"] == "Compared with your baseline (it needs more photos to judge changes)"


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
    ok = _exp("Redness went down by -0.8: about the same as at your start.")
    assert [i for i in explain.problems(ok, data) if "sign" in i or "direction" in i] == []
    named = _exp("Redness: no clear change yet while using Minimalist Retinol.")
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


def test_a_later_session_never_calls_an_uncompared_metric_a_first_reading():
    lines = {
        "id": "lines",
        "label": "Lines",
        "verdict": "no_baseline",
        "delta": None,
        "mdc95": 0.9,
        "value": 2.1,
        "unit": "index",
        "confidence": "indicative",
    }
    assert "first reading" in explain.item(lines, first_reading=True)["summary"]
    later = explain.item(lines, first_reading=False)["summary"]
    assert "not compared with your baseline this time" in later and "first" not in later


def test_no_band_change_is_quoted_as_the_app_shows_it():
    m = {
        "id": "tone_ita",
        "label": "Skin tone",
        "unit": "deg",
        "verdict": "no_baseline",
        "delta": 0.804,
        "mdc95": None,
        "display_mdc95": 0.9,
        "confidence": "indicative",
        "value": 27.21,
    }
    out = explain.item(m, first_reading=False)
    assert "a shift from your start" in out["summary"] and out["quoted_numbers"] == []
    assert not explain.NUMBER.search(out["summary"])


def test_jargon_falls_back_to_plain_words(monkeypatch):
    result = _result_with_change()
    jargon = {
        "headline": "One change",
        "items": [
            {
                "metric_id": "redness",
                "summary": "A delta beyond the noise band.",
                "quoted_numbers": [],
            }
        ],
        "next_steps": [],
        "disclaimer": "x",
    }
    _fake_gemini(monkeypatch, [jargon, jargon])
    exp, source = explain.generate(result, {"days_since_baseline": 21})
    assert source == "template"
    assert not any(explain.JARGON.search(i["summary"]) for i in exp["items"])


def test_items_say_at_most_one_number_and_only_for_a_real_change():
    data = _data(-0.8)
    wordy = _exp("Redness is 13.4 now, down by 0.8 against the usual 2.5 variation.")
    assert any("too many numbers" in i for i in explain.problems(wordy, data))
    plain = _exp("Redness: about the same as at your start.")
    assert not any("numbers" in i for i in explain.problems(plain, data))


def test_saved_explanations_with_jargon_or_many_numbers_are_flagged_for_a_rewrite():
    old = {
        "headline": "Clear trends",
        "items": [
            {"summary": "Blemish count changed, with a delta of -7 against a noise band of 2."}
        ],
    }
    assert not explain.plain_enough(old)
    new = {
        "headline": "Fewer blemishes",
        "items": [{"summary": "7 fewer blemishes than at your start."}],
    }
    assert explain.plain_enough(new) and explain.plain_enough(None)


def _m(mid, delta, verdict="real_change"):
    return {
        "id": mid,
        "label": mid,
        "verdict": verdict,
        "delta": delta,
        "mdc95": 0.5,
        "value": 1.0,
        "confidence": "indicative",
        "unit": "%",
    }


def test_a_change_is_said_by_its_direction():
    assert explain.change_headline([_m("redness", -1.0), _m("pores", -2.0)]) == (
        "2 improved since your baseline"
    )
    assert explain.change_headline([_m("redness", -1.0), _m("glow", -0.2)]) == (
        "1 improved, 1 moved the other way since your baseline"
    )
    assert explain.change_headline([_m("tone_ita", 3.0)]) == "1 shifted since your baseline"
    assert explain.since_start(_m("redness", 1.0), 1.0) == "moved the other way since your start"
    assert (
        explain.since_start(_m("dark_circles", 1.0), 1.0)
        == "a brighter under-eye than at your start"
    )


def test_harsh_words_and_false_improvements_are_rejected():
    data = {"metrics": [_m("redness", 1.0) | {"way": "other_way"}], "frames_used": 3}
    harsh = explain._Explanation(
        headline="Redness moved the other way",
        items=[{"metric_id": "redness", "summary": "Your redness got worse since your start."}],
        next_steps=[],
        disclaimer=explain.DISCLAIMER,
    )
    assert any("harsh" in p for p in explain.problems(harsh, data))
    flipped = harsh.model_copy(
        update={"items": [explain._Item(metric_id="redness", summary="Your redness improved.")]}
    )
    assert any("improvement claimed" in p for p in explain.problems(flipped, data))


def test_the_deadline_caps_each_call_and_skips_a_late_second_try(monkeypatch):
    import time

    result = _result_with_change()
    invented = {"headline": "Redness down 40%", "items": [], "next_steps": [], "disclaimer": "x"}
    timeouts = []

    def fake(prompt_id, contents, schema, **kw):
        timeouts.append(kw["timeout_ms"])
        return schema.model_validate(invented)

    monkeypatch.setattr(explain.gemini, "generate_json", fake)
    # 8 s left: one try (capped at 8 s), no second (needs SECOND_TRY_MIN_S), then the template
    exp, source = explain.generate(result, {}, deadline=time.monotonic() + 8)
    assert source == "template" and exp == explain.template(result)
    assert len(timeouts) == 1 and timeouts[0] <= 8000
    # plenty of time: the second try is made
    timeouts.clear()
    explain.generate(result, {}, deadline=time.monotonic() + 60)
    assert len(timeouts) == 2
    # no time at all: no call
    timeouts.clear()
    assert explain.generate(result, {}, deadline=time.monotonic())[1] == "template"
    assert timeouts == []
