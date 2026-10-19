"""Resumable sessions (add/remove frames, baseline top-up, forced re-analysis), duplicates across
sessions, the live analysis stage and signed media (frame_urls, crop_urls)."""

import json

from app import engine, explain

JPEG = "image/jpeg"


def _create(client, n=3, site="face_full", mode="uncalibrated"):
    ct = JPEG if mode == "uncalibrated" else "image/x-adobe-dng"
    res = client.post(
        "/v1/sessions",
        json={"site": site, "capture_mode": mode, "n_frames": n, "content_types": [ct] * n},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _name(uri: str) -> str:
    return uri.split("/", 3)[3]


def _upload(fake, targets, content_type=JPEG, md5=None):
    for t in targets:
        fake.put(_name(t["object_uri"]), content_type=content_type, md5=md5)


def _doc(fake, sid):
    return fake.store.session_get("u_test", sid)


# ---- POST /v1/sessions/{id}/frames ----


def test_add_frames_before_analyze_appends_new_objects(client, fake):
    created = _create(client, n=2)
    sid = created["session_id"]
    res = client.post(f"/v1/sessions/{sid}/frames", json={"add": 1, "content_types": [JPEG]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["n_frames"] == 3 and body["dropped"] == []
    assert [t["index"] for t in body["upload_urls"]] == [3]
    assert body["upload_urls"][0]["object_uri"].endswith(f"/uploads/u_test/{sid}/frame_3.jpg")
    doc = _doc(fake, sid)
    assert doc["n_frames"] == 3 and len(doc["frame_uris"]) == 3 and doc["status"] == "uploading"


def test_add_frames_checks_type_and_the_five_photo_limit(client, fake):
    sid = _create(client, n=4)["session_id"]
    wrong = client.post(
        f"/v1/sessions/{sid}/frames", json={"add": 1, "content_types": ["image/x-adobe-dng"]}
    )
    assert wrong.status_code == 422 and wrong.json()["detail"]["code"] == "bad_request"
    mismatch = client.post(f"/v1/sessions/{sid}/frames", json={"add": 2, "content_types": [JPEG]})
    assert mismatch.status_code == 422
    full = client.post(f"/v1/sessions/{sid}/frames", json={"add": 2, "content_types": [JPEG] * 2})
    assert full.status_code == 409 and full.json()["detail"]["code"] == "too_many_frames"
    nobody = "/v1/sessions/s_20261013_deadbeef/frames"
    assert client.post(nobody, json={"add": 1, "content_types": [JPEG]}).status_code == 404


def test_add_frames_refused_while_analysis_runs_or_for_samples(client, fake):
    from datetime import UTC, datetime

    sid = _create(client, n=1)["session_id"]
    fake.store.session_update(
        "u_test", sid, {"status": "processing", "processing_started_at": datetime.now(UTC)}
    )
    res = client.post(f"/v1/sessions/{sid}/frames", json={"add": 1, "content_types": [JPEG]})
    assert res.status_code == 409
    other = _create(client, n=1)["session_id"]
    fake.store.session_update("u_test", other, {"sample_id": "face_quick"})
    res = client.post(f"/v1/sessions/{other}/frames", json={"add": 1, "content_types": [JPEG]})
    assert res.status_code == 409


# ---- DELETE /v1/sessions/{id}/frames/{index} ----


def test_delete_frame_before_analyze_moves_later_frames_up(client, fake):
    created = _create(client, n=3)
    sid = created["session_id"]
    _upload(fake, created["upload_urls"])
    res = client.delete(f"/v1/sessions/{sid}/frames/2")
    assert res.status_code == 200, res.text
    body = res.json()
    assert [t["index"] for t in body["upload_urls"]] == [1, 2]
    assert body["upload_urls"][1]["object_uri"].endswith("/frame_3.jpg")
    assert f"uploads/u_test/{sid}/frame_2.jpg" not in fake.blobs  # the object goes too
    doc = _doc(fake, sid)
    assert doc["n_frames"] == 2 and len(doc["content_types"]) == 2
    # a frame added later never reuses a removed name
    added = client.post(f"/v1/sessions/{sid}/frames", json={"add": 1, "content_types": [JPEG]})
    assert added.json()["upload_urls"][0]["object_uri"].endswith("/frame_4.jpg")


def test_delete_frame_rules(client, fake):
    created = _create(client, n=1)
    sid = created["session_id"]
    assert client.delete(f"/v1/sessions/{sid}/frames/2").status_code == 404
    last = client.delete(f"/v1/sessions/{sid}/frames/1")
    assert last.status_code == 409 and last.json()["detail"]["code"] == "last_frame"
    two = _create(client, n=2)
    _upload(fake, two["upload_urls"])
    assert client.post(f"/v1/sessions/{two['session_id']}/analyze").status_code == 200
    after = client.delete(f"/v1/sessions/{two['session_id']}/frames/1")
    assert after.status_code == 409  # measured: only before analyze


# ---- Baseline top-up and ?force=1 ----


def test_topping_up_a_thin_baseline_rebuilds_it_and_keeps_later_comparisons(client, fake):
    base = _create(client, n=2)
    bsid = base["session_id"]
    _upload(fake, base["upload_urls"])
    view = client.post(f"/v1/sessions/{bsid}/analyze").json()
    assert view["session"]["is_baseline"] is True
    assert fake.store.baseline_get("u_test", "face_full__uncalibrated")["has_noise_band"] is False

    later = _create(client, n=3)
    _upload(fake, later["upload_urls"])
    client.post(f"/v1/sessions/{later['session_id']}/analyze")

    res = client.post(f"/v1/sessions/{bsid}/frames", json={"add": 1, "content_types": [JPEG]})
    assert res.status_code == 200, res.text
    doc = _doc(fake, bsid)
    assert doc["status"] == "uploading" and doc["result_json"]  # old result kept until re-run
    # until measured again, the baseline still holds
    assert fake.store.baseline_get("u_test", "face_full__uncalibrated")["frames"] == 2
    missing = client.post(f"/v1/sessions/{bsid}/analyze")
    assert missing.status_code == 409 and missing.json()["detail"]["code"] == "frames_missing"

    _upload(fake, res.json()["upload_urls"])
    view = client.post(f"/v1/sessions/{bsid}/analyze").json()
    assert view["session"]["status"] == "done" and view["session"]["n_frames"] == 3
    assert view["session"]["is_baseline"] is True
    assert view["session"]["baseline"]["has_noise_band"] is True
    rebuilt = fake.store.baseline_get("u_test", "face_full__uncalibrated")
    assert rebuilt["session_id"] == bsid and rebuilt["frames"] == 3
    assert rebuilt["has_noise_band"] is True
    # the later session keeps the comparison it was made with
    kept = client.get(f"/v1/sessions/{later['session_id']}").json()["session"]["baseline"]
    assert kept == {"session_id": bsid, "frames": 2, "has_noise_band": False}


def test_topping_up_drops_the_photos_the_engine_left_out(client, fake, monkeypatch):
    real = engine.fixture_result

    def one_left_out(request):
        result = real(request)
        result["quality"]["per_frame"][1] = {"index": 1, "passed": False, "reasons": ["blurry"]}
        result["frames_used"] = len(request["frames"]) - 1
        return result

    monkeypatch.setattr(engine, "fixture_result", one_left_out)
    created = _create(client, n=3)
    sid = created["session_id"]
    _upload(fake, created["upload_urls"])
    client.post(f"/v1/sessions/{sid}/analyze")
    res = client.post(f"/v1/sessions/{sid}/frames", json={"add": 2, "content_types": [JPEG] * 2})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["dropped"] == [2] and body["n_frames"] == 4
    assert [t["index"] for t in body["upload_urls"]] == [3, 4]
    doc = _doc(fake, sid)
    assert [u.rsplit("/", 1)[1] for u in doc["frame_uris"]] == [
        "frame_1.jpg",
        "frame_3.jpg",
        "frame_4.jpg",
        "frame_5.jpg",
    ]
    assert f"uploads/u_test/{sid}/frame_2.jpg" not in fake.blobs


def test_top_up_refused_once_the_originals_are_deleted(client, fake):
    created = _create(client, n=2)
    sid = created["session_id"]
    _upload(fake, created["upload_urls"])
    client.post(f"/v1/sessions/{sid}/analyze")
    del fake.blobs[f"uploads/u_test/{sid}/frame_1.jpg"]  # the 30-day lifecycle
    res = client.post(f"/v1/sessions/{sid}/frames", json={"add": 1, "content_types": [JPEG]})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "originals_deleted"
    assert _doc(fake, sid)["status"] == "done"


def test_force_reanalyzes_a_done_session_and_a_failure_leaves_it_measured(
    client, fake, monkeypatch
):
    created = _create(client, n=3)
    sid = created["session_id"]
    _upload(fake, created["upload_urls"])
    first = client.post(f"/v1/sessions/{sid}/analyze").json()
    again = client.post(f"/v1/sessions/{sid}/analyze")  # not forced: shown as it is
    assert again.json()["session"]["status"] == "done"
    assert fake.store.usage[("u_test", _today(), "analyze")] == 1

    calls = []
    real = engine.analyze
    monkeypatch.setattr(engine, "analyze", lambda req: calls.append(req) or real(req))
    forced = client.post(f"/v1/sessions/{sid}/analyze?force=1")
    assert forced.status_code == 200 and len(calls) == 1
    assert len(calls[0]["frames"]) == 3 and calls[0]["baseline"] is None  # its own baseline
    assert forced.json()["session"]["is_baseline"] is True
    assert fake.store.usage[("u_test", _today(), "analyze")] == 2

    def boom(request):
        raise engine.EngineError("engine_timeout", "slow", 504)

    monkeypatch.setattr(engine, "analyze", boom)
    failed = client.post(f"/v1/sessions/{sid}/analyze?force=1")
    assert failed.status_code == 504
    doc = _doc(fake, sid)
    assert doc["status"] == "done" and doc["error"] is None and doc.get("stage") is None
    assert json.loads(doc["result_json"])["session_id"] == first["result"]["session_id"]
    assert fake.store.usage[("u_test", _today(), "analyze")] == 2  # refunded


def _today() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).date().isoformat()


# ---- Live stage ----


def test_stage_follows_the_analysis(client, fake, monkeypatch):
    created = _create(client, n=3)
    sid = created["session_id"]
    _upload(fake, created["upload_urls"])
    seen = {}
    real_analyze, real_explain = engine.analyze, explain.generate

    def watch_engine(request):
        seen["engine"] = client.get(f"/v1/sessions/{sid}").json()["session"]["stage"]
        return real_analyze(request)

    def watch_explain(result, context, *rest):
        seen["explaining"] = _doc(fake, sid)["stage"]
        return real_explain(result, context, *rest)

    monkeypatch.setattr(engine, "analyze", watch_engine)
    monkeypatch.setattr(explain, "generate", watch_explain)
    view = client.post(f"/v1/sessions/{sid}/analyze").json()
    assert seen == {"engine": "engine", "explaining": "explaining"}
    assert view["session"]["stage"] is None and _doc(fake, sid)["stage"] is None
    listed = client.get("/v1/sessions").json()["sessions"][0]["session"]
    assert listed["stage"] is None


def test_stage_is_cleared_when_the_engine_fails(client, fake, monkeypatch):
    created = _create(client, n=1)
    sid = created["session_id"]
    _upload(fake, created["upload_urls"])

    def boom(request):
        raise engine.EngineError("frame_unreadable", "bad")

    monkeypatch.setattr(engine, "analyze", boom)
    client.post(f"/v1/sessions/{sid}/analyze")
    doc = _doc(fake, sid)
    assert doc["status"] == "failed" and doc["stage"] is None


# ---- Duplicates ----


def test_objects_flag_duplicates_of_earlier_sessions_and_within_one(client, fake):
    first = _create(client, n=2)
    _upload(fake, first["upload_urls"][:1], md5="same==")
    _upload(fake, first["upload_urls"][1:])
    objs = client.get(f"/v1/sessions/{first['session_id']}/objects").json()["objects"]
    assert [o["duplicate_of"] for o in objs] == [None, None]
    assert _doc(fake, first["session_id"])["frame_md5s"][0] == "same=="

    second = _create(client, n=3)
    sid = second["session_id"]
    t = second["upload_urls"]
    _upload(fake, t[:1], md5="same==")
    _upload(fake, t[1:2], md5="twice==")
    _upload(fake, t[2:], md5="twice==")
    objs = client.get(f"/v1/sessions/{sid}/objects").json()["objects"]
    assert objs[0]["duplicate_of"] == {"session_id": first["session_id"], "index": 1}
    assert objs[1]["duplicate_of"] is None
    assert objs[2]["duplicate_of"] == {"session_id": sid, "index": 2}


def test_duplicates_read_older_sessions_from_the_bucket_and_skip_samples(client, fake):
    old = _create(client, n=1)
    _upload(fake, old["upload_urls"], md5="old==")
    fake.store.session_update("u_test", old["session_id"], {"status": "done"})
    assert "frame_md5s" not in _doc(fake, old["session_id"])  # checked before md5s were kept
    sample = _create(client, n=1)
    _upload(fake, sample["upload_urls"], md5="sample==")
    fake.store.session_update("u_test", sample["session_id"], {"sample_id": "face_quick"})

    new = _create(client, n=2)
    _upload(fake, new["upload_urls"][:1], md5="old==")
    _upload(fake, new["upload_urls"][1:], md5="sample==")
    objs = client.get(f"/v1/sessions/{new['session_id']}/objects").json()["objects"]
    assert objs[0]["duplicate_of"] == {"session_id": old["session_id"], "index": 1}
    assert objs[1]["duplicate_of"] is None
    assert _doc(fake, old["session_id"])["frame_md5s"] == ["old=="]  # stored for next time


# ---- Signed media ----


def test_detail_signs_frames_and_crops_but_the_list_does_not(client, fake):
    created = _create(client, n=2)
    sid = created["session_id"]
    _upload(fake, created["upload_urls"])
    view = client.post(f"/v1/sessions/{sid}/analyze").json()
    candidates = view["result"]["candidates"]
    assert candidates, "the face fixture has candidates"
    for c in candidates[:2]:
        fake.put(_name(c["crop_uri"]), content_type=JPEG)

    detail = client.get(f"/v1/sessions/{sid}").json()["session"]
    get = "https://storage.googleapis.com/get/"
    assert detail["frame_urls"] == [
        f"{get}uploads/u_test/{sid}/frame_1.jpg",
        f"{get}uploads/u_test/{sid}/frame_2.jpg",
    ]
    assert detail["crop_urls"] == {c["id"]: f"{get}{_name(c['crop_uri'])}" for c in candidates[:2]}
    listed = client.get("/v1/sessions").json()["sessions"][0]["session"]
    assert "frame_urls" not in listed and "crop_urls" not in listed


def test_frame_urls_are_null_for_raw_and_missing_frames(client, fake):
    raw = _create(client, n=1, site="forearm_treated", mode="calibrated_raw")
    _upload(fake, raw["upload_urls"], content_type="image/x-adobe-dng")
    assert client.get(f"/v1/sessions/{raw['session_id']}").json()["session"]["frame_urls"] == [None]
    quick = _create(client, n=2)
    _upload(fake, quick["upload_urls"][:1])
    urls = client.get(f"/v1/sessions/{quick['session_id']}").json()["session"]["frame_urls"]
    assert urls[0] is not None and urls[1] is None
