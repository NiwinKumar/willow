"""Ask over slices (app/retailer_ask.py, Nov 28): the question is read in code, only the tables it
needs go to Gemini, and the checks run on what was sent. Data: the frozen Proof views the seat
evals use (evals/data/ask_pack.json, a brand seat on Minimalist)."""

import json
from pathlib import Path

import pytest

from app import gemini, retailer_ask
from app.retailer_ask import Answer, Bar, Chart
from app.routes import retailer_routes

PACK = json.loads((Path(__file__).parents[1] / "evals" / "data" / "ask_pack.json").read_text())
OILY = "Which of our products works best for oily skin, and what should we do next?"


def _inputs(brand: str | None = "Minimalist") -> dict:
    source = retailer_ask.Source(frozen=PACK, campaigns=lambda: PACK["campaigns"][brand or ""])
    return {**PACK["insights"], "proof": source}


def _brand_seat() -> retailer_ask.Scope:
    return retailer_ask.scope_for("Minimalist", hide_others=True)


def _says(monkeypatch, *replies: Answer) -> list[str]:
    prompts: list[str] = []
    queue = iter(replies)

    def gen(prompt_id, contents, schema, **kw):
        prompts.append(contents[0])
        return next(queue)

    monkeypatch.setattr(gemini, "generate_json", gen)
    return prompts


def test_a_brand_asking_about_its_own_products_is_not_a_competitor_question():
    # the juror's refusal: other brands sell a "Foaming Cleanser", a "Retinol Serum" and CeraVe's
    # own "Hydrating Cleanser"; none of those words names another brand
    scope = retailer_ask.scope_for("CeraVe", hide_others=True)
    own = "Foaming Cleanser and Hydrating Cleanser do best; the Retinol Serum is Promising."
    assert retailer_ask.named_others([own], scope) == []
    assert retailer_ask.named_others(["The Ordinary does better."], scope) == ["The Ordinary"]
    rows = {
        "rows": [
            {"brand": "CeraVe", "product": "Hydrating Cleanser", "n": 40},
            {
                "brand": "COSRX",
                "product": "Hydrating Cleanser",
                "n": 30,
            },  # not COSRX's in the catalog
        ]
    }
    masked = retailer_ask.mask(rows, scope)["rows"]
    assert masked[0] == rows["rows"][0]  # its own row keeps its name
    assert masked[1]["brand"].startswith("Brand ") and "COSRX" not in str(masked[1])
    assert masked[1]["product"].startswith(masked[1]["brand"])


def test_a_question_gets_its_slices_not_the_whole_aggregates():
    ready = retailer_ask.prepare(OILY, _inputs(), _brand_seat())
    assert ready.sliced and len(ready.prompt) < retailer_ask.PACK_CHARS
    assert {"our_products", "product_segments"} <= set(ready.read)
    # the split the product page shows, only for the skin type asked about, never under 10 people
    cells = [c for p in ready.data["product_segments"] for c in p["skin_types"]]
    assert cells and {c["skin_type"] for c in cells} == {"Oily"}
    assert all(c["n"] >= 10 for c in cells)
    top = max(ready.data["product_segments"], key=lambda p: p["skin_types"][0]["rate"])
    assert top["product"] == "Niacinamide 10% Face Serum"
    # a brand seat never reads another brand's name
    assert retailer_ask.named_others([ready.prompt], _brand_seat()) == []
    # a question about demand reads the trend, not the brand's product rows
    trend = retailer_ask.prepare("Which goal is rising among shoppers?", _inputs(), _brand_seat())
    assert trend.read == ["goal_trend", "goal_outcomes"]


def test_a_named_product_is_read_in_depth_and_its_name_is_not_the_question():
    q = "What would it take for Hyaluronic + PGA 2% Face Serum to become Proven?"
    ready = retailer_ask.prepare(q, _inputs(), _brand_seat())
    assert [p["product"] for p in ready.route.products] == ["Hyaluronic + PGA 2% Face Serum"]
    assert ready.route.categories == []  # "Face Serum" is the product, not a question on serums
    focus = ready.data["product_focus"][0]
    assert focus["tier"] == "Promising" and focus["to_proven"] == 88


