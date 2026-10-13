"""Line up the photos of one session (docs/METRICS.md pipeline step 7): a similarity
transform (shift, rotation, uniform scale) from each photo's face landmarks onto the
reference photo's, so positions found in one photo can be looked up in another."""

import cv2
import numpy as np

# Rigid parts of the face (eye corners, nose, mouth corners, chin, forehead, cheek edges);
# expression barely moves them, so they give a stable fit.
STABLE_POINTS = [33, 133, 362, 263, 168, 6, 1, 4, 61, 291, 152, 10, 234, 454]


def similarity(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """2x3 matrix mapping src landmark coords onto dst (robust to a few bad points)."""
    m, _ = cv2.estimateAffinePartial2D(
        src[STABLE_POINTS].astype(np.float32),
        dst[STABLE_POINTS].astype(np.float32),
        method=cv2.LMEDS,
    )
    if m is None:
        raise ValueError("could not align photos")
    return m


def transform(m: np.ndarray, xy: np.ndarray) -> np.ndarray:
    """Apply a 2x3 transform to (N, 2) points."""
    xy = np.asarray(xy, dtype=np.float64).reshape(-1, 2)
    return xy @ m[:, :2].T + m[:, 2]


def residual_px(src: np.ndarray, dst: np.ndarray, m: np.ndarray) -> float:
    """RMS distance (px) of the stable points after alignment: how well the photos match."""
    d = transform(m, src[STABLE_POINTS]) - dst[STABLE_POINTS]
    return float(np.sqrt((d**2).sum(axis=1).mean()))
