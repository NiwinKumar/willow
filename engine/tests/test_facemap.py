"""Face map: a mark lands on the same canonical spot and zone whatever the head pose, so
the api can follow it across sessions. Faces are MediaPipe's canonical mesh, turned and
projected geometrically (no photo needed)."""

import math

import numpy as np
import pytest

from app import facemap
from app.landmarks import MODEL
from app.pipeline_face import _place_features

PX_PER_MM = 4.0


@pytest.fixture(scope="module")
def mesh():
    if not MODEL.exists():
        pytest.skip("face model not downloaded")
    return facemap.canonical()


def _rotation(yaw: float, pitch: float) -> np.ndarray:
    y, p = math.radians(yaw), math.radians(pitch)
    ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
    return rx @ ry


def _project(xyz: np.ndarray, rot: np.ndarray) -> np.ndarray:
    p = np.atleast_2d(xyz) @ rot.T
    return np.column_stack([600 + PX_PER_MM * p[:, 0], 600 - PX_PER_MM * p[:, 1]])


def _landmarks(verts: np.ndarray, rot: np.ndarray) -> np.ndarray:
    pts = np.zeros((478, 2))
    pts[: len(verts)] = _project(verts, rot)
    return pts


# a vertex in each zone (MediaPipe mesh numbering): its first triangle's centre is the mark
ZONE_VERTEX = {
    151: "forehead",
    4: "nose",
    50: "right_cheek",
    280: "left_cheek",
    0: "around_mouth",
    199: "chin",
    172: "right_jaw",
    397: "left_jaw",
}


def _marks(mesh):
    verts, tris = mesh
    return {
        v: verts[tris[np.nonzero((tris == v).any(axis=1))[0][0]]].mean(axis=0) for v in ZONE_VERTEX
    }


@pytest.mark.parametrize("yaw,pitch", [(0, 0), (12, 0), (-12, 8), (5, -12)])
def test_a_mark_lands_on_the_same_canonical_spot_at_any_pose(mesh, yaw, pitch):
    rot = _rotation(yaw, pitch)
    points = _landmarks(mesh[0], rot)
    marks = _marks(mesh)
    found = facemap.locate(points, np.vstack([_project(c, rot) for c in marks.values()]))
    for (vertex, centre), place in zip(marks.items(), found, strict=True):
        assert place is not None, vertex
        assert place["face_x_mm"] == pytest.approx(centre[0], abs=0.6), vertex
        assert place["face_y_mm"] == pytest.approx(centre[1], abs=0.6), vertex
        assert place["zone"] == ZONE_VERTEX[vertex], vertex
        # skin sloping away from the camera (jaw, nose sides) covers more mm per pixel;
        # a projection never makes skin look bigger
        assert 0.9 / PX_PER_MM <= place["mm_per_px"] <= 2.5 / PX_PER_MM, vertex


def test_off_the_face_gives_no_position(mesh):
    points = _landmarks(mesh[0], _rotation(0, 0))
    assert facemap.locate(points, [(5.0, 5.0)]) == [None]


def test_the_subjects_right_is_negative_x(mesh):
    verts = mesh[0]
    assert verts[234, 0] < 0 < verts[454, 0]  # 234 is the subject's right cheek edge
    assert facemap.zone_of(-40.0, -5.0) == "right_cheek"
    assert facemap.zone_of(40.0, -5.0) == "left_cheek"


def test_features_are_numbers_with_a_zone_code(mesh):
    place = {"face_x_mm": -41.2, "face_y_mm": -3.0, "zone": "right_cheek", "mm_per_px": 0.25}
    f = _place_features(place, radius_px=6.0)
    assert f == {"face_x_mm": -41.2, "face_y_mm": -3.0, "zone": 3.0, "diameter_mm": 3.0}
    assert _place_features(None, 6.0) == {}
