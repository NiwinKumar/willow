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
    assert body["checks"]["tool_calls"] == 1 and body["checks"]["products_from_tools"] == 1
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


def test_routine_products_may_be_discussed(client, fake, monkeypatch):
    _fake_model(
        monkeypatch,
        [],
        {
            "message": "Keep these two on separate nights.",
            "product_ids": ["p1"],
            "follow_up_suggestions": [],
        },
    )
    fake.store.routine_set(
        "u_test",
        "r1",
        {
            "product_id": "p1",
            "custom_name": "Sunscreen SPF 50",
            "brand": "B",
            "key_actives": [],
            "slots": ["am"],
        },
    )
    body = client.post(
        "/v1/advisor/chat", json={"messages": [{"role": "user", "text": "Is this OK?"}]}
    ).json()
    assert body["product_ids"] == ["p1"]


def test_product_tools_carry_cohort_outcomes_labelled_synthetic(monkeypatch):
    from app import retailer
    from app.store import MemoryStore

    pid = "minimalist-retinol-0-3-face-serum"
    monkeypatch.setattr(
        retailer,
        "insights",
        lambda: {
            "cohort": {"real": 0},
            "product_outcomes": {pid: {"n": 40, "rate": 0.55, "weeks": 6}},
        },
    )
    out = advisor.run_tool("compare_products", {"product_ids": [pid]}, MemoryStore(), "u")
    assert out["measured_outcomes"]["synthetic_cohort"] is True
    assert out["measured_outcomes"]["by_product"] == {pid: {"n": 40, "rate": 0.55, "weeks": 6}}


def test_context_keeps_the_last_good_reading_and_rounds_like_the_screen(fake):
    import json
    from datetime import UTC, datetime, timedelta

    def doc(passed, value, when):
        return {
            "status": "done",
            "site": "face_full",
            "capture_mode": "uncalibrated",
            "n_frames": 3,
            "measured": True,
            "created_at": when,
            "result_json": json.dumps(
                {
                    "frames_used": 2 if passed else 0,
                    "quality": {"passed": passed},
                    "metrics": [
                        {
                            "id": "blemishes",
                            "label": "Blemishes",
                            "unit": "count",
                            "value": value,
                            "delta": None,
                            "mdc95": None,
                            "verdict": "no_baseline",
                            "confidence": "indicative",
                        }
                    ],
                }
            ),
        }

    now = datetime.now(UTC)
    fake.store.session_set("u_test", "s_good", doc(True, 2.5, now - timedelta(days=1)))
    fake.store.session_set("u_test", "s_blurry", doc(False, None, now))
    latest = advisor.context(fake.store, "u_test")["latest_sessions"]["face_full (uncalibrated)"]
    assert latest["session_id"] == "s_good" and latest["photos_used"] == 2
    assert latest["metrics"][0]["value"] == 3
