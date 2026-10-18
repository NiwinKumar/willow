"""Close-up sites (cheek_macro, nose_macro): pores, texture and blemishes on synthetic macro
photos with a known scale (MACRO_FIELD_WIDTH_MM across the long edge)."""

import numpy as np
import pytest
from PIL import Image
from scipy.ndimage import gaussian_filter
from skimage.color import lab2rgb

from app import config
from app.pipeline_macro import analyze_macro

W, H = 3000, 2250  # long edge = MACRO_FIELD_WIDTH_MM -> 100 px/mm at 30 mm


def _px_per_mm(w=W):
    return w / config.MACRO_FIELD_WIDTH_MM


def _macro(
    path,
    L=65.0,
    pores_per_cm2=60,
    pore_mm=0.12,
    pore_dl=8.0,
    rough=0.6,
    bumps=0.3,
    w=W,
    h=H,
    hair=False,
    seed=0,
    exif_tags=None,
):
    rng = np.random.default_rng(seed)
    ppm = _px_per_mm(w)
    lab = np.empty((h, w, 3))
    bump = gaussian_filter(rng.normal(0, 1, (h, w)), 0.1 * ppm)  # skin relief ~0.2 mm across
    lab[..., 0] = L + rng.normal(0, rough, (h, w)) + bumps * bump / bump.std()
    lab[..., 1] = 13.0 + rng.normal(0, 0.3, (h, w))
    lab[..., 2] = 17.0 + rng.normal(0, 0.3, (h, w))
    yy, xx = np.ogrid[:h, :w]
    area_cm2 = (w / ppm) * (h / ppm) / 100
    n = int(pores_per_cm2 * area_cm2)
    xs, ys = rng.uniform(0.08 * w, 0.92 * w, n), rng.uniform(0.08 * h, 0.92 * h, n)
    r = pore_mm * ppm / 2
    for x, y in zip(xs, ys, strict=True):
        y0, y1, x0, x1 = int(y - 2 * r), int(y + 2 * r) + 1, int(x - 2 * r), int(x + 2 * r) + 1
        d2 = (yy[y0:y1] - y) ** 2 + (xx[:, x0:x1] - x) ** 2
        lab[y0:y1, x0:x1, 0] -= pore_dl * np.exp(-d2 / (2 * (r * 0.7) ** 2))
    if hair:  # a dark hair across the field, 0.05 mm wide
        band = np.abs((yy - h * 0.3) - 0.2 * (xx - w * 0.2)) <= 0.03 * ppm
        lab[band & (xx > 0.2 * w) & (xx < 0.8 * w), 0] -= 20
    rgb = (np.clip(lab2rgb(lab), 0, 1) * 255 + 0.5).astype(np.uint8)
    exif = Image.Exif()
    exif[0x0110] = "iPhone 17 Pro"  # a camera photo: only these may use the assumed macro scale
    exif.get_ifd(0x8769).update(exif_tags or {})
    Image.fromarray(rgb).save(path, quality=97, exif=exif)
    return n / area_cm2


def _metric(r, mid):
    return next(m for m in r["metrics"] if m["id"] == mid)


@pytest.mark.parametrize("L", [75.0, 55.0, 32.0])  # light, medium, deep skin
def test_pore_density_is_recovered_at_every_tone(tmp_path, L):
    true = _macro(tmp_path / "c.jpg", L=L)
    r = analyze_macro([str(tmp_path / "c.jpg")], "cheek_macro")
    pores = _metric(r, "pores")
    assert pores["value"] == pytest.approx(true, rel=0.3)
    assert pores["extras"]["mean_diameter_mm"] == pytest.approx(0.12, rel=0.5)
    assert {m["id"] for m in r["metrics"]} == {
        "tone_ita",
        "pigment_spots",
        "redness",
        "blemishes",
        "pores",
        "texture",
    }


def test_rougher_skin_has_higher_texture(tmp_path):
    _macro(tmp_path / "smooth.jpg", bumps=0.3)
    _macro(tmp_path / "rough.jpg", bumps=1.5)
    smooth = _metric(analyze_macro([str(tmp_path / "smooth.jpg")], "cheek_macro"), "texture")
    rough = _metric(analyze_macro([str(tmp_path / "rough.jpg")], "cheek_macro"), "texture")
    assert rough["value"] > 1.5 * smooth["value"]


