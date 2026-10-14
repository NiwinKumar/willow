"""dark_circles: under-eye L* minus same-side cheek L*, relative to the person's own skin."""

import numpy as np
import pytest

from app.metrics.dark_circles import dark_circles


def _face(L, eye_dl=0.0, eye_da=0.0, shape=(200, 200), seed=0):
    rng = np.random.default_rng(seed)
    lab = np.stack(
        [np.full(shape, v) + rng.normal(0, 0.5, shape) for v in (L, 12.0, 18.0)], axis=-1
    )
    eye = np.zeros(shape, bool)
    eye[20:60, 20:180] = True
    lab[eye, 0] += eye_dl
    lab[eye, 1] += eye_da
    cheek = np.zeros(shape, bool)
    cheek[100:180, 20:180] = True
    # linear red from L* (darker -> less red light -> higher melanin proxy)
    linear = np.repeat(((lab[..., :1] + 16) / 116) ** 3, 3, axis=-1)
    return lab, linear, eye, cheek


@pytest.mark.parametrize("L", [75.0, 55.0, 30.0])  # light, medium, deep skin
def test_darker_under_eye_is_negative_at_every_tone(L):
    lab, linear, eye, cheek = _face(L, eye_dl=-6.0, eye_da=1.5)
    skin = {
        "right_under_eye": eye,
        "right_cheek": cheek,
        "left_under_eye": eye,
        "left_cheek": cheek,
    }
    value, extras = dark_circles(lab, linear, skin, min_px=100)
    assert value == pytest.approx(-6.0, abs=0.3)
    assert extras["delta_a_star"] == pytest.approx(1.5, abs=0.3)
    assert extras["delta_melanin_proxy"] > 0 and extras["sides"] == 2


def test_side_view_uses_the_visible_side_only():
    lab, linear, eye, cheek = _face(60, eye_dl=-4.0)
    skin = {"left_under_eye": eye, "left_cheek": cheek}  # a left-side view
    value, extras = dark_circles(lab, linear, skin, min_px=100)
    assert value == pytest.approx(-4.0, abs=0.3) and extras["sides"] == 1


def test_no_value_without_enough_under_eye_skin():
    lab, linear, eye, cheek = _face(60)
    tiny = np.zeros_like(eye)
    tiny[30, 30] = True  # e.g. hair or glasses covering the under-eye
    assert dark_circles(lab, linear, {"right_under_eye": tiny, "right_cheek": cheek}, 100) == (
        None,
        {},
    )
