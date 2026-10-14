"""lines: thin, long, elongated dark ridges count; bumps, marks and creased expressions do not."""

from types import SimpleNamespace

import numpy as np
import pytest

from app.metrics.lines import lines

PX_PER_MM = 6.0


def _skin(L=60.0, shape=(240, 360), seed=0):
    rng = np.random.default_rng(seed)
    return np.stack([np.full(shape, v) + rng.normal(0, 0.5, shape) for v in (L, 12.0, 18.0)], -1)


def _forehead(shape=(240, 360)):
    m = np.zeros(shape, bool)
    m[20:220, 20:340] = True
    return {"forehead": m}


@pytest.mark.parametrize("L", [75.0, 50.0, 30.0])
def test_horizontal_forehead_lines_count_at_every_tone(L):
    lab = _skin(L)
    for y in (70, 120, 170):  # three 0.5 mm wide, 40 mm long lines, 5 L* darker
        lab[y : y + 3, 60:300, 0] -= 5.0
    value, extras = lines(lab, _forehead(), [], PX_PER_MM, {})
    assert value > 2.0 and extras["forehead_pct"] == pytest.approx(value)


def test_plain_skin_and_round_bumps_are_not_lines():
    lab = _skin()
    yy, xx = np.ogrid[:240, :360]
    for cx in range(60, 320, 40):  # a row of 2 mm dark bumps (acne, pores)
        lab[(xx - cx) ** 2 + (yy - 120) ** 2 <= 36, 0] -= 8.0
    value, _ = lines(lab, _forehead(), [], PX_PER_MM, {})
    assert value < 0.5


def test_a_line_on_a_detected_mark_is_ignored():
    lab = _skin()
    lab[118:121, 150:210, 0] -= 6.0  # a 10 mm dark streak...
    mark = SimpleNamespace(x=180.0, y=120.0, radius=40.0)  # ...that is a detected spot
    assert lines(lab, _forehead(), [mark], PX_PER_MM, {})[0] < 0.5


def test_raised_brows_skip_the_forehead():
    lab = _skin()
    lab[118:121, 60:300, 0] -= 5.0
    value, extras = lines(lab, _forehead(), [], PX_PER_MM, {"browInnerUp": 0.9})
    assert value is None and extras["skipped_for_expression"] == ["forehead"]
