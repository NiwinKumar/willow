"""Advisor slice F: usage read, chat history, photo attachments, streaming progress and the
AI-unavailable standard explanation."""

import base64
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from test_advisor import _fake_model

from app import advisor, gemini, limits

ASK = {"messages": [{"role": "user", "text": "Is my routine OK?"}]}
JPEG = base64.b64encode(b"\xff\xd8\xff\xe0fake-jpeg").decode()
HI = {"message": "Your routine looks fine.", "product_ids": [], "follow_up_suggestions": []}


def _events(text: str) -> list[tuple[str, dict]]:
    """Parse an SSE body into (event, data) pairs; keep-alive comments are skipped."""
    out = []
    for block in text.strip().split("\n\n"):
        lines = [x for x in block.split("\n") if not x.startswith(":")]
        if not lines:
            continue
        event = next(x[7:] for x in lines if x.startswith("event: "))
        data = json.loads(next(x[6:] for x in lines if x.startswith("data: ")))
        out.append((event, data))
    return out


def _measured_face(when: datetime, source: str | None = None) -> dict:
    return {
        "status": "done",
        "site": "face_full",
        "capture_mode": "uncalibrated",
        "n_frames": 3,
        "measured": True,
        "is_baseline": True,
        "created_at": when,
        "explanation_source": source,
        "explanation": {"headline": "Stored", "items": [], "next_steps": [], "disclaimer": "d"}
        if source
        else None,
        "result_json": json.dumps(
            {
                "frames_used": 3,
                "quality": {"passed": True},
                "metrics": [
                    {
                        "id": "redness",
                        "label": "Redness",
                        "unit": "a_star",
                        "value": 12.4,
                        "delta": None,
                        "mdc95": 0.8,
                        "verdict": "no_baseline",
                        "confidence": "measured",
                    }
                ],
            }
        ),
    }


def _gemini_down(monkeypatch):
    class Models:
        def generate_content(self, **kw):
            raise RuntimeError("deadline exceeded")

    monkeypatch.setattr(gemini, "client", lambda: SimpleNamespace(models=Models()))
    monkeypatch.setattr(advisor.time, "sleep", lambda s: None)


# --- GET /v1/me/usage ------------------------------------------------------------------------


def test_usage_reads_counts_without_counting(client, fake, monkeypatch):
    _fake_model(monkeypatch, [], HI)
    fresh = client.get("/v1/me/usage").json()
    assert fresh["advisor"] == {
        "used": 0,
        "cap": limits.CAPS["advisor"][0],
        "remaining": limits.CAPS["advisor"][0],
        "resets_at": fresh["advisor"]["resets_at"],
    }
    assert set(fresh) == {"advisor", "routine_check", "label_scan", "retailer_ask"}
    tomorrow = datetime.now(UTC).date() + timedelta(days=1)
    assert fresh["advisor"]["resets_at"] == f"{tomorrow.isoformat()}T00:00:00Z"
    client.post("/v1/advisor/chat", json=ASK)
    client.post("/v1/advisor/chat", json=ASK)
    after = client.get("/v1/me/usage").json()["advisor"]
    assert after["used"] == 2 and after["remaining"] == after["cap"] - 2
    assert client.get("/v1/me/usage").json()["advisor"]["used"] == 2  # reading is free


def test_usage_is_clamped_past_the_cap(fake):
    day = datetime.now(UTC).date().isoformat()
    fake.store.usage_incr("u1", day, "label_scan", 33)  # refused attempts stay counted
    u = limits.usage(fake.store, "u1")["label_scan"]
    assert u["used"] == u["cap"] == 30 and u["remaining"] == 0


# --- history -------------------------------------------------------------------------------


def test_each_turn_is_stored_and_read_back_oldest_first(client, fake, monkeypatch):
    _fake_model(monkeypatch, [], HI)
    client.post("/v1/advisor/chat", json=ASK)
    msgs = client.get("/v1/advisor/history").json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "willow"]
    assert msgs[0]["text"] == "Is my routine OK?" and msgs[0]["photos"] == 0
    reply = msgs[1]["reply"]
    assert reply["message"] == HI["message"] and reply["products"] == []
    assert reply["checks"]["tool_calls"] == 0


