"""MediaPipe Face Landmarker: 478 points, head pose, and face ROI polygons.

Index sets name the subject's own left/right (subject's right cheek appears on the image
left). Each ROI is the convex hull of a few mesh points, shrunk toward its centre so it
stays on skin when the landmarks are a few pixels off.
"""

import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np
from scipy.ndimage import binary_fill_holes

from app import config

MODEL = Path(__file__).resolve().parents[1] / "models" / "face_landmarker.task"

# Mirrored pairs on the canonical mesh (e.g. 50 <-> 280 are the two cheekbones).
ROI_POINTS = {
    "right_cheek": [50, 101, 118, 117, 123, 187, 205, 36],
    "left_cheek": [280, 330, 347, 346, 352, 411, 425, 266],
    "nose": [197, 195, 5, 4, 45, 275, 51, 281],
    "chin": [18, 200, 199, 175, 208, 428, 32, 262],
    "right_under_eye": [110, 24, 23, 22, 26, 120, 119, 118, 117, 111],
    "left_under_eye": [339, 254, 253, 252, 256, 349, 348, 347, 346, 340],
}
CHEEKS = ("right_cheek", "left_cheek")
# Forehead is a band between the hairline row and the brow row of the mesh, touching
# neither: hair and eyebrow strands were being read as dark spots.
FOREHEAD_HAIRLINE = [109, 10, 338]
FOREHEAD_BROWS = [105, 9, 334]  # upper edge of the right brow, glabella, left brow
EYE_OUTER = (33, 263)  # outer eye corners, for face scale (inter-ocular distance)

# Whole-face skin for spots/blemishes: face outline minus features (docs/METRICS.md step 5
# "exclusion masks"). Margins in mm keep lashes, brow hairs and lip edges out.
FACE_OVAL = [
    10,
    338,
    297,
    332,
    284,
    251,
    389,
    356,
    454,
    323,
    361,
    288,
    397,
    365,
    379,
    378,
    400,
    377,
    152,
    148,
    176,
    149,
    150,
    136,
    172,
    58,
    132,
    93,
    234,
    127,
    162,
    21,
    54,
    103,
    67,
    109,
]
# Feature outlines as ORDERED contours (not convex hulls), so cut-outs follow the shape.
RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
LEFT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466]
RIGHT_BROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46]  # upper edge, then lower edge back
LEFT_BROW = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]
# Upper eyelid: eye's upper contour (outer -> inner corner) then the brow's lower edge back
# (inner -> outer). Lid creases and the lid rim are naturally redder than skin.
RIGHT_LID = [33, 246, 161, 160, 159, 158, 157, 173, 133, 55, 65, 52, 53, 46]
LEFT_LID = [263, 466, 388, 387, 386, 385, 384, 398, 362, 285, 295, 282, 283, 276]
LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146]
NOSE_BASE = [64, 98, 97, 2, 326, 327, 294, 129, 358, 240, 460]  # area where nostrils can be


class FaceNotFound(ValueError):
    """MediaPipe found no face in the photo."""


