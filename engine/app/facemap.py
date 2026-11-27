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
    brow_y = float(v[[105, 334], 1].mean()) - config.FOREHEAD_ZONE_BELOW_BROW_MM
    # the nose runs up its bridge to the forehead's lower edge, between the inner eye corners
    # (133, 362): that strip was split between the cheeks, outside both cheeks' drawn areas
    bridge = [
        (v[i, 0] * config.NOSE_BRIDGE_WIDTH_FRAC, y) for i in (133, 362) for y in (v[i, 1], brow_y)
    ]
    nose = cv2.convexHull(
        np.vstack([v[[i for i in NOSE_ALL if i < len(v)], :2], bridge]).astype(np.float32)
    )
    return {
        "brow_y": brow_y,
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


def _facing_tris(points: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """(T,) whether each mesh triangle faces the camera (wound as in the front view; the side
    turned away folds over the visible side), the (T,) photo areas (px2) and the (T, 3, 2)
    photo corners. None without the model."""
    mesh = canonical()
    if mesh is None:
        return None
    verts, tris = mesh
    img = np.asarray(points, dtype=np.float64)[: len(verts)]
    a, b, c = (img[tris[:, k]] for k in range(3))
    ref = verts[:, :2] * [1, -1]
    ra, rb, rc = (ref[tris[:, k]] for k in range(3))
    area_img = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
    area_ref = (rb[:, 0] - ra[:, 0]) * (rc[:, 1] - ra[:, 1]) - (rb[:, 1] - ra[:, 1]) * (
        rc[:, 0] - ra[:, 0]
    )
    facing = (np.sign(area_img) == np.sign(area_ref)) & (np.abs(area_img) > 1e-6)
    return facing, 0.5 * np.abs(area_img), img[tris]


@lru_cache(maxsize=1)
def triangle_zones() -> np.ndarray | None:
    """(T,) 1-based FACE_ZONES code of each mesh triangle (zone_of its canonical centre)."""
    mesh = canonical()
    if mesh is None:
        return None
    verts, tris = mesh
    centre = verts[tris].mean(axis=1)
    return np.array(
        [ZONES.index(zone_of(float(x), float(y))) + 1 for x, y in centre[:, :2]], np.uint8
    )


@lru_cache(maxsize=1)
def triangle_sides() -> np.ndarray | None:
    """(T,) "right" / "left": the half of the face each triangle's canonical centre is on."""
    mesh = canonical()
    if mesh is None:
        return None
    verts, tris = mesh
    return np.where(verts[tris].mean(axis=1)[:, 0] < 0, "right", "left")


def facing(points: np.ndarray) -> np.ndarray | None:
    """(T,) how squarely the photo sees each mesh triangle, about the cosine of the angle
    between the skin and the camera's view: 1 face-on, 0 edge-on or turned away. It is the
    triangle's photo area over its canonical area, divided by the same ratio of the photo's
    most face-on triangles (their 95th percentile), so it needs no pose angles or scale and
    reads the same at any camera distance. None without the model."""
    got = _facing_tris(points)
    mesh = canonical()
    if got is None or mesh is None:
        return None
    ok, area_img, _ = got
    verts, tris = mesh
    area_ref = 0.5 * np.linalg.norm(
        np.cross(verts[tris[:, 1]] - verts[tris[:, 0]], verts[tris[:, 2]] - verts[tris[:, 0]]),
        axis=1,
    )
    ratio = np.where(ok, area_img / np.maximum(area_ref, 1e-9), 0.0)
    if not ok.any():
        return np.zeros(len(tris))
    top = float(np.percentile(ratio[ok], 95))
    return np.clip(ratio / top, 0.0, 1.0) if top > 0 else np.zeros(len(tris))


def triangle_map(points: np.ndarray, shape: tuple[int, int]) -> np.ndarray | None:
    """Per pixel of a (h, w) image whose landmarks are `points`: the index of the face mesh
    triangle covering it (-1 = off the mesh). Only triangles facing the camera are drawn.
    None without the model."""
    got = _facing_tris(points)
    if got is None:
        return None
    ok, _, corners = got
    out = np.full(shape, -1, np.int16)
    for t in np.flatnonzero(ok):
        cv2.fillConvexPoly(out, np.round(corners[t]).astype(np.int32), int(t))
    return out


def zone_map(points: np.ndarray, shape: tuple[int, int]) -> np.ndarray | None:
    """Per pixel of a (h, w) image whose landmarks are `points`: 1-based index into FACE_ZONES of
    the face mesh triangle covering it (0 = off the mesh), each triangle in the zone of its
    centre on the canonical face (zone_of, as marks are placed). Only triangles facing the
    camera are drawn. None without the model."""
    tri = triangle_map(points, shape)
    codes = triangle_zones()
    if tri is None or codes is None:
        return None
    return np.where(tri >= 0, codes[np.clip(tri, 0, None)], 0).astype(np.uint8)


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