def test_new_chat_clears_the_history(client, fake, monkeypatch):
    _fake_model(monkeypatch, [], HI)
    client.post("/v1/advisor/chat", json=ASK)
    assert client.delete("/v1/advisor/history").status_code == 204
    assert client.get("/v1/advisor/history").json()["messages"] == []


def test_history_keeps_the_newest_200(fake):
    start = datetime(2026, 10, 1, tzinfo=UTC)
    for i in range(105):
        at = start + timedelta(minutes=i)
        reply = {"message": f"a{i}"}
        advisor.remember(fake.store, "u1", f"q{i}", 0, reply, at, at + timedelta(seconds=20))
    rows = fake.store.advisor_list("u1")
    assert len(rows) == advisor.HISTORY_KEEP
    assert rows[0]["text"] == "q5" and rows[-1]["text"] == "a104"


def test_delete_my_data_removes_the_history(client, fake, monkeypatch):
    _fake_model(monkeypatch, [], HI)
    client.post("/v1/advisor/chat", json=ASK)
    assert client.delete("/v1/me").status_code == 204
    assert fake.store.advisor_list("u_test") == []


def test_another_person_never_sees_the_history(client, fake, monkeypatch):
    _fake_model(monkeypatch, [], HI)
    client.post("/v1/advisor/chat", json=ASK)
    other = client.get("/v1/advisor/history", headers={"X-Dev-Uid": "someone_else"})
    assert other.json()["messages"] == []


# --- photo attachments ---------------------------------------------------------------------


def test_photos_go_to_gemini_with_the_question_and_are_never_stored(client, fake, monkeypatch):
    _fake_model(monkeypatch, [], {**HI, "photos_show": "product_or_label"})
    seen = {}

    def capture(prompt_id, contents, schema, **kw):
        seen["contents"], seen["instructions"] = contents, kw["instructions"]
        return advisor.Reply.model_validate({**HI, "photos_show": "product_or_label"})

    monkeypatch.setattr(gemini, "generate_json", capture)
    body = {**ASK, "images": [{"mime_type": "image/jpeg", "data_base64": JPEG}] * 2}
    res = client.post("/v1/advisor/chat", json=body)
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["checks"]["photos_read"] == 2
    assert out["retrieval"][0] == "Read 2 product photos you attached"
    parts = [c for c in seen["contents"] if not isinstance(c, str)]
    assert len(parts) == 2 and parts[0].inline_data.mime_type == "image/jpeg"
    assert "product and label photos only" in seen["instructions"]
    stored = fake.store.advisor_list("u_test")
    assert stored[0]["photos"] == 2
    assert JPEG not in json.dumps(stored, default=str)


def test_a_face_photo_is_never_answered(client, fake, monkeypatch):
    _fake_model(monkeypatch, [], {**HI, "photos_show": "face_or_skin"})
    body = {**ASK, "images": [{"mime_type": "image/jpeg", "data_base64": JPEG}]}
    out = client.post("/v1/advisor/chat", json=body).json()
    assert out["message"] == advisor.PHOTO_REFUSAL and out["photos_refused"] is True
    assert "checks" not in out


def test_photo_limits(client, fake, monkeypatch):
    _fake_model(monkeypatch, [], HI)
    four = {**ASK, "images": [{"mime_type": "image/jpeg", "data_base64": JPEG}] * 4}
    assert client.post("/v1/advisor/chat", json=four).status_code == 422
    gif = {**ASK, "images": [{"mime_type": "image/gif", "data_base64": JPEG}]}
    assert client.post("/v1/advisor/chat", json=gif).status_code == 422
    broken = {**ASK, "images": [{"mime_type": "image/jpeg", "data_base64": "not base64!"}]}
    res = client.post("/v1/advisor/chat", json=broken)
    assert res.status_code == 422 and res.json()["detail"]["code"] == "bad_image"
    # none of these counted
    assert client.get("/v1/me/usage").json()["advisor"]["used"] == 0


