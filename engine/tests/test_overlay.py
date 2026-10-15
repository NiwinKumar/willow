"""Redness overlay (overlays/redness.png) and quality.per_frame[].regions (engine 0.3.4)."""

import json
import time
from pathlib import Path

import cv2
import jsonschema
import numpy as np
import pytest
from PIL import Image, ImageFilter
from test_face import _face_photo, fake_landmarks  # noqa: F401 (fixture)
from test_preview import _grey_photo

from app.io import preview_size, save_png
from app.overlay import redness_rgba, to_preview
from app.pipeline_face import analyze_face
from app.quality import region_reasons

SCHEMA = json.loads(
    (Path(__file__).resolve().parents[2] / "schemas" / "analysis_result.schema.json").read_text()
)


def _disk(shape, cx, cy, r):
    yy, xx = np.ogrid[: shape[0], : shape[1]]
    return (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r


def _cheek_map(photo=(2000, 3400), box=(500, 300, 1600, 1400), red_at=(1200, 900), seed=0):
    """a* over a face box crop of a (h, w) photo: plain skin a*=12 with a redder 60 px patch at
    `red_at` (photo pixels), skin = a 600 px disk at the box centre. Returns (rgba, skin, box)."""
    x0, y0, bw, bh = box
    rng = np.random.default_rng(seed)
    a = 12.0 + rng.normal(0, 0.3, (bh, bw)).astype(np.float32)
    a[_disk((bh, bw), red_at[0] - x0, red_at[1] - y0, 60)] += 8.0
    skin = _disk((bh, bw), bw / 2, bh / 2, 600)
    m = to_preview(a, skin, photo, origin=(x0, y0))
    return redness_rgba(m, px_per_mm=8.0), skin, box


def test_overlay_is_preview_sized_and_aligned_with_the_photo():
    photo = (2000, 3400)  # (h, w): preview shrinks by 3
    rgba, _, _ = _cheek_map(photo)
    pw, ph = preview_size(*photo)
    assert rgba.shape == (ph, pw, 4) and rgba.dtype == np.uint8
    alpha = rgba[..., 3].astype(float)
    hot = alpha >= 0.8 * alpha.max()
    ys, xs = np.nonzero(hot)
    # the red patch's centre in preview pixels: (x + 0.5) * pw / w - 0.5
    assert xs.mean() == pytest.approx((1200 + 0.5) * pw / 3400 - 0.5, abs=1.0)
    assert ys.mean() == pytest.approx((900 + 0.5) * ph / 2000 - 0.5, abs=1.0)


def test_overlay_is_clear_outside_the_skin_and_on_plain_skin():
    photo = (2000, 3400)
    rgba, skin, (x0, y0, bw, bh) = _cheek_map(photo)
    pw, ph = preview_size(*photo)
    full = np.zeros(photo, bool)
    full[y0 : y0 + bh, x0 : x0 + bw] = skin
    small = np.asarray(Image.fromarray(full).resize((pw, ph), Image.NEAREST))
    grown = Image.fromarray(small.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5))
    near = np.asarray(grown) > 0  # the skin grown by 2 preview pixels (resampling edge)
    alpha = rgba[..., 3]
    assert alpha[~near].max() == 0  # transparent outside the skin
    # plain skin (at the person's own median) is left almost untouched; the patch is not
    plain = small.copy()
    plain[_disk(small.shape, 1200 / 3, 900 / 3, 40)] = False
    assert np.median(alpha[plain]) <= 0.1 * 255
    assert alpha[round(900 / 3), round(1200 / 3)] >= 0.6 * 255


def test_overlay_is_relative_to_the_persons_own_skin():
    """The same 8 a* patch draws the same map on skin at a*=6 or a*=20 (no shared scale)."""
    shape, skin = (600, 600), _disk((600, 600), 300, 300, 250)
    maps = []
    for base in (6.0, 20.0):
        a = np.full(shape, base, np.float32)
        a[_disk(shape, 300, 300, 40)] += 8.0
        maps.append(redness_rgba(to_preview(a, skin, shape), px_per_mm=5.0))
    assert np.array_equal(*maps)


def test_even_skin_noise_is_not_stretched_into_a_full_map():
    shape, skin = (600, 600), _disk((600, 600), 300, 300, 250)
    a = 12.0 + np.random.default_rng(1).normal(0, 0.5, shape).astype(np.float32)
    alpha = redness_rgba(to_preview(a, skin, shape), px_per_mm=5.0)[..., 3]
    assert alpha.max() < 0.35 * 255  # OVERLAY_MIN_SPAN_A keeps grain faint


