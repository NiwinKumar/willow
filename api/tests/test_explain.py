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
