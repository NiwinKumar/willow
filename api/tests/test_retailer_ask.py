from app import gemini, retailer, retailer_ask
from app.retailer_ask import Answer, Bar, Chart

INSIGHTS = {
    "cohort": {"synthetic": 500, "real": 0, "weeks": 8},
    "tiles": [{"label": "Active users", "value": "430", "n": 430, "sub": "week 8"}],
    "needs": [{"goal": "Fewer dark spots", "n": 100, "real": 24, "none": 61, "early": 15}],
    "products": [
        {
            "product": "Azelaic Gel",
            "brand": "Acme",
            "concern": "dark spots",
            "n": 40,
            "cells": [],
            "rate": 0.61,
            "lift": 0.26,
            "weeks": 6.5,
            "cont": 0.77,
        },
        {
            "product": "Plain Cream",
            "brand": "Beta",
            "concern": "dark spots",
            "n": 30,
            "cells": [],
            "rate": 0.2,
            "lift": -0.1,
            "weeks": 7,
            "cont": 0.5,
        },
    ],
    "brands": [],
    "gaps": [],
    "conflicts": [],
}


def test_rates_may_be_written_as_percents_but_nothing_new():
    ok = Answer(
        answer="Azelaic Gel reached 61% versus 20% for Plain Cream (synthetic cohort).",
        chart=Chart(
            title="Still improved at week 8",
            unit="percent",
            bars=[Bar(label="Azelaic Gel", value=61), Bar(label="Plain Cream", value=20)],
        ),
    )
    assert retailer_ask.problems(ok, INSIGHTS, "which works?") == []
    derived = Answer(answer="Azelaic Gel beats Plain Cream by 41 points.")
    assert retailer_ask.problems(derived, INSIGHTS, "q") == [
        "text quotes a number that is not in the data"
    ]
    echoed = Answer(answer="Yes, 95% of people.")
    assert retailer_ask.problems(echoed, INSIGHTS, "is it 95%?") != []
    raw_rate_as_percent = Answer(
        answer="Rates.",
        chart=Chart(
            title="t",
            unit="percent",
            bars=[Bar(label="Azelaic Gel", value=0.61), Bar(label="Plain Cream", value=0.2)],
        ),
    )
    assert "chart value not in the data: 0.61" in retailer_ask.problems(
        raw_rate_as_percent, INSIGHTS, "q"
    )
    sneaky_title = Answer(
        answer="See chart.",
        chart=Chart(
            title="Up 41 points",
            unit="percent",
            bars=[Bar(label="Azelaic Gel", value=61), Bar(label="Plain Cream", value=20)],
        ),
    )
    assert retailer_ask.problems(sneaky_title, INSIGHTS, "q") == [
        "text quotes a number that is not in the data"
    ]
    made_up = Answer(
        answer="Two products.",
        chart=Chart(
            title="t",
            unit="percent",
            bars=[Bar(label="Azelaic Gel", value=61), Bar(label="Mystery Serum", value=55)],
        ),
    )
    assert retailer_ask.problems(made_up, INSIGHTS, "q") == [
        "chart label not in the data: Mystery Serum",
        "chart value not in the data: 55.0",
    ]


