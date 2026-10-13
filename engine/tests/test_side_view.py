"""Side / three-quarter face views: view detection, scale, and side-view skin cleanup."""

import numpy as np
import pytest

from app import config
from app.landmarks import Face, edge_hair, skin_colour

PX_PER_MM = 6.0


def _face(yaw, near="right"):
    pts = np.zeros((478, 2))
    pts[168], pts[152] = (300, 200), (300, 200 + config.FACE_HEIGHT_MM * PX_PER_MM)
    pts[33], pts[263] = (240, 200), (240 + 63 * PX_PER_MM * 0.5, 200)  # eyes foreshortened
    pts[1] = (300, 260)
    # the cheek facing the camera is farther from the nose tip in the image
    far, close = (100, 300), (360, 300)
    pts[234], pts[454] = (far, close) if near == "right" else (close, far)
    return Face(points=pts, yaw=yaw, pitch=0.0, roll=0.0)


def test_front_view_uses_eye_distance():
    f = _face(yaw=2.0)
    assert f.view == "front"
    assert f.px_per_mm == pytest.approx(f.eye_distance_px / config.EYE_DISTANCE_MM)


@pytest.mark.parametrize("near", ["right", "left"])
def test_turned_head_is_a_side_view_scaled_by_face_height(near):
    f = _face(yaw=40.0, near=near)
    assert f.view == near and f.cheeks == (f"{near}_cheek",)
    # eye distance is halved by the turn, but the scale stays true
    assert f.px_per_mm == pytest.approx(PX_PER_MM)


def _skin(L=50.0, a=14.0, b=20.0, shape=(240, 240), seed=0):
    rng = np.random.default_rng(seed)
    lab = np.stack([np.full(shape, v) + rng.normal(0, 0.6, shape) for v in (L, a, b)], -1)
    return lab


def test_skin_colour_drops_grey_hair_and_shine_but_keeps_a_mark():
    lab = _skin()
    lab[:, :50] = (25.0, 1.0, 2.0)  # dark grey hair at one side
    lab[:40, 100:200] = (95.0, 2.0, 3.0)  # bright grey shine
    yy, xx = np.ogrid[:240, :240]
    mark = (xx - 150) ** 2 + (yy - 150) ** 2 <= 12**2
    lab[mark] = (40.0, 16.0, 22.0)  # a brown mark: darker, keeps its colour
    mask = np.ones((240, 240), bool)
    ref = np.zeros_like(mask)
    ref[100:200, 100:200] = True
    keep = skin_colour(lab, mask, ref, PX_PER_MM)
    assert not keep[:, :45].any() and not keep[:35, 110:190].any()
    assert keep[150, 150] and keep[120, 120]


def test_edge_hair_cuts_rough_grey_patch_at_the_ear_edge_only():
    rng = np.random.default_rng(1)
    lab = _skin()
    rough = (40.0 + rng.normal(0, 6, (240, 60)), 8.0, 11.0)  # stripy, greyer hair
    for i, v in enumerate(rough):
        lab[:, :60, i] = v
    lab[90:150, 130:190] = lab[90:150, :60]  # the same patch inside the cheek, off the edge
    skin = np.ones((240, 240), bool)
    ref = np.zeros_like(skin)
    ref[60:200, 70:120] = True
    ear = np.zeros_like(skin)
    ear[:, :120] = True
    hair = edge_hair(lab, skin, ref, PX_PER_MM, ear)
    assert hair[120, 20] and not hair[120, 160]


def test_skin_colour_keeps_a_dark_mole_at_the_mask_edge():
    lab = _skin()
    yy, xx = np.ogrid[:240, :240]
    lab[(xx - 6) ** 2 + (yy - 120) ** 2 <= 15**2] = (12.0, 2.0, 3.0)  # black mole at the edge
    mask = np.ones((240, 240), bool)
    ref = np.zeros_like(mask)
    ref[60:200, 60:200] = True
    assert skin_colour(lab, mask, ref, PX_PER_MM)[120, 6]


def test_edge_hair_keeps_bumpy_forehead_that_only_touches_the_ear_side():
    rng = np.random.default_rng(3)
    lab = _skin()
    patch = (40.0 + rng.normal(0, 6, (60, 230)), 8.0, 11.0)  # rough, greyer strip
    for i, v in enumerate(patch):
        lab[20:80, 0:230, i] = v  # runs across the top, only its end is on the ear side
    skin = np.ones((240, 240), bool)
    ref = np.zeros_like(skin)
    ref[120:220, 80:200] = True
    ear = np.zeros_like(skin)
    ear[:, :40] = True
    assert not edge_hair(lab, skin, ref, PX_PER_MM, ear)[50, 150]
