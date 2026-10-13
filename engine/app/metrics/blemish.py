"""blemishes (docs/METRICS.md B2): small round spots redder than this person's own skin
nearby. Shading makes skin darker, not redder, so shadows by the nose and eyes are not
picked up. Indicative only: Gemini labels each crop (pimple, mark, mole...) later."""

from dataclasses import dataclass

import numpy as np
from scipy import ndimage
from skimage.feature import blob_log

from app import config


@dataclass
class Blemish:
    x: float  # centre, pixels of the crop it was found in
    y: float
    radius: float
    score: float  # redness above local skin, in units of this person's skin variation
    a_star_contrast: float  # a* above local skin
    l_star_contrast: float  # L* relative to local skin (negative = darker)
    area_px: int


def _local_mean(values: np.ndarray, skin: np.ndarray, sigma: float) -> np.ndarray:
    weight = ndimage.gaussian_filter(skin.astype(np.float64), sigma)
    total = ndimage.gaussian_filter(np.where(skin, values, 0.0), sigma)
    return total / np.maximum(weight, 1e-6)


def find_blemishes(lab: np.ndarray, skin: np.ndarray, px_per_mm: float) -> list[Blemish]:
    """Blemishes inside `skin` (bool mask over the `lab` crop), strongest first."""
    sigma_bg = config.BLEMISH_BACKGROUND_MM * px_per_mm
    a_bg = _local_mean(lab[..., 1], skin, sigma_bg)
    l_bg = _local_mean(lab[..., 0], skin, sigma_bg)
    redder = ndimage.gaussian_filter(np.where(skin, lab[..., 1] - a_bg, 0.0), 0.15 * px_per_mm)
    spread = np.median(np.abs(redder[skin])) * 1.4826  # robust SD of this person's skin
    z = np.clip(redder / max(spread, 1e-6), 0, None)

    # round-blob search at sizes from ~1 to ~5 mm across
    r_min, r_max = (d * px_per_mm / 2 for d in config.BLEMISH_DIAMETER_MM)
    blobs = blob_log(
        z / 10,
        min_sigma=r_min / 1.414,
        max_sigma=r_max / 1.414,
        num_sigma=8,
        threshold=0.05,
        overlap=0.3,
    )
    edge = round(config.BLEMISH_EDGE_MM * px_per_mm)
    inner = ndimage.binary_erosion(skin, iterations=max(edge, 1))  # not on the mask edge
    yy, xx = np.ogrid[: skin.shape[0], : skin.shape[1]]
    found = []
    for y, x, s in blobs:
        y, x = int(y), int(x)
        if not inner[y, x]:
            continue
        r = s * 1.414
        disk = ((yy - y) ** 2 + (xx - x) ** 2 <= r * r) & skin
        score = float(z[disk].mean())
        if score < config.BLEMISH_MIN_SCORE:
            continue
        found.append(
            Blemish(
                x=float(x),
                y=float(y),
                radius=float(r),
                score=score,
                a_star_contrast=float((lab[..., 1] - a_bg)[disk].mean()),
                l_star_contrast=float((lab[..., 0] - l_bg)[disk].mean()),
                area_px=int(disk.sum()),
            )
        )
    return _merge(sorted(found, key=lambda b: -b.score), config.BLEMISH_MERGE_MM * px_per_mm)


def _merge(blemishes: list[Blemish], min_gap_px: float) -> list[Blemish]:
    """One spot found twice at nearby sizes counts once (keep the strongest)."""
    kept: list[Blemish] = []
    for b in blemishes:
        if all(np.hypot(b.x - k.x, b.y - k.y) > max(min_gap_px, b.radius + k.radius) for k in kept):
            kept.append(b)
    return kept
