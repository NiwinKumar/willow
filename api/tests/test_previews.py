import io

from PIL import Image

from app import previews, storage
from tests.test_analyze_flow import _create, _upload_all


def _jpeg(width: int, height: int) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), (200, 150, 130)).save(out, format="JPEG")
    return out.getvalue()


def test_webp_is_shrunk_to_the_preview_height_and_keeps_the_shape():
    with Image.open(io.BytesIO(previews.to_webp(_jpeg(896, 1200)))) as im:
        assert im.format == "WEBP"
        assert im.size == (717, previews.PREVIEW_HEIGHT)


def test_a_small_photo_is_never_enlarged():
    with Image.open(io.BytesIO(previews.to_webp(_jpeg(300, 400)))) as im:
        assert im.size == (300, 400)


def test_publish_writes_a_cacheable_webp_next_to_the_jpeg(monkeypatch):
    written = {}
    monkeypatch.setattr(storage, "read_bytes", lambda name: _jpeg(896, 1200))
    monkeypatch.setattr(
        storage,
        "put_bytes",
        lambda name, data, ct, cache_control=None: written.update(
            name=name, ct=ct, cache_control=cache_control
        ),
    )
    assert previews.publish("results/u/s/preview.jpg") == "results/u/s/preview.webp"
    assert written == {
        "name": "results/u/s/preview.webp",
        "ct": "image/webp",
        "cache_control": "private, max-age=31536000, immutable",
    }


def test_publish_without_a_jpeg_writes_nothing(monkeypatch):
    monkeypatch.setattr(storage, "put_bytes", lambda *a, **k: (_ for _ in ()).throw(AssertionError))
    assert previews.publish("results/u/s/preview.jpg") is None  # read_bytes is offline in tests


def test_analysis_writes_the_webp_of_the_engine_preview(client, fake, monkeypatch):
    asked = []
    monkeypatch.setattr(previews, "publish", asked.append)
    created = _create(client, site="face_full", mode="uncalibrated")
    _upload_all(fake, created)
    client.post(f"/v1/sessions/{created['session_id']}/analyze")
    assert asked == [f"results/u_test/{created['session_id']}/preview.jpg"]


def test_views_sign_the_webp_when_there_is_one(client, fake):
    created = _create(client, site="face_full", mode="uncalibrated")
    _upload_all(fake, created)
    sid = created["session_id"]
    client.post(f"/v1/sessions/{sid}/analyze")
    fake.put(f"results/u_test/{sid}/preview.jpg", content_type="image/jpeg")
    fake.put(f"results/u_test/{sid}/preview.webp", content_type="image/webp")

    for view in (
        client.get("/v1/sessions").json()["sessions"][0],
        client.get(f"/v1/sessions/{sid}").json(),
    ):
        preview = view["session"]["preview"]
        assert preview["url"].endswith(f"results/u_test/{sid}/preview.webp")
        # still the engine's image_size: rings and overlays line up as with the JPEG
        assert preview["width"] == 3024 and preview["height"] == 4032
