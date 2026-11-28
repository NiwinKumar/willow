"""The line in front of the engine (app/engine_gate.py): off by default, oldest first, a wait that
runs out answers "in line" without failing the check-in, and a busy engine is asked again."""

import threading
import time
from datetime import UTC, datetime

import pytest

from app import engine, engine_gate


def _hold(gate: engine_gate.Gate) -> tuple[threading.Event, threading.Thread]:
    """Take the gate's only slot until the returned event is set."""
    release, entered = threading.Event(), threading.Event()

    def busy() -> str:
        entered.set()
        release.wait(5)
        return "first"

    t = threading.Thread(target=gate.call, args=(busy, 0.0, lambda p, e: None, lambda: None))
    t.start()
    assert entered.wait(2)
    return release, t


def test_off_unless_engine_slots_is_set(monkeypatch):
    monkeypatch.delenv("ENGINE_SLOTS", raising=False)
    assert engine_gate.current() is None
    monkeypatch.setenv("ENGINE_SLOTS", "0")
    assert engine_gate.current() is None
    monkeypatch.setenv("ENGINE_SLOTS", "3")
    assert engine_gate.current().slots == 3


def test_the_oldest_place_goes_first_and_waiters_see_their_place():
    gate = engine_gate.Gate(slots=1, wait_s=5, expected_s=40)
    release, holder = _hold(gate)
    order, seen = [], {}

    def waiter(name: str, since: float) -> threading.Thread:
        def run():
            gate.call(
                lambda: order.append(name),
                since,
                lambda pos, eta: seen.setdefault(name, (pos, eta)),
                lambda: None,
            )

        t = threading.Thread(target=run)
        t.start()
        return t

    late = waiter("joined later", since=200.0)
    time.sleep(0.1)
    early = waiter("asked again, joined first", since=100.0)
    time.sleep(0.1)
    release.set()
    for t in (holder, late, early):
        t.join(5)
    assert order == ["asked again, joined first", "joined later"]
    assert seen["joined later"] == (1, 40)  # first in line, about one run away
    assert seen["asked again, joined first"] == (1, 40)  # went ahead of the later one


def test_a_wait_that_runs_out_says_in_line_and_leaves_the_line():
    gate = engine_gate.Gate(slots=1, wait_s=0.2, expected_s=30)
    release, holder = _hold(gate)
    with pytest.raises(engine_gate.InLine) as caught:
        gate.call(lambda: "never", 1.0, lambda p, e: None, lambda: None)
    assert (caught.value.position, caught.value.eta_s) == (1, 30)
    release.set()
    holder.join(5)
    assert gate.snapshot() | {"avg_s": None} == {
        "slots": 1,
        "running": 0,
        "waiting": 0,
        "avg_s": None,
    }


def test_an_engine_busy_everywhere_is_asked_again(monkeypatch):
    monkeypatch.setattr(engine_gate, "BUSY_RETRY_S", 0.01)
    gate = engine_gate.Gate(slots=2, wait_s=5, expected_s=30)
    answers = [engine.EngineError("engine_timeout", "engine HTTP 429", 504, busy=True), "measured"]

    def fn():
        a = answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a

    assert gate.call(fn, 0.0, lambda p, e: None, lambda: None) == "measured"
    # a real engine error is not retried
    with pytest.raises(engine.EngineError):
        gate.call(
            lambda: (_ for _ in ()).throw(engine.EngineError("frame_unreadable", "bad")),
            0.0,
            lambda p, e: None,
            lambda: None,
        )
    assert gate.snapshot()["running"] == 0


def _session(client, fake):
    res = client.post(
        "/v1/sessions",
        json={
            "site": "face_full",
            "capture_mode": "uncalibrated",
            "n_frames": 1,
            "content_types": ["image/jpeg"],
        },
    )
    created = res.json()
    for target in created["upload_urls"]:
        fake.put(target["object_uri"].split("/", 3)[3], content_type="image/jpeg")
    return created["session_id"]


def test_still_in_line_answers_409_and_keeps_the_place_then_measures(client, fake, monkeypatch):
    monkeypatch.setenv("ENGINE_SLOTS", "1")
    monkeypatch.setenv("ENGINE_QUEUE_WAIT_S", "0.2")
    monkeypatch.setattr(engine_gate, "_gate", None)
    sid = _session(client, fake)
    gate = engine_gate.current()
    release, holder = _hold(gate)  # someone else is on the only engine slot

    res = client.post(f"/v1/sessions/{sid}/analyze")
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["code"] == "conflict"  # the web re-reads and asks again on this
    assert detail["queued"] is True and detail["position"] == 1
    doc = fake.store.session_get("u_test", sid)
    assert doc["status"] == "uploading"  # put back as it was, never "failed"
    assert doc.get("queue") is None  # the shown place left with the request
    place = doc["queue_since"]
    day = datetime.now(UTC).date().isoformat()
    assert fake.store.usage_get("u_test", day).get("analyze", 0) == 0  # not a daily analysis

    release.set()
    holder.join(5)
    res = client.post(f"/v1/sessions/{sid}/analyze")
    assert res.status_code == 200, res.text
    doc = fake.store.session_get("u_test", sid)
    assert doc["status"] == "done" and doc["queue_since"] is None
    assert place.tzinfo is not None


def test_the_session_shows_its_place_while_queued(client, fake):
    sid = _session(client, fake)
    fake.store.session_update(
        "u_test",
        sid,
        {
            "status": "processing",
            "processing_started_at": datetime.now(UTC),
            "stage": "queued",
            "queue": {"position": 3, "eta_s": 90},
        },
    )
    s = client.get(f"/v1/sessions/{sid}").json()["session"]
    assert s["stage"] == "queued"
    assert s["queue"] == {"position": 3, "eta_s": 90}


def test_startup_runs_the_old_hooks_in_order(monkeypatch):
    """The lifespan (replacing app.on_event) runs the dev seed, API_THREADS and the warm-up."""
    import anyio.to_thread
    from fastapi.testclient import TestClient

    from app import main

    ran: list[str] = []
    monkeypatch.setattr(main, "_dev_seed", lambda: ran.append("seed"))
    monkeypatch.setattr(main, "_warm", lambda: ran.append("warm"))
    monkeypatch.setenv("API_THREADS", "100")
    with TestClient(main.app) as c:
        tokens = c.portal.call(
            lambda: anyio.to_thread.current_default_thread_limiter().total_tokens
        )
    assert ran == ["seed", "warm"]
    assert tokens == 100
