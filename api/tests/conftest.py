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

    def put(
        self,
        name: str,
        size: int = 1000,
        content_type: str = "image/x-adobe-dng",
        md5: str | None = None,
    ) -> None:
        # each object its own MD5 unless a test says otherwise (duplicate checks compare them)
        self.blobs[name] = storage.ObjectInfo(
            storage.object_uri(name), True, size, md5 or f"md5:{name}", content_type
        )


@pytest.fixture(autouse=True)
def no_real_gemini(monkeypatch: pytest.MonkeyPatch):
    """Tests never call Vertex; a test that needs Gemini replaces generate_json itself."""
    from app import gemini

    def offline(*args, **kwargs):
        raise gemini.GeminiError("offline in tests")

    monkeypatch.setattr(gemini, "generate_json", offline)
    # the shelf agent calls the model directly: offline too (its tests script it)
    from app import shelf_agent

    monkeypatch.setattr(shelf_agent, "model_round", offline)


@pytest.fixture(autouse=True)
def no_real_bigquery(monkeypatch: pytest.MonkeyPatch):
    """Tests never query BigQuery; a test that needs insights replaces retailer.insights."""
    from app import retailer

    def offline():
        raise RuntimeError("offline in tests")

    monkeypatch.setattr(retailer, "fetch", offline)


@pytest.fixture(autouse=True)
def no_real_crops(monkeypatch: pytest.MonkeyPatch):
    """Tests never read crops from the bucket; a test that needs them replaces read_bytes."""

    def offline(name: str) -> bytes:
        raise FileNotFoundError(name)

    monkeypatch.setattr(storage, "read_bytes", offline)


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

    def list_names(prefix: str, globs: tuple[str, ...] = storage.DISPLAYABLE) -> set[str]:
        # as GCS match_glob does: "**/" any folders, "*" one name
        import fnmatch

        pats = [f"{prefix}{g}" for g in globs] + [
            f"{prefix}{g.removeprefix('**/')}" for g in globs if g.startswith("**/")
        ]  # "**/" also matches no folder at all
        return {
            n
            for n in cloud.blobs
            if n.startswith(prefix) and any(fnmatch.fnmatch(n, p) for p in pats)
        }

    monkeypatch.setattr(storage, "list_names", list_names)

    def delete_prefix(prefix: str) -> int:
        cloud.deleted_prefixes.append(prefix)
        gone = [n for n in cloud.blobs if n.startswith(prefix)]
        for n in gone:
            del cloud.blobs[n]
        return len(gone)

    monkeypatch.setattr(storage, "delete_prefix", delete_prefix)
    monkeypatch.setattr(storage, "delete_object", lambda name: cloud.blobs.pop(name, None))
    monkeypatch.setattr(
        storage,
        "list_md5s",
        lambda prefix: {
            n: b.md5_base64 for n, b in cloud.blobs.items() if n.startswith(prefix) and b.md5_base64
        },
    )
    app.dependency_overrides[get_store] = lambda: cloud.store
    yield cloud
    app.dependency_overrides.pop(get_store, None)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app, headers={"X-Dev-Uid": "u_test"})


@pytest.fixture(autouse=True)
def no_real_health_probes(monkeypatch: pytest.MonkeyPatch):
    """/v1/demo/status never reaches Vertex, the bucket or BigQuery in tests: every live probe
    answers at once; a test that needs a failing one replaces it."""
    from app import demo

    for name in ("probe_gemini", "probe_storage", "probe_bigquery"):
        monkeypatch.setattr(demo, name, lambda: None)
