"""A session with a front photo and cheek photos: each face-map zone is measured once, on the
photo that faces it, and the counts are combined."""

from types import SimpleNamespace as M

import numpy as np
import pytest
from PIL import Image
from test_face import FakeFace

from app import config, facemap
from app.pipeline_face import (
    _assign_views,
    _combine_views,
    _keeps,
    _mark_depth_mm,
    _owned_zone_px,
    _owns,
    _shares,
    _view_skin,
    _zone_marks,
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


def _tris(zone: str, half: str) -> np.ndarray:
    """Mesh triangles of a zone on one half of the face."""
    codes, halves = facemap.triangle_zones(), facemap.triangle_sides()
    return np.flatnonzero((codes == facemap.ZONES.index(zone) + 1) & (halves == half))


def _views_by_angle(side_sees_chin: float):
    """Front sees everything at 0.5; the right photo sees its cheek and jaw at 0.9 and the
    right half of the chin at `side_sees_chin`."""
    n = len(facemap.triangle_zones())
    front_f, side_f = np.full(n, 0.5), np.zeros(n)
    for z in ("right_cheek", "right_jaw"):
        side_f[_tris(z, "right")] = 0.9
    side_f[_tris("chin", "right")] = side_sees_chin
    front, side = {"view": "front", "facing": front_f}, {"view": "right", "facing": side_f}
    _assign_views([front], {"right": [side]})
    return front, side


def test_a_side_photo_takes_the_chin_side_it_sees_more_squarely():
    chin_r, chin_l = _tris("chin", "right"), _tris("chin", "left")
    front, side = _views_by_angle(0.5 + config.SIDE_FACING_MARGIN + 0.2)
    assert side["owned"][chin_r].all() and not front["owned"][chin_r].any()
    assert front["owned"][chin_l].all() and not side["owned"][chin_l].any()  # the other half
    assert side["owned"][_tris("right_jaw", "right")].all()
    assert not side["owned"][_tris("nose", "right")].any()  # the nose stays with the front
    assert (front["owned"] ^ side["owned"]).all()  # every triangle measured once


def test_a_side_photo_that_sees_the_chin_no_better_leaves_it_to_the_front():
    front, side = _views_by_angle(0.5 + config.SIDE_FACING_MARGIN / 2)
    assert front["owned"][_tris("chin", "right")].all()
    assert side["owned"][_tris("right_cheek", "right")].all()  # its cheek in any case


def _tri_frame(view, own, tri_map, label, mark_tris, depths):
    return {
        "view": view,
        "owned": own,
        "tri_map": tri_map,
        "zone_label": label,
        "mark_tris": mark_tris,
        "mark_zones": ["chin"] * len(mark_tris),
        "mark_depth_mm": depths,
        "zone_px": {},
        "face": M(px_per_mm=1.0),
        "blemishes": [M() for _ in mark_tris],
        "spots": [],
        "values": {},
        "extras": {"pigment_spots": {"count": 0}},
    }


def test_marks_skin_and_layer_follow_the_triangles_a_photo_measures():
    chin = facemap.ZONES.index("chin") + 1
    own = np.zeros(len(facemap.triangle_zones()), bool)
    own[[3, 4]] = True
    tri_map = np.array([[3, 3, 5, -1], [4, 5, 5, -1]], np.int16)
    label = np.where(tri_map >= 0, chin, 0).astype(np.uint8)
    side = _tri_frame("right", own, tri_map, label, [3, 5, -1, 4], [8.0, 8.0, 8.0, 1.0])
    # its own triangle; the front's; off the face; its own but at the jaw edge
    assert _keeps(side, {"right"}) == [True, False, False, False]
    assert _owned_zone_px(side, {"right"}) == {"chin": 3}
    assert _view_skin(side).sum() == 3
    front = _tri_frame("front", ~own, tri_map, label, [5, -1], [1.0, 1.0])
    assert _keeps(front, {"right"}) == [True, True]  # off the mesh stays with the front
    assert _owned_zone_px(front, {"right"}) == {"chin": 3}


def test_a_zone_split_between_photos_adds_up():
    chin = facemap.ZONES.index("chin") + 1
    own = np.zeros(len(facemap.triangle_zones()), bool)
    own[3] = True
    tri_map = np.full((10, 10), 5, np.int16)
    tri_map[:, :6] = 3  # 60 px of chin on the side photo, 40 on the front: under
    # ZONE_MIN_MM2 alone (1 px a mm here), counted with the side's part
    label = np.full((10, 10), chin, np.uint8)
    side = _tri_frame("right", own, tri_map, label, [3], [8.0])
    front = _tri_frame("front", ~own, tri_map, label, [5, 5], [1.0, 1.0])
    _zone_marks([front], {"right": side})
    assert front["zone_values"]["blemishes"]["chin"] == 3.0


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


def test_side_marks_keep_away_from_eyes_and_the_ear_side_edge_only():
    from app.landmarks import RIGHT_EYE, Face
    from app.pipeline_face import Box, _side_edges

    pts = np.zeros((478, 2))
    pts[RIGHT_EYE] = [[60, 20], [70, 20], [70, 26], [60, 26]] * 4  # an eye inside the skin
    face = Face(points=pts, yaw=40.0, pitch=0.0, roll=0.0)
    skin = np.zeros((100, 100), bool)
    skin[10:90, 10:90] = True
    skin[40:50, 40:50] = False  # a hole the skin mask cut inside the cheek (inflamed acne)
    ear = np.zeros_like(skin)
    ear[:, :30] = True  # the ear side of the photo
    lower = np.zeros_like(skin)
    lower[60:, :] = True  # below the nose
    e = _side_edges(face, Box(0, 0, 100, 100), skin, ear, lower)
    assert e[22, 65]  # the eye
    assert e[50, 5] and e[5, 50]  # outside the face on the ear side and above the nose
    assert not e[45, 45]  # the hole inside the face
    assert not e[95, 60]  # the jawline on the nose side, under the nose
