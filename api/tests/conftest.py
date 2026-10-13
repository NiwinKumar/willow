import os

os.environ.setdefault("AUTH_MODE", "dev")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:5173")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import storage  # noqa: E402
from app.main import app  # noqa: E402
from app.store import MemoryStore, get_store  # noqa: E402


class FakeCloud:
    """In-memory stand-ins for Firestore (MemoryStore) and the captures bucket."""

    def __init__(self) -> None:
        self.store = MemoryStore()
        self.blobs: dict[str, storage.ObjectInfo] = {}
        self.deleted_prefixes: list[str] = []

    # Kept for the M1 tests that read session docs directly.
    @property
    def docs(self) -> dict:
        return self.store.sessions

    def put(self, name: str, size: int = 1000, content_type: str = "image/x-adobe-dng") -> None:
        self.blobs[name] = storage.ObjectInfo(
            storage.object_uri(name), True, size, "md5==", content_type
        )


@pytest.fixture(autouse=True)
def no_real_gemini(monkeypatch: pytest.MonkeyPatch):
    """Tests never call Vertex; a test that needs Gemini replaces generate_json itself."""
    from app import gemini

    def offline(*args, **kwargs):
        raise gemini.GeminiError("offline in tests")

    monkeypatch.setattr(gemini, "generate_json", offline)


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch):
    cloud = FakeCloud()
    monkeypatch.setattr(
        storage,
        "signed_put_url",
        lambda name, ct, ttl: f"https://storage.googleapis.com/signed/{name}?ttl={ttl}",
    )
    monkeypatch.setattr(
        storage,
        "object_info",
        lambda name: cloud.blobs.get(
            name, storage.ObjectInfo(storage.object_uri(name), False, None, None, None)
        ),
    )
    monkeypatch.setattr(
        storage, "signed_get_url", lambda name: f"https://storage.googleapis.com/get/{name}"
    )
    monkeypatch.setattr(
        storage, "list_names", lambda prefix: {n for n in cloud.blobs if n.startswith(prefix)}
    )

    def delete_prefix(prefix: str) -> int:
        cloud.deleted_prefixes.append(prefix)
        gone = [n for n in cloud.blobs if n.startswith(prefix)]
        for n in gone:
            del cloud.blobs[n]
        return len(gone)

    monkeypatch.setattr(storage, "delete_prefix", delete_prefix)
    app.dependency_overrides[get_store] = lambda: cloud.store
    yield cloud
    app.dependency_overrides.pop(get_store, None)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app, headers={"X-Dev-Uid": "u_test"})
