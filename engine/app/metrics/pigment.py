"""pigment_spots (docs/METRICS.md A4): area % of skin darker in melanin than the person's
own skin around it. Threshold is median + k * MAD of THIS ROI, never an absolute L*."""

import numpy as np
from scipy import ndimage

from app import config
from app.metrics.evenness import melanin_index


def find_spots(
    linear_red: np.ndarray, skin: np.ndarray, px_per_mm: float
) -> tuple[np.ndarray, list[float]]:
    """Spot mask and per-spot mean contrast (MI units) inside one ROI's bounding box."""
    mi = ndimage.gaussian_filter(melanin_index(linear_red), sigma=max(px_per_mm * 0.3, 1.0))
    # local, tone-relative background: average of THIS person's skin within ~3 mm, so gentle
    # shading across the face (curvature, overhead light) is not mistaken for a spot
    sigma_bg = config.SPOT_BACKGROUND_MM * px_per_mm
    weight = ndimage.gaussian_filter(skin.astype(np.float64), sigma_bg)
    background = ndimage.gaussian_filter(np.where(skin, mi, 0.0), sigma_bg) / np.maximum(weight, 1e-6)
    contrast = mi - background
    mad = np.median(np.abs(contrast[skin])) * 1.4826  # robust SD of this person's skin
    # MI is a log scale, so a fixed MI difference is the same *ratio* of light at every tone
    threshold = max(config.SPOT_K_MAD * mad, config.SPOT_MIN_CONTRAST_MI)
    labels, n = ndimage.label(skin & (contrast > threshold))
    min_area = np.pi * (config.SPOT_MIN_DIAMETER_MM * px_per_mm / 2) ** 2
    max_area = np.pi * (config.SPOT_MAX_DIAMETER_MM * px_per_mm / 2) ** 2
    mask = np.zeros_like(skin)
    contrasts = []
    for k in range(1, n + 1):
        blob = labels == k
        core = blob & (contrast >= contrast[blob].max() / 2)  # size at half its own peak
        if min_area <= core.sum() <= max_area:
            mask |= core
            contrasts.append(float(contrast[core].mean()))
    return mask, contrasts


def pigment_spots(
    regions: dict[str, tuple[np.ndarray, np.ndarray]], px_per_mm: float
) -> tuple[float, dict]:
    """regions: name -> (linear red crop, skin mask crop). Returns area % + count/contrast."""
    spot_px = skin_px = 0
    contrasts: list[float] = []
    for red, skin in regions.values():
        mask, c = find_spots(red, skin, px_per_mm)
        spot_px += int(mask.sum())
        skin_px += int(skin.sum())
        contrasts += c
    pct = 100.0 * spot_px / max(skin_px, 1)
    extras = {
        "count": len(contrasts),
        "mean_contrast": round(float(np.mean(contrasts)), 2) if contrasts else 0.0,
    }
    return pct, extras
