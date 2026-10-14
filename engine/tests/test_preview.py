"""preview.jpg (CONTRACT_CHANGES proposal 1b): the reference photo the response describes,
as a JPEG the browser can show."""

import numpy as np
import pytest
from PIL import Image
from test_align import _frame
from test_face import FakeFace, _face_photo, fake_landmarks  # noqa: F401 (fixture)
from test_metrics_forearm import _fake_photo

from app.pipeline import analyze_forearm
from app.pipeline_face import _align, analyze_face
from app.roi import Box


def _grey_photo(path, value=128, size=(1000, 1000)):
    rng = np.random.default_rng(0)
    img = np.full((*size, 3), float(value)) + rng.normal(0, 4, (*size, 1))  # sharp texture
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path, quality=95)


@pytest.mark.usefixtures("fake_landmarks")
def test_face_preview_is_the_reference_photo_at_image_size(tmp_path):
    _grey_photo(tmp_path / "face.jpg")
    out = tmp_path / "out"
    r = analyze_face([str(tmp_path / "face.jpg")], output_prefix=str(out))
    with Image.open(out / "preview.jpg") as im:
        assert im.format == "JPEG"
        assert im.size == (r["image_size"]["width"], r["image_size"]["height"])
        centre = np.asarray(im.convert("RGB"))[400:600, 400:600].reshape(-1, 3).mean(axis=0)
    assert np.allclose(centre, 128, atol=4)  # mid-grey stays mid-grey (sRGB, not linear)


@pytest.mark.usefixtures("fake_landmarks")
def test_large_photo_preview_is_shrunk_by_a_whole_factor(tmp_path):
    _grey_photo(tmp_path / "big.jpg", size=(3400, 2000))
    analyze_face([str(tmp_path / "big.jpg")], output_prefix=str(tmp_path))
    with Image.open(tmp_path / "preview.jpg") as im:
        assert max(im.size) <= 1600
        assert im.size == (round(2000 / 3), round(3400 / 3))


def test_preview_follows_the_first_front_photo_when_a_side_view_passes_first(tmp_path, monkeypatch):
    """The api cannot tell views apart from quality.per_frame, so the preview must be the
    reference photo itself: here photo 2 (front), not photo 1 (a passing side view)."""
    side, front = tmp_path / "side.jpg", tmp_path / "front.jpg"
    _face_photo(side, seed=1)
    _grey_photo(front, value=128)

    def detect(srgb8):
        pts = np.zeros((478, 2))
        pts[33], pts[263] = (300, 380), (700, 380)
        pts[168], pts[152], pts[1], pts[234], pts[454] = (
            (500, 380),
            (500, 880),
            (500, 560),
            (210, 480),
            (790, 480),
        )
        yaw = 1.0 if abs(float(srgb8.mean()) - 128) < 10 else 30.0  # the grey photo is front
        return FakeFace(points=pts, yaw=yaw, pitch=0.0, roll=0.0)

    monkeypatch.setattr("app.pipeline_face.detect_face", detect)
    analyze_face([str(side), str(front)], output_prefix=str(tmp_path / "out"))
    with Image.open(tmp_path / "out" / "preview.jpg") as im:
        assert np.allclose(np.asarray(im.convert("RGB")).mean(), 128, atol=4)


def test_alignment_warnings_name_the_reference_photo():
    ref = _frame(np.random.default_rng(0).uniform(200, 800, (478, 2)), [], index=2)
    stuck = _frame(np.zeros((478, 2)), [], index=0)  # landmarks that cannot be fitted
    _, warnings = _align(ref, [stuck])
    assert warnings == ["photo 1 could not be lined up with photo 3"]


def test_forearm_preview_is_written(tmp_path):
    _fake_photo(tmp_path / "arm.jpg", np.random.default_rng(0))
    r = analyze_forearm(
        [str(tmp_path / "arm.jpg")],
        "forearm_treated",
        [Box(70, 70, 160, 160)],
        [Box(290, 70, 80, 160)],
        output_prefix=str(tmp_path),
    )
    with Image.open(tmp_path / "preview.jpg") as im:
        assert im.size == (r["image_size"]["width"], r["image_size"]["height"])
