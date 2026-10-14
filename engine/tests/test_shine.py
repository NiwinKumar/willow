"""shine: highlights are brighter than the skin around them AND greyer."""

import numpy as np
import pytest

from app.metrics.shine import shine

PX_PER_MM = 6.0


def _skin(L, shape=(240, 240)):
    rng = np.random.default_rng(0)
    lab = np.stack([np.full(shape, v) + rng.normal(0, 0.6, shape) for v in (L, 12.0, 18.0)], -1)
    linear = np.full((*shape, 3), 0.3)
    return lab, linear


def _zones(shape=(240, 240)):
    t = np.zeros(shape, bool)
    t[:120] = True
    return t, ~t


@pytest.mark.parametrize("L", [75.0, 50.0, 30.0])  # light, medium, deep skin
def test_highlight_on_the_forehead_counts_at_every_tone(L):
    lab, linear = _skin(L)
    lab[30:60, 60:180, 0] += 12  # a glint: brighter...
    lab[30:60, 60:180, 1:] *= 0.5  # ...and greyer than the skin around it
    t, u = _zones()
    value, extras = shine(lab, linear, t, u, PX_PER_MM)
    assert value == pytest.approx(100 * 30 * 120 / t.sum(), rel=0.25)
    assert extras["u_zone_pct"] < 0.5


def test_brighter_but_coloured_skin_is_not_shine():
    lab, linear = _skin(60)
    lab[30:60, 60:180, 0] += 12  # brighter, same colour: a lit area, not oil
    t, u = _zones()
    assert shine(lab, linear, t, u, PX_PER_MM)[0] < 0.5


def test_clipped_white_counts_and_too_little_t_zone_gives_no_value():
    lab, linear = _skin(60)
    linear[10:20, 10:20] = 1.0
    t, u = _zones()
    assert shine(lab, linear, t, u, PX_PER_MM)[0] > 0
    tiny = np.zeros_like(t)
    tiny[0, 0] = True
    assert shine(lab, linear, tiny, u, PX_PER_MM) == (None, {})