def test_overlay_png_is_deterministic(tmp_path):
    a, _, _ = _cheek_map()
    b, _, _ = _cheek_map()
    save_png(a, str(tmp_path / "a.png"))
    save_png(b, str(tmp_path / "b.png"))
    assert (tmp_path / "a.png").read_bytes() == (tmp_path / "b.png").read_bytes()
    with Image.open(tmp_path / "a.png") as im:
        assert im.mode == "RGBA"
        assert np.array_equal(np.asarray(im), a)  # channels round-trip (RGBA, not BGRA)


def test_no_skin_no_overlay():
    shape = (300, 300)
    m = to_preview(np.zeros(shape, np.float32), np.zeros(shape, bool), shape)
    assert redness_rgba(m, px_per_mm=5.0) is None


def test_overlay_costs_under_300_ms_on_a_12_mp_photo(tmp_path):
    photo = (3024, 4032)
    x0, y0, bw, bh = 800, 300, 2400, 2600  # a face filling most of a 12 MP selfie
    rng = np.random.default_rng(0)
    a = (12.0 + rng.normal(0, 0.5, (bh, bw))).astype(np.float32)
    skin = _disk((bh, bw), bw / 2, bh / 2, 1100)
    best = float("inf")
    for _ in range(2):  # best of two: the first run pays OpenCV's warm-up
        t = time.perf_counter()
        rgba = redness_rgba(to_preview(a, skin, photo, origin=(x0, y0)), px_per_mm=14.0)
        save_png(rgba, str(tmp_path / "redness.png"))
        best = min(best, time.perf_counter() - t)
    assert best < 0.3


# ---- face pipeline ----------------------------------------------------------------------


def _red_cheek_photo(path):
    _face_photo(path)
    img = np.asarray(Image.open(path)).astype(np.float64)
    yy, xx = np.ogrid[:1000, :1000]
    patch = (xx - 310) ** 2 + (yy - 510) ** 2 <= 25**2  # inside the right_cheek square
    img[patch] += (25, -15, -10)
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path, quality=95)


@pytest.mark.usefixtures("fake_landmarks")
def test_face_pipeline_writes_the_redness_overlay_next_to_the_preview(tmp_path):
    _red_cheek_photo(tmp_path / "face.jpg")
    out = tmp_path / "out"
    r = analyze_face([str(tmp_path / "face.jpg")], output_prefix=str(out))
    assert r["overlays"] == [{"metric_id": "redness", "uri": f"{out}/overlays/redness.png"}]
    assert "overlay" in r["timings_ms"]
    with Image.open(out / "preview.jpg") as prev, Image.open(out / "overlays/redness.png") as ov:
        assert ov.mode == "RGBA" and ov.size == prev.size
        alpha = np.asarray(ov)[..., 3]
    assert alpha[510, 310] > 100  # the red patch on the cheek shows
    assert alpha[50, 50] == 0 and alpha[510, 100] == 0  # background, outside the face


@pytest.mark.usefixtures("fake_landmarks")
def test_overlays_move_no_number_and_can_be_switched_off(tmp_path):
    _red_cheek_photo(tmp_path / "face.jpg")
    on = analyze_face([str(tmp_path / "face.jpg")], output_prefix=str(tmp_path / "on"))
    off = analyze_face(
        [str(tmp_path / "face.jpg")], output_prefix=str(tmp_path / "off"), compute_overlays=False
    )
    assert off["overlays"] == [] and not (tmp_path / "off" / "overlays").exists()
    assert on["metrics"] == off["metrics"]
    assert on["candidates"] == [
        {**c, **{k: v.replace("/off/", "/on/") for k, v in c.items() if k.endswith("uri")}}
        for c in off["candidates"]
    ]
    assert analyze_face([str(tmp_path / "face.jpg")])["overlays"] == []  # nowhere to write


@pytest.mark.usefixtures("fake_landmarks")
def test_face_frame_regions_name_the_overexposed_cheek(tmp_path):
    _face_photo(tmp_path / "face.jpg")
    img = np.asarray(Image.open(tmp_path / "face.jpg")).copy()
    img[440:580, 620:760] = 255  # the left_cheek square, blown out
    Image.fromarray(img).save(tmp_path / "face.jpg", quality=95)
    r = analyze_face([str(tmp_path / "face.jpg")])  # schema-validated inside
    f = r["quality"]["per_frame"][0]
    assert "overexposed" in f["reasons"]
    assert {"reason": "overexposed", "region": "left_cheek"} in f["regions"]
    assert {"reason": "overexposed", "region": "right_cheek"} not in f["regions"]


@pytest.mark.usefixtures("fake_landmarks")
def test_passing_frame_has_empty_regions(tmp_path):
    _grey_photo(tmp_path / "face.jpg")
    r = analyze_face([str(tmp_path / "face.jpg")])
    assert r["quality"]["per_frame"][0]["regions"] == []


