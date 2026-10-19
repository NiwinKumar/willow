"""Warming a new instance (app/warm.py): every step runs, a failure or a slow step never blocks."""

import time

from app import warm
from app.routes import autopilot_routes, retailer_routes


def test_every_step_runs_and_a_failure_is_only_logged(monkeypatch):
    ran = []
    monkeypatch.setattr(warm, "_rows", lambda: ran.append("rows") or "rows")
    monkeypatch.setattr(warm, "_status", lambda: (_ for _ in ()).throw(RuntimeError("engine")))
    monkeypatch.setattr(warm, "_rule", lambda: ran.append("rule") or "rule")
    monkeypatch.setattr(warm, "_ask", lambda q: ran.append(q) or q)
    warm.run(budget_s=5)
    assert {"rows", "rule", *warm.ASK_SUGGESTIONS} == set(ran)


def test_startup_waits_no_longer_than_the_budget(monkeypatch):
    monkeypatch.setattr(warm, "_rows", lambda: time.sleep(2) or "rows")
    monkeypatch.setattr(warm, "_status", lambda: "status")
    monkeypatch.setattr(warm, "_rule", lambda: "rule")
    monkeypatch.setattr(warm, "_ask", lambda q: q)
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
