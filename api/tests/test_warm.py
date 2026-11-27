"""Warming a new instance (app/warm.py): every step runs, a failure or a slow step never blocks."""

import time
from datetime import UTC, datetime

from app import demo, store, warm
from app.routes import autopilot_routes, demo_routes, retailer_routes


def test_every_step_runs_and_a_failure_is_only_logged(monkeypatch):
    ran = []
    monkeypatch.setattr(warm, "_rows", lambda: ran.append("rows") or "rows")
    monkeypatch.setattr(warm, "_status", lambda: (_ for _ in ()).throw(RuntimeError("engine")))
    monkeypatch.setattr(warm, "_rule", lambda: ran.append("rule") or "rule")
    monkeypatch.setattr(warm, "_ask", lambda q: ran.append(q) or q)
    monkeypatch.setattr(warm, "_demo", lambda: ran.append("demo") or "demo")
    monkeypatch.setattr(warm, "_demo_check", lambda: ran.append("check") or "check")
    warm.run(budget_s=5)
    assert {"rows", "rule", "demo", "check", *warm.ASK_SUGGESTIONS} == set(ran)


def test_startup_waits_no_longer_than_the_budget(monkeypatch):
    monkeypatch.setattr(warm, "_rows", lambda: time.sleep(2) or "rows")
    monkeypatch.setattr(warm, "_status", lambda: "status")
    monkeypatch.setattr(warm, "_rule", lambda: "rule")
    monkeypatch.setattr(warm, "_ask", lambda q: q)
    monkeypatch.setattr(warm, "_demo", lambda: "demo")
    monkeypatch.setattr(warm, "_demo_check", lambda: "check")
    started = time.monotonic()
    warm.run(budget_s=0.2)
    assert time.monotonic() - started < 1


def test_a_warmed_answer_is_kept_and_a_refusal_is_not(monkeypatch):
    monkeypatch.setattr(retailer_routes, "_ask_inputs", lambda c, r: {})
    monkeypatch.setattr(retailer_routes, "_data_version", lambda: 1)
    monkeypatch.setattr(retailer_routes.retailer_ask, "ask", lambda q, d: {"answer": "ok"})
    assert retailer_routes.warm_answer("Where is demand growing fastest?")
    key = ("where is demand growing fastest?", "mixed", "all", 1)
    assert retailer_routes._answers[key][1] == {"answer": "ok"}
    monkeypatch.setattr(retailer_routes.retailer_ask, "ask", lambda q, d: {"refused": True})
    assert not retailer_routes.warm_answer("Which users changed the most?")


def test_a_warmed_rule_reading_is_kept(monkeypatch):
    read = {"rule": {}, "missed": [], "source": "gemini", "sentence": "s"}
    monkeypatch.setattr(autopilot_routes, "_gemini_read", lambda t, w, f: read)
    assert autopilot_routes.warm_reading(*warm.JOURNEY_RULE)
    text, workspace = warm.JOURNEY_RULE
    assert autopilot_routes._parsed[(" ".join(text.lower().split()), workspace)][1] is read


def test_demo_days_cover_every_time_zones_today_and_its_yesterday():
    # 00:30 UTC on Dec 4: Hawaii is still on Dec 3 (its yesterday Dec 2), Kiribati on Dec 5
    days = warm._demo_days(datetime(2026, 12, 4, 0, 30, tzinfo=UTC))
    assert days == ["2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05"]


def test_the_demo_journey_is_read_once_at_startup_and_then_served_from_memory(
    client, fake, monkeypatch
):
    """A new instance answers Mei's journey, routine, ticks, Wisp history and routine check
    from what the warm-up read: the judge's first request reads nothing."""
    demo.clear_cache()
    monkeypatch.setattr(store, "get_store", lambda: fake.store)
    warm._demo()
    warm._demo_check()

    def unread(*args):
        raise AssertionError("read again instead of served from the warm-up")

    monkeypatch.setattr(demo_routes, "list_views", unread)
    monkeypatch.setattr(fake.store, "routine_list", unread)
    monkeypatch.setattr(fake.store, "advisor_list", unread)
    anon = {"X-Dev-Uid": ""}
    today = warm._demo_days()[2]
    assert client.get("/v1/demo/journey", headers=anon).status_code == 200
    assert client.get(f"/v1/demo/routine?today={today}", headers=anon).status_code == 200
    log = client.get(f"/v1/demo/routine/log?from={today}&to={today}", headers=anon)
    assert log.status_code == 200
    assert client.get("/v1/demo/advisor/history", headers=anon).status_code == 200
    assert client.get("/v1/demo/routine/check", headers=anon).status_code == 200
    demo.clear_cache()
