import os

os.environ.setdefault("AUTH_MODE", "dev")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:5173")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import sessions as sessions_mod  # noqa: E402
from app import storage  # noqa: E402
from app.main import app  # noqa: E402


class FakeStore:
    """In-memory stand-ins for GCS and Firestore."""

    def __init__(self) -> None:
        self.docs: dict[tuple[str, str], dict] = {}
        self.blobs: dict[str, storage.ObjectInfo] = {}


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeStore:
    store = FakeStore()
    monkeypatch.setattr(
        storage,
        "signed_put_url",
        lambda name, ct, ttl: f"https://storage.googleapis.com/signed/{name}?ttl={ttl}",
    )
    monkeypatch.setattr(
        storage,
        "object_info",
        lambda name: store.blobs.get(
            name, storage.ObjectInfo(storage.object_uri(name), False, None, None, None)
        ),
    )
    monkeypatch.setattr(
        sessions_mod, "create", lambda uid, sid, data: store.docs.__setitem__((uid, sid), data)
    )
    monkeypatch.setattr(sessions_mod, "get", lambda uid, sid: store.docs.get((uid, sid)))
    return store


@pytest.fixture
def client() -> TestClient:
    return TestClient(app, headers={"X-Dev-Uid": "u_test"})
