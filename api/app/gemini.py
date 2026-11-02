"""Gemini on Vertex AI (docs/GEMINI_SPEC.md).

Every call: the global system rules, JSON output against a pydantic schema, low thinking, a
generous token cap (thinking tokens count against it), then the caller's deterministic fallback.
Speed and reliability (Nov 2, judging and the finale):
- a second, faster model (GEMINI_FALLBACK_MODEL) takes the second try after a schema failure or a
  transient error (429, 503, 504, a timeout), instead of the same overloaded model again;
- a hedge: when the main model has not answered in HEDGE_AFTER_S, the fallback model is asked
  too and the first valid answer wins, so a slow call costs seconds, not 25;
- kept answers (app/kept.py): callers that opt in get a repeat answered from Firestore.
At most two model calls per request. Logs prompt id, model, latency and token counts only (no
images, no PII).
"""

import json
import logging
import threading
import time
from collections.abc import Callable
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait

from google import genai
from google.genai import errors, types
from pydantic import BaseModel, ValidationError

from app import kept
from app.settings import get_settings

log = logging.getLogger("willow.gemini")

SYSTEM_RULES = (
    "You are Willow's skincare assistant. Cosmetic guidance only, not medical advice. Never "
    "diagnose or name diseases. Never estimate or invent measurements, scores, skin tone, or age; "
    "only quote numbers given to you in the input. Never imply lighter skin is better. Be calm, "
    "inclusive, brief. If something looks concerning (changing mole, bleeding, pain), suggest "
    "seeing a dermatologist."
)


class GeminiError(Exception):
    """Gemini failed twice or could not be reached; callers fall back."""


# Worth a second try: a rate limit, an overloaded model, Vertex's own deadline (Oct 19: Ask
# answered 503 after one 504 DEADLINE_EXCEEDED; the same question worked minutes later) or a
# client-side timeout.
TRANSIENT_CODES = (429, 503, 504)
# A try that failed after this long is not repeated, so a retry adds at most one call's worth of
# waiting to a request (the 25 s per-call policy).
RETRY_WITHIN_S = 25.0
# The main model answers a small prompt in about 4 s (Nov 2, measured from the laptop and in the
# logs); past this it is having a slow moment and the fallback model is asked as well.
HEDGE_AFTER_S = 7.0
DEFAULT_TIMEOUT_S = 25.0

# Model calls that run beside the request thread (the hedge). Late losers finish here on their own.
_pool = ThreadPoolExecutor(max_workers=32, thread_name_prefix="gemini")


def transient(exc: BaseException) -> bool:
    if isinstance(exc, errors.APIError):
        return exc.code in TRANSIENT_CODES
    return isinstance(exc, TimeoutError) or "timeout" in type(exc).__name__.lower()


def retry_pause(exc: BaseException) -> float:
    """Seconds to wait before the retry: a rate limit needs a moment, an overload or a deadline
    barely any."""
    return 1.5 if isinstance(exc, errors.APIError) and exc.code == 429 else 0.5


def models() -> list[str]:
    """The main model, then the fallback model when one is set."""
    s = get_settings()
    out = [s.gemini_model]
    if s.gemini_fallback_model and s.gemini_fallback_model != s.gemini_model:
        out.append(s.gemini_fallback_model)
    return out


def config_for(model: str, config: types.GenerateContentConfig) -> types.GenerateContentConfig:
    """`config` for `model`: the fallback model runs without a thinking level (with LOW it takes
    about 6 s instead of about 1.3 s, Nov 2)."""
    if model == get_settings().gemini_model or config is None or config.thinking_config is None:
        return config
    return config.model_copy(update={"thinking_config": None})


def second_try(exc: BaseException) -> tuple[str, float]:
    """(model, pause) for the second try: the fallback model at once, or the main one after the
    usual pause when there is no fallback."""
    ms = models()
    return (ms[1], 0.0) if len(ms) > 1 else (ms[0], retry_pause(exc))


def with_retry[R](
    prompt_id: str, call: Callable[[str], R], hedge_after_s: float | None = HEDGE_AFTER_S
) -> R:
    """`call(model)` on the main model. When it fails with a transient error that came back
    within RETRY_WITHIN_S it is tried once more on the fallback model; when it is still out after
    `hedge_after_s` the fallback model is asked too and the first answer wins. For the
    tool-calling turns, which call the client directly; build the request config with
    config_for(model, ...)."""
    ms = models()
    started = time.monotonic()
    first: Future = _pool.submit(call, ms[0])
    hedge = hedge_after_s is not None and len(ms) > 1
    finished, _ = wait([first], timeout=hedge_after_s if hedge else None)
    if not finished:
        log.info(json.dumps({"prompt_id": prompt_id, "hedged_after_s": hedge_after_s}))
        pending = {first, _pool.submit(call, ms[1])}
        error: BaseException | None = None
        while pending:
            finished, pending = wait(pending, return_when=FIRST_COMPLETED)
            for f in finished:
                if f.exception() is None:
                    return f.result()
                error = f.exception()
        assert error is not None
        raise error
    exc = first.exception()
    if exc is None:
        return first.result()
    if not transient(exc) or time.monotonic() - started > RETRY_WITHIN_S:
        raise exc
    model, pause = second_try(exc)
    log.warning(
        "gemini %s attempt 1 failed, retrying on %s: %s: %s",
        prompt_id,
        model,
        type(exc).__name__,
        str(exc)[:300],
    )
    if pause:
        time.sleep(pause)
    return call(model)


_client: genai.Client | None = None
_client_lock = threading.Lock()


