import json
from datetime import UTC, datetime

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
    assert view["session"]["sample_id"] == "forearm_base"
    # someone else's photos: never this person's own baseline...
    assert fake.store.baseline_get("u_test", "forearm_control") is None
    # ...but the starting point of the sample runs, so the next sample run has a verdict
    assert view["session"]["is_baseline"] is True
    assert fake.store.baseline_get("u_test", "forearm_control__sample")["session_id"] == sid


FACE_MANIFEST = {
    "samples": [
        {
            "id": "mei_face_week1",
            "title": "Face check-in, Mei's first week",
            "site": "face_full",
            "capture_mode": "uncalibrated",
            "frames": ["frame_1.jpg", "frame_2.jpg", "frame_3.jpg"],
        }
    ]
}


@pytest.fixture
def face_samples(fake, monkeypatch):
    """Mei's first week in the manifest, her week-eight photos in the demo journey's uploads."""
    demo.clear_cache()
    monkeypatch.setattr(storage, "read_text", lambda name: json.dumps(FACE_MANIFEST))
    monkeypatch.setattr(storage, "copy_object", lambda src, dst: fake.put(dst))
    fake.put("uploads/demo_willow/s_20261011_8e0b0021/frame_1.jpg")
    for sid, day in (("s_20260823_810e21e6", 23), ("s_20261011_8e0b0021", None)):
        when = datetime(2026, 8, day, tzinfo=UTC) if day else datetime(2026, 10, 11, tzinfo=UTC)
        fake.store.session_set("demo_willow", sid, {"site": "face_full", "created_at": when})
    yield
    demo.clear_cache()


def test_a_later_week_sample_is_listed_from_the_journeys_own_photos(client, fake, face_samples):
    listed = client.get("/v1/demo/samples").json()["samples"]
    assert [s["id"] for s in listed] == ["mei_face_week1", "mei_face_week8"]
    assert listed[1]["after"] == "mei_face_week1" and "source_session" not in listed[1]
    # without her photos in the bucket it is not offered
    del fake.blobs["uploads/demo_willow/s_20261011_8e0b0021/frame_1.jpg"]
    demo.clear_cache()
    assert [s["id"] for s in client.get("/v1/demo/samples").json()["samples"]] == ["mei_face_week1"]


def test_the_second_sample_run_is_compared_with_the_first(client, fake, face_samples):
    # out of order it would be a baseline itself: refused until the first sample has run
    early = client.post("/v1/demo/samples/mei_face_week8/session")
    assert early.status_code == 409 and early.json()["detail"]["code"] == "run_first_sample"
    first = client.post("/v1/demo/samples/mei_face_week1/session").json()["session_id"]
    base = client.post(f"/v1/sessions/{first}/analyze").json()
    assert base["session"]["is_baseline"] is True
    assert base["session"]["baseline"]["session_id"] == first

    second = client.post("/v1/demo/samples/mei_face_week8/session").json()["session_id"]
    doc = fake.store.session_get("u_test", second)
    assert doc["frame_uris"][0].endswith(f"uploads/u_test/{second}/frame_1.jpg")
    view = client.post(f"/v1/sessions/{second}/analyze").json()
    assert view["session"]["is_baseline"] is False
    assert view["session"]["baseline"]["session_id"] == first
    verdicts = {m["verdict"] for m in view["result"]["metrics"] if m["value"] is not None}
    assert verdicts & {"real_change", "within_noise"}  # a verdict, not nine "could not compare"
    # the photos are seven weeks apart in the journey, whatever the clock says about the runs
    assert doc["sample_taken"] == datetime(2026, 10, 11, tzinfo=UTC)
    # and the list view agrees with the detail view
    listed = {
        v["session"]["id"]: v["session"] for v in client.get("/v1/sessions").json()["sessions"]
    }
    assert listed[first]["is_baseline"] is True
    assert listed[second]["baseline"]["session_id"] == first


def test_sample_runs_never_touch_the_persons_own_baseline(client, fake, face_samples):
    from tests.test_analyze_flow import _create, _upload_all  # the person's own selfie

    created = _create(client, site="face_full", mode="uncalibrated", n=3)
    _upload_all(fake, created)
    own = created["session_id"]
    mine = client.post(f"/v1/sessions/{own}/analyze").json()
    assert mine["session"]["is_baseline"] is True
    sid = client.post("/v1/demo/samples/mei_face_week1/session").json()["session_id"]
    view = client.post(f"/v1/sessions/{sid}/analyze").json()
    # Mei's photos are not compared with the person's own baseline, and do not replace it
    assert (
        view["session"]["is_baseline"] is True and view["session"]["baseline"]["session_id"] == sid
    )
    assert all(m["delta"] is None for m in view["result"]["metrics"])
    assert fake.store.baseline_get("u_test", "face_full__uncalibrated")["session_id"] == own
    assert client.get(f"/v1/sessions/{own}").json()["session"]["is_baseline"] is True


