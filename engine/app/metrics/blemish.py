"""blemishes (docs/METRICS.md B2): small round spots redder than this person's own skin
nearby. Shading makes skin darker, not redder, so shadows by the nose and eyes are not
picked up. Indicative only: Gemini labels each crop (pimple, mark, mole...) later."""

from dataclasses import dataclass

import cv2
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
    """Average of `values` over skin pixels nearby (Gaussian, sigma in px)."""
    weight = cv2.GaussianBlur(skin.astype(np.float32), (0, 0), sigma)
    total = cv2.GaussianBlur(np.where(skin, values, 0).astype(np.float32), (0, 0), sigma)
    return total / np.maximum(weight, 1e-6)


def working_scale(
    lab: np.ndarray, masks: list[np.ndarray], px_per_mm: float
) -> tuple[np.ndarray, list[np.ndarray], float, float]:
    """Shrink to DETECT_PX_PER_MM: 1-5 mm spots need no more detail, and the blob search
    costs grow with pixel count. Returns (lab, masks, px_per_mm, factor to full size)."""
    scale = min(config.DETECT_PX_PER_MM / px_per_mm, 1.0)
    if scale == 1.0:
        return lab, masks, px_per_mm, 1.0
    h, w = lab.shape[:2]
    size = (max(round(w * scale), 1), max(round(h * scale), 1))
    small = cv2.resize(lab.astype(np.float32), size, interpolation=cv2.INTER_AREA)
    small_masks = [
        cv2.resize(m.astype(np.uint8), size, interpolation=cv2.INTER_NEAREST).astype(bool)
        for m in masks
    ]
    return small, small_masks, px_per_mm * scale, 1.0 / scale


def find_blemishes(lab: np.ndarray, skin: np.ndarray, px_per_mm: float) -> list[Blemish]:
    """Blemishes inside `skin` (bool mask over the `lab` crop), strongest first.
    Coordinates and areas are in the input's pixels."""
    lab, (skin,), px_per_mm, back = working_scale(lab, [skin], px_per_mm)
    sigma_bg = config.BLEMISH_BACKGROUND_MM * px_per_mm
    a_bg = _local_mean(lab[..., 1], skin, sigma_bg)
    l_bg = _local_mean(lab[..., 0], skin, sigma_bg)
    redder = cv2.GaussianBlur(
        np.where(skin, lab[..., 1] - a_bg, 0).astype(np.float32), (0, 0), max(0.15 * px_per_mm, 0.5)
    )
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
                x=float(x * back),  # plain floats: numpy float32 is not JSON-serialisable
                y=float(y * back),
                radius=float(r * back),
                score=score,
                a_star_contrast=float((lab[..., 1] - a_bg)[disk].mean()),
                l_star_contrast=float((lab[..., 0] - l_bg)[disk].mean()),
                area_px=round(disk.sum() * back * back),
            )
        )
    gap = config.BLEMISH_MERGE_MM * px_per_mm * back  # in input pixels
    return _merge(sorted(found, key=lambda b: -b.score), gap)


def _merge(blemishes: list[Blemish], min_gap_px: float) -> list[Blemish]:
    """One spot found twice at nearby sizes counts once (keep the strongest)."""
    kept: list[Blemish] = []
    for b in blemishes:
        if all(np.hypot(b.x - k.x, b.y - k.y) > max(min_gap_px, b.radius + k.radius) for k in kept):
            kept.append(b)
    return kept
