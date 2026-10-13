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

from app import config

MODEL = Path(__file__).resolve().parents[1] / "models" / "face_landmarker.task"

# Mirrored pairs on the canonical mesh (e.g. 50 <-> 280 are the two cheekbones).
ROI_POINTS = {
    "forehead": [109, 10, 338, 108, 151, 337, 69, 299],
    "right_cheek": [50, 101, 118, 117, 123, 187, 205, 36],
    "left_cheek": [280, 330, 347, 346, 352, 411, 425, 266],
    "nose": [197, 195, 5, 4, 45, 275, 51, 281],
    "chin": [18, 200, 199, 175, 208, 428, 32, 262],
    "right_under_eye": [110, 24, 23, 22, 26, 120, 119, 118, 117, 111],
    "left_under_eye": [339, 254, 253, 252, 256, 349, 348, 347, 346, 340],
}
CHEEKS = ("right_cheek", "left_cheek")
EYE_OUTER = (33, 263)  # outer eye corners, for face scale (inter-ocular distance)


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
        out = {}
        for name, idx in ROI_POINTS.items():
            pts = self.points[idx].astype(np.float32)
            hull = cv2.convexHull(pts).reshape(-1, 2)
            centre = hull.mean(axis=0)
            out[name] = centre + (hull - centre) * config.FACE_ROI_SHRINK
        return out


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