@dataclass
class Face:
    points: np.ndarray  # (478, 2) pixel coords in the photo
    yaw: float
    pitch: float
    roll: float

    @property
    def eye_distance_px(self) -> float:
        a, b = (self.points[i] for i in EYE_OUTER)
        return float(np.hypot(*(a - b)))

    def roi_polygons(self) -> dict[str, np.ndarray]:
        hair = self.points[FOREHEAD_HAIRLINE]
        brow = self.points[FOREHEAD_BROWS]
        top = hair + (brow - hair) * config.FOREHEAD_BAND[0]
        bottom = hair + (brow - hair) * config.FOREHEAD_BAND[1]
        band = np.vstack([top, bottom[::-1]])
        centre = band.mean(axis=0)  # keep the middle of the width, away from side hair
        band[:, 0] = centre[0] + (band[:, 0] - centre[0]) * config.FOREHEAD_WIDTH
        out = {"forehead": band}
        for name, idx in ROI_POINTS.items():
            pts = self.points[idx].astype(np.float32)
            hull = cv2.convexHull(pts).reshape(-1, 2)
            centre = hull.mean(axis=0)
            out[name] = centre + (hull - centre) * config.FACE_ROI_SHRINK
        return out

    @property
    def px_per_mm(self) -> float:
        return self.eye_distance_px / config.EYE_DISTANCE_MM

    def _disk(self, mm: float) -> np.ndarray:
        r = max(round(mm * self.px_per_mm), 1)
        return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))

    def _shape(self, shape, idx, margin_mm: float = 0.0) -> np.ndarray:
        """Mask of an ordered landmark contour, grown by margin_mm."""
        m = polygon_mask(shape, self.points[idx]).astype(np.uint8)
        return (cv2.dilate(m, self._disk(margin_mm)) if margin_mm > 0 else m).astype(bool)

    def outline(self) -> np.ndarray:
        """Face outline, with the top pushed up past the hairline (the mesh stops short of
        it); hair taken in this way is trimmed by colour in refine_skin."""
        oval = self.points[FACE_OVAL].copy()
        centre = oval.mean(axis=0)
        oval = centre + (oval - centre) * config.FACE_OVAL_SHRINK
        up = self.points[10] - self.points[152]
        up /= np.linalg.norm(up)
        lift = config.FOREHEAD_LIFT * float(np.linalg.norm(self.points[10] - self.points[9]))
        rel = (oval - self.points[168]) @ up  # 168: between the eyes
        weight = np.clip(rel / np.linalg.norm(self.points[10] - self.points[168]), 0, 1)
        oval[rel > 0] += np.outer(weight[rel > 0], up) * lift
        return oval

    def skin_mask(self, shape: tuple[int, int]) -> np.ndarray:
        """Face outline minus eyes (lash/lid-rim margin), upper eyelids and lips, following
        their real contours. Brows, nostrils and hair are cut by colour in refine_skin."""
        mask = polygon_mask(shape, self.outline())
        for eye in (RIGHT_EYE, LEFT_EYE):
            mask &= ~self._shape(shape, eye, config.EYE_MARGIN_MM)
        for lid in (RIGHT_LID, LEFT_LID):
            mask &= ~self._shape(shape, lid, config.FEATURE_EDGE_MM)
        mask &= ~self._shape(shape, LIPS, config.LIP_MARGIN_MM)
        return mask

    def feature_zones(self, shape: tuple[int, int]) -> dict[str, np.ndarray]:
        """Where brows and nostrils can be; refine_skin removes only their dark pixels."""
        brow_core = self._shape(shape, RIGHT_BROW) | self._shape(shape, LEFT_BROW)
        brow_zone = cv2.dilate(brow_core.astype(np.uint8), self._disk(config.BROW_ZONE_MM))
        nose = cv2.convexHull(self.points[NOSE_BASE].astype(np.float32)).reshape(-1, 2)
        nose_zone = cv2.dilate(polygon_mask(shape, nose).astype(np.uint8), self._disk(1.0))
        return {
            "brow_core": brow_core,
            "brow_zone": brow_zone.astype(bool),
            "nostril_zone": nose_zone.astype(bool),
        }


def _euler_degrees(matrix: np.ndarray) -> tuple[float, float, float]:
    """Head rotation (yaw, pitch, roll) from MediaPipe's 4x4 face transform."""
    r = np.asarray(matrix)[:3, :3]
    pitch = math.degrees(math.atan2(r[2, 1], r[2, 2]))
    yaw = math.degrees(math.atan2(-r[2, 0], math.hypot(r[2, 1], r[2, 2])))
    roll = math.degrees(math.atan2(r[1, 0], r[0, 0]))
    return yaw, pitch, roll


@lru_cache(maxsize=1)
def _landmarker():
    import mediapipe as mp  # heavy import, only when a face photo is analysed

    if not MODEL.exists():
        raise FileNotFoundError(f"{MODEL} missing: download face_landmarker.task (see README)")
    options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(MODEL)),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_faces=1,
        output_facial_transformation_matrixes=True,
    )
    return mp.tasks.vision.FaceLandmarker.create_from_options(options)


def detect_face(srgb8: np.ndarray) -> Face:
    """Run the landmarker on an upright 8-bit sRGB photo (downscaled for speed)."""
    import mediapipe as mp

    h, w = srgb8.shape[:2]
    scale = min(1.0, config.LANDMARK_MAX_SIDE / max(h, w))
    small = cv2.resize(srgb8, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(small))
    result = _landmarker().detect(image)
    if not result.face_landmarks:
        raise FaceNotFound("no face found")
    lm = result.face_landmarks[0]
    points = np.array([[p.x * w, p.y * h] for p in lm], dtype=np.float64)  # back to full res
    yaw, pitch, roll = _euler_degrees(result.facial_transformation_matrixes[0])
    return Face(points=points, yaw=yaw, pitch=pitch, roll=roll)


def polygon_mask(shape: tuple[int, int], polygon: np.ndarray) -> np.ndarray:
    """Boolean mask of a polygon (pixel coords) for an image of the given (h, w)."""
    mask = np.zeros(shape, np.uint8)
    cv2.fillPoly(mask, [np.round(polygon).astype(np.int32)], 1)
    return mask.astype(bool)