def test_sample_explanations_never_read_the_persons_routine(fake, face_samples):
    from app import analysis

    fake.store.routine_set("u_test", "r1", {"brand": "Brand", "custom_name": "Serum 10%"})
    base = {"session_id": "s_a", "sample_taken": datetime(2026, 8, 23, tzinfo=UTC), "metrics": {}}
    doc = {"sample_id": "mei_face_week8", "sample_taken": datetime(2026, 10, 11, tzinfo=UTC)}
    ctx = analysis.explain_context(fake.store, "u_test", doc, base, "s_b")
    assert ctx["routine"] == [] and ctx["days_since_baseline"] == 49 and not ctx["is_baseline"]


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
        "latency_ms": body["bigquery"]["latency_ms"],
        "dataset": "willow_insights",
        "people": 502,
        "synthetic": 500,
    }
    assert body["catalog"]["products"] > 0
    assert body["gemini"]["status"] == "ok" and body["gemini"]["model"]
    assert body["storage"]["status"] == "ok" and isinstance(body["storage"]["latency_ms"], int)


def test_global_cap_bounds_cost_across_guest_accounts(client, fake, samples, monkeypatch):
    from app import limits

    monkeypatch.setitem(limits.CAPS, "sample_runs", (12, 2))
    for uid in ("g1", "g2"):
        res = client.post("/v1/demo/samples/forearm_base/session", headers={"X-Dev-Uid": uid})
        assert res.status_code == 200
    res = client.post("/v1/demo/samples/forearm_base/session", headers={"X-Dev-Uid": "g3"})
    assert res.status_code == 429 and res.json()["detail"]["code"] == "busy"


def test_judge_setup_never_touches_a_signed_in_account(client, fake, monkeypatch):
    from app import settings

    monkeypatch.setattr(settings.get_settings(), "auth_mode", "firebase")
    from app.auth import AuthUser, current_user
    from app.main import app

    app.dependency_overrides[current_user] = lambda: AuthUser(uid="real", is_anonymous=False)
    try:
        assert client.post("/v1/demo/judge-setup").json()["routine_added"] == 0
    finally:
        app.dependency_overrides.pop(current_user, None)
    assert fake.store.routine_list("real") == []


def test_a_sleeping_engine_reads_as_waking_and_is_asked_again_soon(client, monkeypatch):
    from app import engine, retailer

    demo.clear_cache()
    monkeypatch.setattr(retailer, "insights", lambda: {"cohort": {"synthetic": 500, "real": 0}})
    calls = []

    def slow(timeout=engine.HEALTH_TIMEOUT_S):
        calls.append(timeout)
        raise engine.EngineError("engine_waking", "read timed out")

    monkeypatch.setattr(engine, "health", slow)
    assert client.get("/v1/demo/status").json()["engine"]["status"] == "waking"
    assert client.get("/v1/demo/status").json()["engine"]["status"] == "waking"
    assert len(calls) == 1  # kept briefly...
    monkeypatch.setattr(demo.time, "time", lambda: 10_000_000_000.0)
    monkeypatch.setattr(engine, "health", lambda timeout=0: {"engine_version": "0.3.1"})
    # ...then asked again, in the background: this caller gets the last answer at once
    assert client.get("/v1/demo/status").json()["engine"]["status"] == "waking"
    with demo._status_lock:  # the background check has finished
        pass
    assert client.get("/v1/demo/status").json()["engine"]["status"] == "ok"
    assert engine.HEALTH_TIMEOUT_S > 35  # longer than a cold start


def test_a_stale_status_never_waits_and_checks_once_at_a_time(monkeypatch):
    import threading

    from app import engine, retailer

    demo.clear_cache()
    old = {k: {"status": "ok", "old": True} for k in demo.LIVE_KEYS}
    demo._cache["status"] = (0.0, old)
    gate, calls = threading.Event(), []

    def slow_engine(timeout=0):
        calls.append(1)
        gate.wait(5)  # a cold engine
        return {"engine_version": "0.3.1"}

    monkeypatch.setattr(engine, "health", slow_engine)
    monkeypatch.setattr(demo, "live_check", lambda *a: {"status": "ok"})
    monkeypatch.setattr(retailer, "insights", lambda: {"cohort": {"synthetic": 500, "real": 0}})
    # two stale reads while the engine is slow: both answered from the cache at once
    assert demo.status() is old and demo.status() is old
    gate.set()
    with demo._status_lock:  # the one background check has finished
        pass
    assert len(calls) == 1
    assert demo.status()["engine"]["status"] == "ok" and "old" not in demo.status()["engine"]
    demo.clear_cache()


def test_an_engine_that_refuses_is_unreachable(client, monkeypatch):
    from app import engine, retailer

    demo.clear_cache()
    monkeypatch.setattr(retailer, "insights", lambda: {"cohort": {"synthetic": 500, "real": 0}})

    def refused(timeout=0):
        raise engine.EngineError("engine_unreachable", "403")

    monkeypatch.setattr(engine, "health", refused)
    assert client.get("/v1/demo/status").json()["engine"]["status"] == "unreachable"


