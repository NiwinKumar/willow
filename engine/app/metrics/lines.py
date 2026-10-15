"""lines (docs/METRICS.md C1): visible lines and folds in four zones of a face photo, each
with the direction its lines run: forehead (across the face), glabella (frown lines, up
the face), crow's feet (fanning out from the outer eye corner) and nasolabial folds (nose
wing to mouth corner).

A line is a dark valley in L*: a Hessian ridge (larger curvature positive, much larger than
the other) on L* divided by the skin's local mean, so the depth is a share of the skin's
own lightness (the same crease reads the same on light and deep skin, and broad shading
cancels). Kept only where the valley runs in the zone's direction (skin texture, pores and
hair run every way), away from blemishes and dark spots, and in connected pieces at least
LINES_MIN_LENGTH_MM long. Value = line length per skin area (mm per cm2), the mean over the
zones measured; a zone is skipped when the expression that creases it is on (raised brows,
squint, smile). Indicative: compare a person's own sessions taken in the same light."""

import dataclasses

import cv2
import numpy as np
from scipy import ndimage
from skimage.morphology import skeletonize

from app import config
from app.landmarks import Face, polygon_mask

ZONES = ("forehead", "glabella", "crows_feet", "nasolabial")
# zone -> (MediaPipe expression scores that crease it, config limit). Not used, they read high
# on neutral faces: browOuterUp 0.45-0.97 (Oct 14), eyeSquint 0.57-0.67 (Oct 15, 3 of 12)
GATES = {
    "forehead": (("browInnerUp",), "LINES_MAX_BROW_RAISE"),
    # deep frown lines themselves read as brows down (0.61-0.64 on a neutral lined face)
    "glabella": (("browDownLeft", "browDownRight"), "LINES_MAX_FROWN"),
    "crows_feet": (("mouthSmileLeft", "mouthSmileRight"), "LINES_MAX_EXPRESSION"),
    "nasolabial": (("mouthSmileLeft", "mouthSmileRight"), "LINES_MAX_EXPRESSION"),
}
GLABELLA_BROWS = (107, 336, 285, 55)  # inner brow ends: upper R, upper L, lower L, lower R


def _unit(v: np.ndarray) -> np.ndarray:
    return v / max(float(np.linalg.norm(v)), 1e-9)


def zone_geometry(face: Face) -> dict[str, list[tuple]]:
    """zone -> [(polygon, direction, above)]: direction ("axis", unit vector) or ("radial",
    point); above None or (point, up vector), keeping only the up side of that line.
    Front views: every zone, both sides. Side views: the forehead and the visible side's
    crow's feet and fold."""
    p, mm = face.points, face.px_per_mm
    across = _unit(p[263] - p[33])  # right eye -> left eye
    up = _unit(p[10] - p[152])
    out: dict[str, list] = {z: [] for z in ZONES}
    # forehead: the face outline (lifted into the hair, which is cut from the skin by
    # colour) above a line LINES_BROW_GAP_MM over the brow tops
    brow_line = p[[105, 334]].mean(axis=0) + up * config.LINES_BROW_GAP_MM * mm
    outline = dataclasses.replace(face, yaw=0.0).outline()
    out["forehead"].append((outline, ("axis", across), (brow_line, up)))
    sides = {"front": ("right", "left"), "right": ("right",), "left": ("left",)}[face.view]
    if face.view == "front":  # between the inner brow ends and up onto the forehead (lower
        # down, the nose bridge's sides are vertical shadow edges)
        ur, ul, ll, lr = (p[i] for i in GLABELLA_BROWS)
        rise = up * config.LINES_GLABELLA_RISE_MM * mm
        glabella = np.array([ur + rise, ul + rise, ll, lr])
        centre = glabella.mean(axis=0)  # narrowed: the inner brow heads' hairs run upward
        glabella[:, 0] = centre[0] + (glabella[:, 0] - centre[0]) * config.LINES_GLABELLA_WIDTH
        out["glabella"].append((glabella, ("axis", up), None))
    for side in sides:
        inner, outer, wing, mouth = (133, 33, 98, 61) if side == "right" else (362, 263, 327, 291)
        axis = _unit(p[outer] - p[inner])
        normal = np.array([-axis[1], axis[0]])
        start = p[outer] + axis * config.LINES_CROW_GAP_MM * mm
        end = start + axis * config.LINES_CROW_LENGTH_MM * mm
        half = normal * config.LINES_CROW_HALF_HEIGHT_MM * mm
        crow = np.array([start - half, end - half, end + half, start + half])
        out["crows_feet"].append((crow, ("radial", p[outer]), None))
        a = p[wing]
        along = _unit(p[mouth] - a)
        b = p[mouth] + along * config.LINES_FOLD_PAST_MOUTH_MM * mm
        away = np.array([-along[1], along[0]])
        if (a - p[2]) @ away < 0:  # point away from the face midline
            away = -away
        near, far = (d * mm for d in config.LINES_FOLD_BAND_MM)
        fold = np.array([a + away * near, a + away * far, b + away * far, b + away * near])
        out["nasolabial"].append((fold, ("axis", along), None))
    return out


