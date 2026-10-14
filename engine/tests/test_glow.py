"""glow: brighter, richer and smoother cheeks score higher; shine does not add glow."""

import numpy as np
import pytest

from app import config
from app.metrics.glow import glow

PX_PER_MM = 6.0


def _cheek(L=60.0, chroma_scale=1.0, texture=1.0, seed=0, shape=(200, 200)):
    rng = np.random.default_rng(seed)
    lab = np.stack(
        [
            np.full(shape, L) + rng.normal(0, texture, shape),
            np.full(shape, 12.0 * chroma_scale),
            np.full(shape, 18.0 * chroma_scale),
        ],
        -1,
    )
    return lab, np.full((*shape, 3), 0.3), np.ones(shape, bool)


def test_smoother_skin_glows_more_at_the_same_tone():
    rough, smooth = glow(*_cheek(texture=2.0), PX_PER_MM), glow(*_cheek(texture=0.5), PX_PER_MM)
    assert smooth[0] > rough[0]
    assert smooth[1]["fine_texture"] < rough[1]["fine_texture"]


def test_parts_are_reported():
    value, extras = glow(*_cheek(L=55.0), PX_PER_MM)
    assert extras["l_star"] == pytest.approx(55.0, abs=0.5)
    assert value == pytest.approx(
        extras["l_star"] + extras["chroma"] - config.GLOW_TEXTURE_WEIGHT * extras["fine_texture"],
        abs=0.05,
    )


def test_shine_highlights_do_not_add_glow():
    lab, lin, cheeks = _cheek()
    base = glow(lab, lin, cheeks, PX_PER_MM)[0]
    lab[50:70, 50:70, 0] += 25  # a greasy glint
    lab[50:70, 50:70, 1:] *= 0.3
    assert glow(lab, lin, cheeks, PX_PER_MM)[0] == pytest.approx(base, abs=0.5)


def test_too_little_cheek_gives_no_value():
    lab, lin, cheeks = _cheek()
    tiny = np.zeros_like(cheeks)
    tiny[0, 0] = True
    assert glow(lab, lin, tiny, PX_PER_MM) == (None, {})