def _local_mean(values: np.ndarray, mask: np.ndarray, sigma: float) -> np.ndarray:
    """Average of `values` over `mask` pixels nearby (Gaussian, sigma in px)."""
    weight = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), sigma)
    total = cv2.GaussianBlur(np.where(mask, values, 0).astype(np.float32), (0, 0), sigma)
    return total / np.maximum(weight, 1e-6)


def refine_skin(
    l_star: np.ndarray, mask: np.ndarray, zones: dict[str, np.ndarray], px_per_mm: float
) -> np.ndarray:
    """Cut brows, nostrils and hair by their actual dark pixels, then smooth the edges.

    All darkness tests are relative to this person's own skin nearby, so they hold at every
    skin tone and are not fooled by gradual shading.
    """

    def disk(mm: float) -> np.ndarray:
        r = max(round(mm * px_per_mm), 1)
        return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))

    local = _local_mean(l_star, mask, config.HAIR_BACKGROUND_MM * px_per_mm)
    darker = local - l_star  # >0 where darker than the skin around it

    # brows: the brow outline itself, plus brow hairs (dark) in the band around it
    brow = zones["brow_core"] | (zones["brow_zone"] & (darker > config.BROW_DELTA_L))
    # nostrils: only the dark openings inside the nose-base area; the tip stays skin
    nostril = zones["nostril_zone"] & (darker > config.NOSTRIL_DELTA_L)
    nostril = cv2.morphologyEx(nostril.astype(np.uint8), cv2.MORPH_CLOSE, disk(1.0))
    cut = cv2.dilate((brow | nostril.astype(bool)).astype(np.uint8), disk(config.FEATURE_EDGE_MM))
    skin = remove_hair(l_star, mask & ~cut.astype(bool), px_per_mm)

    # smooth: fill pin-holes, shave ragged spurs, keep the one face region
    smooth = cv2.morphologyEx(skin.astype(np.uint8), cv2.MORPH_CLOSE, disk(0.7))
    smooth = cv2.morphologyEx(smooth, cv2.MORPH_OPEN, disk(1.0))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(smooth, connectivity=8)
    if n > 1:
        smooth = (labels == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
    return smooth.astype(bool) & mask & ~cut.astype(bool)


def remove_hair(l_star: np.ndarray, mask: np.ndarray, px_per_mm: float) -> np.ndarray:
    """Drop hair from a face skin mask without dropping dark spots or shaded skin.

    Hair is much darker than this person's own skin *nearby* (so gradual shading on the
    lower face is not hair) AND either touches the outer edge of the face (hairline, face
    border) or is a long thin strand (> HAIR_MIN_LENGTH_MM). Dark skin patches inside the
    face (under-eye, marks) stay.
    """
    sigma = config.HAIR_BACKGROUND_MM * px_per_mm
    weight = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), sigma)
    local = cv2.GaussianBlur(np.where(mask, l_star, 0).astype(np.float32), (0, 0), sigma)
    local /= np.maximum(weight, 1e-6)
    # darker than nearby skin (fine strands), or far darker than this person's typical skin
    # (a large patch of hair is its own "nearby", so the first test alone misses it)
    very_dark = l_star < np.median(l_star[mask]) - config.HAIR_DELTA_L_GLOBAL
    dark = mask & ((l_star < local - config.HAIR_DELTA_L) | very_dark)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(dark.astype(np.uint8), connectivity=8)
    # only the OUTER edge (hairline, face border) counts: holes cut for eyes/lips/brows have
    # darker skin next to them (under-eye, lip corners) that is not hair
    outer = binary_fill_holes(mask)
    edge = mask & ~cv2.erode(outer.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    on_edge = set(np.unique(labels[edge & dark]).tolist())
    min_strand = config.HAIR_MIN_LENGTH_MM * px_per_mm
    hair_ids = []
    for k in range(1, n):
        w, h = stats[k, cv2.CC_STAT_WIDTH], stats[k, cv2.CC_STAT_HEIGHT]
        long_side, short_side = max(w, h), max(min(w, h), 1)
        thin = short_side <= config.HAIR_MAX_WIDTH_MM * px_per_mm  # strands are hair-thin
        strand = long_side > min_strand and long_side > 3 * short_side and thin
        if k in on_edge or strand:
            hair_ids.append(k)
    hair = np.isin(labels, hair_ids).astype(np.uint8)
    r = max(round(config.HAIR_MARGIN_MM * px_per_mm), 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return mask & ~cv2.dilate(hair, kernel).astype(bool)
