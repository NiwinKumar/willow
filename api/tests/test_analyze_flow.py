from app import engine


def _create(client, site="forearm_treated", mode="calibrated_raw", n=5):
    ct = "image/x-adobe-dng" if mode == "calibrated_raw" else "image/jpeg"
    res = client.post(
        "/v1/sessions",
        json={"site": site, "capture_mode": mode, "n_frames": n, "content_types": [ct] * n},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _upload_all(fake, created):
    for target in created["upload_urls"]:
        fake.put(target["object_uri"].split("/", 3)[3])


def test_analyze_refuses_until_every_frame_is_uploaded(client, fake):
    created = _create(client)
    fake.put(created["upload_urls"][0]["object_uri"].split("/", 3)[3])
    res = client.post(f"/v1/sessions/{created['session_id']}/analyze")
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "frames_missing"


def test_first_calibrated_five_frame_session_becomes_the_baseline(client, fake):
    created = _create(client)
    _upload_all(fake, created)
    sid = created["session_id"]
    res = client.post(f"/v1/sessions/{sid}/analyze")
    assert res.status_code == 200, res.text
    view = res.json()
    assert view["session"]["status"] == "done"
    assert view["session"]["is_baseline"] is True
    assert view["session"]["hours_since_baseline"] == 0.0
    assert view["result"]["session_id"] == sid
    assert {m["verdict"] for m in view["result"]["metrics"]} == {"no_baseline"}
    assert view["explanation"]["headline"] == "Your first reading"
    assert view["session"]["explanation_source"] == "template"
    baseline = fake.store.baseline_get("u_test", "forearm_treated")
    assert baseline["session_id"] == sid
    assert set(baseline["metrics"]) == {"tone_ita", "redness"}


def test_later_sessions_are_compared_to_the_baseline(client, fake):
    first = _create(client)
    _upload_all(fake, first)
    client.post(f"/v1/sessions/{first['session_id']}/analyze")

    second = _create(client, n=1)
    _upload_all(fake, second)
    view = client.post(f"/v1/sessions/{second['session_id']}/analyze").json()
    assert view["session"]["is_baseline"] is False
    assert {m["verdict"] for m in view["result"]["metrics"]} <= {"within_noise", "real_change"}
    assert all(m["delta"] is not None for m in view["result"]["metrics"])


def test_uncalibrated_sessions_never_become_the_auto_baseline(client, fake):
    created = _create(client, mode="uncalibrated")
    _upload_all(fake, created)
    view = client.post(f"/v1/sessions/{created['session_id']}/analyze").json()
    assert view["session"]["is_baseline"] is False
    assert fake.store.baseline_get("u_test", "forearm_treated") is None


def test_engine_failure_marks_the_session_failed(client, fake, monkeypatch):
    created = _create(client)
    _upload_all(fake, created)

    def boom(request):
        raise engine.EngineError("frame_unreadable", "cannot decode frame 2")

    monkeypatch.setattr(engine, "analyze", boom)
    res = client.post(f"/v1/sessions/{created['session_id']}/analyze")
    assert res.status_code == 502
    doc = fake.store.session_get("u_test", created["session_id"])
    assert doc["status"] == "failed"
    assert doc["error"]["code"] == "frame_unreadable"
    # Upload links can be re-issued for a retry.
    again = client.post(f"/v1/sessions/{created['session_id']}/upload-urls")
    assert again.status_code == 200
    assert len(again.json()["upload_urls"]) == 5


def test_list_detail_preview_and_overlays(client, fake):
    created = _create(client, site="face_full")
    _upload_all(fake, created)
    sid = created["session_id"]
    client.post(f"/v1/sessions/{sid}/analyze")
    fake.put(f"results/u_test/{sid}/preview.jpg", content_type="image/jpeg")
    fake.put(f"results/u_test/{sid}/overlays/redness.png", content_type="image/png")

    listed = client.get("/v1/sessions", params={"site": "face_full"}).json()["sessions"]
    assert [s["session"]["id"] for s in listed] == [sid]
    preview = listed[0]["session"]["preview"]
    assert preview["url"].endswith(f"results/u_test/{sid}/preview.jpg")
    assert preview["width"] == 3024 and preview["height"] == 4032
    assert listed[0]["session"]["overlay_urls"] == {}

    detail = client.get(f"/v1/sessions/{sid}").json()
    assert detail["session"]["overlay_urls"] == {
        "redness": f"https://storage.googleapis.com/get/results/u_test/{sid}/overlays/redness.png"
    }
    assert client.get("/v1/sessions", params={"site": "nose_macro"}).json() == {"sessions": []}


def test_patch_note_and_deviation(client, fake):
    sid = _create(client)["session_id"]
    res = client.patch(f"/v1/sessions/{sid}", json={"note": "New moisturiser", "deviation": True})
    assert res.status_code == 200
    assert res.json()["session"]["note"] == "New moisturiser"
    assert res.json()["session"]["deviation"] is True
    too_long = client.patch(f"/v1/sessions/{sid}", json={"note": "x" * 281})
    assert too_long.status_code == 422


def test_timeline_and_manual_baseline(client, fake):
    sids = []
    for _ in range(2):
        created = _create(client, mode="uncalibrated", n=1)
        _upload_all(fake, created)
        client.post(f"/v1/sessions/{created['session_id']}/analyze")
        sids.append(created["session_id"])

    set_res = client.post("/v1/baselines/forearm_treated", json={"session_id": sids[0]})
    assert set_res.status_code == 200, set_res.text
    assert set_res.json()["session_id"] == sids[0]
    assert fake.store.session_get("u_test", sids[0])["is_baseline"] is True

    tl = client.get("/v1/timeline", params={"site": "forearm_treated"}).json()
    assert tl["baseline_session_id"] == sids[0]
    assert [p["session_id"] for p in tl["metrics"]["redness"]] == sids

    wrong_site = client.post("/v1/baselines/face_full", json={"session_id": sids[0]})
    assert wrong_site.status_code == 404


def test_other_users_cannot_see_a_session(client, fake):
    sid = _create(client)["session_id"]
    from fastapi.testclient import TestClient

    from app.main import app

    other = TestClient(app, headers={"X-Dev-Uid": "u_other"})
    assert other.get(f"/v1/sessions/{sid}").status_code == 404
    assert other.post(f"/v1/sessions/{sid}/analyze").status_code == 404
    assert other.get("/v1/sessions").json() == {"sessions": []}


def test_delete_me_removes_photos_results_and_documents(client, fake):
    created = _create(client)
    _upload_all(fake, created)
    client.post(f"/v1/sessions/{created['session_id']}/analyze")
    res = client.delete("/v1/me")
    assert res.status_code == 204
    assert fake.deleted_prefixes == ["uploads/u_test/", "results/u_test/"]
    assert fake.store.sessions_list("u_test") == []
    assert fake.store.baseline_get("u_test", "forearm_treated") is None