def test_ask_route_retries_once_then_answers(client, fake, monkeypatch):
    replies = iter(
        [
            Answer(answer="It beats it by 41 points."),
            Answer(answer="Azelaic Gel: 61% still improved at week 8 (synthetic cohort)."),
        ]
    )
    monkeypatch.setattr(gemini, "generate_json", lambda *a, **k: next(replies))
    monkeypatch.setattr(retailer, "insights", lambda *a: INSIGHTS)
    res = client.post("/v1/retailer/ask", json={"question": "What works for dark spots?"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["answer"].startswith("Azelaic Gel")
    assert body["checks"]["rejected_attempts"] == 1


def test_gemini_down_is_a_clear_error_and_the_question_is_refunded(client, fake, monkeypatch):
    from datetime import UTC, datetime

    monkeypatch.setattr(retailer, "insights", lambda *a: INSIGHTS)
    res = client.post("/v1/retailer/ask", json={"question": "anything?"})
    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "assistant_unavailable"
    day = datetime.now(UTC).date().isoformat()
    assert fake.store.usage_incr("u_test", day, "retailer_ask", 0) == 0


def test_chart_labels_may_name_any_product_with_evidence():
    from app.retailer_ask import _names

    data = {
        "products": [],
        "product_outcomes": {
            "p1": {
                "product": "Alpha Arbutin 2% + HA",
                "brand": "Minimalist",
                "concern": "dark spots",
                "n": 20,
                "rate": 0.5,
                "weeks": 6,
                "cont": 0.8,
            },
        },
    }
    assert "alpha arbutin 2% + ha" in _names(data)


def test_answers_carry_refused_per_bar_n_and_source(client, fake, monkeypatch):
    seen = []
    monkeypatch.setattr(
        gemini,
        "generate_json",
        lambda *a, **k: Answer(
            answer="For fewer dark spots, Azelaic Gel reached 61% (synthetic cohort).",
            chart=Chart(
                title="Still improved at week 8",
                unit="percent",
                bars=[Bar(label="Azelaic Gel", value=61), Bar(label="Beta Plain Cream", value=20)],
            ),
        ),
    )
    monkeypatch.setattr(retailer, "insights", lambda c, r: seen.append((c, r)) or INSIGHTS)
    res = client.post(
        "/v1/retailer/ask",
        json={"question": "What works for dark spots?", "cohort": "simulated", "range": "90d"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert seen == [("simulated", "90d")]
    assert body["refused"] is False
    assert [b["n"] for b in body["chart"]["bars"]] == [40, 30]
    assert body["source"] == ["product_outcomes", "needs"]
    bad = client.post("/v1/retailer/ask", json={"question": "anything?", "cohort": "all"})
    assert bad.status_code == 422


def test_a_refusal_has_no_chart_and_the_fallback_is_a_refusal(client, fake, monkeypatch):
    chart = Chart(
        title="t",
        unit="percent",
        bars=[Bar(label="Azelaic Gel", value=61), Bar(label="Plain Cream", value=20)],
    )
    refusal = Answer(answer="No.", refused=True, chart=chart)
    assert retailer_ask.problems(refusal, INSIGHTS, "q") == ["a refusal has no chart"]
    plain = Answer(answer="I can't name people; ask about a goal instead.", refused=True)
    assert retailer_ask.problems(plain, INSIGHTS, "q") == []
    monkeypatch.setattr(
        gemini, "generate_json", lambda *a, **k: Answer(answer="It beats it by 41 points.")
    )
    monkeypatch.setattr(retailer, "insights", lambda *a: INSIGHTS)
    body = client.post("/v1/retailer/ask", json={"question": "Which users changed most?"}).json()
    assert body["refused"] is True and body["chart"] is None and body["checks"] is None
    assert body["source"] == []


def test_gemini_sees_months_in_words_and_no_page_plumbing():
    data = {
        **INSIGHTS,
        "filters": {"cohort": "mixed", "range": "all", "since": None, "today": "2026-10-15"},
        "empty": False,
        "needs_by_month": {"months": ["2026-08", "2026-10"], "people": [20, 30], "goals": []},
    }
    v = retailer_ask.view(data)
    assert "filters" not in v and "empty" not in v
    assert v["needs_by_month"]["months"] == ["August 2026", "October 2026"]


def test_a_repeated_question_is_answered_from_the_kept_answer(client, fake, monkeypatch):
    from datetime import UTC, datetime

    calls = []

    def once(*a, **k):
        calls.append(1)
        return Answer(answer="Azelaic Gel: 61% still improved at week 8 (synthetic cohort).")

    monkeypatch.setattr(gemini, "generate_json", once)
    monkeypatch.setattr(retailer, "insights", lambda *a: INSIGHTS)
    first = client.post("/v1/retailer/ask", json={"question": "What works for dark spots?"})
    again = client.post("/v1/retailer/ask", json={"question": "  what works for DARK spots? "})
    assert first.status_code == again.status_code == 200
    assert again.json() == first.json()
    assert len(calls) == 1
    day = datetime.now(UTC).date().isoformat()
    assert fake.store.usage_incr("u_test", day, "retailer_ask", 0) == 1
    # other filters are another question
    other = client.post(
        "/v1/retailer/ask", json={"question": "What works for dark spots?", "range": "30d"}
    )
    assert other.status_code == 200 and len(calls) == 2
