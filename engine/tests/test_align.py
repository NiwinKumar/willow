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


def _counted_frame(points, blemishes, index):
    """A photo with counts already set, as _frame() leaves them before confirmation."""
    f = _frame(points, blemishes, index)
    f["values"] = {"blemishes": float(len(blemishes)), "pigment_spots": 0.0}
    f["extras"] = {"pigment_spots": {"count": 0, "mean_contrast": 0.0}}
    f["face_skin"] = (f["box"], np.ones((10, 10), bool))
    return f


def test_a_photo_whose_only_partner_cannot_be_lined_up_keeps_its_counts():
    from app.pipeline_face import _count_confirmed

    pts = np.random.default_rng(3).uniform(200, 800, (478, 2))
    good = _counted_frame(pts, [(500.0, 600.0), (350.0, 750.0)], 0)
    stuck = _counted_frame(np.zeros((478, 2)), [(400.0, 400.0)], 1)  # similarity() rejects it
    with pytest.raises(ValueError):
        similarity(stuck["face"].points, good["face"].points)
    _count_confirmed([good, stuck])
    assert good["values"]["blemishes"] == 2.0  # not dropped to 0 for lack of a partner
    assert stuck["values"]["blemishes"] == 1.0
