import base64
import json
import threading
from types import SimpleNamespace

from app import gcp, storage


class _Creds:
    universe_domain = "googleapis.com"

    def before_request(self, request, method, url, headers):
        headers["authorization"] = "Bearer source-token"


def test_signatures_share_one_session(monkeypatch):
    """Every signBlob call goes through the same transport (google-auth's impersonated
    credentials open a new session per signature)."""
    signing = storage.SharedSessionSigning(_Creds(), "sa-api@p.iam.gserviceaccount.com")
    transports, urls = set(), []

    def transport(url, method, body, headers):
        transports.add(id(signing.signer._request))
        urls.append(url)
        assert json.loads(body)["payload"] == base64.b64encode(b"msg").decode()
        return SimpleNamespace(
            status=200, data=json.dumps({"signedBlob": base64.b64encode(b"sig").decode()}).encode()
        )

    signing.signer._request = transport
    assert signing.sign_bytes(b"msg") == b"sig" and signing.sign_bytes(b"msg") == b"sig"
    assert len(transports) == 1 and len(urls) == 2
    assert "sa-api@p.iam.gserviceaccount.com:signBlob" in urls[0]
    assert signing.signer_email == "sa-api@p.iam.gserviceaccount.com"


def test_signing_wraps_impersonated_credentials_once(monkeypatch):
    impersonated = SimpleNamespace(_source_credentials=_Creds(), signer_email="sa@p")
    made = []
    monkeypatch.setattr(storage, "_signing", None)
    monkeypatch.setattr(gcp, "signing_credentials", lambda: made.append(1) or impersonated)
    first = storage.signing()
    assert isinstance(first, storage.SharedSessionSigning) and first.signer_email == "sa@p"
    assert storage.signing() is first and made == [1]
    # credentials that sign by themselves (a key, a test double) are used as they are
    plain = SimpleNamespace(signer_email="x")
    monkeypatch.setattr(storage, "_signing", None)
    monkeypatch.setattr(gcp, "signing_credentials", lambda: plain)
    assert storage.signing() is plain
    monkeypatch.setattr(storage, "_signing", None)


def test_list_names_lists_each_glob_at_once_names_only(monkeypatch):
    globs = ("**/preview.jpg", "**/overlays/*", "**/crops/*")
    together = threading.Barrier(len(globs), timeout=3)
    calls = []

    class Client:
        def list_blobs(self, bucket, prefix, match_glob, fields):
            together.wait()  # breaks unless the listings run side by side
            calls.append((prefix, match_glob, fields))
            name = {
                "**/preview.jpg": "preview.jpg",
                "**/overlays/*": "overlays/redness.png",
                "**/crops/*": "crops/c_1.jpg",
            }[match_glob]
            return [SimpleNamespace(name=f"{prefix}{name}")]

    monkeypatch.setattr(gcp, "storage_client", lambda: Client())
    out = storage.list_names("results/u/s/", globs)
    assert out == {
        "results/u/s/preview.jpg",
        "results/u/s/overlays/redness.png",
        "results/u/s/crops/c_1.jpg",
    }
    assert {g for _, g, _ in calls} == set(globs)
    assert all(f == "items(name),nextPageToken" for _, _, f in calls)
    assert storage.list_names("results/u/s/", ()) == set()