def _valleys(rel: np.ndarray, px: float) -> tuple[np.ndarray, np.ndarray]:
    """Per pixel: (depth, line direction in radians) of the strongest dark valley over
    LINES_SIGMAS_MM. Depth is the scale-normalised larger Hessian eigenvalue of `rel`
    (0 where the valley is not clearly elongated: a pore or bump curves both ways)."""
    depth = np.zeros(rel.shape, np.float32)
    theta = np.zeros(rel.shape, np.float32)
    for s_mm in config.LINES_SIGMAS_MM:
        s = s_mm * px
        lxx = ndimage.gaussian_filter(rel, s, order=(0, 2))
        lyy = ndimage.gaussian_filter(rel, s, order=(2, 0))
        lxy = ndimage.gaussian_filter(rel, s, order=(1, 1))
        root = np.sqrt((lxx - lyy) ** 2 + 4 * lxy**2)
        big, small = (lxx + lyy + root) / 2, (lxx + lyy - root) / 2
        d = s * s * big
        d[(big <= 0) | (big < config.LINES_MIN_ANISOTROPY * np.abs(small))] = 0
        across = 0.5 * np.arctan2(2 * lxy, lxx - lyy)  # direction of the larger curvature
        better = d > depth
        depth[better] = d[better]
        theta[better] = (across + np.pi / 2)[better]
    return depth, theta


def _direction_ok(theta: np.ndarray, direction: tuple, shape: tuple[int, int]) -> np.ndarray:
    kind, v = direction
    if kind == "axis":
        want = np.full(shape, np.arctan2(v[1], v[0]))
    else:  # radial from a point
        yy, xx = np.mgrid[: shape[0], : shape[1]].astype(np.float32)
        want = np.arctan2(yy - v[1], xx - v[0])
    diff = np.abs((theta - want + np.pi / 2) % np.pi - np.pi / 2)
    return diff <= np.radians(config.LINES_ANGLE_TOL_DEG)


