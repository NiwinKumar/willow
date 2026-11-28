"""Comparison words must agree with the numbers they compare (juror pass, live site)."""

from app import advisor, explain, gemini, numbers

JUROR = "Your dark spots moved by -0.3, within the 0.25 your photos usually vary."
SPOTS = {"id": "pigment_spots", "label": "Dark spots", "delta": -0.3, "mdc95": 0.25}


def test_the_juror_sentence_is_caught_and_its_true_versions_pass():
    assert numbers.false_comparison(JUROR, [SPOTS]) == "within the 0.25"
    assert numbers.false_comparison(JUROR.replace("within", "beyond"), [SPOTS]) is None
    small = {**SPOTS, "delta": -0.2}
    assert numbers.false_comparison(JUROR.replace("0.3", "0.2"), [small]) is None
    assert numbers.false_comparison(
        "Dark spots moved by -0.2, more than your photos usually vary.", [small]
    )


def test_range_words_use_the_quoted_metric_or_the_item_subject():
    said = "Dark spots stayed inside your normal range."
    assert numbers.false_comparison(said, [SPOTS], subject=SPOTS)
    assert numbers.false_comparison(said, [SPOTS]) is None  # no change quoted, no subject
    assert (
        numbers.false_comparison("Dark spots are not within your usual range.", [SPOTS], SPOTS)
        is None
    )


def test_numbers_that_are_not_the_band_are_not_comparisons():
    said = "Dark spots moved by -0.3 in less than 2 weeks, more than 0.25."
    assert numbers.false_comparison(said, [SPOTS]) is None


def test_explanations_with_a_false_comparison_are_rejected():
    data = {
        "frames_used": 3,
        "days_since_baseline": None,
        "routine": [],
        "metrics": [
            {
                **SPOTS,
                "verdict": "real_change",
                "direction": "decrease",
                "confidence": "high",
                "unit": "",
                "value": 4.1,
            }
        ],
    }
    exp = explain._Explanation(
        headline="Your dark spots reading.",
        items=[explain._Item(metric_id="pigment_spots", summary=JUROR)],
        next_steps=[],
        disclaimer="x",
    )
    assert any("contradict" in i for i in explain.problems(exp, data))


def test_the_advisor_retries_a_false_comparison(client, fake, monkeypatch):
    ctx = {
        "profile": {},
        "routine": [],
        "latest_sessions": {"face (guided)": {"session_id": "s1", "metrics": [SPOTS]}},
    }
    monkeypatch.setattr(advisor, "context", lambda store, uid: ctx)
    replies = iter(
        [JUROR, "Your dark spots moved by -0.3, beyond the 0.25 your photos usually vary."]
    )
    monkeypatch.setattr(
        gemini,
        "generate_json",
        lambda *a, **k: advisor.Reply.model_validate(
            {"message": next(replies), "product_ids": [], "follow_up_suggestions": []}
        ),
    )
    monkeypatch.setattr(
        advisor, "_generate", lambda *a, **k: type("R", (), {"function_calls": None})()
    )
    res = client.post("/v1/advisor/chat", json={"messages": [{"role": "user", "text": "Spots?"}]})
    assert res.status_code == 200, res.text
    assert "beyond the 0.25" in res.json()["message"]
