"""texture (docs/METRICS.md A6): roughness of the skin surface in a close-up. Energy of the
Laplacian of L* at a fixed fine scale (TEXTURE_SIGMA_MM), RMS over the skin, normalised by
the skin's mean L* so the same roughness reads the same on light and deep skin. Highlights
(clipped pixels) are left out. Lower = smoother."""

import cv2
import numpy as np

from app import config
from app.metrics.pores import _to_work


def texture(lab: np.ndarray, skin: np.ndarray, px_per_mm: float) -> float | None:
    L, px, _ = _to_work(lab[..., 0].astype(np.float32), px_per_mm)
    skin = cv2.resize(skin.astype(np.uint8), L.shape[::-1], interpolation=cv2.INTER_NEAREST) > 0
    sigma = config.TEXTURE_SIGMA_MM * px
    smooth = cv2.GaussianBlur(L, (0, 0), sigma)
    lap = cv2.Laplacian(smooth, cv2.CV_32F) * sigma**2  # scale-normalised
    inner = cv2.erode(skin.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=3) > 0
    if inner.sum() < 100:
        return None
    return float(100.0 * np.sqrt(np.mean(lap[inner] ** 2)) / max(float(L[inner].mean()), 1e-6))
