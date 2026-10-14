"""Where a mark sits on the face, the same way in every session (docs/METRICS.md, "Face
map"): a position on MediaPipe's canonical face (millimetres, front view) and a zone.

Each photo's landmarks are the canonical mesh's vertices seen from some angle, so a mark
inside a mesh triangle keeps its barycentric weights whatever the pose; the same weights
on the canonical triangle give its canonical position. A turned head, a tilted laptop
selfie or a different camera distance all land a mark on the same canonical spot, so the
api can follow one mark across sessions days apart (it does the matching; the engine
stays per session).

Canonical millimetres are the template's own (an average adult face), not this person's:
good for "same place as last time", not for measuring the face."""

import struct
import zipfile
from functools import lru_cache

import cv2
import numpy as np

from app import config
from app.landmarks import MODEL, NOSE_ALL

ZONES = config.FACE_ZONES


def _varint(b: bytes, i: int) -> tuple[int, int]:
    r = s = 0
    while True:
        c = b[i]
        i += 1
        r |= (c & 0x7F) << s
        s += 7
        if c < 0x80:
            return r, i


@lru_cache(maxsize=1)
def canonical() -> tuple[np.ndarray, np.ndarray] | None:
    """(468, 3) canonical vertices in mm (x toward the subject's left, y up, z toward the
    camera) and (898, 3) triangles, read from the face model's geometry metadata; None
    without the model (marks then carry no face position)."""
    if not MODEL.exists():
        return None
    b = zipfile.ZipFile(MODEL).read("geometry_pipeline_metadata_landmarks.binarypb")
    _, i = _varint(b, 0)  # field 1: the canonical Mesh3d
    n, i = _varint(b, i)
    mesh, j, floats, index = b[i : i + n], 0, [], []
    while j < len(mesh):
        key, j = _varint(mesh, j)
        field, wire = key >> 3, key & 7
        if wire == 5:  # vertex_buffer: x, y, z, u, v per vertex (cm)
            if field == 3:
                floats.append(struct.unpack("<f", mesh[j : j + 4])[0])
            j += 4
        elif wire == 0:  # index_buffer, unpacked
            v, j = _varint(mesh, j)
            if field == 4:
                index.append(v)
        else:
            m, j = _varint(mesh, j)
            j += m
    vertices = np.array(floats, dtype=np.float64).reshape(-1, 5)[:, :3] * 10.0
    return vertices, np.array(index, dtype=np.int64).reshape(-1, 3)


@lru_cache(maxsize=1)
def _zone_bounds() -> dict:
    """Zone edges on the canonical face, from its own landmarks (mm)."""
    mesh = canonical()
    assert mesh is not None
    v = mesh[0]
    nose = cv2.convexHull(v[[i for i in NOSE_ALL if i < len(v)], :2].astype(np.float32))
    return {
        "brow_y": float(v[[105, 334], 1].mean()) - config.FOREHEAD_ZONE_BELOW_BROW_MM,
        "nose": nose,
        "mouth_x": float(abs(v[61, 0])) + config.MOUTH_ZONE_MARGIN_MM,
        "subnasal_y": float(v[2, 1]),
        "mouth_y": float(v[[61, 291], 1].mean()),
        "lip_bottom_y": float(v[17, 1]) - config.MOUTH_ZONE_MARGIN_MM,
    }


def zone_of(x_mm: float, y_mm: float) -> str:
    """Zone of a canonical position (x < 0 is the subject's right)."""
    z = _zone_bounds()
    side = "right" if x_mm < 0 else "left"
    if y_mm >= z["brow_y"]:
        return "forehead"
    if cv2.pointPolygonTest(z["nose"], (float(x_mm), float(y_mm)), False) >= 0:
        return "nose"
    if abs(x_mm) <= z["mouth_x"]:
        if y_mm < z["lip_bottom_y"]:
            return "chin"
        if y_mm <= z["subnasal_y"]:
            return "around_mouth"
    elif y_mm < z["mouth_y"]:  # beside and below the mouth, out to the face edge
        return f"{side}_jaw"
    return f"{side}_cheek"


