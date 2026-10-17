"""A session with a front photo and cheek photos: each face-map zone is measured once, on the
photo that faces it, and the counts are combined."""

from types import SimpleNamespace as M

import numpy as np
import pytest
from PIL import Image
from test_face import FakeFace

from app.pipeline_face import (
    _combine_views,
    _keeps,
    _mark_depth_mm,
    _owns,
    _shares,
    analyze_face,
)


def test_each_zone_is_owned_by_one_view():
    both = {"right", "left"}
    assert _owns("front", "forehead", both) and _owns("front", "chin", both)
    assert not _owns("front", "right_cheek", both) and not _owns("front", "left_jaw", both)
    assert _owns("right", "right_cheek", both) and _owns("right", "right_jaw", both)
    assert not _owns("right", "left_cheek", both) and not _owns("right", "nose", both)
    assert _owns("front", "left_cheek", {"right"})  # no left photo: the front measures it
    assert _owns("front", None, both)  # unzoned marks stay with the front


def _frame(view, zones, depths, spot_px, zone_px, px_per_mm=10.0, spot_dl=None):
    n_b = len(zones) - len(spot_px)
    spot_dl = spot_dl or [-5.0] * len(spot_px)
    return {
        "view": view,
        "face": M(px_per_mm=px_per_mm),
        "blemishes": [M() for _ in range(n_b)],
        "spots": [M(area_px=a, l_star_contrast=d) for a, d in zip(spot_px, spot_dl, strict=True)],
        "mark_zones": zones,
        "mark_depth_mm": depths,
        "zone_px": zone_px,
        "values": {},
        "extras": {"pigment_spots": {"count": 0}},
    }


def test_side_marks_at_the_face_edge_are_left_out():
    f = _frame("right", ["right_cheek", "right_jaw", "nose"], [8.0, 1.0, 8.0], [], {})
    assert _keeps(f, {"right"}) == [True, False, False]  # jaw-edge shadow, nose is the front's
    front = _frame("front", ["forehead"], [1.0], [], {})
    assert _keeps(front, {"right"}) == [True]  # the front keeps its own edge rules


def test_counts_and_area_combine_across_views():
    front = _frame(
        "front",
        ["forehead", "right_cheek", "chin", "right_cheek"],  # 2 blemishes, 2 spots
        [9.0] * 4,
        [400.0, 400.0],  # 4 mm2 each at 10 px/mm
        {"forehead": 6000, "chin": 4000, "right_cheek": 5000},
        spot_dl=[-4.0, -9.0],  # chin, then the front's cheek spot (dropped), the darker
    )
    side = _frame(
        "right",
        ["right_cheek", "right_cheek", "right_jaw"],  # 1 blemish, 2 spots (one at the edge)
        [9.0, 9.0, 0.5],
        [100.0, 100.0],  # 4 mm2 each at 5 px/mm
        {"right_cheek": 2500, "right_jaw": 1500},  # 100 + 60 mm2
        px_per_mm=5.0,
        spot_dl=[-6.0, -20.0],  # the jaw-edge shadow (dropped) is darker still
    )
    _combine_views([front], {"right": side})
    assert front["values"]["blemishes"] == 2.0  # forehead + the side's cheek; not the front cheek
    # spots: chin 4 mm2 + side cheek 4 mm2 over forehead 60 + chin 40 + cheek 100 + jaw 60 mm2
    assert front["values"]["pigment_spots"] == pytest.approx(100 * 8 / 260)
    assert front["extras"]["pigment_spots"]["count"] == 2
    # mean darkness of the same two kept spots: chin (4) and the side's cheek (6)
    assert front["extras"]["pigment_spots"]["mean_contrast"] == 5.0


def test_cheeks_share_what_the_front_leaves_of_the_candidate_cap():
    assert _shares(5, [3, 3]) == [3, 2]  # an even split, the odd slot to the first
    assert _shares(6, [1, 9]) == [1, 5]  # a cheek with fewer marks passes its slots on
    assert _shares(0, [4, 4]) == [0, 0]  # the front used the whole cap
    assert _shares(10, [2, 0]) == [2, 0]  # never more than a cheek's own marks
    assert _shares(3, []) == []


def test_mark_depth_is_measured_from_its_rim():
    skin = np.zeros((100, 100), bool)
    skin[:, 20:] = True
    d = _mark_depth_mm(skin, [M(x=60, y=50, radius=5), M(x=22, y=50, radius=5)], 10.0)
    assert d[0] == pytest.approx(3.5, abs=0.15) and d[1] < 0


# ---- a whole session, with a stand-in for MediaPipe -------------------------------------

POINTS = {  # rigid landmarks the photos are lined up on (as test_face.fake_landmarks)
    33: (300, 380),
    133: (430, 380),
    362: (570, 380),
    263: (700, 380),
    168: (500, 380),
    6: (500, 430),
    1: (500, 560),
    4: (500, 540),
    61: (420, 700),
    291: (580, 700),
    152: (500, 880),
    10: (500, 130),
    234: (210, 480),
    454: (790, 480),
}


def _photo(path, view, seed, bumps=((500, 600), (350, 750), (650, 300))):
    rng = np.random.default_rng(seed)
    img = np.full((1000, 1000, 3), (198, 148, 115), np.float64) + rng.normal(0, 3, (1000, 1000, 1))
    yy, xx = np.ogrid[:1000, :1000]
    for cx, cy in bumps:
        img[(xx - cx) ** 2 + (yy - cy) ** 2 <= 9**2] = (215, 120, 105)  # red bumps
    img[:60, :60] = 120 * view  # which view the photo is, for the stand-in detector
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path, quality=95)


def test_a_three_view_session_keeps_one_candidate_cap(tmp_path, monkeypatch):
    def detect(srgb8):
        view = round(float(srgb8[30, 30].mean()) / 120)  # 0 front, 1 right, 2 left
        pts = np.zeros((478, 2))
        for i, xy in POINTS.items():
            pts[i] = xy
        if view == 1:
            pts[234] = (150, 480)  # the right cheek turned to the camera
        elif view == 2:
            pts[454] = (850, 480)
        return FakeFace(points=pts, yaw=30.0 if view else 1.0, pitch=0.0, roll=0.0)

    monkeypatch.setattr("app.pipeline_face.detect_face", detect)
    # the stand-in landmarks place no face-map zones: every mark counts for its own view
    monkeypatch.setattr("app.pipeline_face._keeps", lambda f, sides: [True] * len(f["mark_zones"]))
    files = []
    for name, view, seed in (("front", 0, 0), ("right1", 1, 1), ("right2", 1, 2), ("left", 2, 3)):
        _photo(tmp_path / f"{name}.jpg", view, seed)
        files.append(str(tmp_path / f"{name}.jpg"))
    r = analyze_face(files, max_candidates=5)  # schema-validated inside
    assert [v["view"] for v in r["views"]] == ["front", "right", "left"]
    # 3 marks a photo: the front's 3 first, then one each for the cheeks (not 3 + 3 + 3)
    got = [(c["features"]["view"], c["features"]["frames_in_view"]) for c in r["candidates"]]
    assert got == [(0.0, 1.0)] * 3 + [(1.0, 2.0), (2.0, 1.0)]
    assert [c["id"] for c in r["candidates"]] == [f"c_{i:03d}" for i in range(1, 6)]
    # the right cheek's mark is a share of its own 2 photos
    assert r["candidates"][3]["features"]["seen_in_fraction"] == 1.0
