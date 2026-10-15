"""lines (docs/METRICS.md C1) on a synthetic front-on face: the face model's canonical mesh
drawn at PX_PER_MM, plain skin with drawn creases."""

import numpy as np
import pytest

from app import config
from app.facemap import canonical
from app.landmarks import Face
from app.metrics.lines import lines

PX_PER_MM = 8.0
mesh = canonical()
pytestmark = pytest.mark.skipif(mesh is None, reason="face model not downloaded")


def _face(expression=None) -> Face:
    verts = mesh[0]
    pts = np.zeros((478, 2))
    eyes = float(np.linalg.norm(verts[263, :2] - verts[33, :2]))
    k = PX_PER_MM * config.EYE_DISTANCE_MM / eyes  # so the face's own scale is PX_PER_MM
    pts[: len(verts)] = verts[:, :2] * [1, -1] * k  # image y points down
    pts[: len(verts)] -= pts[: len(verts)].min(axis=0) - 20 * PX_PER_MM
    return Face(points=pts, yaw=0.0, pitch=0.0, roll=0.0, expression=expression or {})


def _skin(face, L, seed=0):
    h, w = (np.ceil(face.points.max(axis=0)) + 20 * PX_PER_MM).astype(int)[::-1]
    rng = np.random.default_rng(seed)
    lab = np.empty((h, w, 3), np.float32)
    lab[..., 0] = L + rng.normal(0, 0.4, (h, w))
    lab[..., 1], lab[..., 2] = 12.0, 18.0
    return lab, face.skin_mask((h, w))


def _forehead_y(face):
    return float(face.points[[105, 334], 1].mean() - 15 * PX_PER_MM)  # 15 mm above the brows


def _crease(lab, x0, y0, x1, y1, depth=0.06, width_mm=0.8):
    """A dark crease `depth` x the skin's L*, Gaussian across, from (x0, y0) to (x1, y1)."""
    h, w = lab.shape[:2]
    yy, xx = np.mgrid[:h, :w].astype(np.float32)
    d = np.array([x1 - x0, y1 - y0], np.float32)
    t = np.clip(((xx - x0) * d[0] + (yy - y0) * d[1]) / (d @ d), 0, 1)
    dist = np.hypot(xx - (x0 + t * d[0]), yy - (y0 + t * d[1]))
    sigma = width_mm / 2 * PX_PER_MM
    lab[..., 0] *= 1 - depth * np.exp(-(dist**2) / (2 * sigma**2))


def _forehead_lines(lab, face, vertical=False):
    cx, y = float(face.points[[105, 334], 0].mean()), _forehead_y(face)
    for k in range(-2, 3):
        if vertical:  # five 12 mm creases running up the face
            x = cx + k * 6 * PX_PER_MM
            _crease(lab, x, y - 6 * PX_PER_MM, x, y + 6 * PX_PER_MM, 0.08, 1.4)
        else:  # three 30 mm prominent creases across (8% darker, 1.4 mm wide)
            if abs(k) < 2:
                yk = y + k * 5 * PX_PER_MM
                _crease(lab, cx - 15 * PX_PER_MM, yk, cx + 15 * PX_PER_MM, yk, 0.08, 1.4)


def test_plain_skin_has_no_lines():
    face = _face()
    lab, skin = _skin(face, 60.0)
    value, extras = lines(lab, face, skin, PX_PER_MM, [])
    assert value is not None and value < 0.5
    assert set(extras) >= {"forehead_mm_per_cm2", "crows_feet_mm_per_cm2", "skipped_for_expression"}


@pytest.mark.parametrize("L", [75.0, 55.0, 32.0])
def test_forehead_lines_found_alike_at_every_tone(L):
    face = _face()
    lab, skin = _skin(face, L)
    _forehead_lines(lab, face)
    _, extras = lines(lab, face, skin, PX_PER_MM, [])
    ref_lab, _ = _skin(face, 55.0)
    _forehead_lines(ref_lab, face)
    _, ref = lines(ref_lab, face, skin, PX_PER_MM, [])
    assert extras["forehead_mm_per_cm2"] > 2.0
    assert extras["forehead_mm_per_cm2"] == pytest.approx(ref["forehead_mm_per_cm2"], rel=0.25)


