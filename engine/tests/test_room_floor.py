"""The between-room floor on a colour reading's normal range (config.ROOM_LIGHT_FLOOR): five
photos in one room's light give a band too narrow for a check-in in another room."""

import pytest

from app import config
from app.aggregate import mdc95, summarize


def test_floor_widens_a_narrow_band_and_never_narrows_a_wide_one():
    steady = [15.0, 15.1, 14.9, 15.0, 15.05]  # one room: a* barely moves
    s = summarize(steady, None, config.MIN_SD["redness"], floor=3.63)
    assert mdc95(max(0.0707, config.MIN_SD["redness"]), 5) < 3.63
    assert s["mdc95"] == 3.63
    wide = summarize([10.0, 14.0, 18.0, 12.0, 16.0], None, 0.2, floor=3.63)
    assert wide["mdc95"] > 3.63  # a session whose own spread is wider keeps it


def test_a_change_inside_the_floor_is_within_the_normal_range_and_beyond_it_is_real():
    base = summarize([15.0, 15.1, 14.9, 15.0, 15.05], None, 0.2, floor=3.63)
    ref = {"mean": base["value"], "mdc95": base["mdc95"]}
    assert summarize([17.0, 17.1, 16.9], ref)["verdict"] == "within_noise"  # a new room's light
    assert summarize([19.0, 19.1, 18.9], ref)["verdict"] == "real_change"


def test_no_band_under_three_photos_floor_or_not():
    assert summarize([15.0, 15.2], None, 0.2, floor=3.63)["mdc95"] is None


@pytest.mark.parametrize("metric", sorted(config.ROOM_LIGHT_FLOOR))
def test_floors_only_on_colour_and_light_readings(metric):
    # marks and lines are found against nearby skin, which the room's light moves with them
    assert metric not in {"blemishes", "pigment_spots", "lines", "pores", "texture"}
    assert config.ROOM_LIGHT_FLOOR[metric] > 0