def test_a_hair_is_not_a_row_of_pores(tmp_path):
    _macro(tmp_path / "a.jpg", pores_per_cm2=20, seed=1)
    _macro(tmp_path / "b.jpg", pores_per_cm2=20, seed=1, hair=True)
    plain = _metric(analyze_macro([str(tmp_path / "a.jpg")], "cheek_macro"), "pores")["value"]
    hairy = _metric(analyze_macro([str(tmp_path / "b.jpg")], "cheek_macro"), "pores")["value"]
    assert hairy == pytest.approx(plain, rel=0.15)


def test_nose_close_up_has_blemishes_and_pores(tmp_path):
    true = _macro(tmp_path / "nose.jpg")
    r = analyze_macro([str(tmp_path / "nose.jpg")], "nose_macro")
    assert {m["id"] for m in r["metrics"]} == {"blemishes", "pores"}
    assert _metric(r, "pores")["value"] == pytest.approx(true, rel=0.3)
    assert "blackheads" not in _metric(r, "blemishes")["extras"]


def test_low_resolution_close_up_gives_no_pores(tmp_path):
    _macro(tmp_path / "small.jpg", w=450, h=338)  # too far / too small: 15 px/mm
    r = analyze_macro([str(tmp_path / "small.jpg")], "cheek_macro")
    assert _metric(r, "pores")["value"] is None and _metric(r, "texture")["value"] is None
    assert any("closer photo" in w for w in r["warnings"])
    assert _metric(r, "redness")["value"] is not None  # colour metrics still work


def test_uncalibrated_scale_is_indicative_and_says_so(tmp_path):
    _macro(tmp_path / "c.jpg")
    r = analyze_macro([str(tmp_path / "c.jpg")] * 3, "cheek_macro")
    assert not config.MACRO_SCALE_CALIBRATED
    assert _metric(r, "pores")["confidence"] == "indicative"
    assert any("scale assumed" in w for w in r["warnings"])


def test_ruler_scale_is_measured():
    from scripts.macro_scale import tick_period_px

    ppm = 37.3  # px per mm
    grey = np.full((900, 1200), 230.0)
    for i in range(int(1200 / ppm)):  # 1 mm ticks, longer every 5 mm
        x = round(i * ppm)
        grey[300 : 600 if i % 5 else 700, x : x + 3] = 30
    grey += np.random.default_rng(0).normal(0, 5, grey.shape)
    period, strength = tick_period_px(np.clip(grey, 0, 255).astype(np.uint8))
    assert period == pytest.approx(ppm, rel=0.02) and strength > 5


def test_iris_sets_the_scale_when_an_eye_is_in_view():
    from app.landmarks import Face
    from app.pipeline_macro import _iris_px_per_mm

    points = np.zeros((478, 2))
    for centre, idx, r in (
        ((500, 400), range(468, 473), 117.0),
        ((1500, 400), range(473, 478), 90),
    ):
        pts = np.array([centre, *(np.add(centre, d) for d in ((r, 0), (0, r), (-r, 0), (0, -r)))])
        points[list(idx)] = pts
    face = Face(points=points, yaw=30.0, pitch=0.0, roll=0.0)
    # the nearer (larger) iris: 234 px across = 11.7 mm -> 20 px/mm
    assert _iris_px_per_mm(face, (2000, 3000)) == pytest.approx(20.0)
    assert _iris_px_per_mm(face, (2000, 450)) is None  # both irises off the photo


def test_guessed_scale_needs_a_real_macro_shot(tmp_path):
    # no face in view, so the scale is assumed: a 30 px/mm photo is not trusted for pores
    _macro(tmp_path / "mid.jpg", w=900, h=675)
    r = analyze_macro([str(tmp_path / "mid.jpg")], "cheek_macro")
    assert _metric(r, "pores")["value"] is None
    assert _metric(r, "pores")["confidence"] == "indicative"


def test_marks_at_the_region_edge_or_overlapping_are_cleaned():
    from types import SimpleNamespace as M

    from app.pipeline_macro import _clean_marks

    skin = np.zeros((500, 500), bool)
    skin[50:450, 50:450] = True  # 10 px/mm: 40 x 40 mm of skin
    marks = [
        M(x=60, y=250, radius=5),  # 1 mm inside the edge: an edge shadow
        M(x=250, y=250, radius=10),  # a patch...
        M(x=262, y=250, radius=6),  # ...found twice
        M(x=350, y=350, radius=5),
    ]
    kept = _clean_marks(marks, skin, 10.0)
    assert [(m.x, m.y) for m in kept] == [(250, 250), (350, 350)]


