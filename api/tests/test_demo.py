import json

import pytest

from app import demo, storage

MANIFEST = {
    "samples": [
        {
            "id": "forearm_base",
            "title": "Forearm baseline",
            "site": "forearm_control",
            "capture_mode": "calibrated_raw",
            "frames": ["frame_1.dng", "frame_2.dng"],
            "credit": "Team capture, consent on file",
        }
    ]
}


@pytest.fixture
def samples(fake, monkeypatch):
    demo.clear_cache()
    monkeypatch.setattr(storage, "read_text", lambda name: json.dumps(MANIFEST))
    copies = []

    def copy(src, dst):
        copies.append((src, dst))
        fake.put(dst)

    monkeypatch.setattr(storage, "copy_object", copy)
    yield copies
    demo.clear_cache()


def test_samples_are_listed_without_sign_in(client, samples):
    res = client.get("/v1/demo/samples", headers={"X-Dev-Uid": ""})
    assert res.status_code == 200
    (s,) = res.json()["samples"]
    assert s["id"] == "forearm_base" and s["n_frames"] == 2 and "frames" not in s


def test_a_sample_run_is_an_ordinary_session_of_the_judge(client, fake, samples):
    res = client.post("/v1/demo/samples/forearm_base/session")
    assert res.status_code == 200, res.text
    sid = res.json()["session_id"]
    assert [src for src, _ in samples] == [
        "demo/samples/forearm_base/frame_1.dng",
        "demo/samples/forearm_base/frame_2.dng",
    ]
    assert all(dst.startswith(f"uploads/u_test/{sid}/") for _, dst in samples)
    view = client.post(f"/v1/sessions/{sid}/analyze").json()
    assert view["session"]["status"] == "done"
    assert view["session"]["is_baseline"] is True
    assert view["session"]["sample_id"] == "forearm_base"


def test_unknown_sample_is_404(client, samples):
    assert client.post("/v1/demo/samples/nope/session").status_code == 404


def test_judge_setup_adds_a_routine_once(client, fake):
    first = client.post("/v1/demo/judge-setup").json()
    assert first["routine_added"] == 4
    assert client.post("/v1/demo/judge-setup").json()["routine_added"] == 0
    check = client.post("/v1/routine/check").json()
    assert any(c["source"] == "rule" for c in check["conflicts"])
    assert fake.store.user_get("u_test")["judge"] is True


def test_journey_reads_the_demo_account(client, fake, samples):
    demo_client = client.__class__(client.app, headers={"X-Dev-Uid": "demo_willow"})
    sid = demo_client.post("/v1/demo/samples/forearm_base/session").json()["session_id"]
    demo_client.post(f"/v1/sessions/{sid}/analyze")
    demo.clear_cache()
    res = client.get("/v1/demo/journey")
    assert [v["session"]["id"] for v in res.json()["sessions"]] == [sid]


def test_status_reports_each_service(client, monkeypatch):
    from app import retailer

    demo.clear_cache()
    monkeypatch.setattr(retailer, "insights", lambda: {"cohort": {"synthetic": 500, "real": 2}})
    body = client.get("/v1/demo/status").json()
    assert body["engine"]["status"] == "ok"
    assert body["bigquery"] == {
        "status": "ok",
        "dataset": "willow_insights",
        "people": 502,
        "synthetic": 500,
    }
    assert body["catalog"]["products"] > 0
