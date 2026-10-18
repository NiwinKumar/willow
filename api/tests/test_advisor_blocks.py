"""The advisor's structured answer: blocks, inline markup, widgets, and the validators on them."""

from test_advisor import _fake_model

from app import advisor
from app import advisor_blocks as ab

ASK = {"messages": [{"role": "user", "text": "Which sunscreen?"}]}
SEARCH = [("search_catalog", {"concern": "dark_spots_pigmentation"})]


def _ask(client, monkeypatch, reply, tools=SEARCH):
    _fake_model(monkeypatch, tools, reply)
    res = client.post("/v1/advisor/chat", json=ASK)
    assert res.status_code == 200, res.text
    return res.json()


def test_structured_answer_is_returned_answer_first(client, fake, monkeypatch):
    body = _ask(
        client,
        monkeypatch,
        {
            "blocks": [
                {"type": "note", "text": "Reapply **often** outdoors."},
                {"type": "answer", "text": "Try ==[product:p1]==, a **fragrance-free** sunscreen."},
                {"type": "bullets", "items": ["Costs 499 INR", "Sold at Nykaa"]},
                {"type": "widget", "widget": {"kind": "product", "product_id": "p1"}},
                {"type": "widget", "widget": {"kind": "metric_trend", "metric_id": "redness"}},
            ],
            "follow_up_suggestions": ["Is it fragrance free?"],
        },
    )
    kinds = [b["type"] for b in body["blocks"]]
    assert kinds == ["answer", "note", "bullets", "widget", "widget"]
    assert body["blocks"][3]["widget"] == {"kind": "product", "params": {"product_id": "p1"}}
    assert body["blocks"][4]["widget"] == {
        "kind": "metric_trend",
        "params": {"metric_id": "redness"},
    }
    # plain fallback: markup gone, product named; product id digits are not "numbers"
    assert body["message"].startswith("Try B Sunscreen SPF 50, a fragrance-free sunscreen.")
    assert "- Costs 499 INR" in body["message"]
    assert body["product_ids"] == ["p1"] and body["products"][0]["product_id"] == "p1"
    assert body["checks"]["numbers_checked"] == 1  # 499, from the catalog
    assert "**" not in body["message"] and "==" not in body["message"]


def test_a_new_number_anywhere_rejects_the_answer(client, fake, monkeypatch):
    body = _ask(
        client,
        monkeypatch,
        {
            "blocks": [
                {"type": "answer", "text": "Try [product:p1]."},
                {"type": "bullets", "items": ["Cuts dark spots by 30%"]},
            ]
        },
    )
    assert body["message"] == advisor.NO_ANSWER and "checks" not in body


def test_unknown_product_or_metric_links_reject_the_answer(client, fake, monkeypatch):
    made_up = {"blocks": [{"type": "answer", "text": "Try [product:made-up]."}]}
    assert _ask(client, monkeypatch, made_up)["message"] == advisor.NO_ANSWER
    bad_metric = {"blocks": [{"type": "answer", "text": "Your [metric:wrinkle_score] moved."}]}
    assert _ask(client, monkeypatch, bad_metric)["message"] == advisor.NO_ANSWER


def test_a_diagnosis_question_falls_back_to_the_cosmetic_scope_reply(client, fake, monkeypatch):
    # an honest refusal that names the condition is still rejected: the fixed reply says why instead
    _fake_model(
        monkeypatch,
        SEARCH,
        {"blocks": [{"type": "answer", "text": "I can't say if it is melasma."}]},
    )
    res = client.post(
        "/v1/advisor/chat", json={"messages": [{"role": "user", "text": "Do I have melasma?"}]}
    )
    assert res.status_code == 200, res.text
    assert res.json()["message"] == advisor.SCOPE_REPLY
    assert not advisor.explain.BANNED.search(advisor.SCOPE_REPLY)


def test_an_answer_block_is_required(client, fake, monkeypatch):
    only_bullets = {"blocks": [{"type": "bullets", "items": ["Sunscreen"]}]}
    assert _ask(client, monkeypatch, only_bullets)["message"] == advisor.NO_ANSWER


def test_unusable_widgets_are_left_out_and_capped(client, fake, monkeypatch):
    body = _ask(
        client,
        monkeypatch,
        {
            "blocks": [
                {"type": "answer", "text": "Here is your routine."},
                {"type": "widget", "widget": {"kind": "metric_trend", "metric_id": "wrinkles"}},
                {"type": "widget", "widget": {"kind": "session_summary", "session_id": "nope"}},
                {"type": "widget", "widget": {"kind": "routine", "slot": "pm"}},
                {"type": "widget", "widget": {"kind": "spot_diary"}},
                {"type": "widget", "widget": {"kind": "product_test"}},
            ]
        },
        tools=[],
    )
    widgets = [b["widget"] for b in body["blocks"] if b["type"] == "widget"]
    # the spot diary is gone from the app: its widget is left out
    assert widgets == [
        {"kind": "routine", "params": {"slot": "pm"}},
        {"kind": "product_test", "params": {}},
    ]


def test_widget_params():
    w = ab.WidgetSpec
    assert ab.widget_params(w(kind="session_summary"), set(), set()) == {"session_id": "latest"}
    assert ab.widget_params(w(kind="session_summary", session_id="s1"), {"s1"}, set()) == {
        "session_id": "s1"
    }
    assert ab.widget_params(
        w(kind="metric_trend", metric_id="pores", site="nose_macro"), set(), set()
    ) == {
        "metric_id": "pores",
        "site": "nose_macro",
    }
    assert (
        ab.widget_params(w(kind="metric_trend", metric_id="pores", site="moon"), set(), set())
        is None
    )
    assert ab.widget_params(w(kind="routine", site="moon"), set(), set()) is None
    assert ab.widget_params(w(kind="product", product_id="x"), set(), set()) is None
    assert ab.widget_params(w(kind="product", product_id="x"), set(), {"x"}) == {"product_id": "x"}


def test_markup_strip_and_plain():
    text = "Use **[product:the-ordinary-10-niacinamide]** for ==[metric:pigment_spots]=="
    assert ab.strip(text).split() == ["Use", "for"]
    names = {"the-ordinary-10-niacinamide": "The Ordinary Niacinamide"}
    assert ab.plain(text, names, ab.METRIC_LABELS) == "Use The Ordinary Niacinamide for dark spots"


def test_a_plain_message_reply_is_one_answer_block():
    r = advisor.Reply.model_validate({"message": "Hi."})
    assert r.blocks[0].type == "answer" and r.blocks[0].text == "Hi."


def test_history_keeps_the_blocks(client, fake, monkeypatch):
    _ask(
        client,
        monkeypatch,
        {"blocks": [{"type": "answer", "text": "Yes, **keep it**."}]},
        tools=[],
    )
    stored = client.get("/v1/advisor/history").json()["messages"][1]["reply"]
    assert stored["blocks"] == [{"type": "answer", "text": "Yes, **keep it**."}]
