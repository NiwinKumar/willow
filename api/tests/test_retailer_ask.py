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
    monkeypatch.setattr(retailer, "insights", lambda: INSIGHTS)
    res = client.post("/v1/retailer/ask", json={"question": "What works for dark spots?"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["answer"].startswith("Azelaic Gel")
    assert body["checks"]["rejected_attempts"] == 1


def test_gemini_down_is_a_clear_error_and_the_question_is_refunded(client, fake, monkeypatch):
    from datetime import UTC, datetime

    monkeypatch.setattr(retailer, "insights", lambda: INSIGHTS)
    res = client.post("/v1/retailer/ask", json={"question": "anything?"})
    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "assistant_unavailable"
    day = datetime.now(UTC).date().isoformat()
    assert fake.store.usage_incr("u_test", day, "retailer_ask", 0) == 0