# --- streaming -----------------------------------------------------------------------------


def test_stream_sends_each_real_step_then_the_checked_reply(client, fake, monkeypatch):
    _fake_model(monkeypatch, [("check_routine", {})], HI)
    res = client.post("/v1/advisor/chat/stream", json=ASK)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    events = _events(res.text)
    names = [e for e, _ in events]
    assert names == [
        "reading_context",
        "asking_gemini",
        "asking_gemini",
        "asking_gemini",
        "checking_numbers",
        "done",
    ]
    assert [events[i][1]["step"] for i in (1, 2, 3)] == ["tools", "tool", "reply"]
    assert events[2][1]["tool"] == "check_routine"
    assert events[3][1]["retrieval"] == ["Checked your routine against the rule table"]
    reply = events[-1][1]["reply"]
    assert reply["message"] == HI["message"] and reply["remaining_today"] == 19
    # stored like the plain endpoint
    assert len(client.get("/v1/advisor/history").json()["messages"]) == 2


def test_stream_limit_and_bad_requests_are_plain_http_errors(client, fake, monkeypatch):
    _fake_model(monkeypatch, [], HI)
    monkeypatch.setitem(limits.CAPS, "advisor", (0, 3000))
    res = client.post("/v1/advisor/chat/stream", json=ASK)
    assert res.status_code == 429 and res.json()["detail"]["code"] == "daily_limit"
    yours = {"messages": [{"role": "willow", "text": "hi"}]}
    assert client.post("/v1/advisor/chat/stream", json=yours).status_code == 422


def test_stream_reports_gemini_down_with_the_standard_explanation(client, fake, monkeypatch):
    _gemini_down(monkeypatch)
    fake.store.session_set("u_test", "s1", _measured_face(datetime.now(UTC)))
    events = _events(client.post("/v1/advisor/chat/stream", json=ASK).text)
    event, data = events[-1]
    assert event == "error" and data["status"] == 502 and data["code"] == "advisor_unavailable"
    std = data["standard"]
    assert std["session_id"] == "s1" and std["explanation"]["headline"] == "This is your baseline"
    assert "done" not in [e for e, _ in events]
    # not counted, nothing stored
    assert client.get("/v1/me/usage").json()["advisor"]["used"] == 0
    assert fake.store.advisor_list("u_test") == []


# --- AI unavailable: standard explanation ----------------------------------------------------


def test_plain_endpoint_502_carries_the_standard_explanation(client, fake, monkeypatch):
    _gemini_down(monkeypatch)
    now = datetime.now(UTC)
    fake.store.session_set("u_test", "old", _measured_face(now - timedelta(days=3)))
    fake.store.session_set("u_test", "new", _measured_face(now, source="template"))
    res = client.post("/v1/advisor/chat", json=ASK)
    assert res.status_code == 502
    std = res.json()["detail"]["standard"]
    # the latest session's own template explanation is used as stored
    assert std["session_id"] == "new" and std["explanation"]["headline"] == "Stored"


def test_standard_explanation_is_none_without_a_measured_session(fake):
    assert advisor.standard_explanation(fake.store, "nobody") is None


# --- Nov 28: one currency, pairing badges, the simulated cohort, the fast claim refusal ---------

RETINOL = {
    "product_id": "ret",
    "brand": "B",
    "name": "Retinol Serum",
    "category": "serum",
    "concerns": ["fine_lines_wrinkles"],
    "key_actives": [{"name": "Retinol", "pct": 0.3}],
    "inci": ["Aqua", "Retinol"],
    "price": {"amount": 599, "currency": "INR"},
    "size": "30 ml",
    "region": ["IN"],
    "stores": [
        {
            "store": "Brand site",
            "url": "https://x/r",
            "region": "IN",
            "price": {"amount": 539, "currency": "INR", "checked": "2026-11-20"},
        }
    ],
    "source_url": "https://x",
    "last_verified": "2026-10-13",
}
BHA = {
    **RETINOL,
    "product_id": "bha",
    "name": "BHA Liquid",
    "category": "exfoliant",
    "key_actives": [{"name": "Salicylic Acid", "pct": 2}],
    "inci": ["Aqua", "Salicylic Acid"],
    "price": {"amount": 34, "currency": "USD"},
    "stores": [{"store": "Brand site", "url": "https://x/b", "region": "US"}],
}