# ---- region_reasons ---------------------------------------------------------------------


def _regions_setup():
    shape = (400, 400)
    masks = {}
    for i, n in enumerate(["forehead", "left_cheek", "right_cheek", "nose", "chin"]):
        m = np.zeros(shape, bool)
        m[20 + 75 * i : 80 + 75 * i, 100:300] = True
        masks[n] = m
    m = np.zeros(shape, bool)
    m[20:80, 320:380] = True
    masks["right_under_eye"] = m
    m = m.copy()
    m[20:80, 20:80] = True
    masks["left_under_eye"] = m
    rng = np.random.default_rng(0)
    srgb8 = np.clip(128 + rng.normal(0, 20, (*shape, 3)), 0, 255).astype(np.uint8)
    linear = (srgb8 / 255.0) ** 2.2
    return masks, linear, srgb8


def test_region_reasons_one_region_or_whole():
    masks, linear, srgb8 = _regions_setup()
    lin = linear.copy()
    lin[masks["nose"]] = 1.0
    assert region_reasons(["overexposed"], masks, lin, srgb8, 4.0) == [
        {"reason": "overexposed", "region": "nose"}
    ]
    assert region_reasons(["overexposed"], masks, np.ones_like(linear), srgb8, 4.0) == [
        {"reason": "overexposed", "region": "whole"}
    ]
    dark = np.full_like(linear, 1e-4)
    out = region_reasons(["underexposed", "pose_out_of_range"], masks, dark, srgb8, 4.0)
    assert out == [{"reason": "underexposed", "region": "whole"}]  # pose is not attributed
    assert region_reasons([], masks, lin, srgb8, 4.0) == []


def test_region_reasons_blur_names_the_soft_region():
    masks, linear, srgb8 = _regions_setup()
    soft = srgb8.copy()
    soft[masks["chin"]] = cv2.GaussianBlur(srgb8, (0, 0), 4)[masks["chin"]]
    out = region_reasons(["blurry"], masks, linear, soft, 4.0)
    assert out == [{"reason": "blurry", "region": "chin"}]


def test_region_reasons_hand_over_a_cheek():
    masks, linear, srgb8 = _regions_setup()
    hand = masks["right_cheek"].copy()
    out = region_reasons(["occlusion_suspected"], masks, linear, srgb8, 4.0, hand)
    assert out == [{"reason": "occlusion_suspected", "region": "right_cheek"}]


# ---- schema -----------------------------------------------------------------------------


def _result_with(regions):
    sample = json.loads(
        (
            Path(__file__).resolve().parents[2] / "fixtures" / "analysis_result.sample.json"
        ).read_text()
    )
    sample["quality"]["per_frame"] = [
        {"index": 0, "passed": False, "reasons": ["overexposed"], "regions": regions}
    ]
    return sample


def test_schema_accepts_regions_and_rejects_unknown_ones():
    jsonschema.validate(_result_with([{"reason": "overexposed", "region": "forehead"}]), SCHEMA)
    jsonschema.validate(_result_with([]), SCHEMA)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(_result_with([{"reason": "overexposed", "region": "ear"}]), SCHEMA)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(_result_with([{"reason": "too_dark", "region": "nose"}]), SCHEMA)


# ---- through the HTTP API (options.compute_overlays) -------------------------------------


@pytest.mark.parametrize("compute", [True, False])
def test_api_cheek_close_up_overlay_follows_the_option(tmp_path, monkeypatch, compute):
    from fastapi.testclient import TestClient
    from test_macro import _macro

    from app.io import LOCAL_ENV
    from app.main import app

    monkeypatch.setenv(LOCAL_ENV, "1")
    _macro(tmp_path / "frame_1.jpg")
    out = tmp_path / "results"
    req = {
        "schema_version": "1.0",
        "session_id": "s_test",
        "user_id": "u_test",
        "site": "cheek_macro",
        "capture_mode": "uncalibrated",
        "frames": [{"uri": str(tmp_path / "frame_1.jpg")}],
        "output_prefix": str(out) + "/",
        "options": {"compute_overlays": compute},
    }
    body = TestClient(app).post("/v1/analyze", json=req).json()
    jsonschema.validate(body, SCHEMA)
    if not compute:
        assert body["overlays"] == []
        return
    assert body["overlays"] == [{"metric_id": "redness", "uri": f"{out}/overlays/redness.png"}]
    with Image.open(out / "preview.jpg") as prev, Image.open(out / "overlays/redness.png") as ov:
        assert ov.mode == "RGBA" and ov.size == prev.size
