"""Willow engine HTTP service (docs/CONTRACT.md section 2).

Forearm sites run the real pipeline. Face and macro sites still return the contract
fixture (clearly marked in `warnings`) until the face pipeline lands, so the api and web
keep integrating against the same endpoint.
"""

import json
import logging
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from jsonschema import ValidationError, validate

from app import __version__
from app.errors import EngineError
from app.io import fetch_frames
from app.pipeline import FOREARM_SITES, analyze_forearm

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "schemas"
FIXTURE = ROOT / "fixtures" / "analysis_result.sample.json"
REQUEST_SCHEMA = json.loads((SCHEMAS / "analyze_request.schema.json").read_text())
RESULT_SCHEMA = json.loads((SCHEMAS / "analysis_result.schema.json").read_text())
MODE_FOR_EXT = {".dng": "calibrated_raw"}  # anything else is a normal photo -> uncalibrated

log = logging.getLogger("willow.engine")
app = FastAPI(title="Willow engine", version=__version__)


@app.exception_handler(EngineError)
def _engine_error(_: Request, exc: EngineError) -> JSONResponse:
    return JSONResponse(exc.body(), status_code=exc.status)


@app.exception_handler(Exception)
def _unexpected(_: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error")
    return JSONResponse(EngineError("internal", type(exc).__name__).body(), status_code=500)


@app.get("/healthz")
@app.get("/health")  # Cloud Run's front end swallows /healthz on *.run.app; same response
def healthz() -> dict:
    return {"status": "ok", "engine_version": __version__}


def _placeholder(request: dict) -> dict:
    result = json.loads(FIXTURE.read_text())
    for key in ("session_id", "user_id", "site", "capture_mode"):
        result[key] = request[key]
    result["engine_version"] = f"{__version__}-placeholder"
    result["warnings"] = [f"placeholder: {request['site']} not analysed yet, fixture data"]
    return result


def _check_mode(request: dict) -> None:
    """The declared capture_mode must match the files (DNG <-> calibrated_raw)."""
    for frame in request["frames"]:
        ext = Path(frame["uri"]).suffix.lower()
        if MODE_FOR_EXT.get(ext, "uncalibrated") != request["capture_mode"]:
            raise EngineError(
                "bad_request",
                f"{frame['uri']} does not match capture_mode {request['capture_mode']}",
            )


@app.post("/v1/analyze")
async def analyze(http_request: Request) -> dict:
    t0 = time.perf_counter()
    try:
        request = await http_request.json()
        validate(request, REQUEST_SCHEMA)
    except ValidationError as exc:
        raise EngineError("bad_request", exc.message) from exc
    except ValueError as exc:  # body is not JSON
        raise EngineError("bad_request", f"invalid JSON: {exc}") from exc

    if request["site"] not in FOREARM_SITES:
        result = _placeholder(request)
    else:
        _check_mode(request)
        n = len(request["frames"])
        with tempfile.TemporaryDirectory(prefix="willow_") as tmp:
            t_fetch = time.perf_counter()
            paths = fetch_frames([f["uri"] for f in request["frames"]], Path(tmp))
            fetch_ms = (time.perf_counter() - t_fetch) * 1000
            result = analyze_forearm(
                paths,
                request["site"],
                [None] * n,  # forearm square found from the pen dots
                [None] * n,  # white paper found automatically
                session_id=request["session_id"],
                user_id=request["user_id"],
                baseline=request.get("baseline"),
            )
        result["timings_ms"]["fetch"] = round(fetch_ms, 1)

    result["timings_ms"]["request"] = round((time.perf_counter() - t0) * 1000, 1)
    validate(result, RESULT_SCHEMA)  # never send a response that breaks the contract
    log.info(
        json.dumps(
            {
                "event": "analyze",
                "session_id": request["session_id"],
                "site": request["site"],
                "frames": len(request["frames"]),
                "frames_used": result["frames_used"],
                "passed": result["quality"]["passed"],
                "timings_ms": result["timings_ms"],
            }
        )
    )
    return result
