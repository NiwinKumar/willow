from app import analysis, engine, views


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


def test_quick_selfies_get_their_own_baseline(client, fake):
    raw = _create(client)
    _upload_all(fake, raw)
    client.post(f"/v1/sessions/{raw['session_id']}/analyze")

    quick = _create(client, mode="uncalibrated")
    _upload_all(fake, quick)
    view = client.post(f"/v1/sessions/{quick['session_id']}/analyze").json()
    # Never compared with the calibrated baseline: it becomes the quick-selfie baseline.
    assert view["session"]["is_baseline"] is True
    assert {m["verdict"] for m in view["result"]["metrics"]} == {"no_baseline"}
    assert fake.store.baseline_get("u_test", "forearm_treated")["session_id"] == raw["session_id"]
    quick_base = fake.store.baseline_get("u_test", "forearm_treated__uncalibrated")
    assert quick_base["session_id"] == quick["session_id"]


def test_first_single_photo_session_is_the_baseline_without_a_noise_band(client, fake):
    first = _create(client, n=1)
    _upload_all(fake, first)
    view = client.post(f"/v1/sessions/{first['session_id']}/analyze").json()
    assert view["session"]["is_baseline"] is True
    assert view["session"]["baseline"]["has_noise_band"] is False

    later = _create(client, n=1)
    _upload_all(fake, later)
    view = client.post(f"/v1/sessions/{later['session_id']}/analyze").json()
    assert view["session"]["baseline"] == {
        "session_id": first["session_id"],
        "frames": 1,
        "has_noise_band": False,
    }
    # Deltas are reported, but nothing can be called a real change without a noise band.
    assert all(m["delta"] is not None for m in view["result"]["metrics"])
    assert "real_change" not in {m["verdict"] for m in view["result"]["metrics"]}


def test_placeholder_results_are_never_shown_or_used_as_a_baseline(client, fake, monkeypatch):
    def placeholder(request):
        result = engine.fixture_result(request)
        result["engine_version"] = "0.2.0-placeholder"
        result["warnings"] = ["placeholder: face_full not analysed yet, fixture data"]
        return result

    monkeypatch.setattr(engine, "analyze", placeholder)
    created = _create(client, site="face_full", n=1)
    _upload_all(fake, created)
    view = client.post(f"/v1/sessions/{created['session_id']}/analyze").json()
    assert view["session"]["status"] == "done"
    assert view["session"]["measured"] is False
    assert view["result"] is None and view["explanation"] is None
    assert view["session"]["is_baseline"] is False
    assert fake.store.baseline_get("u_test", "face_full") is None
    listed = client.get("/v1/sessions", params={"site": "face_full"}).json()["sessions"]
    assert listed[0]["result"] is None and listed[0]["session"]["measured"] is False
    refused = client.post("/v1/baselines/face_full", json={"session_id": created["session_id"]})
    assert refused.status_code == 409


def test_sessions_analysed_before_the_measured_flag_hide_placeholders(client, fake):
    created = _create(client, site="face_full", n=1)
    result = engine.fixture_result(
        {
            "schema_version": "1.0",
            "session_id": created["session_id"],
            "user_id": "u_test",
            "site": "face_full",
            "capture_mode": "calibrated_raw",
            "frames": [{"uri": "gs://b/x"}],
        }
    )
    result["engine_version"] = "0.2.0-placeholder"
    import json

    fake.store.session_update(
        "u_test",
        created["session_id"],
        {"status": "done", "result_json": json.dumps(result), "is_baseline": True},
    )
    view = client.get(f"/v1/sessions/{created['session_id']}").json()
    assert view["result"] is None
    assert view["session"]["measured"] is False and view["session"]["is_baseline"] is False


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
    assert tl["baseline_session_ids"]["uncalibrated"] == sids[0]
    assert tl["baseline_session_id"] is None  # no calibrated baseline yet
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