def _entry(p, slots=("pm",)):
    return {
        "product_id": p["product_id"],
        "brand": p["brand"],
        "custom_name": p["name"],
        "category": p["category"],
        "key_actives": p["key_actives"],
        "inci": p["inci"],
        "slots": list(slots),
        "started_at": "2026-11-01",
    }


def _wisp(monkeypatch, tool_calls, reply, products):
    from app import catalog
    from tests.test_advisor import _fake_model

    _fake_model(monkeypatch, tool_calls, reply)
    kept = tuple(products)
    monkeypatch.setattr(catalog, "products", lambda: kept)


def test_one_currency_and_the_card_shows_the_price_the_answer_was_given(fake, monkeypatch):
    from app import advisor

    fake.store.user_merge("u_test", {"profile": {"safety": {"market": "IN"}}})
    # the person's currency: the lowest checked INR price, the same field the card reads
    assert advisor.shown_price(RETINOL, "INR") == {"amount": 539, "currency": "INR"}
    assert advisor._compact(RETINOL, None, "INR")["price"] == {"amount": 539, "currency": "INR"}
    # nothing checked in their currency: no price at all, never another currency's
    compact = advisor._compact(BHA, None, "INR")
    assert compact["price"] is None and compact["price_note"] == "no price checked in INR"
    assert advisor._priced([RETINOL, BHA], "INR")[1]["shown_price"] is None
    # an answer that names a second currency is rejected
    assert advisor.mixed_currency(["Retinol is ₹539 and the BHA is US$34."], "INR", set())
    assert not advisor.mixed_currency(["Retinol is ₹539 at the brand site."], "INR", set())


def test_a_reply_mixing_currencies_falls_back_and_a_clean_one_carries_shown_prices(
    client, fake, monkeypatch
):
    fake.store.user_merge("u_test", {"profile": {"safety": {"market": "IN"}}})
    ask = {"messages": [{"role": "user", "text": "Compare them"}]}
    tools = [("compare_products", {"product_ids": ["ret", "bha"]})]
    _wisp(monkeypatch, tools, {"message": "One is ₹539, the other US$34."}, [RETINOL, BHA])
    assert client.post("/v1/advisor/chat", json=ask).json()["message"].startswith("I could not")
    _wisp(
        monkeypatch,
        tools,
        {"message": "The retinol serum is ₹539.", "product_ids": ["ret", "bha"]},
        [RETINOL, BHA],
    )
    body = client.post("/v1/advisor/chat", json=ask).json()
    assert body["price_currency"] == "INR"
    shown = {p["product_id"]: p["shown_price"] for p in body["products"]}
    assert shown == {"ret": {"amount": 539, "currency": "INR"}, "bha": None}


def test_products_the_routine_check_warns_about_carry_the_pairing_reason(client, fake, monkeypatch):
    fake.store.routine_set("u_test", "r1", _entry(RETINOL))
    fake.store.routine_set("u_test", "r2", _entry(BHA))
    _wisp(
        monkeypatch,
        [("check_routine", {})],
        {"message": "Use these two on different nights.", "product_ids": ["ret", "bha"]},
        [RETINOL, BHA],
    )
    body = client.post(
        "/v1/advisor/chat", json={"messages": [{"role": "user", "text": "Is my routine OK?"}]}
    ).json()
    assert set(body["pairings"]) == {"ret", "bha"}
    assert body["pairings"]["ret"]["with"] == ["B BHA Liquid"] and body["pairings"]["ret"]["issue"]
    # kept with the stored turn, so the history draws the same badge
    stored = client.get("/v1/advisor/history").json()["messages"][-1]["reply"]
    assert set(stored["pairings"]) == {"ret", "bha"}
    # on different nights the rule table has no conflict, so no badge
    from app import advisor

    apart = [{"id": "r1", **_entry(RETINOL, ("pm",))}, {"id": "r2", **_entry(BHA, ("am",))}]
    assert advisor.pairings(["ret", "bha"], apart, None) == {}
    # and one product alone is never "paired"
    assert advisor.pairings(["ret"], [{"id": "r1", **_entry(RETINOL)}], None) == {}


