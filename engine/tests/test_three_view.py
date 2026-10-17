"""A session with a front photo and cheek photos: each face-map zone is measured once, on the
photo that faces it, and the counts are combined."""

from types import SimpleNamespace as M

import numpy as np
import pytest

from app.pipeline_face import _combine_views, _keeps, _mark_depth_mm, _owns


def test_each_zone_is_owned_by_one_view():
    both = {"right", "left"}
    assert _owns("front", "forehead", both) and _owns("front", "chin", both)
    assert not _owns("front", "right_cheek", both) and not _owns("front", "left_jaw", both)
    assert _owns("right", "right_cheek", both) and _owns("right", "right_jaw", both)
    assert not _owns("right", "left_cheek", both) and not _owns("right", "nose", both)
    assert _owns("front", "left_cheek", {"right"})  # no left photo: the front measures it
    assert _owns("front", None, both)  # unzoned marks stay with the front


def _frame(view, zones, depths, spot_px, zone_px, px_per_mm=10.0):
    n_b = len(zones) - len(spot_px)
    return {
        "view": view,
        "face": M(px_per_mm=px_per_mm),
        "blemishes": [M() for _ in range(n_b)],
        "spots": [M(area_px=a) for a in spot_px],
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
    )
    side = _frame(
        "right",
        ["right_cheek", "right_cheek", "right_jaw"],  # 1 blemish, 2 spots (one at the edge)
        [9.0, 9.0, 0.5],
        [100.0, 100.0],  # 4 mm2 each at 5 px/mm
        {"right_cheek": 2500, "right_jaw": 1500},  # 100 + 60 mm2
        px_per_mm=5.0,
    )
    _combine_views([front], {"right": side})
    assert front["values"]["blemishes"] == 2.0  # forehead + the side's cheek; not the front cheek
    # spots: chin 4 mm2 + side cheek 4 mm2 over forehead 60 + chin 40 + cheek 100 + jaw 60 mm2
    assert front["values"]["pigment_spots"] == pytest.approx(100 * 8 / 260)
    assert front["extras"]["pigment_spots"]["count"] == 2


def test_mark_depth_is_measured_from_its_rim():
    skin = np.zeros((100, 100), bool)
    skin[:, 20:] = True
    d = _mark_depth_mm(skin, [M(x=60, y=50, radius=5), M(x=22, y=50, radius=5)], 10.0)
    assert d[0] == pytest.approx(3.5, abs=0.15) and d[1] < 0
