"""Willow engine HTTP service (docs/CONTRACT.md section 2).

Every contract site runs a real pipeline: forearm sites (pipeline), face_full
(pipeline_face) and the close-ups *_macro (pipeline_macro).
"""

import json
import logging
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path

import anyio
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from jsonschema import ValidationError, validate

from app import __version__
from app.errors import EngineError
from app.io import fetch_frames
from app.pipeline import analyze_forearm
from app.pipeline_face import analyze_face
from app.pipeline_macro import MACRO_SITES, analyze_macro

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "schemas"
REQUEST_SCHEMA = json.loads((SCHEMAS / "analyze_request.schema.json").read_text())
RESULT_SCHEMA = json.loads((SCHEMAS / "analysis_result.schema.json").read_text())
MODE_FOR_EXT = {".dng": "calibrated_raw"}  # anything else is a normal photo -> uncalibrated

log = logging.getLogger("willow.engine")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Load both face models before the first request, not during it (a judge's first selfie
    # otherwise waited for them).
    try:
        from app.landmarks import _hand_landmarker, _landmarker

        await anyio.to_thread.run_sync(_landmarker)
        await anyio.to_thread.run_sync(_hand_landmarker)
    except Exception:  # a missing model is reported by the request that needs it
        log.exception("face models did not load at startup")
    yield


app = FastAPI(title="Willow engine", version=__version__, lifespan=lifespan)


@app.exception_handler(EngineError)
def _engine_error(_: Request, exc: EngineError) -> JSONResponse:
    return JSONResponse(exc.body(), status_code=exc.status)


@app.exception_handler(Exception)
def _unexpected(_: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error")
    return JSONResponse(EngineError("internal", type(exc).__name__).body(), status_code=500)


@app.get("/healthz")
@app.get("/health")
@app.get("/v1/health")  # Cloud Run front end swallows /healthz on *.run.app; same response
def healthz() -> dict:
    return {"status": "ok", "engine_version": __version__}


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

    # The measurement is CPU work: run it in a worker thread so the event loop keeps answering
    # (health checks, a second request) while a photo is being measured.
    result = await anyio.to_thread.run_sync(_run, request)
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


def _run(request: dict) -> dict:
    _check_mode(request)
    n = len(request["frames"])
    with tempfile.TemporaryDirectory(prefix="willow_") as tmp:
        t_fetch = time.perf_counter()
        paths = fetch_frames([f["uri"] for f in request["frames"]], Path(tmp))
        fetch_ms = (time.perf_counter() - t_fetch) * 1000
        ids = {"session_id": request["session_id"], "user_id": request["user_id"]}
        opts = request.get("options") or {}
        if request["site"] in MACRO_SITES:
            result = analyze_macro(
                paths,
                request["site"],
                baseline=request.get("baseline"),
                output_prefix=request.get("output_prefix"),
                max_candidates=opts.get("max_candidates", 40),
                compute_overlays=opts.get("compute_overlays", True),
                **ids,
            )
        elif request["site"] == "face_full":
            result = analyze_face(
                paths,
                baseline=request.get("baseline"),
                output_prefix=request.get("output_prefix"),
                max_candidates=opts.get("max_candidates", 40),
                compute_overlays=opts.get("compute_overlays", True),
                **ids,
            )
        else:
            result = analyze_forearm(
                paths,
                request["site"],
                [None] * n,  # forearm square found from the pen dots
                [None] * n,  # white paper found automatically
                baseline=request.get("baseline"),
                output_prefix=request.get("output_prefix"),
                **ids,
            )
    result["timings_ms"]["fetch"] = round(fetch_ms, 1)
    return result