def test_live_checks_tell_unreachable_busy_and_slow_apart(client, monkeypatch):
    from app import retailer

    demo.clear_cache()
    monkeypatch.setattr(retailer, "insights", lambda: {"cohort": {"synthetic": 500, "real": 0}})

    def down():
        raise ConnectionError("no route to host")

    def busy():
        raise RuntimeError("429 RESOURCE_EXHAUSTED")

    monkeypatch.setattr(demo, "probe_storage", down)
    monkeypatch.setattr(demo, "probe_gemini", busy)
    monkeypatch.setattr(demo, "probe_bigquery", down)
    body = client.get("/v1/demo/status").json()
    assert body["storage"] == {
        "bucket": "willow-511508-captures",
        "status": "unreachable",
        "latency_ms": None,
    }
    assert body["gemini"]["status"] == "degraded" and body["gemini"]["reason"] == "busy"
    assert body["bigquery"]["status"] == "unreachable" and "people" not in body["bigquery"]

    # slow but answering is degraded; a failed check is asked again after STATUS_RETRY_S
    monkeypatch.setattr(demo.time, "time", lambda: 10_000_000_000.0)
    ticks = iter([0.0, 9.0] * 10)
    monkeypatch.setattr(demo.time, "monotonic", lambda: next(ticks, 9.0))
    monkeypatch.setattr(demo, "probe_storage", lambda: None)
    assert demo.live_check("storage", lambda: None) == {
        "status": "degraded",
        "latency_ms": 9000,
        "reason": "slow",
    }


def test_bigquery_up_but_insights_failing_is_degraded(client, monkeypatch):
    from app import retailer

    def failing():
        raise RuntimeError("query failed")

    demo.clear_cache()
    monkeypatch.setattr(retailer, "insights", failing)
    body = client.get("/v1/demo/status").json()
    assert body["bigquery"]["status"] == "degraded" and body["bigquery"]["latency_ms"] >= 0


def test_journey_routine_is_public_and_read_only(client, fake):
    demo_client = client.__class__(client.app, headers={"X-Dev-Uid": "demo_willow"})
    demo_client.post("/v1/demo/judge-setup")
    entry = demo_client.get("/v1/routine").json()["entries"][0]
    today = entry["started_at"][:10]
    demo_client.put(f"/v1/routine/log/{today}/{entry['id']}/am")
    demo.clear_cache()
    anon = client.__class__(client.app)
    routine = anon.get(f"/v1/demo/routine?today={today}").json()["entries"]
    mine = demo_client.get("/v1/routine").json()["entries"]
    assert [e["id"] for e in routine] == [e["id"] for e in mine]
    days = anon.get(f"/v1/demo/routine/log?from={today}&to={today}").json()["days"]
    assert days[0]["used"][entry["id"]] == ["am"]
    check = anon.get("/v1/demo/routine/check").json()
    assert "conflicts" in check
    # nothing a caller sends reaches the demo account: there are no demo write routes
    assert anon.put(f"/v1/demo/routine/log/{today}/{entry['id']}/pm").status_code in (404, 405)


def test_a_new_guest_starts_with_the_starter_check_ins_and_routine(client, fake, monkeypatch):
    import json as _json

    from app import storage

    copied = []
    monkeypatch.setattr(storage, "copy_prefix", lambda src, dst: copied.append((src, dst)) or 3)
    source = "s_20260823_810e21e6"
    fake.store.session_set(
        "demo_willow",
        source,
        {
            "site": "face_full",
            "capture_mode": "uncalibrated",
            "status": "done",
            "measured": True,
            "is_baseline": True,
            "note": "Mei's own words",
            "frame_uris": [f"gs://b/uploads/demo_willow/{source}/frame_1.jpg"],
            "result_json": _json.dumps(
                {
                    "session_id": source,
                    "user_id": "demo_willow",
                    "preview": f"demo_willow/{source}/p",
                }
            ),
            "labels": {"c_001": "mole"},
        },
    )
    first = client.post("/v1/demo/guest-setup").json()
    assert first == {"routine_added": 4, "sessions_added": 1}
    sid, doc = fake.store.sessions_list("u_test")[0]
    assert doc["sample_id"] == "mei_face_week1" and doc["is_baseline"] is False
    assert doc["note"] is None and doc["labels"] == {"c_001": "mole"}
    assert doc["frame_uris"] == [f"gs://b/uploads/u_test/{sid}/frame_1.jpg"]
    assert _json.loads(doc["result_json"]) == {
        "session_id": sid,
        "user_id": "u_test",
        "preview": f"u_test/{sid}/p",
    }
    assert (f"uploads/demo_willow/{source}/", f"uploads/u_test/{sid}/") in copied
    # once is enough: a second call (another tab) adds nothing
    assert client.post("/v1/demo/guest-setup").json() == {"routine_added": 0, "sessions_added": 0}
    assert len(fake.store.sessions_list("u_test")) == 1
