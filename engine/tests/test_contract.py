import json
from pathlib import Path

from fastapi.testclient import TestClient
from jsonschema import validate

from app.main import app

ROOT = Path(__file__).resolve().parents[2]


def _load(name: str) -> dict:
    return json.loads((ROOT / name).read_text())


def test_fixture_is_schema_valid():
    validate(_load("fixtures/analysis_result.sample.json"), _load("schemas/analysis_result.schema.json"))


def test_placeholder_analyze_roundtrip():
    client = TestClient(app)
    req = {
        "schema_version": "1.0",
        "session_id": "s_test",
        "user_id": "u_test",
        "site": "forearm_treated",
        "capture_mode": "calibrated_raw",
        "frames": [{"uri": "gs://bucket/uploads/u_test/s_test/frame_1.dng"}],
    }
    res = client.post("/v1/analyze", json=req)
    assert res.status_code == 200
    body = res.json()
    validate(body, _load("schemas/analysis_result.schema.json"))
    assert body["site"] == "forearm_treated"