def test_sessions_keep_the_baseline_they_were_compared_with(client, fake):
    first = _create(client, n=1)
    _upload_all(fake, first)
    client.post(f"/v1/sessions/{first['session_id']}/analyze")
    second = _create(client, n=5)
    _upload_all(fake, second)
    client.post(f"/v1/sessions/{second['session_id']}/analyze")
    third = _create(client, n=1)
    _upload_all(fake, third)
    client.post(f"/v1/sessions/{third['session_id']}/analyze")

    client.post("/v1/baselines/forearm_treated", json={"session_id": second["session_id"]})
    view = client.get(f"/v1/sessions/{third['session_id']}").json()
    # Still labelled with the baseline its numbers were computed against.
    assert view["session"]["baseline"]["session_id"] == first["session_id"]
    assert view["session"]["baseline"]["has_noise_band"] is False


def test_legacy_baselines_from_placeholders_are_ignored(client, fake):
    import json as _json

    created = _create(client, n=1)
    result = engine.fixture_result(
        {
            "schema_version": "1.0",
            "session_id": created["session_id"],
            "user_id": "u_test",
            "site": "forearm_treated",
            "capture_mode": "calibrated_raw",
            "frames": [{"uri": "gs://b/x"}],
        }
    )
    result["engine_version"] = "0.2.0-placeholder"
    fake.store.session_update(
        "u_test", created["session_id"], {"status": "done", "result_json": _json.dumps(result)}
    )
    fake.store.baseline_set(
        "u_test",
        "forearm_treated",
        {
            "session_id": created["session_id"],
            "metrics": {"redness": {"mean": 13.4, "mdc95": 0.86, "n_frames": 5}},
        },
    )
    fresh = _create(client, n=1)
    _upload_all(fake, fresh)
    view = client.post(f"/v1/sessions/{fresh['session_id']}/analyze").json()
    # The fake baseline is not used: this real session becomes the baseline instead.
    assert view["session"]["is_baseline"] is True
    assert {m["verdict"] for m in view["result"]["metrics"]} == {"no_baseline"}


def test_saved_sessions_are_measured_again_oldest_first(client, fake, monkeypatch):
    """Face photos saved before face measurement existed: the earliest becomes the baseline."""

    real_analyze = engine.analyze

    def placeholder(request):
        result = engine.fixture_result(request)
        result["engine_version"] = "0.2.0-placeholder"
        return result

    monkeypatch.setattr(engine, "analyze", placeholder)
    first = _create(client, site="face_full", n=5)
    second = _create(client, site="face_full", n=3)
    for created in (first, second):
        _upload_all(fake, created)
        client.post(f"/v1/sessions/{created['session_id']}/analyze")
    assert fake.store.baseline_get("u_test", "face_full") is None

    monkeypatch.setattr(engine, "analyze", real_analyze)
    dry = analysis.remeasure(fake.store, "b", "u_test")
    assert len(dry) == 2 and all(line.endswith("would measure") for line in dry)
    lines = analysis.remeasure(fake.store, "b", "u_test", apply=True)
    assert lines[0].endswith("measured, now the baseline")
    assert fake.store.baseline_get("u_test", "face_full")["session_id"] == first["session_id"]
    later = fake.store.session_get("u_test", second["session_id"])
    assert later["measured"] is True and later["compared_with"]["session_id"] == first["session_id"]
    assert analysis.remeasure(fake.store, "b", "u_test", apply=True) == []


def test_quick_selfie_shows_its_own_photo_and_raw_waits_for_a_preview(client, fake):
    quick = _create(client, mode="uncalibrated", n=1)
    _upload_all(fake, quick)
    view = client.post(f"/v1/sessions/{quick['session_id']}/analyze").json()
    assert view["session"]["preview"]["url"].endswith(f"{quick['session_id']}/frame_1.jpg")
    raw = _create(client, n=1)
    _upload_all(fake, raw)
    view = client.post(f"/v1/sessions/{raw['session_id']}/analyze").json()
    assert view["session"]["preview"] is None


def test_a_second_analyze_while_one_runs_is_refused_and_not_counted(client, fake):
    from datetime import UTC, datetime

    created = _create(client)
    _upload_all(fake, created)
    sid = created["session_id"]
    fake.store.session_update(
        "u_test", sid, {"status": "processing", "processing_started_at": datetime.now(UTC)}
    )
    res = client.post(f"/v1/sessions/{sid}/analyze")
    assert res.status_code == 409 and res.json()["detail"]["code"] == "conflict"
    day = datetime.now(UTC).date().isoformat()
    assert fake.store.usage.get(("u_test", day, "analyze")) == 0


