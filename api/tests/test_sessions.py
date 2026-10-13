import re

from app import storage


def test_create_session_returns_signed_urls(client, fake):
    res = client.post(
        "/v1/sessions",
        json={
            "site": "forearm_treated",
            "capture_mode": "calibrated_raw",
            "n_frames": 2,
            "content_types": ["image/x-adobe-dng", "image/x-adobe-dng"],
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert re.fullmatch(r"s_\d{8}_[0-9a-f]{8}", body["session_id"])
    assert body["expires_in_seconds"] == 900
    assert [u["index"] for u in body["upload_urls"]] == [1, 2]
    first = body["upload_urls"][0]
    assert first["object_uri"].endswith(f"/uploads/u_test/{body['session_id']}/frame_1.dng")
    assert first["url"].startswith("https://storage.googleapis.com/signed/")
    assert first["headers"] == {"Content-Type": "image/x-adobe-dng"}
    doc = fake.docs[("u_test", body["session_id"])]
    assert doc["site"] == "forearm_treated" and doc["n_frames"] == 2
    assert len(doc["frame_uris"]) == 2


def test_create_session_rejects_wrong_content_type_for_mode(client, fake):
    res = client.post(
        "/v1/sessions",
        json={
            "site": "face_full",
            "capture_mode": "calibrated_raw",
            "n_frames": 1,
            "content_types": ["image/jpeg"],
        },
    )
    assert res.status_code == 422


def test_create_session_rejects_count_mismatch_and_bad_site(client, fake):
    bad_count = client.post(
        "/v1/sessions",
        json={
            "site": "face_full",
            "capture_mode": "uncalibrated",
            "n_frames": 2,
            "content_types": ["image/jpeg"],
        },
    )
    assert bad_count.status_code == 422
    bad_site = client.post(
        "/v1/sessions",
        json={
            "site": "left_ear",
            "capture_mode": "uncalibrated",
            "n_frames": 1,
            "content_types": ["image/jpeg"],
        },
    )
    assert bad_site.status_code == 422


def test_requires_auth(fake):
    from fastapi.testclient import TestClient

    from app.main import app

    res = TestClient(app).post(
        "/v1/sessions",
        json={
            "site": "face_full",
            "capture_mode": "uncalibrated",
            "n_frames": 1,
            "content_types": ["image/jpeg"],
        },
    )
    assert res.status_code == 401


def test_session_objects_reports_size_and_md5(client, fake):
    created = client.post(
        "/v1/sessions",
        json={
            "site": "face_full",
            "capture_mode": "uncalibrated",
            "n_frames": 1,
            "content_types": ["image/jpeg"],
        },
    ).json()
    sid = created["session_id"]
    name = f"uploads/u_test/{sid}/frame_1.jpg"
    fake.blobs[name] = storage.ObjectInfo(
        storage.object_uri(name), True, 1234, "abc==", "image/jpeg"
    )

    res = client.get(f"/v1/sessions/{sid}/objects")
    assert res.status_code == 200
    obj = res.json()["objects"][0]
    assert obj["exists"] is True and obj["size"] == 1234 and obj["md5_base64"] == "abc=="


def test_session_objects_404_for_other_user(client, fake):
    res = client.get("/v1/sessions/s_20261013_deadbeef/objects")
    assert res.status_code == 404
