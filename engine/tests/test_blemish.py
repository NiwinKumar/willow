import numpy as np
import pytest

from app.metrics.blemish import find_blemishes

PX_PER_MM = 10.0


def _skin_lab(L, a=12.0, b=18.0, seed=0, shape=(400, 400)):
    rng = np.random.default_rng(seed)
    lab = np.empty((*shape, 3))
    lab[..., 0] = L + rng.normal(0, 0.6, shape)
    lab[..., 1] = a + rng.normal(0, 0.6, shape)
    lab[..., 2] = b + rng.normal(0, 0.6, shape)
    return lab


def _spot(lab, cx, cy, r, d_a=0.0, d_l=0.0):
    yy, xx = np.ogrid[: lab.shape[0], : lab.shape[1]]
    disk = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
    lab[disk, 1] += d_a
    lab[disk, 0] += d_l
    return lab


@pytest.mark.parametrize("L", [80.0, 65.0, 45.0, 28.0])  # very light -> very deep skin
def test_red_spots_found_at_every_tone(L):
    lab = _skin_lab(L)
    for cx, cy in [(100, 100), (300, 120), (200, 300)]:
        _spot(lab, cx, cy, r=12, d_a=6.0)  # 2.4 mm red bumps
    found = find_blemishes(lab, np.ones(lab.shape[:2], bool), PX_PER_MM)
    assert len(found) == 3
    assert {(round(b.x / 100), round(b.y / 100)) for b in found} == {(1, 1), (3, 1), (2, 3)}


def test_plain_skin_has_no_blemishes():
    lab = _skin_lab(60)
    assert find_blemishes(lab, np.ones(lab.shape[:2], bool), PX_PER_MM) == []


def test_shadow_darker_but_not_redder_is_ignored():
    lab = _spot(_skin_lab(60), 200, 200, r=15, d_l=-12.0)  # dark, same redness
    assert find_blemishes(lab, np.ones(lab.shape[:2], bool), PX_PER_MM) == []


def test_one_spot_is_counted_once():
    lab = _spot(_skin_lab(60), 200, 200, r=20, d_a=8.0)  # a big 4 mm spot
    assert len(find_blemishes(lab, np.ones(lab.shape[:2], bool), PX_PER_MM)) == 1


def test_spots_outside_skin_mask_are_ignored():
    lab = _spot(_skin_lab(60), 100, 100, r=12, d_a=8.0)
    skin = np.ones(lab.shape[:2], bool)
    skin[:200, :200] = False  # e.g. lips / eyes cut out
    assert find_blemishes(lab, skin, PX_PER_MM) == []


def test_red_spot_among_hair_gaps_is_found():
    # a beard: skin with many 1-px hair gaps cut out of the mask, and a red bump among them
    lab = _spot(_skin_lab(60), 200, 200, r=12, d_a=8.0)
    rng = np.random.default_rng(3)
    skin = np.ones(lab.shape[:2], bool)
    ys, xs = rng.integers(0, 400, 4000), rng.integers(0, 400, 4000)
    skin[ys, xs] = False  # single-pixel hair gaps everywhere, including over the bump
    found = find_blemishes(lab, skin, PX_PER_MM)
    assert len(found) == 1 and abs(found[0].x - 200) < 6
