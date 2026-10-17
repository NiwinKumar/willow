"""The face's measured areas (result.rois): the whole face skin in the face map's zones."""

import numpy as np
import pytest

from app import config
from app.facemap import canonical
from app.landmarks import Face
from app.pipeline_face import _area_outlines, _zone_labels
from app.roi import Box

PX_PER_MM = 6.0
mesh = canonical()
pytestmark = pytest.mark.skipif(mesh is None, reason="face model not downloaded")


def _face() -> Face:
    verts = mesh[0]
    pts = np.zeros((478, 2))
    eyes = float(np.linalg.norm(verts[263, :2] - verts[33, :2]))
    k = PX_PER_MM * config.EYE_DISTANCE_MM / eyes
    pts[: len(verts)] = verts[:, :2] * [1, -1] * k
    pts[: len(verts)] -= pts[: len(verts)].min(axis=0) - 20 * PX_PER_MM
    return Face(points=pts, yaw=0.0, pitch=0.0, roll=0.0)


def test_zones_cover_the_whole_face_skin_and_leave_the_eyes_out():
    face = _face()
    h, w = (np.ceil(face.points.max(axis=0)) + 20 * PX_PER_MM).astype(int)[::-1]
    skin = face.skin_mask((h, w))
    under = {"right_under_eye": np.array([[0, 0], [5, 0], [5, 5]], float)}
    areas = _area_outlines(face, Box(0, 0, w, h), _zone_labels(face, Box(0, 0, w, h), skin), under)
    assert set(config.FACE_ZONES) <= set(areas)  # all eight zones of a front view
    assert "right_under_eye" in areas  # dark circles' patch stays
    from app.landmarks import polygon_mask

    drawn = np.logical_or.reduce(
        [polygon_mask((h, w), p) for n, p in areas.items() if n in config.FACE_ZONES]
    )
    assert (drawn & skin).sum() > 0.85 * skin.sum()
    eye = face.points[[33, 133]].mean(axis=0).round().astype(int)  # right eye's centre
    assert not drawn[eye[1], eye[0]]


def test_no_mesh_on_the_skin_keeps_the_roi_patches():
    face = Face(points=np.full((478, 2), -500.0), yaw=0.0, pitch=0.0, roll=0.0)
    polys = {"forehead": np.array([[1, 1], [9, 1], [9, 9]], float)}
    assert (
        _area_outlines(
            face,
            Box(0, 0, 50, 50),
            _zone_labels(face, Box(0, 0, 50, 50), np.ones((50, 50), bool)),
            polys,
        )
        == polys
    )
