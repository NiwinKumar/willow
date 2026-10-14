"""Gemini on Vertex AI (docs/GEMINI_SPEC.md).

Every call: the global system rules, JSON output against a pydantic schema, low thinking, a
generous token cap (thinking tokens count against it), one retry on a schema failure, then the
caller's deterministic fallback. Logs prompt id, latency and token counts only (no images, no PII).
"""

import json
import logging
import threading
import time

from google import genai
from google.genai import types
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
) -> T:
    config = types.GenerateContentConfig(
        system_instruction=f"{SYSTEM_RULES}\n\n{instructions}",
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        response_mime_type="application/json",
        response_schema=schema,
        thinking_config=types.ThinkingConfig(thinking_level=thinking),
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
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