def test_engine_failure_gives_the_analysis_back(client, fake, monkeypatch):
    from datetime import UTC, datetime

    def down(request):
        raise engine.EngineError("engine_timeout", "slow", 504)

    monkeypatch.setattr(engine, "analyze", down)
    created = _create(client)
    _upload_all(fake, created)
    assert client.post(f"/v1/sessions/{created['session_id']}/analyze").status_code == 504
    day = datetime.now(UTC).date().isoformat()
    assert fake.store.usage.get(("u_test", day, "analyze")) == 0


def test_a_session_made_baseline_shows_no_deltas_against_the_old_one(client, fake):
    first = _create(client)
    _upload_all(fake, first)
    client.post(f"/v1/sessions/{first['session_id']}/analyze")
    second = _create(client)
    _upload_all(fake, second)
    sid = second["session_id"]
    before = client.post(f"/v1/sessions/{sid}/analyze").json()
    assert any(m["delta"] is not None for m in before["result"]["metrics"])
    assert client.post("/v1/baselines/forearm_treated", json={"session_id": sid}).status_code == 200
    after = client.get(f"/v1/sessions/{sid}").json()
    assert after["session"]["is_baseline"] is True
    assert all(m["delta"] is None for m in after["result"]["metrics"])
    assert after["session"]["baseline"]["session_id"] == sid


def test_stage_photo_is_the_photo_the_engine_measured(client, fake, monkeypatch):
    """Spots are found on the first face photo that passed; the stage shows that photo."""
    real = engine.analyze

    def first_two_blurry(request):
        result = real(request)
        result["site"] = "face_full"
        result["quality"]["per_frame"] = [
            {"index": i, "passed": i >= 2, "reasons": [] if i >= 2 else ["blurry"]}
            for i in range(len(request["frames"]))
        ]
        return result

    monkeypatch.setattr(engine, "analyze", first_two_blurry)
    created = _create(client, site="face_full", mode="uncalibrated", n=4)
    _upload_all(fake, created)
    view = client.post(f"/v1/sessions/{created['session_id']}/analyze").json()
    assert view["session"]["preview"]["url"].endswith(f"{created['session_id']}/frame_3.jpg")


def test_reference_index_rules():
    face = {
        "site": "face_full",
        "quality": {
            "per_frame": [
                {"index": 0, "passed": False, "reasons": ["face_not_found"]},
                {"index": 1, "passed": False, "reasons": ["blurry"]},
            ]
        },
    }
    assert views.reference_index(face) == 1
    arm = {
        "site": "forearm_control",
        "quality": {
            "per_frame": [
                {"index": 0, "passed": False, "reasons": []},
                {"index": 1, "passed": False, "reasons": ["blurry"]},
                {"index": 2, "passed": True, "reasons": []},
            ]
        },
    }
    assert views.reference_index(arm) == 1
    assert views.reference_index(None) == 0


def test_remeasure_named_session_runs_again_when_already_measured(client, fake):
    created = _create(client, site="forearm_control")
    _upload_all(fake, created)
    client.post(f"/v1/sessions/{created['session_id']}/analyze")
    assert analysis.remeasure(fake.store, "b", "u_test") == []
    lines = analysis.remeasure(
        fake.store, "b", "u_test", apply=True, sessions={created["session_id"]}
    )
    assert len(lines) == 1 and "measured" in lines[0]
    assert (
        fake.store.baseline_get("u_test", "forearm_control")["session_id"] == created["session_id"]
    )


def test_malformed_session_ids_are_not_found(client):
    assert client.get("/v1/sessions/__x__").status_code == 404
    assert client.get("/v1/sessions/s_" + "9" * 2000).status_code == 404


def test_a_crash_marks_the_session_failed_with_a_plain_message(client, fake, monkeypatch):
    created = _create(client)
    _upload_all(fake, created)

    def boom(request):
        raise RuntimeError("token minting failed: gs://bucket/uploads/u_test/secret")

    monkeypatch.setattr(engine, "analyze", boom)
    res = client.post(f"/v1/sessions/{created['session_id']}/analyze")
    assert res.status_code == 502
    assert "gs://" not in res.text and "RuntimeError" not in res.text
    doc = fake.store.session_get("u_test", created["session_id"])
    assert doc["status"] == "failed"