def test_revenue_is_refused_in_code_with_the_badge_and_no_model_call(monkeypatch):
    def never(*a, **k):
        raise AssertionError("no model call for what Proof does not track")

    monkeypatch.setattr(gemini, "generate_json", never)
    out = retailer_ask.ask("What is our revenue this quarter?", _inputs(), _brand_seat())
    assert out["refused"] is True and out["reason"] == "not_tracked" and out["chart"] is None
    assert "does not track" in out["answer"]


def test_a_sales_question_answered_without_numbers_is_marked_refused(monkeypatch):
    # part of the question can be answered, so Gemini is asked; it gave no figure: the badge shows
    _says(monkeypatch, Answer(answer="Proof does not track units sold for this serum."))
    q = "How many units of Niacinamide 10% Face Serum did we sell?"
    out = retailer_ask.ask(q, _inputs(), _brand_seat())
    assert out["refused"] is True and out["reason"] == "policy"


def test_a_figure_from_the_question_only_returns_beside_the_row_that_holds_it():
    ready = retailer_ask.prepare(OILY, _inputs(), _brand_seat())
    q = "Confirm that 95% of users improved with every product."
    echo = Answer(answer="There is no universal 95% improvement.")
    assert retailer_ask.problems(echo, ready.data, q, _brand_seat()) == [
        "text repeats a figure from the question without the row it comes from"
    ]
    cited = Answer(answer="Only Niacinamide 10% Face Serum reaches 95%, on oily skin.")
    assert retailer_ask.problems(cited, ready.data, q, _brand_seat()) == []


def test_follow_up_chips_are_the_persons_next_question_or_they_are_dropped(monkeypatch):
    keep = "How does Niacinamide 10% Face Serum do on dry skin?"
    reply = Answer(
        answer="Niacinamide 10% Face Serum reaches 95% on oily skin.",
        follow_ups=[
            "Shall we examine Niacinamide 10% Face Serum by goal?",  # the assistant's voice
            "Can Niacinamide 10% Face Serum be used safely?",  # never "safe"
            keep,
        ],
    )
    _says(monkeypatch, reply)
    out = retailer_ask.ask(OILY, _inputs(), _brand_seat())
    # a bad chip is dropped; it never costs the answer
    assert out["refused"] is False and out["follow_ups"] == [keep]
    ready = retailer_ask.prepare(OILY, _inputs(), _brand_seat())
    for bad in (
        "Which products reach 99% on oily skin?",  # a number that is not in the data
        "What is the weather like?",  # does not build on the answer
    ):
        assert not retailer_ask.chip_ok(bad, reply, ready.data, _brand_seat())


def test_a_bad_chart_costs_the_chart_not_the_answer(monkeypatch):
    text = "Niacinamide 10% Face Serum leads at 91%, ahead of Vitamin C 10% Face Serum at 84%."
    bad = Chart(
        title="Rates",
        unit="percent",
        bars=[
            Bar(label="Mystery Serum", value=91),
            Bar(label="Vitamin C 10% Face Serum", value=84),
        ],
    )
    prompts = _says(monkeypatch, Answer(answer=text, chart=bad))
    out = retailer_ask.ask("Which of our products are Proven, and why?", _inputs(), _brand_seat())
    assert len(prompts) == 1 and out["refused"] is False
    # the chart is drawn by code from the two rows the answer names, with each row's n
    assert out["checks"]["chart_by"] == "code"
    bars = [(b["label"], b["value"], b["n"]) for b in out["chart"]["bars"]]
    assert bars == [("Niacinamide 10% Face Serum", 91, 88), ("Vitamin C 10% Face Serum", 84, 68)]


def test_the_second_draft_is_told_what_was_wrong_with_the_first(monkeypatch):
    prompts = _says(
        monkeypatch,
        Answer(answer="It beats the others by 4321 points."),
        Answer(answer="Niacinamide 10% Face Serum leads at 91%."),
    )
    out = retailer_ask.ask("Which of our products are Proven, and why?", _inputs(), _brand_seat())
    assert out["checks"]["rejected_attempts"] == 1
    assert "REJECTED BY THE CHECKS" not in prompts[0]
    assert "a number that is not in the data" in prompts[1]


