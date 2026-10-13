from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import storage
from app.routes import dev_routes


def test_dev_upload_links_point_at_the_local_api(monkeypatch):
    settings = storage.get_settings()
    monkeypatch.setattr(settings, "auth_mode", "dev")
    monkeypatch.setattr(settings, "dev_uploads", True)
    url = storage.signed_put_url("uploads/u/s/frame_1.jpg", "image/jpeg", 900)
    assert url.startswith("http://localhost:8080/v1/dev/upload?")
    assert "name=uploads%2Fu%2Fs%2Fframe_1.jpg" in url and "content_type=image%2Fjpeg" in url


def test_dev_uploads_are_off_unless_both_flags_are_set(monkeypatch):
    settings = storage.get_settings()
    monkeypatch.setattr(settings, "dev_uploads", True)
    monkeypatch.setattr(settings, "auth_mode", "firebase")
    assert storage.dev_uploads_enabled() is False


def test_dev_upload_writes_only_under_uploads(monkeypatch):
    written = {}
    monkeypatch.setattr(
        storage, "put_bytes", lambda name, data, ct: written.update({name: (data, ct)})
    )
    app = FastAPI()
    app.include_router(dev_routes.router)
    client = TestClient(app)
    ok = client.put(
        "/v1/dev/upload",
        params={"name": "uploads/u/s/frame_1.jpg", "content_type": "image/jpeg"},
        content=b"jpeg-bytes",
    )
    assert ok.status_code == 200
    assert written == {"uploads/u/s/frame_1.jpg": (b"jpeg-bytes", "image/jpeg")}
    for bad in ("results/u/s/x.jpg", "uploads/../secrets"):
        res = client.put(
            "/v1/dev/upload", params={"name": bad, "content_type": "image/jpeg"}, content=b"x"
        )
        assert res.status_code == 400
