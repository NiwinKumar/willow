import math

import numpy as np
import pytest

from app.align import residual_px, similarity, transform


def test_recovers_known_shift_rotation_scale():
    rng = np.random.default_rng(1)
    src = rng.uniform(100, 900, (478, 2))
    a, s, t = math.radians(7), 1.12, np.array([35.0, -20.0])
    rot = s * np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
    dst = src @ rot.T + t
    m = similarity(src, dst)
    assert np.allclose(m[:, :2], rot, atol=1e-3) and np.allclose(m[:, 2], t, atol=0.5)
    assert residual_px(src, dst, m) < 0.5
    assert transform(m, [[500, 500]])[0] == pytest.approx(rot @ [500, 500] + t, abs=0.5)


def _frame(points, marks, index):
    """Minimal stand-in for one analysed photo: landmarks, and marks (photo pixels)."""
    from types import SimpleNamespace

    from app.roi import Box

    face = SimpleNamespace(points=points, px_per_mm=6.0)
    blems = [SimpleNamespace(x=x, y=y) for x, y in marks]
    return {
        "face": face,
        "box": Box(0, 0, 1000, 1000),
        "blemishes": blems,
        "spots": [],
        "index": index,
    }


def test_marks_match_after_the_head_moves_between_photos():
    from app.pipeline_face import _align, _seen_in

    rng = np.random.default_rng(2)
    pts = rng.uniform(200, 800, (478, 2))
    a, s, t = math.radians(5), 1.05, np.array([40.0, -25.0])  # head moved, turned, closer
    rot = s * np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
    move = lambda xy: np.asarray(xy, float) @ rot.T + t
    real, grain = (500.0, 600.0), (350.0, 750.0)
    ref = _frame(pts, [real, grain], 0)
    other = _frame(move(pts), [tuple(move(real))], 1)  # the real mark moved with the face
    unmoved = _frame(move(pts), [real], 2)  # same pixel spot but the face moved: not it
    mapped, warnings = _align(ref, [other, unmoved])
    assert warnings == []
    assert _seen_in(ref, mapped) == [0.67, 0.33]