def test_creases_running_the_wrong_way_are_not_forehead_lines():
    face = _face()
    lab, skin = _skin(face, 60.0)
    _forehead_lines(lab, face, vertical=True)
    _, extras = lines(lab, face, skin, PX_PER_MM, [])
    assert extras["forehead_mm_per_cm2"] < 0.5


def test_round_dark_spots_are_not_lines():
    face = _face()
    lab, skin = _skin(face, 60.0)
    h, w = lab.shape[:2]
    yy, xx = np.mgrid[:h, :w]
    cx, y = float(face.points[[105, 334], 0].mean()), _forehead_y(face)
    for k in range(-3, 4):  # freckles 1.5 mm across, 8 L* darker
        lab[..., 0] -= 8 * (np.hypot(xx - cx - k * 5 * PX_PER_MM, yy - y) <= 0.75 * PX_PER_MM)
    _, extras = lines(lab, face, skin, PX_PER_MM, [])
    assert extras["forehead_mm_per_cm2"] < 0.5


def test_raised_brows_skip_the_forehead():
    face = _face({"browInnerUp": 0.95})
    lab, skin = _skin(face, 60.0)
    _forehead_lines(lab, face)
    _, extras = lines(lab, face, skin, PX_PER_MM, [])
    assert "forehead" in extras["skipped_for_expression"]
    assert "forehead_mm_per_cm2" not in extras


def test_too_small_a_face_gives_no_value():
    face = _face()
    lab, skin = _skin(face, 60.0)
    assert lines(lab, face, skin, 2.5, []) == (None, {})  # under LINES_MIN_PX_PER_MM


def _upper_lip(face):
    """(x of the mouth's centre, y halfway between the lip edge and the nose base)."""
    p = face.points
    return float(p[[13, 14], 0].mean()), float((p[0, 1] + p[2, 1]) / 2)


def test_lip_lines_found_and_the_philtrum_left_out():
    face = _face()
    lab, skin = _skin(face, 60.0)
    cx, y = _upper_lip(face)
    half = 3 * PX_PER_MM  # 6 mm vertical creases on the upper lip
    for dx in (-14, -10, 10, 14):  # either side, outside the philtrum
        x = cx + dx * PX_PER_MM
        _crease(lab, x, y - half, x, y + half, depth=0.08, width_mm=0.6)
    _, extras = lines(lab, face, skin, PX_PER_MM, [])
    assert extras["lips_mm_per_cm2"] > 1.0

    plain, skin = _skin(face, 60.0)
    _crease(plain, cx, y - half, cx, y + half, depth=0.08, width_mm=1.2)  # philtrum groove
    _, extras = lines(plain, face, skin, PX_PER_MM, [])
    assert extras["lips_mm_per_cm2"] < 0.5


def test_marionette_lines_found():
    face = _face()
    lab, skin = _skin(face, 60.0)
    for side, sign in ((61, -1), (291, 1)):  # from each mouth corner down and outward
        x0, y0 = face.points[side] + [sign * 3 * PX_PER_MM, 2 * PX_PER_MM]
        _crease(
            lab, x0, y0, x0 + sign * 3 * PX_PER_MM, y0 + 14 * PX_PER_MM, depth=0.08, width_mm=1.4
        )
    _, extras = lines(lab, face, skin, PX_PER_MM, [])
    assert extras["marionette_mm_per_cm2"] > 1.0


def test_line_skin_keeps_shaded_skin_and_cuts_hair_and_beards():
    from app.pipeline_face import _line_skin

    h, w = 200, 200
    lab = np.empty((h, w, 3), np.float32)
    lab[...] = (65.0, 12.0, 18.0)
    lab[:, :60] = (40.0, 9.0, 13.5)  # shaded skin: much darker, keeps its colour
    lab[:40, 100:] = (20.0, 1.0, 1.0)  # dark grey hair
    area = np.ones((h, w), bool)
    lower = np.zeros((h, w), bool)
    lower[120:] = True
    skin = _line_skin(lab, area, lower)
    assert skin[:, :50].all() and not skin[:35, 105:].any()
    assert skin[150:, 150:].all()  # a clear lower face is kept

    lab[130:, 70:] = (15.0, 2.0, 2.0)  # a beard over most of the lower face
    assert not _line_skin(lab, area, lower)[120:].any()
