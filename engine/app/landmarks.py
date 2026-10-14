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
# Where the face's own shape casts shadows: nose sidewalls (bridge to wings) and the
# groove under the nose. Under-eye hollows use the under-eye ROIs. Dark spots skip these.
NOSE_SIDES = [
    193,
    417,
    122,
    351,
    196,
    419,
    3,
    248,
    236,
    456,
    198,
    420,
    131,
    360,
    49,
    279,
    48,
    278,
    219,
    439,
    64,
    294,
]
SUBNASAL = [2, 164, 0, 37, 267, 97, 326, 167, 393]
EYE_CORNERS = (133, 362, 33, 263)  # inner (right, left), outer (right, left)
MOUTH_CORNERS = (61, 291)  # shadowed creases at the lip corners
GLABELLA = [107, 55, 168, 285, 336, 9]  # between the inner brow ends, down to the bridge
NOSE_BASE = [64, 98, 97, 2, 326, 327, 294, 129, 358, 240, 460]  # area where nostrils can be


# Face midline from chin to forehead (side views cut the face here; 152 and 10 are the
# outline's own end points)
MIDLINE = [175, 199, 200, 18, 17, 0, 164, 2, 1, 4, 5, 195, 197, 6, 168, 8, 9, 151]
NOSE_ALL = NOSE_SIDES + NOSE_BASE + [1, 4, 5, 195, 197, 6]
OVAL_RIGHT_HALF = slice(18, 36)  # FACE_OVAL from 152 round the subject's right to 109
OVAL_LEFT_HALF = slice(0, 19)  # FACE_OVAL from 10 round the subject's left to 152


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
        if self.view != "front":  # only the cheek and under-eye facing the camera
            out = {n: p for n, p in out.items() if n.startswith(self.view + "_")}
        return out

    @property
    def px_per_mm(self) -> float:
        if self.view == "front":
            return self.eye_distance_px / config.EYE_DISTANCE_MM
        # a turned head shortens the eye distance but not the nose-bridge-to-chin height
        height = float(np.hypot(*(self.points[168] - self.points[152])))
        if height <= 0:  # no usable height: fall back to the eye scale
            return self.eye_distance_px / config.EYE_DISTANCE_MM
        return height / config.FACE_HEIGHT_MM

    @property
    def view(self) -> str:
        """'front', or the subject's side that faces the camera: 'right' / 'left'."""
        if abs(self.yaw) <= config.MAX_ABS_YAW:
            return "front"
        right = np.hypot(*(self.points[1] - self.points[234]))  # nose tip to right cheek edge
        left = np.hypot(*(self.points[1] - self.points[454]))
        return "right" if right > left else "left"

    def ear_side(self, shape: tuple[int, int], origin: tuple[int, int] = (0, 0)) -> np.ndarray:
        """Side views: the part of the image beyond the visible cheek's centre, away from
        the nose (toward the ear, sideburn and temple). Front views: all False."""
        if self.view == "front":
            return np.zeros(shape, bool)
        nose = self.points[1] - np.asarray(origin, float)
        cheek = self.points[ROI_POINTS[self.view + "_cheek"]].mean(axis=0) - np.asarray(
            origin, float
        )
        d = (cheek - nose) / np.linalg.norm(cheek - nose)
        yy, xx = np.mgrid[: shape[0], : shape[1]].astype(np.float32)
        return (xx - cheek[0]) * d[0] + (yy - cheek[1]) * d[1] > 0

    @property
    def cheeks(self) -> tuple[str, ...]:
        """Cheek ROIs that face the camera."""
        return {"front": CHEEKS, "right": ("right_cheek",), "left": ("left_cheek",)}[self.view]

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
        if self.view == "front":
            return oval
        # side view: the half facing the camera, closed along the midline
        half = oval[OVAL_RIGHT_HALF if self.view == "right" else OVAL_LEFT_HALF]
        mid = self.points[MIDLINE]
        if self.view == "right":  # half runs chin -> forehead, so return forehead -> chin
            mid = mid[::-1]
        return np.vstack([half, mid])

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

    def shadow_guard(self, shape: tuple[int, int]) -> np.ndarray:
        """Areas where the face's shape casts shadows (nose sides, under the nose,
        under-eye hollows), grown by SHADOW_GUARD_MM. Dark-spot search skips them."""
        guard = np.zeros(shape, bool)
        for idx in (NOSE_SIDES, SUBNASAL):
            hull = cv2.convexHull(self.points[idx].astype(np.float32)).reshape(-1, 2)
            guard |= polygon_mask(shape, hull)
        polys = self.roi_polygons()
        for name in ("right_under_eye", "left_under_eye"):
            if name in polys:
                guard |= polygon_mask(shape, polys[name])
        if self.view != "front":  # a turned nose: shine on the ridge, shadow on the far side
            hull = cv2.convexHull(self.points[NOSE_ALL].astype(np.float32)).reshape(-1, 2)
            guard |= polygon_mask(shape, hull)
        grown = cv2.dilate(guard.astype(np.uint8), self._disk(config.SHADOW_GUARD_MM))
        return grown.astype(bool)

    def nose_mask(self, shape: tuple[int, int]) -> np.ndarray:
        """The whole nose (bridge, sides, tip, wings), grown by SHADOW_GUARD_MM."""
        hull = cv2.convexHull(self.points[NOSE_ALL].astype(np.float32)).reshape(-1, 2)
        grown = cv2.dilate(
            polygon_mask(shape, hull).astype(np.uint8), self._disk(config.SHADOW_GUARD_MM)
        )
        return grown.astype(bool)

    def eye_corner_guard(self, shape: tuple[int, int]) -> np.ndarray:
        """A CANTHUS_GUARD_MM circle at each eye corner (deep shadow, lid redness)."""
        corners = np.zeros(shape, np.uint8)
        r = max(round(config.CANTHUS_GUARD_MM * self.px_per_mm), 1)
        for i in EYE_CORNERS:
            cv2.circle(corners, tuple(int(v) for v in self.points[i]), r, 1, -1)
        return corners.astype(bool)

    def lip_band(self, shape: tuple[int, int], mm: float) -> np.ndarray:
        """The lips grown by `mm` (the lip edge is naturally redder and darker)."""
        return self._shape(shape, LIPS, mm)

    def edge_guard(self, shape: tuple[int, int]) -> np.ndarray:
        """Where shading sits right next to a feature, for dark spots: brows (BROW_GUARD_MM),
        the glabella, the eye corners, the mouth corners, a SPOT_LIP_GUARD_MM band around
        the lips (the crease above the chin) and under the nostrils. Only these spots are
        guarded; elsewhere the round test rejects shadow edges (see also border_band)."""
        guard = self.brow_guard(shape) | self.eye_corner_guard(shape)
        hull = cv2.convexHull(self.points[GLABELLA].astype(np.float32)).reshape(-1, 2)
        guard |= polygon_mask(shape, hull)
        guard |= self.lip_band(shape, config.SPOT_LIP_GUARD_MM)
        nose = cv2.convexHull(self.points[NOSE_BASE].astype(np.float32)).reshape(-1, 2)
        guard |= cv2.dilate(
            polygon_mask(shape, nose).astype(np.uint8), self._disk(config.SPOT_NOSTRIL_GUARD_MM)
        ).astype(bool)
        corners = np.zeros(shape, np.uint8)
        r = max(round(config.CANTHUS_GUARD_MM * self.px_per_mm), 1)
        for i in MOUTH_CORNERS:
            cv2.circle(corners, tuple(int(v) for v in self.points[i]), r, 1, -1)
        return guard | corners.astype(bool)

    def brow_guard(self, shape: tuple[int, int]) -> np.ndarray:
        """The brows grown by BROW_GUARD_MM (stray brow hairs; brow edges look red too)."""
        guard = self._shape(shape, RIGHT_BROW, config.BROW_GUARD_MM)
        return guard | self._shape(shape, LEFT_BROW, config.BROW_GUARD_MM)

    def border_band(
        self,
        skin: np.ndarray,
        origin: tuple[int, int] = (0, 0),
        hairline_mm: float | None = None,
        features: np.ndarray | None = None,
    ) -> np.ndarray:
        """Band inside the OUTER edge of a skin mask (whose top-left pixel is `origin` in
        the photo): `hairline_mm` (default HAIRLINE_GUARD_MM) above the eyes, where baby
        hairs too fine for the colour trim remain, and JAW_GUARD_MM below (jaw shadow, neck,
        background). Measured from where the skin really ends, not from the outline lifted
        into the hair. `features` (eyes, lips, nostrils cut from the skin) count as inside the
        face, so a cut-out that reaches the outline is not mistaken for the face edge."""
        if hairline_mm is None:
            hairline_mm = config.HAIRLINE_GUARD_MM
        filled = skin if features is None else skin | features
        outer = binary_fill_holes(filled).astype(np.uint8)
        inside = cv2.distanceTransform(outer, cv2.DIST_L2, 5) / self.px_per_mm  # mm
        up = self.points[10] - self.points[152]
        up = up / np.linalg.norm(up)
        cx, cy = self.points[168] - np.asarray(origin, float)  # 168: between the eyes
        yy, xx = np.mgrid[: skin.shape[0], : skin.shape[1]].astype(np.float32)
        above_eyes = (xx - cx) * up[0] + (yy - cy) * up[1] > 0
        band_mm = np.where(above_eyes, hairline_mm, config.JAW_GUARD_MM)
        return outer.astype(bool) & (inside < band_mm) & skin

    def feature_zones(self, shape: tuple[int, int]) -> dict[str, np.ndarray]:
        """Where brows and nostrils can be; refine_skin removes only their dark pixels."""
        brow_core = self._shape(shape, RIGHT_BROW) | self._shape(shape, LEFT_BROW)
        brow_zone = cv2.dilate(brow_core.astype(np.uint8), self._disk(config.BROW_ZONE_MM))
        nose = cv2.convexHull(self.points[NOSE_BASE].astype(np.float32)).reshape(-1, 2)
        nose_zone = cv2.dilate(polygon_mask(shape, nose).astype(np.uint8), self._disk(1.0))
        # below the nose (where a beard / stubble grows), as a half-plane across the face
        up = self.points[10] - self.points[152]
        up = up / np.linalg.norm(up)
        yy, xx = np.mgrid[: shape[0], : shape[1]].astype(np.float32)
        sx, sy = self.points[2]  # 2: just under the nose tip
        lower = (xx - sx) * up[0] + (yy - sy) * up[1] < 0
        return {
            "lower_face": lower,
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


def facial_hair(
    l_star: np.ndarray,
    skin: np.ndarray,
    px_per_mm: float,
    near_features: np.ndarray | None = None,
) -> np.ndarray:
    """Moustache, beard and stubble: many hair-thin pixels much darker than the skin
    right next to them (within ~1 mm). Hair is stripy; a shadow is smooth, and a dark spot
    is one small patch, so neither reaches the density. Patches smaller than
    FACIAL_HAIR_MIN_AREA_MM2 (a cluster of small dark bumps) are kept as skin."""
    fine = cv2.GaussianBlur(
        l_star.astype(np.float32), (0, 0), config.FACIAL_HAIR_FINE_MM * px_per_mm
    )
    strands = skin & (l_star < fine - config.FACIAL_HAIR_DELTA_L)
    window = round(config.FACIAL_HAIR_WINDOW_MM * px_per_mm) | 1
    density = cv2.blur(strands.astype(np.float32), (window, window))
    beard = (density > config.FACIAL_HAIR_DENSITY).astype(np.uint8)
    # a moustache or stubble covers a big patch; a small cluster of dark bumps is marks
    n, labels, stats, _ = cv2.connectedComponentsWithStats(beard, connectivity=8)
    min_area = config.FACIAL_HAIR_MIN_AREA_MM2 * px_per_mm**2
    # hair darkens a patch; shine (bright highlights between dark pores) only looks stripy
    median = float(np.median(l_star[skin])) if skin.any() else 0.0
    shiny = {k for k in range(1, n) if l_star[labels == k].mean() > median}
    hair = {k for k in range(1, n) if stats[k, cv2.CC_STAT_AREA] >= min_area} - shiny
    if near_features is not None:
        hair |= set(np.unique(labels[near_features & (labels > 0)]).tolist()) - shiny
    beard = np.isin(labels, list(hair)).astype(np.uint8)
    r = max(round(config.HAIR_MARGIN_MM * px_per_mm), 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.dilate(beard, kernel).astype(bool)


def skin_colour(lab: np.ndarray, mask: np.ndarray, ref: np.ndarray, px_per_mm: float) -> np.ndarray:
    """Pixels of `mask` whose colour matches this person's skin in `ref` (visible cheek):
    enough chroma and a similar hue (hair and background are grey), not much brighter
    (shine) or far darker (hair). Holes up to SIDE_FILL_HOLES_MM2 are refilled so marks that
    lose colour stay skin. Used on side views, where hair and background crowd the cheek."""
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    chroma = np.hypot(a, b)
    hue = np.degrees(np.arctan2(b, a))
    # darkness limit from all of this skin, not the cheek patch alone: on a shiny photo
    # the cheek patch sits on the highlight and shaded skin (under the mouth) read as hair.
    # The shine limit keeps the brighter of the two, so lit skin is not cut as shine.
    l_all, l_cheek = float(np.median(L[mask])), float(np.median(L[ref]))
    c_ref = float(np.median(chroma[ref]))
    h_ref = float(np.median(hue[ref]))
    d_hue = (hue - h_ref + 180) % 360 - 180  # negative = redder than the cheek
    keep = (
        mask
        & (chroma >= config.SIDE_MIN_CHROMA_FRAC * c_ref)
        & (d_hue <= config.SIDE_MAX_HUE_DEG)
        & (d_hue >= -config.SIDE_MAX_RED_SHIFT_DEG)  # inflamed skin is much redder: keep it
        & (L <= max(l_all, l_cheek) + config.SIDE_MAX_BRIGHTER_L)
        & (L >= min(l_all, l_cheek) - config.SIDE_MAX_DARKER_L)
    )
    # small round dark blobs are marks or moles, not hair (hair is thin or large), even
    # where they touch the mask edge
    dark = mask & ~keep & (L < min(l_all, l_cheek))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(dark.astype(np.uint8), connectivity=8)
    max_area = config.SIDE_FILL_HOLES_MM2 * px_per_mm**2
    for k in range(1, n):
        w, h, area = (
            stats[k, cv2.CC_STAT_WIDTH],
            stats[k, cv2.CC_STAT_HEIGHT],
            stats[k, cv2.CC_STAT_AREA],
        )
        if (
            area < max_area
            and min(w, h) >= px_per_mm
            and area >= 0.5 * w * h
            and max(w, h) <= 2 * min(w, h)
        ):
            keep |= labels == k
    holes = binary_fill_holes(keep) & ~keep
    n, labels, stats, _ = cv2.connectedComponentsWithStats(holes.astype(np.uint8), connectivity=8)
    small = [
        k
        for k in range(1, n)
        if stats[k, cv2.CC_STAT_AREA] < config.SIDE_FILL_HOLES_MM2 * px_per_mm**2
    ]
    keep |= np.isin(labels, small) & mask
    r = max(round(0.7 * px_per_mm), 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    keep = cv2.morphologyEx(keep.astype(np.uint8), cv2.MORPH_OPEN, kernel)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(keep, connectivity=8)
    if n > 1:
        keep = (labels == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
    return keep.astype(bool) & mask


def edge_hair(
    lab: np.ndarray,
    skin: np.ndarray,
    ref: np.ndarray,
    px_per_mm: float,
    ear_side: np.ndarray | None = None,
) -> np.ndarray:
    """Sideburns / temple hair on side views: rough (fine texture well above this
    person's skin) AND greyer than the cheek, over a SIDE_HAIR_WINDOW_MM window, in
    patches that touch the outer edge of the skin mask on the ear side and lie mostly on
    that side (`ear_side`; marks inside the cheek and bumpy forehead skin are rough too,
    but they do not)."""
    L = lab[..., 0].astype(np.float32)
    hp = L - cv2.GaussianBlur(L, (0, 0), 0.7 * px_per_mm)
    w = round(config.SIDE_HAIR_WINDOW_MM * px_per_mm) | 1
    tex = np.sqrt(cv2.blur(hp * hp, (w, w)))
    chroma = cv2.blur(np.hypot(lab[..., 1], lab[..., 2]).astype(np.float32), (w, w))
    rough = tex > config.SIDE_HAIR_TEXTURE * float(np.median(tex[skin]))
    grey = chroma < config.SIDE_HAIR_CHROMA * float(np.median(chroma[ref]))
    hair = (skin & rough & grey).astype(np.uint8)
    hair = cv2.morphologyEx(hair, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    outer = binary_fill_holes(skin).astype(np.uint8)
    # (borderValue 0: a mask that runs to the crop border has an edge there too)
    inner = cv2.erode(
        outer, np.ones((5, 5), np.uint8), borderType=cv2.BORDER_CONSTANT, borderValue=0
    )
    edge = outer.astype(bool) & ~inner.astype(bool)
    if ear_side is not None:
        edge &= ear_side
    n, labels, stats, _ = cv2.connectedComponentsWithStats(hair, connectivity=8)
    min_area = config.FACIAL_HAIR_MIN_AREA_MM2 * px_per_mm**2
    ids = [
        k
        for k in range(1, n)
        if stats[k, cv2.CC_STAT_AREA] >= min_area
        and (edge & (labels == k)).any()
        # mostly beside the ear: a rough patch that only reaches the ear-side edge from
        # the forehead or brow (bumpy skin, brow hairs) is not a sideburn
        and (ear_side is None or ear_side[labels == k].mean() > 0.5)
    ]
    r = max(round(config.HAIR_MARGIN_MM * px_per_mm), 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.dilate(np.isin(labels, ids).astype(np.uint8), kernel).astype(bool)


def stubble(l_star: np.ndarray, skin: np.ndarray, px_per_mm: float) -> np.ndarray:
    """Short stubble in a phone photo: not strands but a dense field of small dark dots.
    Share of pixels STUBBLE_DELTA_L darker than the skin within ~0.5 mm, over a
    STUBBLE_WINDOW_MM window; big patches above STUBBLE_DENSITY are beard. Call it on the
    lower face only. Oct 13: beard 0.11 (median at its spots); dense freckles and acne
    below the nose at most 0.02."""
    fine = cv2.GaussianBlur(l_star.astype(np.float32), (0, 0), 0.5 * px_per_mm)
    specks = skin & (l_star < fine - config.STUBBLE_DELTA_L)
    w = round(config.STUBBLE_WINDOW_MM * px_per_mm) | 1
    share = cv2.blur(specks.astype(np.float32), (w, w)) / np.maximum(
        cv2.blur(skin.astype(np.float32), (w, w)), 1e-3
    )
    patch = (skin & (share > config.STUBBLE_DENSITY)).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(patch, connectivity=8)
    min_area = config.FACIAL_HAIR_MIN_AREA_MM2 * px_per_mm**2
    median = float(np.median(l_star[skin])) if skin.any() else 0.0
    big = [
        k
        for k in range(1, n)
        if stats[k, cv2.CC_STAT_AREA] >= min_area and l_star[labels == k].mean() <= median
    ]  # (a shiny patch is speckled too, but brighter than this person's skin, not darker)
    r = max(round(config.HAIR_MARGIN_MM * px_per_mm), 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.dilate(np.isin(labels, big).astype(np.uint8), kernel).astype(bool)


def refine_skin(
    l_star: np.ndarray,
    mask: np.ndarray,
    zones: dict[str, np.ndarray],
    px_per_mm: float,
    chroma: np.ndarray | None = None,
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
    skin = remove_hair(l_star, mask & ~cut.astype(bool), px_per_mm, chroma)
    # eyes, lids, lips (holes in the mask) and brows, grown a little: lashes/brow tails
    features = (binary_fill_holes(mask) & ~mask) | cut.astype(bool)
    features = cv2.dilate(features.astype(np.uint8), disk(config.HAIR_MARGIN_MM)).astype(bool)
    skin &= ~facial_hair(l_star, skin, px_per_mm, near_features=features)
    if "lower_face" in zones:
        skin &= ~stubble(l_star, skin & zones["lower_face"], px_per_mm)

    # smooth: fill pin-holes, shave ragged spurs, keep the one face region
    smooth = cv2.morphologyEx(skin.astype(np.uint8), cv2.MORPH_CLOSE, disk(0.7))
    smooth = cv2.morphologyEx(smooth, cv2.MORPH_OPEN, disk(1.0))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(smooth, connectivity=8)
    if n > 1:
        smooth = (labels == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
    return smooth.astype(bool) & mask & ~cut.astype(bool)


def remove_hair(
    l_star: np.ndarray, mask: np.ndarray, px_per_mm: float, chroma: np.ndarray | None = None
) -> np.ndarray:
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
    if chroma is not None:
        # dark AND grey: black hair and braids on deep skin are only ~25 L* darker than the
        # face (the test above can miss them) but have almost no colour, unlike skin or marks
        very_dark |= (l_star < np.median(l_star[mask]) - config.HAIR_GREY_DELTA_L) & (
            chroma < config.HAIR_GREY_CHROMA * np.median(chroma[mask])
        )
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
