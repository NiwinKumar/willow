"""One retry on a transient Gemini error (429, 503, 504), never more (Oct 19: Ask answered 503
after a single 504 DEADLINE_EXCEEDED). Since Nov 2 the retry goes to the fallback model, a slow
main model is hedged with it, and opted-in answers are kept (app/kept.py)."""

import json
import threading
from types import SimpleNamespace

import pytest
from google.genai import errors
from test_retailer_ask import INSIGHTS

from app import gemini, kept, retailer_ask
from app.gemini import generate_json as real_generate_json
from app.settings import get_settings
from app.shelf_agent import model_round as real_shelf_round

MAIN = get_settings().gemini_model
FALLBACK = get_settings().gemini_fallback_model


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
        self.models: list[str] = []
        self.configs: list = []

    def generate_content(self, **kw):
        self.calls += 1
        self.models.append(kw.get("model"))
        self.configs.append(kw.get("config"))
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


def test_a_504_then_success_is_retried_once_on_the_fallback_model(fake):
    models, sleeps = fake([DEADLINE, json.dumps({"answer": "Fine."})])
    assert ask_once().answer == "Fine."
    assert models.models == [MAIN, FALLBACK]
    assert sleeps == []  # another model: no pause
    # the fallback runs without a thinking level (much faster), the main model with one
    assert models.configs[0].thinking_config is not None
    assert models.configs[1].thinking_config is None


def test_without_a_fallback_the_main_model_is_retried_after_a_pause(fake, monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_fallback_model", "")
    models, sleeps = fake([DEADLINE, json.dumps({"answer": "Fine."})])
    assert ask_once().answer == "Fine."
    assert models.models == [MAIN, MAIN]
    assert sleeps == [0.5]


def test_a_rate_limit_waits_longer(fake, monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_fallback_model", "")
    models, sleeps = fake(
        [server_error(429, "RESOURCE_EXHAUSTED"), json.dumps({"answer": "Fine."})]
    )
    assert ask_once().answer == "Fine."
    assert sleeps == [1.5]


def test_a_schema_failure_gets_its_second_try_on_the_fallback(fake):
    models, _ = fake(["not json", json.dumps({"answer": "Fine."})])
    out = real_generate_json("t", ["q"], retailer_ask.Answer, instructions="i")
    assert out.answer == "Fine."
    assert models.models == [MAIN, FALLBACK]


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

    def flaky(model):
        calls.append(model)
        if len(calls) == 1:
            raise DEADLINE
        return "ok"

    _, sleeps = fake([])
    assert gemini.with_retry("t", flaky) == "ok"
    assert calls == [MAIN, FALLBACK] and sleeps == []

    def broken(model):
        raise ValueError("bad")

    with pytest.raises(ValueError):
        gemini.with_retry("t", broken)


def test_agent_turns_retry_too(fake):
    models, _ = fake([DEADLINE, "done"])
    calls, text, _content = real_shelf_round([], None)
    assert (calls, text, models.calls) == ([], "done", 2)


class SlowModels(FakeModels):
    """The main model hangs until released; the fallback answers at once."""

    def __init__(self, outcomes: list):
        super().__init__(outcomes)
        self.release = threading.Event()

    def generate_content(self, **kw):
        if kw.get("model") == MAIN:
            self.models.append(MAIN)
            self.release.wait(5)
            return SimpleNamespace(text=json.dumps({"answer": "Slow."}), usage_metadata=None)
        return super().generate_content(**kw)


def test_a_slow_main_model_is_hedged_with_the_fallback(monkeypatch):
    models = SlowModels([json.dumps({"answer": "Quick."})])
    monkeypatch.setattr(gemini, "client", lambda: SimpleNamespace(models=models))
    try:
        out = real_generate_json(
            "t", ["q"], retailer_ask.Answer, instructions="i", hedge_after_s=0.05
        )
    finally:
        models.release.set()
    assert out.answer == "Quick."
    assert models.models == [MAIN, FALLBACK]


def test_no_hedge_when_turned_off(monkeypatch):
    models = SlowModels([])
    monkeypatch.setattr(gemini, "client", lambda: SimpleNamespace(models=models))
    models.release.set()
    out = real_generate_json("t", ["q"], retailer_ask.Answer, instructions="i", hedge_after_s=None)
    assert out.answer == "Slow." and models.models == [MAIN]


@pytest.fixture
def keeping(monkeypatch: pytest.MonkeyPatch):
    """kept.py on, with a dict standing in for Firestore."""
    docs: dict[str, dict] = {}

    class Doc:
        def __init__(self, path: str):
            self.path = path

        def get(self):
            d = docs.get(self.path)
            return SimpleNamespace(exists=d is not None, to_dict=lambda: d)

        def set(self, d):
            docs[self.path] = d

    monkeypatch.setattr(get_settings(), "keep_gemini_answers", True)
    monkeypatch.setattr(kept.gcp, "firestore_client", lambda: SimpleNamespace(document=Doc))
    kept.clear_memory()
    yield docs
    kept.clear_memory()


def test_a_kept_answer_is_reused_across_instances(fake, keeping):
    models, _ = fake([json.dumps({"answer": "Once."})])
    first = real_generate_json("t", ["q"], retailer_ask.Answer, instructions="i", keep=True)
    kept.clear_memory()  # a fresh instance: only Firestore has it
    again = real_generate_json("t", ["q"], retailer_ask.Answer, instructions="i", keep=True)
    assert first.answer == again.answer == "Once."
    assert models.calls == 1 and len(keeping) == 1


def test_other_inputs_are_not_answered_from_a_kept_answer(fake, keeping):
    models, _ = fake([json.dumps({"answer": "A."}), json.dumps({"answer": "B."})])
    a = real_generate_json("t", ["q1"], retailer_ask.Answer, instructions="i", keep=True)
    b = real_generate_json("t", ["q2"], retailer_ask.Answer, instructions="i", keep=True)
    assert (a.answer, b.answer, models.calls) == ("A.", "B.", 2)


def test_answers_are_kept_only_when_asked(fake, keeping):
    models, _ = fake([json.dumps({"answer": "A."}), json.dumps({"answer": "A."})])
    real_generate_json("t", ["q"], retailer_ask.Answer, instructions="i")
    real_generate_json("t", ["q"], retailer_ask.Answer, instructions="i")
    assert models.calls == 2 and keeping == {}


def test_an_unreadable_store_falls_back_to_gemini(fake, keeping, monkeypatch):
    def broken():
        raise RuntimeError("firestore down")

    monkeypatch.setattr(kept.gcp, "firestore_client", broken)
    models, _ = fake([json.dumps({"answer": "Live."})])
    out = real_generate_json("t", ["q"], retailer_ask.Answer, instructions="i", keep=True)
    assert out.answer == "Live." and models.calls == 1