def client() -> genai.Client:
    """One shared client, created under a lock. Without it, parallel first calls (explanation and
    spot labels run together) each built a client, and the one nobody kept was closed mid-request
    ("Cannot send a request, as the client has been closed")."""
    global _client
    with _client_lock:
        if _client is None:
            s = get_settings()
            # 25 s per request by default: a slow Gemini call falls back to deterministic output
            # instead of holding up an analysis or a chat reply.
            _client = genai.Client(
                vertexai=True,
                project=s.project_id,
                location=s.vertex_location,
                http_options=types.HttpOptions(timeout=round(DEFAULT_TIMEOUT_S * 1000)),
            )
        return _client


def generate_json[T: BaseModel](
    prompt_id: str,
    contents: list[types.Part | str],
    schema: type[T],
    *,
    instructions: str,
    temperature: float = 0.0,
    max_output_tokens: int = 4096,
    thinking: types.ThinkingLevel = types.ThinkingLevel.LOW,
    attempts: int = 2,
    timeout_ms: int | None = None,
    keep: bool | Callable[[T], bool] = False,
    hedge_after_s: float | None = HEDGE_AFTER_S,
) -> T:
    """A schema-checked answer. `attempts`: 2 gives a schema failure a second try; with 1 only a
    transient error gets one (both on the fallback model). `timeout_ms`: the whole call's
    deadline (default 25 s). `keep`: answer a repeat from app/kept.py and keep a new answer (when
    a check is given, only an answer it accepts: the caller's own validators, so a rejected answer
    is never handed back); only for inputs that are aggregates, products or sample photos.
    `hedge_after_s`: when to ask the fallback model too (None: never)."""
    system = f"{SYSTEM_RULES}\n\n{instructions}"
    ms = models()
    kept_key = None
    if keep and kept.enabled():
        kept_key = kept.key(prompt_id, ms[0], system, schema, temperature, contents)
        text = kept.get(kept_key)
        if text is not None:
            try:
                out = schema.model_validate_json(text)
                log.info(json.dumps({"prompt_id": prompt_id, "kept": True}))
                return out
            except ValidationError:
                pass  # the schema changed since: ask again
    total_s = timeout_ms / 1000 if timeout_ms else DEFAULT_TIMEOUT_S
    started = time.monotonic()
    deadline = started + total_s
    config = types.GenerateContentConfig(
        system_instruction=system,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        response_mime_type="application/json",
        response_schema=schema,
        thinking_config=types.ThinkingConfig(thinking_level=thinking),
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )

    def ask(attempt: int, model: str) -> tuple[T, str]:
        left_ms = max(1_000, round((deadline - time.monotonic()) * 1000))
        cfg = config_for(model, config).model_copy(
            update={"http_options": types.HttpOptions(timeout=left_ms)}
        )
        t0 = time.monotonic()
        try:
            res = client().models.generate_content(model=model, contents=contents, config=cfg)
        except Exception as exc:  # network, quota, safety block
            log.warning(
                "gemini %s attempt %d (%s) failed: %s: %s",
                prompt_id,
                attempt,
                model,
                type(exc).__name__,
                str(exc)[:300],
            )
            raise
        usage = res.usage_metadata
        log.info(
            json.dumps(
                {
                    "prompt_id": prompt_id,
                    "attempt": attempt,
                    "model": model,
                    "latency_ms": round((time.monotonic() - t0) * 1000),
                    "input_tokens": getattr(usage, "prompt_token_count", None),
                    "output_tokens": getattr(usage, "candidates_token_count", None),
                    "thinking_tokens": getattr(usage, "thoughts_token_count", None),
                }
            )
        )
        text = res.text or ""
        try:
            return schema.model_validate_json(text), text
        except ValidationError:
            log.warning("gemini %s attempt %d: schema validation failed", prompt_id, attempt)
            raise

    def done(out: tuple[T, str]) -> T:
        if kept_key and (keep is True or (callable(keep) and keep(out[0]))):
            kept.put(kept_key, prompt_id, out[1])
        return out[0]

    first: Future = _pool.submit(ask, 1, ms[0])
    hedge = hedge_after_s is not None and len(ms) > 1 and hedge_after_s < total_s
    finished, _ = wait([first], timeout=hedge_after_s if hedge else total_s)
    if not finished and hedge:
        # Slow: ask the fallback model as well; the first valid answer wins.
        log.info(json.dumps({"prompt_id": prompt_id, "hedged_after_s": hedge_after_s}))
        pending = {first, _pool.submit(ask, 2, ms[1])}
        last_error: BaseException | None = None
        while pending:
            finished, pending = wait(
                pending, timeout=max(0.0, deadline - time.monotonic()), return_when=FIRST_COMPLETED
            )
            if not finished:
                break
            for f in finished:
                if f.exception() is None:
                    return done(f.result())
                last_error = f.exception()
        raise GeminiError(f"{prompt_id}: {last_error or 'no answer in time'}")
    if not finished:
        raise GeminiError(f"{prompt_id}: no answer in {total_s:.0f} s")
    exc = first.exception()
    if exc is None:
        return done(first.result())
    retry = (isinstance(exc, ValidationError) and attempts >= 2) or (
        transient(exc) and time.monotonic() - started <= RETRY_WITHIN_S
    )
    if not retry or deadline - time.monotonic() < 1.0:
        raise GeminiError(f"{prompt_id}: {exc}")
    model, pause = second_try(exc)
    if pause:
        time.sleep(pause)
    try:
        return done(ask(2, model))
    except Exception as exc2:
        raise GeminiError(f"{prompt_id}: {exc2}") from exc2
