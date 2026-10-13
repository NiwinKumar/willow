"""Willow engine placeholder.

Returns the contract fixture so the api and web can integrate from day 1.
Replace `analyze` with the real pipeline (see prompts/claude-code-engine.md).
"""

import json
from pathlib import Path

from fastapi import FastAPI
from jsonschema import validate

from app import __version__

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "schemas"
FIXTURE = ROOT / "fixtures" / "analysis_result.sample.json"

app = FastAPI(title="Willow engine", version=__version__)


def _load(path: Path) -> dict:
    return json.loads(path.read_text())


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "engine_version": __version__}


@app.post("/v1/analyze")
def analyze(request: dict) -> dict:
    validate(request, _load(SCHEMAS / "analyze_request.schema.json"))
    result = _load(FIXTURE)
    for key in ("session_id", "user_id", "site", "capture_mode"):
        result[key] = request[key]
    result["engine_version"] = f"{__version__}-placeholder"
    result["warnings"] = ["placeholder engine: fixture data, not a real analysis"]
    validate(result, _load(SCHEMAS / "analysis_result.schema.json"))
    return result
