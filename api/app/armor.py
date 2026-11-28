"""Model Armor screening for Wisp (finals B8, Nov 28).

Every question typed or spoken to Wisp is screened by Google Cloud Model Armor before Gemini sees
it: prompt injection and jailbreak attempts, and malicious links, are refused with a fixed reply.
Wisp's own validators still check every answer after Gemini (numbers, wording); this guards the
input side.

Off until configured: with `MODEL_ARMOR_TEMPLATE` unset nothing is called. When Model Armor
itself fails or is slow, the question goes through (fail open, logged): Wisp's answer checks
still apply, and a screening outage must not take the advisor down.
"""

import logging
import time

import google.auth
from google.auth.transport.requests import AuthorizedSession

from app.settings import get_settings

log = logging.getLogger("willow.armor")

TIMEOUT_S = 4.0
REFUSAL = (
    "I can only help with your skin, your routine and the products in Willow. "
    "Ask me about a result, a product or an ingredient."
)
_session: AuthorizedSession | None = None


def enabled() -> bool:
    return bool(get_settings().model_armor_template)


def _client() -> AuthorizedSession:
    global _session
    if _session is None:
        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        _session = AuthorizedSession(creds)
    return _session


def blocked(text: str) -> bool:
    """True when Model Armor finds a prompt injection, jailbreak or malicious link in `text`."""
    s = get_settings()
    if not s.model_armor_template or not text.strip():
        return False
    loc = s.model_armor_location
    url = (
        f"https://modelarmor.{loc}.rep.googleapis.com/v1/projects/{s.project_id}/locations/{loc}"
        f"/templates/{s.model_armor_template}:sanitizeUserPrompt"
    )
    t0 = time.monotonic()
    try:
        res = _client().post(url, json={"userPromptData": {"text": text[:4000]}}, timeout=TIMEOUT_S)
        res.raise_for_status()
        state = res.json().get("sanitizationResult", {}).get("filterMatchState")
    except Exception as exc:  # unavailable or slow: answer checks still apply
        log.warning("model armor unavailable (%s): question allowed", type(exc).__name__)
        return False
    log.info('{"armor_ms": %d, "match": "%s"}', round((time.monotonic() - t0) * 1000), state)
    return state == "MATCH_FOUND"
