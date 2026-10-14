import json
from pathlib import Path

from fastapi.testclient import TestClient
from jsonschema import validate
from test_macro import _macro

from app.io import LOCAL_ENV
from app.main import app

ROOT = Path(__file__).resolve().parents[2]


def _load(name: str) -> dict:
    return json.loads((ROOT / name).read_text())


def test_fixture_is_schema_valid():
    validate(
        _load("fixtures/analysis_result.sample.json"), _load("schemas/analysis_result.schema.json")
    )


def test_analyze_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv(LOCAL_ENV, "1")
    _macro(tmp_path / "frame_1.jpg")
    client = TestClient(app)
    req = {
        "schema_version": "1.0",
        "session_id": "s_test",
        "user_id": "u_test",
        "site": "cheek_macro",
        "capture_mode": "uncalibrated",
        "frames": [{"uri": str(tmp_path / "frame_1.jpg")}],
    }
    res = client.post("/v1/analyze", json=req)
    assert res.status_code == 200
    body = res.json()
    validate(body, _load("schemas/analysis_result.schema.json"))
    assert body["site"] == "cheek_macro"