def find_lines(
    lab: np.ndarray, face: Face, skin: np.ndarray, px_per_mm: float, marks: list
) -> tuple[dict[str, np.ndarray], dict[str, float | None], list[str]]:
    """Line pixels per zone, at the input's scale. `face` landmarks are in `lab`'s pixels,
    `marks` (blemishes, dark spots: x, y, radius) too. -> (zone -> line mask, zone -> mm of
    line per cm2 of zone skin or None if too small, zones skipped for expression)."""
    h, w = skin.shape
    scale = min(config.LINES_WORK_PX_PER_MM / px_per_mm, 1.0)
    size = (max(round(w * scale), 1), max(round(h * scale), 1))
    L = cv2.resize(lab[..., 0].astype(np.float32), size, interpolation=cv2.INTER_AREA)
    chroma = cv2.resize(
        np.hypot(lab[..., 1], lab[..., 2]).astype(np.float32), size, interpolation=cv2.INTER_AREA
    )
    sk = cv2.resize(skin.astype(np.uint8), size, interpolation=cv2.INTER_NEAREST) > 0
    px = px_per_mm * scale
    # L* over the skin's local mean: a crease's depth as a share of the skin's lightness
    sigma = config.LINES_BACKGROUND_MM * px
    weight = cv2.GaussianBlur(sk.astype(np.float32), (0, 0), sigma)
    local = cv2.GaussianBlur(np.where(sk, L, 0).astype(np.float32), (0, 0), sigma)
    local = local / np.maximum(weight, 1e-6)
    rel = np.where(sk, L / np.maximum(local, 1.0), 1.0).astype(np.float32)
    depth, theta = _valleys(rel, px)
    marks_mask = np.zeros(sk.shape, np.uint8)
    for m in marks:
        r = round(m.radius * scale + config.LINES_MARK_GAP_MM * px)
        cv2.circle(marks_mask, (round(m.x * scale), round(m.y * scale)), max(r, 1), 1, -1)
    edge = max(round(config.LINES_EDGE_MM * px), 1)
    inner = ndimage.binary_erosion(sk, iterations=edge)  # hair / feature edges are dark too
    cand = (depth >= config.LINES_MIN_DEPTH) & inner & ~marks_mask.astype(bool)

    small_face = dataclasses.replace(face, points=face.points * scale)
    brows = small_face.brow_guard(sk.shape)  # brow hairs (inner brow heads run upward)
    hairline = small_face.border_band(sk)  # baby hairs just inside the hairline
    yy, xx = np.mgrid[: sk.shape[0], : sk.shape[1]].astype(np.float32)
    masks, density, skipped = {}, {}, []
    for zone, parts in zone_geometry(small_face).items():
        scores, limit = GATES[zone]
        if max((face.expression.get(e, 0.0) for e in scores), default=0.0) > getattr(config, limit):
            skipped.append(zone)
            continue
        zone_line = np.zeros(sk.shape, bool)
        lengths, area = [], 0
        for poly, direction, above in parts:
            region = polygon_mask(sk.shape, poly) & sk
            if above is not None:
                (bx, by), (ux, uy) = above
                region &= (xx - bx) * ux + (yy - by) * uy > 0
            if zone in ("glabella", "forehead"):
                region &= ~brows & ~hairline
                # grey / white hair over the forehead (the skin cut takes dark hair only):
                # far greyer than this skin; a crease is a shadow and keeps the skin's colour
                if region.any():
                    grey = chroma < config.LINES_GREY_HAIR_CHROMA * float(np.median(chroma[region]))
                    grey = cv2.dilate(grey.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
                    region &= ~grey
            if region.sum() < config.LINES_MIN_ZONE_MM2 * px * px:
                continue
            line = cand & region & _direction_ok(theta, direction, sk.shape)
            labels, n = ndimage.label(line, structure=np.ones((3, 3)))
            # each piece's length = its skeleton's pixels
            on_skel = labels[skeletonize(line)]
            per_piece = np.bincount(on_skel, minlength=n + 1)[1:] * config.LINES_SKELETON_PX / px
            area_mm2 = np.bincount(labels.ravel(), minlength=n + 1)[1:] / px**2
            width = area_mm2 / np.maximum(per_piece, 1e-6)  # a blob (lash, lid shadow) is wide
            ok = (per_piece >= config.LINES_MIN_LENGTH_MM) & (width <= config.LINES_MAX_WIDTH_MM)
            long = np.flatnonzero(ok) + 1
            keep = np.isin(labels, long)
            lengths += per_piece[long - 1].tolist()
            zone_line |= keep
            area += int(region.sum())
        if area:
            density[zone] = sum(lengths) / (area / px**2 / 100.0)
            masks[zone] = cv2.resize(
                zone_line.astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST
            ).astype(bool)
        else:
            density[zone] = None
    return masks, density, skipped


def lines(
    lab: np.ndarray, face: Face, skin: np.ndarray, px_per_mm: float, marks: list
) -> tuple[float | None, dict]:
    """Value = mean line density (mm per cm2) over the zones measured; extras per zone."""
    if px_per_mm < config.LINES_MIN_PX_PER_MM:
        return None, {}
    _, density, skipped = find_lines(lab, face, skin, px_per_mm, marks)
    measured = [v for v in density.values() if v is not None]
    extras = {
        f"{z}_mm_per_cm2": (round(v, 2) if v is not None else None) for z, v in density.items()
    }
    extras["skipped_for_expression"] = sorted(skipped)
    return (float(np.mean(measured)) if measured else None), extras