def test_engine_error_text_never_reaches_people(client, fake, monkeypatch):
    created = _create(client)
    _upload_all(fake, created)

    def html_error(request):
        raise engine.EngineError("internal", "<html>503 Service Unavailable</html>")

    monkeypatch.setattr(engine, "analyze", html_error)
    res = client.post(f"/v1/sessions/{created['session_id']}/analyze")
    assert "<html>" not in res.text
    assert res.json()["detail"]["message"].startswith("Something went wrong while measuring")


def test_data_deleted_mid_measurement_leaves_nothing(client, fake, monkeypatch):
    created = _create(client)
    _upload_all(fake, created)
    sid = created["session_id"]
    real = engine.analyze

    def delete_while_running(request):
        result = real(request)
        fake.store.delete_user("u_test")  # "Delete my data" in another tab
        fake.put(f"results/u_test/{sid}/crops/c_001.jpg", content_type="image/jpeg")
        return result

    monkeypatch.setattr(engine, "analyze", delete_while_running)
    assert client.post(f"/v1/sessions/{sid}/analyze").status_code == 404
    assert not [n for n in fake.blobs if n.startswith(f"results/u_test/{sid}/")]


def test_counts_are_not_compared_across_one_photo_and_several():
    from app import baselines

    result = {
        "site": "face_full",
        "frames_used": 3,
        "warnings": [],
        "metrics": [
            {"id": "blemishes", "delta": -4.0, "verdict": "real_change", "direction": "decrease"},
            {"id": "redness", "delta": 0.5, "verdict": "within_noise", "direction": "increase"},
        ],
    }
    baselines.guard_counts(result, {"frames": 1})
    blem, red = result["metrics"]
    assert blem["delta"] is None and blem["verdict"] == "no_baseline"
    assert red["delta"] == 0.5  # other metrics are compared as usual
    assert result["warnings"] == [baselines.COUNTS_NOT_COMPARED]
    same = {"site": "face_full", "frames_used": 3, "metrics": [{"id": "blemishes", "delta": -1}]}
    baselines.guard_counts(same, {"frames": 5})
    assert same["metrics"][0]["delta"] == -1


def test_no_comparison_across_engine_versions_and_bands_from_the_baseline():
    from app import baselines, explain

    result = {
        "engine_version": "0.3.0",
        "warnings": [],
        "metrics": [{"id": "redness", "delta": 1.0, "verdict": "real_change", "direction": "x"}],
    }
    baselines.guard_engine_version(result, {"engine_version": "0.2.0"})
    assert result["metrics"][0]["delta"] is None and result["warnings"] == [
        baselines.ENGINE_CHANGED
    ]
    same = {"engine_version": "0.3.4", "metrics": [{"id": "redness", "delta": 1.0}]}
    baselines.guard_engine_version(same, {"engine_version": "0.3.0"})
    assert same["metrics"][0]["delta"] == 1.0  # a patch release keeps comparisons

    banded = explain.with_bands(
        {"metrics": [{"id": "redness", "unit": "a_star", "delta": 1.2, "mdc95": None}]},
        {"redness": 0.9},
    )
    assert banded["metrics"][0]["mdc95"] == 0.9  # the band the verdict used


def test_remeasuring_the_baseline_refreshes_or_clears_it(client, fake, monkeypatch):
    created = _create(client, site="forearm_control")
    _upload_all(fake, created)
    sid = created["session_id"]
    client.post(f"/v1/sessions/{sid}/analyze")
    assert fake.store.baseline_get("u_test", "forearm_control")["session_id"] == sid

    real = engine.analyze

    def now_fails(request):  # e.g. a new engine no longer finds the square in this photo
        result = real(request)
        result["quality"]["passed"] = False
        return result

    monkeypatch.setattr(engine, "analyze", now_fails)
    analysis.remeasure(fake.store, "b", "u_test", apply=True, sessions={sid})
    assert fake.store.baseline_get("u_test", "forearm_control") is None
    assert fake.store.session_get("u_test", sid)["is_baseline"] is False