def test_a_web_camera_close_up_without_a_face_is_not_measured(tmp_path):
    # the web app saves a canvas JPEG (no EXIF), always from the front camera: with no face in
    # view there is no scale and no region, so nothing is measured (never a guessed 30 mm field)
    _macro(tmp_path / "c.jpg")
    Image.open(tmp_path / "c.jpg").save(tmp_path / "web.jpg", quality=97)  # EXIF dropped
    r = analyze_macro([str(tmp_path / "web.jpg")], "cheek_macro")
    assert r["quality"]["passed"] is False
    assert "face_not_found" in r["quality"]["reasons"]
    assert all(m["value"] is None for m in r["metrics"])


def _apple_note(focus_position, af_confidence):
    """An Apple MakerNote with FocusPosition and AFConfidence (signed longs, as iPhones write)."""
    entries = [(0x002F, focus_position), (0x003D, af_confidence)]
    body = b"".join(
        t.to_bytes(2, "big")
        + (9).to_bytes(2, "big")
        + (1).to_bytes(4, "big")
        + v.to_bytes(4, "big", signed=True)
        for t, v in entries
    )
    return b"Apple iOS\x00\x00\x01MM" + len(entries).to_bytes(2, "big") + body


@pytest.mark.parametrize(
    ("tags", "reason"),
    [
        ({0xA405: 26}, "face_not_found"),  # the main camera: a hand's width away at best
        ({0xA405: 103}, "face_not_found"),  # digital zoom
        ({0xA405: 14, 0x927C: _apple_note(111, 94)}, "face_not_found"),  # ultra wide at ~12 cm
        ({0xA405: 14, 0x927C: _apple_note(255, 0)}, "blurry"),  # the camera says out of focus
    ],
)
def test_a_photo_the_camera_says_is_no_macro_shot_is_not_measured(tmp_path, tags, reason):
    # no eye in view: the assumed 30 mm field only fits a real macro shot, so EXIF that says
    # otherwise fails the frame (instead of pores and spots read at the wrong scale)
    _macro(tmp_path / "c.jpg", exif_tags=tags)
    r = analyze_macro([str(tmp_path / "c.jpg")], "cheek_macro")
    assert r["quality"]["passed"] is False
    assert reason in r["quality"]["reasons"]
    assert all(m["value"] is None for m in r["metrics"])


def test_a_close_focused_ultra_wide_macro_keeps_the_assumed_scale(tmp_path):
    _macro(tmp_path / "c.jpg", exif_tags={0xA405: 14, 0x927C: _apple_note(255, 92)})
    r = analyze_macro([str(tmp_path / "c.jpg")], "cheek_macro")
    assert r["quality"]["passed"] is True
    assert _metric(r, "pores")["value"] is not None
    assert _metric(r, "pores")["confidence"] == "indicative"  # assumed, until calibrated


def test_a_close_up_with_a_mark_gives_a_candidate(tmp_path):
    # Oct 18: every close-up with a blemish or spot failed (the candidate code read a face view the
    # close-up frame does not have); the synthetic close-ups above have no marks, so none caught it
    from skimage.color import rgb2lab

    _macro(tmp_path / "c.jpg", pores_per_cm2=0)
    rgb = np.asarray(Image.open(tmp_path / "c.jpg")).astype(float) / 255
    lab = rgb2lab(rgb)
    yy, xx = np.ogrid[: lab.shape[0], : lab.shape[1]]
    ppm = _px_per_mm()
    mark = (yy - H / 2) ** 2 + (xx - W / 2) ** 2 <= (1.5 * ppm) ** 2  # a 3 mm dark patch
    lab[mark, 0] -= 18
    out = (np.clip(lab2rgb(lab), 0, 1) * 255 + 0.5).astype(np.uint8)
    exif = Image.Exif()
    exif[0x0110] = "iPhone 17 Pro"
    Image.fromarray(out).save(tmp_path / "m.jpg", quality=97, exif=exif)
    r = analyze_macro([str(tmp_path / "m.jpg")], "cheek_macro", output_prefix=str(tmp_path / "out"))
    assert r["quality"]["passed"] is True
    assert r["candidates"]
    assert all(c["features"]["view"] == 0.0 for c in r["candidates"])