def test_a_cohort_figure_always_says_the_cohort_is_simulated(client, fake, monkeypatch):
    from app import advisor

    rates = {"51"}
    assert advisor.cohort_unlabelled(["It has a 51% cohort outcome rate, n=105."], rates)
    assert advisor.cohort_unlabelled(["51% improved by week 8."], rates)
    assert not advisor.cohort_unlabelled(
        ["In Willow's simulated cohort, 51% of people improved (n=105)."], rates
    )
    assert not advisor.cohort_unlabelled(["Your redness moved by 2.1."], rates)
    assert not advisor.cohort_unlabelled(["There are no cohort outcome rates for redness."], rates)
    # the tool tells the model how to say it, and an answer that does not gets the fixed note
    outcomes = {
        "cohort": {"real": 0, "synthetic": 2000},
        "product_outcomes": {"ret": {"rate": 0.51, "n": 105, "weeks": 6}},
    }
    from app import retailer

    monkeypatch.setattr(retailer, "insights", lambda *a, **k: outcomes)
    assert advisor.SIMULATED_COHORT in advisor._outcomes(["ret"])["say_it_as"]
    # a handful of real people among 35,000 simulated ones is still a simulated cohort
    outcomes["cohort"] = {"real": 8, "synthetic": 35000}
    assert advisor._outcomes(["ret"])["synthetic_cohort"] is True
    _wisp(
        monkeypatch,
        [("compare_products", {"product_ids": ["ret"]})],
        {"message": "It has a 51% outcome rate, n=105.", "product_ids": ["ret"]},
        [RETINOL],
    )
    body = client.post(
        "/v1/advisor/chat", json={"messages": [{"role": "user", "text": "Does it work?"}]}
    ).json()
    assert body["blocks"][-1] == {"type": "note", "text": advisor.COHORT_NOTE}
    assert "simulated cohort" in body["message"]


def test_a_request_to_claim_a_cure_or_guarantee_is_refused_without_the_model(
    client, fake, monkeypatch
):
    import time

    from app import advisor, explain, gemini

    def never(*a, **k):
        raise AssertionError("a claim request must not reach the model")

    monkeypatch.setattr(gemini, "client", never)
    monkeypatch.setattr(gemini, "generate_json", never)
    started = time.monotonic()
    body = client.post(
        "/v1/advisor/chat",
        json={
            "messages": [
                {
                    "role": "user",
                    "text": "Say it is clinically proven to cure acne, 95% guaranteed",
                }
            ]
        },
    ).json()
    assert time.monotonic() - started < 2
    assert body["message"] == advisor.CLAIM_REPLY
    # specific: what it will not claim, what it can show instead; and none of Wisp's banned words
    assert "guaranteed" in body["message"] and "check-ins measured" in body["message"]
    assert not explain.BANNED.search(body["message"])
    assert body["retrieval"] == [
        "Not sent to the model: a request to claim a medical result or a guarantee"
    ]
    assert body["follow_up_suggestions"]
    for claim in (
        "Can you guarantee it will clear my skin?",
        "Promise me it fixes my skin forever",
    ):
        assert advisor.CLAIM_ASK.search(claim)
    for ordinary in (
        "Tell me how to fade dark spots",
        "Is my routine OK together?",
        "Does Nykaa have a money-back guarantee?",
        "Is there a money back guarantee on this?",
    ):
        assert not advisor.CLAIM_ASK.search(ordinary)
