"""tone_evenness (docs/METRICS.md A3). Lower = more even. Descriptive, not a score."""

import numpy as np
from scipy import ndimage

from app import config

EPS = 1e-6


def melanin_index(linear_red: np.ndarray) -> np.ndarray:
    """MI = 100 * log10(1 / R): more melanin absorbs more red light -> higher MI."""
    return 100.0 * np.log10(1.0 / (linear_red + EPS))


def tone_evenness(
    regions: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]], px_per_mm: float
) -> tuple[float, dict]:
    """regions: name -> (L* crop, linear red crop, skin mask) for each ROI.

    value = SD of the per-ROI median L* across ROIs (patchiness between areas)
          + mean within-ROI SD of the melanin proxy (blotchiness inside each area),
            measured after ~1 mm smoothing so camera grain does not count as unevenness.
    """
    sigma = max(config.EVENNESS_SMOOTH_MM * px_per_mm, 0.5)
    medians, within = [], []
    for L, red, skin in regions.values():
        medians.append(float(np.median(L[skin])))
        mi = ndimage.gaussian_filter(melanin_index(red), sigma=sigma)
        within.append(float(np.std(mi[skin])))
    between = float(np.std(medians, ddof=1)) if len(medians) > 1 else 0.0
    return between + float(np.mean(within)), {}
