"""Gemini on Vertex AI (docs/GEMINI_SPEC.md).

Every call: the global system rules, JSON output against a pydantic schema, low thinking, a
generous token cap (thinking tokens count against it), one retry on a schema failure or a
transient error (429, 503, 504), then the caller's deterministic fallback. Logs prompt id,
latency and token counts only (no images, no PII).
"""

import json
import logging
import threading
import time
from collections.abc import Callable

from google import genai
from google.genai import errors, types
from pydantic import BaseModel, ValidationError

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


# Worth one more try: a rate limit, an overloaded model, or Vertex's own deadline (Oct 19: Ask
# answered 503 after one 504 DEADLINE_EXCEEDED; the same question worked minutes later).
TRANSIENT_CODES = (429, 503, 504)
# A try that failed after this long is not repeated, so a retry adds at most one call's worth of
# waiting to a request (the 25 s per-call policy).
RETRY_WITHIN_S = 25.0


def transient(exc: BaseException) -> bool:
    return isinstance(exc, errors.APIError) and exc.code in TRANSIENT_CODES


def retry_pause(exc: BaseException) -> float:
    """Seconds to wait before the retry: a rate limit needs a moment, an overload or a deadline
    barely any."""
    return 1.5 if isinstance(exc, errors.APIError) and exc.code == 429 else 0.5


def with_retry[R](prompt_id: str, call: Callable[[], R]) -> R:
    """`call()`, tried once more after a short pause when it fails with a transient error that
    came back within RETRY_WITHIN_S. For the tool-calling turns, which call the client directly;
    generate_json does the same inside its own attempts."""
    started = time.monotonic()
    try:
        return call()
    except Exception as exc:
        if not transient(exc) or time.monotonic() - started > RETRY_WITHIN_S:
            raise
        log.warning(
            "gemini %s attempt 1 failed, retrying: %s: %s",
            prompt_id,
            type(exc).__name__,
            str(exc)[:300],
        )
        time.sleep(retry_pause(exc))
    return call()


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
                http_options=types.HttpOptions(timeout=25_000),
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
) -> T:
    config = types.GenerateContentConfig(
        # A per-call deadline for prompts with large inputs (the client default is 25 s).
        http_options=types.HttpOptions(timeout=timeout_ms) if timeout_ms else None,
        system_instruction=f"{SYSTEM_RULES}\n\n{instructions}",
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        response_mime_type="application/json",
        response_schema=schema,
        thinking_config=types.ThinkingConfig(thinking_level=thinking),
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    last_error: Exception | None = None
    tries = attempts
    attempt = 0
    while attempt < tries:
        attempt += 1
        started = time.monotonic()
        try:
            res = client().models.generate_content(
                model=get_settings().gemini_model, contents=contents, config=config
            )
        except Exception as exc:  # network, quota, safety block
            last_error = exc
            log.warning(
                "gemini %s attempt %d failed: %s: %s",
                prompt_id,
                attempt,
                type(exc).__name__,
                str(exc)[:300],
            )
            if transient(exc) and time.monotonic() - started <= RETRY_WITHIN_S:
                # A single-attempt call still gets one retry on a transient error (never more:
                # a request waits at most one extra call).
                tries = max(tries, 2)
                if attempt < tries:
                    time.sleep(retry_pause(exc))
            continue
        usage = res.usage_metadata
        log.info(
            json.dumps(
                {
                    "prompt_id": prompt_id,
                    "attempt": attempt,
                    "latency_ms": round((time.monotonic() - started) * 1000),
                    "input_tokens": getattr(usage, "prompt_token_count", None),
                    "output_tokens": getattr(usage, "candidates_token_count", None),
                    "thinking_tokens": getattr(usage, "thoughts_token_count", None),
                }
            )
        )
        try:
            return schema.model_validate_json(res.text or "")
        except ValidationError as exc:
            last_error = exc
            log.warning("gemini %s attempt %d: schema validation failed", prompt_id, attempt)
    raise GeminiError(f"{prompt_id}: {last_error}")
