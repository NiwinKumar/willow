"""Readings by area (extras.by_zone): each face-map zone's own value, spread and noise band,
from the same marks and pixels the whole-face metric uses."""

import numpy as np
import pytest
from test_three_view import _frame

from app import config
from app.pipeline_face import _by_zone, _combine_views, _zone_colour, _zone_marks


def _three_view():
    front = _frame(
        "front",
        ["forehead", "right_cheek", "chin", "right_cheek"],  # 2 blemishes, 2 spots
        [9.0] * 4,
        [400.0, 400.0],  # 4 mm2 each at 10 px/mm
        {"forehead": 6000, "chin": 6000, "right_cheek": 5000},  # 60, 60, 50 mm2
    )
    side = _frame(
        "right",
        ["right_cheek", "right_cheek", "right_jaw"],  # 1 blemish, 2 spots (one at the edge)
        [9.0, 9.0, 0.5],
        [100.0, 100.0],  # 4 mm2 each at 5 px/mm
        {"right_cheek": 2500, "right_jaw": 1500},  # 100 + 60 mm2
        px_per_mm=5.0,
    )
    return front, side


def test_zone_marks_add_up_to_the_session_totals():
    front, side = _three_view()
    _combine_views([front], {"right": side})
    _zone_marks([front], {"right": side})
    blem = front["zone_values"]["blemishes"]
    # the front's own right-cheek blemish is not counted: the cheek photo measures that zone
    assert blem == {"forehead": 1.0, "chin": 0.0, "right_cheek": 1.0, "right_jaw": 0.0}
    assert sum(blem.values()) == front["values"]["blemishes"]
    spots = front["zone_values"]["pigment_spots"]
    assert spots["chin"] == pytest.approx(100 * 4 / 60)  # 4 mm2 of 60 mm2 chin skin
    assert spots["right_cheek"] == pytest.approx(100 * 4 / 100)  # the side photo's cheek
    assert spots["forehead"] == 0.0 and spots["right_jaw"] == 0.0  # the jaw mark was an edge


def test_small_zones_are_left_out():
    tiny = int(0.5 * config.ZONE_MIN_MM2 * 100)  # half the minimum, at 10 px/mm
    f = _frame("front", ["forehead", "nose"], [9.0, 9.0], [], {"forehead": 6000, "nose": tiny})
    _zone_marks([f], {})
    assert f["zone_values"]["blemishes"] == {"forehead": 1.0}


def test_by_zone_has_its_own_band_and_photo_count():
    have = [
        {"zone_values": {"redness": {"chin": 20.0, "nose": 15.0}}},
        {"zone_values": {"redness": {"chin": 21.0}}},  # the nose was cut off in this photo
        {"zone_values": {"redness": {"chin": 22.0, "nose": float("nan")}}},
    ]
    out = _by_zone("redness", have)
    assert out["chin"]["value"] == 21.0 and out["chin"]["n"] == 3
    assert out["chin"]["within_session_sd"] == 1.0
    assert out["chin"]["mdc95"] is not None  # 3 photos: a band
    # one usable photo: a value, but no spread and no band, never a verdict
    assert out["nose"] == {"value": 15.0, "within_session_sd": None, "mdc95": None, "n": 1}


def test_identical_photos_get_the_metric_floor_not_zero():
    have = [{"zone_values": {"blemishes": {"chin": 4.0}}}] * 5
    chin = _by_zone("blemishes", have)["chin"]
    assert chin["within_session_sd"] == config.MIN_SD["blemishes"]
    assert chin["mdc95"] > 0


def test_zone_colour_reads_each_zone_on_its_own_skin():
    px = 10.0
    lab = np.zeros((100, 200, 3))
    lab[..., 1] = 10.0
    lab[:, 100:, 1] = 20.0  # the right half is redder
    red = np.full((100, 200), 0.4)
    left = np.zeros((100, 200), bool)
    left[:, :100] = True  # 100 mm2 at 10 px/mm
    right = ~left
    speck = np.zeros((100, 200), bool)
    speck[0, 0] = True  # far below ZONE_MIN_MM2
    out = _zone_colour(lab, red, {"forehead": left, "chin": right, "nose": speck}, px)
    assert out["redness"] == {"forehead": 10.0, "chin": 20.0}
    # uniform melanin proxy: no blotchiness inside either zone
    assert out["tone_evenness"]["forehead"] == pytest.approx(0.0, abs=1e-9)
    assert "nose" not in out["tone_evenness"]
