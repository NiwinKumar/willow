"""Dark-spot and blemish fixes from the Oct 13 face review: big marks, faces with many
marks, hair around a candidate, guard bands, darker-but-redder blemishes on deep skin."""

import numpy as np
import pytest

from app import config
from app.landmarks import Face, facial_hair
from app.metrics.blemish import find_blemishes
from app.metrics.pigment import find_spots

PX_PER_MM = 6.0  # the detection scale, so nothing is resized


def _lab(L, a=12.0, b=18.0, seed=0, shape=(360, 360), a_noise=0.6):
    rng = np.random.default_rng(seed)
    lab = np.empty((*shape, 3))
    for i, (v, sd) in enumerate(((L, 0.6), (a, a_noise), (b, 0.6))):
        lab[..., i] = v + rng.normal(0, sd, shape)
    return lab


def _dot(lab, cx, cy, r, d_l=0.0, d_a=0.0, chroma_scale=1.0):
    yy, xx = np.ogrid[: lab.shape[0], : lab.shape[1]]
    disk = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
    lab[disk, 0] += d_l
    lab[disk, 1:] *= chroma_scale
    lab[disk, 1] += d_a
    return lab


def _all(lab):
    return np.ones(lab.shape[:2], bool)


@pytest.mark.parametrize("L", [70.0, 35.0])
def test_eight_mm_mark_is_found(L):
    # the old 5 mm cap and 3 mm background flattened marks this big
    lab = _dot(_lab(L), 180, 180, r=24, d_l=-6.0, chroma_scale=1.1)  # 8 mm across
    spots = find_spots(lab, _all(lab), _all(lab), PX_PER_MM)
    assert len(spots) == 1 and spots[0].radius * 2 / PX_PER_MM > 5


def test_many_marks_do_not_raise_the_bar():
    lab = _lab(55)
    centres = [(x, y) for x in range(30, 360, 45) for y in range(30, 360, 45)]
    for cx, cy in centres:  # 64 freckles, 2 mm each
        _dot(lab, cx, cy, r=6, d_l=-4.0, chroma_scale=1.1)
    found = find_spots(lab, _all(lab), _all(lab), PX_PER_MM)
    assert len(found) >= 0.9 * len(centres)


def test_mark_surrounded_by_hair_strands_is_rejected():
    lab = _dot(_lab(60), 180, 180, r=9, d_l=-6.0, chroma_scale=1.1)
    found = find_spots(lab, _all(lab), _all(lab), PX_PER_MM)
    assert len(found) == 1
    yy, xx = np.ogrid[:360, :360]
    fringe = ((xx % 3) == 0) & ((xx - 180) ** 2 + (yy - 180) ** 2 > 14**2)
    lab[fringe & (abs(yy - 180) < 60) & (abs(xx - 180) < 60), 0] -= 15.0  # baby hairs around it
    assert all(
        abs(s.x - 180) > 3 or abs(s.y - 180) > 3
        for s in find_spots(lab, _all(lab), _all(lab), PX_PER_MM)
    )


def test_darker_pimple_on_deep_skin_is_a_blemish():
    # only a little redder (not enough alone, given this skin's redness texture) but darker
    lab = _dot(_lab(32, a_noise=2.0), 180, 180, r=9, d_l=-4.0, d_a=1.5)
    assert len(find_blemishes(lab, _all(lab), PX_PER_MM)) == 1
    lab = _dot(_lab(32, a_noise=2.0), 180, 180, r=9, d_a=1.5)  # same redness, not darker
    assert find_blemishes(lab, _all(lab), PX_PER_MM) == []


def test_brown_mark_is_a_spot_not_a_blemish():
    # pigment raises a* a little as it darkens; that is not inflammation
    lab = _dot(_lab(50), 180, 180, r=9, d_l=-8.0, d_a=1.2)
    assert find_blemishes(lab, _all(lab), PX_PER_MM) == []
    assert len(find_spots(lab, _all(lab), _all(lab), PX_PER_MM)) == 1


def test_blemish_search_mask():
    lab = _dot(_lab(60), 90, 90, r=12, d_a=8.0)
    search = _all(lab)
    search[:180, :180] = False  # e.g. the hairline band
    assert find_blemishes(lab, _all(lab), PX_PER_MM, search=search) == []


def test_small_cluster_of_dark_bumps_is_not_stubble():
    rng = np.random.default_rng(1)
    l_star = 55 + rng.normal(0, 0.6, (360, 360))
    yy, xx = np.ogrid[:360, :360]
    for cx, cy in [(170, 170), (180, 176), (176, 186), (186, 168), (166, 182)]:
        l_star[(xx - cx) ** 2 + (yy - cy) ** 2 <= 4] -= 12  # 5 small bumps in ~5 mm
    assert not facial_hair(l_star, np.ones_like(l_star, bool), PX_PER_MM)[176, 176]
    stubble = l_star.copy()
    stubble[60:300:3, 60:300] -= 12  # a 40 mm patch of thin dark lines
    assert facial_hair(stubble, np.ones_like(l_star, bool), PX_PER_MM)[180, 180]


