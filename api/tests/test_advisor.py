from types import SimpleNamespace

from app import advisor, catalog, gemini

PRODUCT = {
    "product_id": "p1",
    "brand": "B",
    "name": "Sunscreen SPF 50",
    "category": "sunscreen",
    "concerns": ["dark_spots_pigmentation"],
    "key_actives": [],
    "inci": [],
    "price": {"amount": 499, "currency": "INR"},
    "size": "50 g",
    "region": ["IN"],
    "stores": [{"store": "Nykaa", "url": "https://x", "region": "IN"}],
    "source_url": "https://x",
    "last_verified": "2026-10-13",
}


def _fake_model(monkeypatch, tool_calls, reply):
    """First generate_content asks for the given tools, the next one stops; then the reply."""
    state = {"n": 0}

    class Models:
        def generate_content(self, **kw):
            state["n"] += 1
            if state["n"] == 1 and tool_calls:
                calls = [SimpleNamespace(name=n, args=a) for n, a in tool_calls]
                return SimpleNamespace(
                    function_calls=calls, candidates=[SimpleNamespace(content=None)]
                )
            return SimpleNamespace(function_calls=None, candidates=[])

    monkeypatch.setattr(gemini, "client", lambda: SimpleNamespace(models=Models()))
    monkeypatch.setattr(
        advisor.types.Part,
        "from_function_response",
        classmethod(lambda cls, name, response: cls(text=name)),
    )
    monkeypatch.setattr(advisor.types, "Content", lambda role, parts: (role, parts))
    monkeypatch.setattr(
        gemini, "generate_json", lambda *a, **k: advisor.Reply.model_validate(reply)
    )
    monkeypatch.setattr(catalog, "products", lambda: (PRODUCT,))


def test_reply_with_tool_products_is_returned(client, fake, monkeypatch):
    _fake_model(
        monkeypatch,
        [("search_catalog", {"concern": "dark_spots_pigmentation"})],
        {
            "message": "Here is a sunscreen at 499 INR.",
            "product_ids": ["p1"],
            "follow_up_suggestions": ["Is it fragrance free?"],
        },
    )
    res = client.post("/v1/advisor/chat", json={"messages": [{"role": "user", "text": "SPF?"}]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["product_ids"] == ["p1"] and body["products"][0]["name"] == "Sunscreen SPF 50"
    assert body["retrieval"][0].startswith("Searched the catalog")
    assert body["remaining_today"] == 19


def test_invented_products_or_numbers_are_refused(client, fake, monkeypatch):
    _fake_model(
        monkeypatch,
        [],
        {
            "message": "Use X, it cuts redness by 40%.",
            "product_ids": ["made-up"],
            "follow_up_suggestions": [],
        },
    )
    res = client.post("/v1/advisor/chat", json={"messages": [{"role": "user", "text": "Help"}]})
    body = res.json()
    assert body["products"] == [] and body["message"].startswith("I could not put together")


def test_daily_limit(client, fake, monkeypatch):
    _fake_model(monkeypatch, [], {"message": "Hi.", "product_ids": [], "follow_up_suggestions": []})
    for _ in range(advisor.DAILY_LIMIT):
        assert (
            client.post(
                "/v1/advisor/chat", json={"messages": [{"role": "user", "text": "hi"}]}
            ).status_code
            == 200
        )
    over = client.post("/v1/advisor/chat", json={"messages": [{"role": "user", "text": "hi"}]})
    assert over.status_code == 429 and over.json()["detail"]["code"] == "daily_limit"


def test_routine_check_route_uses_saved_entries(client, fake):
    fake.store.routine_set(
        "u_test",
        "r1",
        {
            "custom_name": "Retinol",
            "brand": "B",
            "key_actives": [{"name": "retinol", "pct": None}],
            "inci": [],
            "slots": ["pm"],
            "category": "serum",
        },
    )
    fake.store.routine_set(
        "u_test",
        "r2",
        {
            "custom_name": "BHA",
            "brand": "B",
            "key_actives": [{"name": "salicylic acid", "pct": 2}],
            "inci": [],
            "slots": ["pm"],
            "category": "exfoliant",
        },
    )
    body = client.post("/v1/routine/check").json()
    assert body["conflicts"][0]["source"] == "rule"
    assert body["gaps"][0]["need"] == "Daily sunscreen in the morning"