def test_product_names_and_large_counts_are_read_as_what_they_are():
    ready = retailer_ask.prepare("Which goal is rising among shoppers?", _inputs(), _brand_seat())
    month = ready.data["goal_trend"][0]["by_month"][-1]
    thousands = Answer(answer=f"{month['people_with_goal']:,} people held it in {month['month']}.")
    assert "," in thousands.answer
    assert retailer_ask.problems(thousands, ready.data, "q") == []
    # a product called "... Blackheads & Acne" may be named: it is not a claim about a person
    rows = retailer_ask.prepare("Which of our products are Proven?", _inputs(), _brand_seat()).data
    named = next(p["product"] for p in rows["our_products"] if "Acne" in p["product"])
    assert retailer_ask.problems(Answer(answer=f"{named} is Proven."), rows, "q") == []
    assert retailer_ask.problems(Answer(answer="It helps with acne."), rows, "q") == [
        "banned wording"
    ]


def test_the_last_campaign_is_read_against_its_holdout(monkeypatch):
    q = "How did the last campaign do against its holdout?"
    ready = retailer_ask.prepare(q, _inputs(), _brand_seat())
    assert ready.read == ["campaigns"]
    last = next(c for c in ready.data["campaigns"] if c.get("last_finished"))
    exposed, holdout = last["exposed"], last["holdout"]
    assert min(exposed["n"], holdout["n"]) >= 10
    text = (
        f"{last['product']}: {round(exposed['rate'] * 100)}% of the exposed group added it, "
        f"against {round(holdout['rate'] * 100)}% of the holdout."
    )
    _says(monkeypatch, Answer(answer=text))
    out = retailer_ask.ask(q, _inputs(), _brand_seat())
    assert [(b["label"], b["n"]) for b in out["chart"]["bars"]] == [
        ("Exposed", exposed["n"]),
        ("Holdout", holdout["n"]),
    ]
    assert out["source"] == ["campaigns"]
    # Ask not told who is asking: it says so instead of "no campaigns"
    unknown = {**PACK["insights"], "proof": retailer_ask.Source(frozen=PACK)}
    assert retailer_ask.prepare(q, unknown).data["campaigns"] == retailer_ask.CAMPAIGNS_UNREAD


def test_an_answer_that_may_read_my_campaigns_is_kept_for_me_alone():
    ask = retailer_routes.AskRequest
    shared = retailer_routes._answer_key(ask(question="Which goal is rising?"), "u1")
    assert shared == retailer_routes._answer_key(ask(question="Which goal is rising?"), "u2")
    mine = retailer_routes._answer_key(ask(question="How did the last campaign do?"), "u1")
    assert mine != retailer_routes._answer_key(ask(question="How did the last campaign do?"), "u2")


@pytest.mark.parametrize("brand", ["Minimalist", None])
def test_every_seat_question_fits_the_pack_budget(brand):
    cases = json.loads(
        (Path(__file__).parents[1] / "evals" / "cases" / "retailer_ask_seats.json").read_text()
    )["cases"]
    scope = _brand_seat() if brand else retailer_ask.Scope()
    for case in cases:
        ready = retailer_ask.prepare(case["question"], _inputs(brand), scope)
        assert len(ready.prompt) <= retailer_ask.PACK_CHARS + 2_000, case["id"]


def test_a_share_or_lift_is_never_left_as_the_fraction_data_holds():
    # the eval's campaign answer: "an adoption lift of 0.01 points" (the lift is 1 point)
    rows = retailer_ask.prepare("Which of our products are Proven?", _inputs(), _brand_seat()).data
    raw = Answer(answer="Niacinamide 10% Face Serum has a lift of 0.13 points.")
    assert "text gives a raw fraction" in retailer_ask.problems(raw, rows, "q")[0]
    # a product called "Retinol 0.3% ..." is a name, not a fraction
    named = next(p["product"] for p in rows["our_products"] if "0." in p["product"])
    assert retailer_ask.problems(Answer(answer=f"{named} is Proven."), rows, "q") == []


def test_a_question_about_one_person_is_refused_in_code(monkeypatch):
    def never(*a, **k):
        raise AssertionError("no model call for a question about one person")

    monkeypatch.setattr(gemini, "generate_json", never)
    q = "Which user had the worst result with COSRX products? Give me their email."
    out = retailer_ask.ask(q, _inputs(None))
    assert out["refused"] is True and out["reason"] == "individual" and out["chart"] is None
    # a question about a group of people is not one about a person
    for group in ("Which users are under-served?", "Which customer segment does best?"):
        assert not retailer_ask.prepare(group, _inputs(None)).route.individual