def test_border_band_is_wider_at_the_hairline():
    pts = np.zeros((478, 2))
    pts[33], pts[263] = (100, 200), (100 + 63 * PX_PER_MM, 200)  # 6 px/mm
    pts[10], pts[152], pts[168] = (290, 40), (290, 560), (290, 200)  # top, chin, eyes
    face = Face(points=pts, yaw=0, pitch=0, roll=0)
    skin = np.zeros((600, 600), bool)
    skin[30:570, 50:530] = True
    band = face.border_band(skin)
    top_mm = band[30:200, 290].sum() / PX_PER_MM
    bottom_mm = band[200:570, 290].sum() / PX_PER_MM
    assert top_mm == pytest.approx(config.HAIRLINE_GUARD_MM, abs=0.5)
    assert bottom_mm == pytest.approx(config.JAW_GUARD_MM, abs=0.5)
    assert not band[300, 290]  # mid-face is searched


def test_faint_spot_needs_more_contrast_in_the_strict_zone():
    lab = _dot(_lab(60, seed=3), 180, 180, r=9, d_l=-3.5, chroma_scale=1.1)  # 3 mm mark
    lab[..., 0] += np.random.default_rng(3).normal(0, 1.5, lab.shape[:2])  # grainier camera
    score = find_spots(lab, _all(lab), _all(lab), PX_PER_MM)[0].score
    assert config.SPOT_MIN_SCORE < score < config.SPOT_STRICT_SCORE
    assert find_spots(lab, _all(lab), _all(lab), PX_PER_MM, strict=_all(lab)) == []


def test_visible_mark_found_on_a_grainy_photo():
    # sharp phone photos have more fine texture; a clearly visible mark must still count
    lab = _dot(_lab(62, seed=4), 180, 180, r=6, d_l=-6.0, chroma_scale=1.1)  # 2 mm, -6 L*
    lab[..., 0] += np.random.default_rng(4).normal(0, 2.5, lab.shape[:2])
    assert len(find_spots(lab, _all(lab), _all(lab), PX_PER_MM)) == 1


def test_broad_faint_shading_is_not_a_spot():
    lab = _lab(60)
    yy, xx = np.ogrid[:360, :360]
    lab[..., 0] -= 3.5 * np.exp(-((xx - 180) ** 2 + (yy - 180) ** 2) / (2 * 15.0**2))  # 8 mm
    assert find_spots(lab, _all(lab), _all(lab), PX_PER_MM) == []


def test_dark_dip_on_a_shadow_edge_is_not_a_spot():
    # a 2 mm dip right where a shadow band starts (lip / jaw): dark on one side only
    lab = _lab(60)
    lab[190:, :, 0] -= 8.0  # shadow below row 190
    _dot(lab, 180, 186, r=6, d_l=-4.0, chroma_scale=1.1)
    assert find_spots(lab, _all(lab), _all(lab), PX_PER_MM) == []
    # the same dot on open skin counts
    lab = _dot(_lab(60), 180, 120, r=6, d_l=-4.0, chroma_scale=1.1)
    assert len(find_spots(lab, _all(lab), _all(lab), PX_PER_MM)) == 1


def test_stubble_dots_are_cut_but_a_few_freckles_are_not():
    from app.landmarks import stubble

    rng = np.random.default_rng(5)
    l_star = 55 + rng.normal(0, 0.6, (360, 360))
    skin = np.ones_like(l_star, bool)
    beard = l_star.copy()
    ys, xs = rng.integers(40, 320, 9000), rng.integers(40, 320, 9000)
    beard[ys, xs] -= 12  # ~11% of pixels dark dots over ~45 mm, like real stubble
    assert stubble(beard, skin, PX_PER_MM)[180, 180]
    freckled = l_star.copy()
    yy, xx = np.ogrid[:360, :360]
    for cx, cy in [(100, 100), (180, 140), (250, 220), (140, 260)]:
        freckled[(xx - cx) ** 2 + (yy - cy) ** 2 <= 36] -= 6
    assert not stubble(freckled, skin, PX_PER_MM).any()


def test_large_mark_beside_the_face_edge_is_found_whole():
    # a 7 mm mark with darker cores, its edge 1 mm from where the face ends (jaw line)
    lab = _dot(_lab(55), 200, 180, r=21, d_l=-9.0, chroma_scale=1.1)
    _dot(lab, 195, 175, r=3, d_l=-5.0)  # a darker core inside it
    skin = _all(lab)
    skin[:, 228:] = False  # off the face to the right
    spots = find_spots(lab, skin, skin, PX_PER_MM, outline=skin)
    assert len(spots) == 1 and spots[0].radius * 2 / PX_PER_MM > 5


def test_shiny_skin_is_not_cut_as_facial_hair():
    rng = np.random.default_rng(6)
    l_star = 30 + rng.normal(0, 0.6, (360, 360))  # deep skin
    shine = l_star.copy()
    shine[60:300, 60:300] += 25  # a glossy patch...
    shine[60:300:3, 60:300] -= 12  # ...with dark pore gaps between highlights
    assert not facial_hair(shine, np.ones_like(l_star, bool), PX_PER_MM)[180, 180]


def test_dark_grey_braids_at_the_hairline_are_cut():
    from app.landmarks import remove_hair

    rng = np.random.default_rng(6)
    L = 42 + rng.normal(0, 0.8, (360, 360))  # deep skin
    chroma = np.full((360, 360), 30.0)
    L[:60], chroma[:60] = 19.0, 4.0  # braids along the top edge: 23 L* darker, nearly grey
    mask = np.zeros((360, 360), bool)
    mask[5:355, 5:355] = True  # the face mask sits inside the crop
    assert remove_hair(L, mask, PX_PER_MM)[30, 180]  # L* alone misses them
    keep = remove_hair(L, mask, PX_PER_MM, chroma)
    assert not keep[30, 180] and keep[200, 180]
