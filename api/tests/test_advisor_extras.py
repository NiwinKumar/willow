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
        "checking_numbers",
        "done",
    ]
    assert events[1][1]["step"] == "tools" and events[2][1]["step"] == "reply"
    assert events[2][1]["retrieval"] == ["Checked your routine against the rule table"]
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
    assert std["session_id"] == "s1" and std["explanation"]["headline"] == "Your first reading"
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
