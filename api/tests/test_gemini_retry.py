"""One retry on a transient Gemini error (429, 503, 504), never more (Oct 19: Ask answered 503
after a single 504 DEADLINE_EXCEEDED)."""

import json
from types import SimpleNamespace

import pytest
from google.genai import errors
from test_retailer_ask import INSIGHTS

from app import gemini, retailer_ask
from app.gemini import generate_json as real_generate_json
from app.shelf_agent import model_round as real_shelf_round


def server_error(code: int, status: str) -> errors.APIError:
    body = {"error": {"code": code, "message": "Deadline expired", "status": status}}
    return (errors.ClientError if code < 500 else errors.ServerError)(code, body)


DEADLINE = server_error(504, "DEADLINE_EXCEEDED")


class FakeModels:
    """Each generate_content call takes the next outcome: an exception is raised, text is the
    reply."""

    def __init__(self, outcomes: list):
        self.outcomes = list(outcomes)
        self.calls = 0

    def generate_content(self, **kw):
        self.calls += 1
        out = self.outcomes.pop(0)
        if isinstance(out, Exception):
            raise out
        return SimpleNamespace(text=out, usage_metadata=None, function_calls=None, candidates=[])


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch):
    sleeps: list[float] = []
    monkeypatch.setattr(gemini.time, "sleep", sleeps.append)

    def install(outcomes: list) -> tuple[FakeModels, list[float]]:
        models = FakeModels(outcomes)
        monkeypatch.setattr(gemini, "client", lambda: SimpleNamespace(models=models))
        return models, sleeps

    return install


def ask_once(**kw):
    return real_generate_json("t", ["q"], retailer_ask.Answer, instructions="i", attempts=1, **kw)


def test_a_504_then_success_is_retried_once(fake):
    models, sleeps = fake([DEADLINE, json.dumps({"answer": "Fine."})])
    assert ask_once().answer == "Fine."
    assert models.calls == 2
    assert sleeps == [0.5]


def test_a_rate_limit_waits_longer(fake):
    models, sleeps = fake(
        [server_error(429, "RESOURCE_EXHAUSTED"), json.dumps({"answer": "Fine."})]
    )
    assert ask_once().answer == "Fine."
    assert sleeps == [1.5]


def test_only_one_retry(fake):
    models, _ = fake([DEADLINE, server_error(503, "UNAVAILABLE"), json.dumps({"answer": "x"})])
    with pytest.raises(gemini.GeminiError):
        ask_once()
    assert models.calls == 2


def test_two_attempts_stay_two(fake):
    models, _ = fake([DEADLINE, DEADLINE, json.dumps({"answer": "x"})])
    with pytest.raises(gemini.GeminiError):
        real_generate_json("t", ["q"], retailer_ask.Answer, instructions="i")
    assert models.calls == 2


def test_other_errors_are_not_retried(fake):
    models, _ = fake([server_error(400, "INVALID_ARGUMENT"), json.dumps({"answer": "x"})])
    with pytest.raises(gemini.GeminiError):
        ask_once()
    assert models.calls == 1


def test_a_failure_that_took_too_long_is_not_retried(fake, monkeypatch):
    monkeypatch.setattr(gemini, "RETRY_WITHIN_S", -1.0)
    models, _ = fake([DEADLINE, json.dumps({"answer": "x"})])
    with pytest.raises(gemini.GeminiError):
        ask_once()
    assert models.calls == 1


def test_ask_survives_one_deadline_exceeded(fake, monkeypatch):
    monkeypatch.setattr(gemini, "generate_json", real_generate_json)
    reply = {"answer": "Azelaic Gel reached 61% (synthetic cohort).", "follow_ups": []}
    models, _ = fake([DEADLINE, json.dumps(reply)])
    out = retailer_ask.ask("Which works best?", INSIGHTS)
    assert out["answer"] == reply["answer"]
    assert out["checks"]["rejected_attempts"] == 0
    assert models.calls == 2


def test_ask_still_unavailable_after_two_deadlines(fake, monkeypatch):
    monkeypatch.setattr(gemini, "generate_json", real_generate_json)
    models, _ = fake([DEADLINE, DEADLINE])
    with pytest.raises(retailer_ask.Unavailable):
        retailer_ask.ask("Which works best?", INSIGHTS)
    assert models.calls == 2


def test_with_retry(fake):
    calls = []

    def flaky():
        calls.append(1)
        if len(calls) == 1:
            raise DEADLINE
        return "ok"

    _, sleeps = fake([])
    assert gemini.with_retry("t", flaky) == "ok"
    assert len(calls) == 2 and sleeps == [0.5]

    def broken():
        raise ValueError("bad")

    with pytest.raises(ValueError):
        gemini.with_retry("t", broken)


def test_agent_turns_retry_too(fake):
    models, _ = fake([DEADLINE, "done"])
    calls, text, _content = real_shelf_round([], None)
    assert (calls, text, models.calls) == ([], "done", 2)