def _barycentric(p: np.ndarray, a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    """(N, T, 3) weights of N points in T triangles (rows a, b, c: (T, 2))."""
    v0, v1 = b - a, c - a
    v2 = p[:, None, :] - a[None]
    d00, d01, d11 = (v0 * v0).sum(-1), (v0 * v1).sum(-1), (v1 * v1).sum(-1)
    d20, d21 = (v2 * v0).sum(-1), (v2 * v1).sum(-1)
    den = d00 * d11 - d01**2
    den = np.where(np.abs(den) < 1e-9, np.nan, den)
    w1 = (d11 * d20 - d01 * d21) / den
    w2 = (d00 * d21 - d01 * d20) / den
    return np.stack([1 - w1 - w2, w1, w2], -1)


def locate(points: np.ndarray, xy: np.ndarray) -> list[dict | None]:
    """For each (x, y) photo-pixel point: {"face_x_mm", "face_y_mm", "zone", "mm_per_px"} on
    the canonical face, or None (off the face mesh by more than FACEMAP_MAX_OUTSIDE_MM,
    or no model). `points` are the photo's (478, 2) landmarks."""
    mesh = canonical()
    xy = np.asarray(xy, dtype=np.float64).reshape(-1, 2)
    if mesh is None or not len(xy):
        return [None] * len(xy)
    verts, tris = mesh
    img = np.asarray(points, dtype=np.float64)[: len(verts)]
    a, b, c = (img[tris[:, k]] for k in range(3))
    # the side of the face turned away folds over the visible side in the photo: keep the
    # triangles wound as in the front view (image y points down, canonical y up)
    ref = verts[:, :2] * [1, -1]
    ra, rb, rc = (ref[tris[:, k]] for k in range(3))

    def cross(p, q, r):
        return (q[:, 0] - p[:, 0]) * (r[:, 1] - p[:, 1]) - (q[:, 1] - p[:, 1]) * (r[:, 0] - p[:, 0])

    area_img, area_ref = cross(a, b, c), cross(ra, rb, rc)
    facing = (np.sign(area_img) == np.sign(area_ref)) & (np.abs(area_img) > 1e-6)
    if not facing.any():
        return [None] * len(xy)
    tri_area = 0.5 * np.linalg.norm(
        np.cross(verts[tris[:, 1]] - verts[tris[:, 0]], verts[tris[:, 2]] - verts[tris[:, 0]]),
        axis=1,
    )
    scale = np.sqrt(tri_area / np.maximum(0.5 * np.abs(area_img), 1e-9))  # canonical mm per px
    # an edge-on triangle (far jaw on a turned head) blows its scale up: cap it
    cap = config.FACEMAP_MAX_SCALE * float(np.median(scale[facing]))
    w = _barycentric(xy, a, b, c)
    worst = np.where(facing[None], np.nanmin(w, axis=-1), -np.inf)  # (N, T)
    worst = np.nan_to_num(worst, nan=-np.inf)
    out: list[dict | None] = []
    for n in range(len(xy)):
        t = int(np.argmax(worst[n]))
        wt = np.clip(w[n, t], 0, None)
        wt = wt / wt.sum()
        # how far outside the triangle, in canonical mm (the triangle's own scale)
        tri = tris[t]
        mm_per_px = float(min(scale[t], cap))
        nearest = wt @ img[tri]
        if np.hypot(*(nearest - xy[n])) * mm_per_px > config.FACEMAP_MAX_OUTSIDE_MM:
            out.append(None)
            continue
        x, y = (wt @ verts[tri])[:2]
        if not (np.isfinite(x) and np.isfinite(y)):  # every facing triangle degenerate
            out.append(None)
            continue
        out.append(
            {
                "face_x_mm": round(float(x), 1),
                "face_y_mm": round(float(y), 1),
                "zone": zone_of(float(x), float(y)),
                "mm_per_px": mm_per_px,
            }
        )
    return out
