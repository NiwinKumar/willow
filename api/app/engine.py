"""Engine client (CONTRACT.md section 2).

ENGINE_MODE=fixture answers locally from the contract fixture so the whole product flow runs
before the real engine is deployed. It never pretends to measure: the engine_version ends in
"-fixture" and a warning says the numbers are a sample. ENGINE_MODE=http calls the private
Cloud Run engine with an ID token.
"""

import copy
import hashlib
from typing import Any

import httpx

from app import contract
from app.settings import get_settings

# Cheek close-ups can take over two minutes on the engine (2 CPU); the engine's Cloud Run timeout is
# 300 s and the api's own is 300 s, so wait 280 s and still answer before the api is cut off.
ENGINE_TIMEOUT_S = 280.0
FIXTURE_WARNING = (
    "Sample result from the fixture engine: these numbers are not measured from your photos."
)

# CONTRACT.md 2.5: which metrics each site reports.
SITE_METRICS: dict[str, tuple[str, ...]] = {
    "face_full": (
        "tone_ita",
        "pigment_spots",
        "tone_evenness",
        "redness",
        "blemishes",
        "lines",
        "dark_circles",
        "shine",
        "glow",
    ),
    **{
        site: ("tone_ita", "pigment_spots", "redness", "blemishes", "pores", "texture")
        for site in (
            "cheek_macro",
            "left_cheek_macro",
            "right_cheek_macro",
            "forehead_macro",
            "chin_macro",
        )
    },
    "nose_macro": ("blemishes", "pores"),
    "forearm_treated": ("tone_ita", "redness"),
    "forearm_control": ("tone_ita", "redness"),
}

# Macro-only metrics are missing from the face fixture; the fixture engine adds these.
_FIXTURE_EXTRA_METRICS: list[dict[str, Any]] = [
    {
        "id": "pores",
        "group": "texture_pores",
        "label": "Pores",
        "value": 38.0,
        "unit": "per_cm2",
        "confidence": "measured",
        "within_session_sd": 1.1,
        "mdc95": 3.05,
        "delta": None,
        "verdict": "no_baseline",
        "direction": "none",
        "extras": {"mean_diameter_mm": 0.21},
    },
    {
        "id": "texture",
        "group": "texture_pores",
        "label": "Texture",
        "value": 0.42,
        "unit": "index",
        "confidence": "measured",
        "within_session_sd": 0.02,
        "mdc95": 0.06,
        "delta": None,
        "verdict": "no_baseline",
        "direction": "none",
        "extras": {},
    },
]


