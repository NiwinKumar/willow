import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from jsonschema import validate
from PIL import Image
from test_skin_tones import PEN, TONES, _arm_photo

from app.io import LOCAL_ENV, parse_gs_uri
from app.main import app

SCHEMA = json.loads(
    (Path(__file__).resolve().parents[2] / "schemas" / "analysis_result.schema.json").read_text()
)
client = TestClient(app)


def _request(site, uris, mode="uncalibrated", **extra):
    return {
        "schema_version": "1.0",
        "session_id": "s_20261013_test0001",
        "user_id": "u_test",
        "site": site,
        "capture_mode": mode,
        "frames": [{"uri": u} for u in uris],
        **extra,
    }


@pytest.fixture
def local_files(monkeypatch):
    monkeypatch.setenv(LOCAL_ENV, "1")


def _arm_jpgs(tmp_path, n=3):
    skin, _ = TONES["intermediate"]
    paths = []
    for i in range(n):
        _arm_photo(tmp_path / f"f{i}.jpg", skin, PEN, seed=i)
        paths.append(str(tmp_path / f"f{i}.jpg"))
    return paths


@pytest.mark.parametrize("path", ["/healthz", "/health", "/v1/health"])
def test_healthz(path):
    body = client.get(path).json()
    assert body["status"] == "ok" and body["engine_version"]


def test_forearm_real_analysis(tmp_path, local_files):
    req = _request("forearm_control", _arm_jpgs(tmp_path))
    res = client.post("/v1/analyze", json=req)
    assert res.status_code == 200, res.text
    body = res.json()
    validate(body, SCHEMA)
    assert body["frames_used"] == 3 and body["quality"]["passed"]
    assert {m["id"] for m in body["metrics"]} == {"tone_ita", "redness"}
    assert all(m["confidence"] == "indicative" for m in body["metrics"])
    assert {"fetch", "request", "total"} <= set(body["timings_ms"])


def test_forearm_baseline_verdicts(tmp_path, local_files):
    req = _request(
        "forearm_treated",
        _arm_jpgs(tmp_path),
        baseline={"redness": {"mean": 0.0, "mdc95": 1.0}, "tone_ita": {"mean": 1e3, "mdc95": 1.0}},
    )
    metrics = {m["id"]: m for m in client.post("/v1/analyze", json=req).json()["metrics"]}
    assert metrics["redness"]["verdict"] == "real_change"
    assert metrics["redness"]["direction"] == "increase"
    assert metrics["tone_ita"]["direction"] == "decrease"


def test_photo_without_dots_fails_quality_not_request(tmp_path, local_files):
    path = tmp_path / "plain.jpg"
    rng = np.random.default_rng(0)
    img = np.clip(np.full((800, 600, 3), (190, 140, 110)) + rng.normal(0, 4, (800, 600, 1)), 0, 255)
    Image.fromarray(img.astype(np.uint8)).save(path)
    res = client.post("/v1/analyze", json=_request("forearm_control", [str(path)]))
    assert res.status_code == 200
    body = res.json()
    validate(body, SCHEMA)
    assert not body["quality"]["passed"] and "too_few_frames" in body["quality"]["reasons"]
    assert any("pen-dot square not found" in w for w in body["warnings"])


def test_face_site_is_marked_placeholder():
    res = client.post("/v1/analyze", json=_request("face_full", ["gs://b/u/s/frame_1.jpg"]))
    assert res.status_code == 200
    assert res.json()["warnings"][0].startswith("placeholder")


@pytest.mark.parametrize(
    ("req", "status", "code"),
    [
        ({"schema_version": "1.0"}, 400, "bad_request"),
        (_request("forearm_control", ["gs://b/x/frame.png"]), 415, "unsupported_format"),
        (
            _request("forearm_control", ["gs://b/x/f.jpg"], mode="calibrated_raw"),
            400,
            "bad_request",
        ),
        (_request("forearm_control", ["/tmp/not_gs.jpg"]), 400, "bad_request"),
    ],
)
def test_contract_errors(req, status, code):
    res = client.post("/v1/analyze", json=req)
    assert res.status_code == status
    assert res.json()["error"]["code"] == code


def test_unreadable_frame(tmp_path, local_files):
    bad = tmp_path / "broken.jpg"
    bad.write_bytes(b"not really a jpeg")
    res = client.post("/v1/analyze", json=_request("forearm_control", [str(bad)]))
    assert res.status_code == 422 and res.json()["error"]["code"] == "frame_unreadable"


def test_parse_gs_uri():
    assert parse_gs_uri("gs://willow-captures/uploads/u/s/frame_1.dng") == (
        "willow-captures",
        "uploads/u/s/frame_1.dng",
    )
