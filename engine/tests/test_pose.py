"""Head-pitch gate: a tilted face (laptop selfie, camera above the screen) still puts every
ROI on the same skin. Uses MediaPipe's canonical face mesh from the model file, tilted
geometrically, so no photo is needed."""

import math
import struct
import zipfile

import numpy as np
import pytest

from app import config
from app.landmarks import MODEL, Face, polygon_mask
from app.pipeline_face import _pose_ok

SHAPE = (1000, 1000)


def _varint(b, i):
    r = s = 0
    while True:
        c = b[i]
        i += 1
        r |= (c & 0x7F) << s
        s += 7
        if c < 0x80:
            return r, i


def _canonical_mesh() -> np.ndarray:
    """(468, 3) canonical face mesh vertices (cm; x right, y up, z toward the camera)."""
    b = zipfile.ZipFile(MODEL).read("geometry_pipeline_metadata_landmarks.binarypb")
    _, i = _varint(b, 0)
    n, i = _varint(b, i)
    mesh, j, floats = b[i : i + n], 0, []
    while j < len(mesh):
        key, j = _varint(mesh, j)
        field, wire = key >> 3, key & 7
        if wire == 5:
            if field == 3:  # vertex_buffer: x, y, z, u, v per vertex
                floats.append(struct.unpack("<f", mesh[j : j + 4])[0])
            j += 4
        elif wire == 0:
            _, j = _varint(mesh, j)
        else:
            m, j = _varint(mesh, j)
            j += m
    return np.array(floats).reshape(-1, 5)[:, :3]


@pytest.fixture(scope="module")
def mesh():
    if not MODEL.exists():
        pytest.skip("face model not downloaded")
    return _canonical_mesh()


def _tilted_face(mesh, pitch_deg):
    a = math.radians(pitch_deg)
    rot = np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
    p = mesh @ rot.T
    pts = np.zeros((478, 2))
    pts[:468] = np.column_stack([500 + 40 * p[:, 0], 500 - 40 * p[:, 1]])
    return Face(points=pts, yaw=0.0, pitch=float(pitch_deg), roll=0.0)


def _on_skin(face):
    skin = face.skin_mask(SHAPE)
    return {n: skin[polygon_mask(SHAPE, q)].mean() for n, q in face.roi_polygons().items()}


@pytest.mark.parametrize("pitch", [-config.MAX_ABS_PITCH, config.MAX_ABS_PITCH])
def test_rois_stay_on_the_same_skin_at_the_pitch_limit(mesh, pitch):
    level, tilted = _on_skin(_tilted_face(mesh, 0)), _on_skin(_tilted_face(mesh, pitch))
    for name in level:
        assert tilted[name] >= level[name] - 0.05, name
    area = {
        p: polygon_mask(SHAPE, _tilted_face(mesh, p).roi_polygons()["forehead"]).sum()
        for p in (0, pitch)
    }
    assert abs(area[pitch] / area[0] - 1) < 0.15  # forehead band keeps its size


def test_pose_gate_accepts_laptop_pitch_and_rejects_beyond_the_limit(mesh):
    assert _pose_ok(_tilted_face(mesh, 11.3))  # a laptop selfie Niwin's session rejected
    assert not _pose_ok(_tilted_face(mesh, config.MAX_ABS_PITCH + 1))