class EngineError(Exception):
    def __init__(self, code: str, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status

    @property
    def public_message(self) -> str:
        """What a person may read: never the engine's own text (exception names, HTML error
        pages, gs:// paths with a uid). The detail stays in the logs."""
        return PUBLIC_MESSAGES.get(self.code, GENERIC_MESSAGE)


GENERIC_MESSAGE = "Something went wrong while measuring. Your photos are safe; try again."
PUBLIC_MESSAGES = {
    "engine_timeout": "The measurement took too long. Your photos are safe; try again.",
    "engine_unreachable": "The measurement service did not answer. Your photos are safe; try "
    "again.",
    "frame_unreadable": "One of the files could not be read. Check that it is the original DNG, "
    "JPEG or HEIC.",
    "unsupported_format": "One of the files is in a format Willow cannot read.",
}


def analyze(request: dict[str, Any]) -> dict[str, Any]:
    problems = contract.errors("analyze_request.schema.json", request)
    if problems:
        raise EngineError("bad_request", f"AnalyzeRequest invalid: {problems[0]}", status=500)
    if get_settings().engine_mode == "fixture":
        result = fixture_result(request)
    else:
        result = _http_analyze(request)
    problems = contract.errors("analysis_result.schema.json", result)
    if problems:
        raise EngineError("bad_engine_response", f"AnalysisResult invalid: {problems[0]}")
    return result


def _http_analyze(request: dict[str, Any]) -> dict[str, Any]:
    url = get_settings().engine_url
    if not url:
        raise EngineError("engine_unconfigured", "ENGINE_URL is not set", status=500)
    headers = {}
    if not url.startswith(("http://localhost", "http://127.0.0.1")):
        headers["Authorization"] = f"Bearer {_id_token(url)}"
    try:
        res = httpx.post(
            f"{url.rstrip('/')}/v1/analyze", json=request, headers=headers, timeout=ENGINE_TIMEOUT_S
        )
    except httpx.TimeoutException as exc:
        raise EngineError("engine_timeout", "The engine did not answer in time", 504) from exc
    except httpx.HTTPError as exc:
        raise EngineError("engine_unreachable", str(exc)) from exc
    if res.status_code in (429, 503, 504):
        # every engine instance busy (concurrency 1, max 3), or Cloud Run's own timeout: the
        # answer is not the engine's JSON; say "took too long", which invites a retry
        raise EngineError("engine_timeout", f"engine HTTP {res.status_code}", 504)
    if res.status_code >= 400:
        try:
            err = res.json().get("error", {})
        except ValueError:
            err = {}
        raise EngineError(err.get("code", "internal"), err.get("message", res.text[:300]))
    return res.json()


# A cold engine takes about 35 s to answer (Cloud Run starts the container, then the models
# load): the status check waits that long, so a sleeping engine reads as "waking", not down.
HEALTH_TIMEOUT_S = 45.0


def health(timeout: float = HEALTH_TIMEOUT_S) -> dict[str, Any]:
    """The engine's /v1/health, for the status panel. Fixture mode answers locally."""
    if get_settings().engine_mode == "fixture":
        return {"status": "ok", "engine_version": "fixture"}
    url = get_settings().engine_url
    if not url:
        raise EngineError("engine_unconfigured", "ENGINE_URL is not set", status=500)
    headers = {}
    if not url.startswith(("http://localhost", "http://127.0.0.1")):
        headers["Authorization"] = f"Bearer {_id_token(url)}"
    try:
        res = httpx.get(f"{url.rstrip('/')}/v1/health", headers=headers, timeout=timeout)
        res.raise_for_status()
    except httpx.TimeoutException as exc:
        raise EngineError("engine_waking", str(exc)) from exc
    except httpx.HTTPError as exc:
        raise EngineError("engine_unreachable", str(exc)) from exc
    return res.json()


def _id_token(audience: str) -> str:
    from google.auth.transport.requests import Request
    from google.oauth2 import id_token

    try:
        return id_token.fetch_id_token(Request(), audience)
    except Exception:
        # A laptop's user ADC cannot mint ID tokens; local end-to-end runs use gcloud's.
        if get_settings().auth_mode != "dev":
            raise
        import subprocess

        out = subprocess.run(
            ["gcloud", "auth", "print-identity-token"], capture_output=True, text=True, check=True
        )
        return out.stdout.strip()


def is_placeholder(result: dict[str, Any]) -> bool:
    """The engine answers sites it cannot analyse yet with the contract fixture, marked so.

    Those numbers are not measurements of anyone's skin, so the api never shows them.
    """
    return result["engine_version"].endswith("-placeholder") or any(
        w.startswith("placeholder:") for w in result.get("warnings", [])
    )


def _unit_noise(session_id: str, metric_id: str) -> float:
    """Deterministic value in [-1, 1] so fixture sessions differ a little but repeatably."""
    digest = hashlib.sha256(f"{session_id}:{metric_id}".encode()).digest()
    return int.from_bytes(digest[:4], "big") / 0xFFFFFFFF * 2 - 1


def fixture_result(request: dict[str, Any]) -> dict[str, Any]:
    base = copy.deepcopy(contract.load("analysis_result.sample.json"))
    site = request["site"]
    sid = request["session_id"]
    n = len(request["frames"])
    baseline = request.get("baseline") or {}
    uncalibrated = request["capture_mode"] == "uncalibrated"

    pool = {m["id"]: m for m in base["metrics"] + copy.deepcopy(_FIXTURE_EXTRA_METRICS)}
    metrics = []
    for metric_id in SITE_METRICS[site]:
        m = pool[metric_id]
        sd = m.get("within_session_sd") or abs(m["value"]) * 0.01
        value = m["value"] + _unit_noise(sid, metric_id) * sd
        value = round(value) if m["unit"] == "count" else round(value, 2)
        m["value"] = value
        if n == 1:
            m["within_session_sd"] = None
            m["mdc95"] = None
        if uncalibrated or site == "face_full":  # faces have no colour reference (engine)
            m["confidence"] = "indicative"
        _apply_baseline(m, baseline.get(metric_id))
        metrics.append(m)

    prefix = request.get("output_prefix") or ""
    base.update(
        engine_version=f"{base['engine_version'].removesuffix('-fixture')}-fixture",
        session_id=sid,
        user_id=request["user_id"],
        site=site,
        capture_mode=request["capture_mode"],
        frames_used=n,
        metrics=metrics,
        candidates=[
            {
                **c,
                "crop_uri": f"{prefix}crops/{c['id']}.jpg",
                "context_crop_uri": f"{prefix}crops/{c['id']}_ctx.jpg",
            }
            for c in base["candidates"]
            if "pigment_spots" in SITE_METRICS[site]  # not the nose or the forearms
        ],
        overlays=[
            {"metric_id": o["metric_id"], "uri": f"{prefix}overlays/{o['metric_id']}.png"}
            for o in base["overlays"]
            if o["metric_id"] in SITE_METRICS[site]
        ],
        warnings=[FIXTURE_WARNING],
    )
    base["quality"]["per_frame"] = [{"index": i, "passed": True, "reasons": []} for i in range(n)]
    if uncalibrated:
        base["quality"]["card_detected"] = False
        base["quality"]["card_delta_e_mean"] = None
    return base


def _apply_baseline(metric: dict[str, Any], stored: dict[str, Any] | None) -> None:
    """Contract 2.4 verdict rules, as the real engine applies them."""
    if not stored or metric["value"] is None:
        metric.update(delta=None, verdict="no_baseline", direction="none")
        return
    delta = round(metric["value"] - stored["mean"], 2)
    mdc = stored.get("mdc95")
    # Like the engine (engine/app/aggregate.py): without a baseline noise band there is a delta
    # but no verdict, so the verdict stays no_baseline.
    if mdc is None:
        verdict = "no_baseline"
    else:
        verdict = "real_change" if abs(delta) > mdc else "within_noise"
    metric.update(
        delta=delta,
        verdict=verdict,
        direction="increase" if delta > 0 else "decrease" if delta < 0 else "none",
    )
