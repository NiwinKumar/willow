"""blemishes (docs/METRICS.md B2): small round spots redder than this person's own skin
nearby. On deeper skin a pimple is often only a little redder but clearly darker, so the
score adds part of the darkness, but a spot must still be somewhat redder: shading makes
skin darker, not redder, so shadows by the nose and eyes are not picked up. Indicative
only: Gemini labels each crop (pimple, mark, mole...) later."""

from dataclasses import dataclass

import cv2
import numpy as np
from scipy import ndimage

from app import config
from app.metrics.blobs import blob_log_fast


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


def find_blemishes(
    lab: np.ndarray, skin: np.ndarray, px_per_mm: float, search: np.ndarray | None = None
) -> list[Blemish]:
    """Blemishes inside `skin` (bool mask over the `lab` crop) whose centre lies in `search`
    (default: all of `skin`), strongest first. `skin` is the local background, so guarded
    skin still counts as 'nearby'. Coordinates and areas are in the input's pixels."""
    if search is None:
        search = skin
    lab, (skin, search), px_per_mm, back = working_scale(lab, [skin, search], px_per_mm)
    sigma_bg = config.BLEMISH_BACKGROUND_MM * px_per_mm
    a_bg = _local_mean(lab[..., 1], skin, sigma_bg)
    l_bg = _local_mean(lab[..., 0], skin, sigma_bg)
    smooth = max(0.15 * px_per_mm, 0.5)
    redder = cv2.GaussianBlur(
        np.where(skin, lab[..., 1] - a_bg, 0).astype(np.float32), (0, 0), smooth
    )
    darker = cv2.GaussianBlur(
        np.where(skin, l_bg - lab[..., 0], 0).astype(np.float32), (0, 0), smooth
    )
    # robust SDs of this person's skin, from the half that blemishes do not touch
    z_red = np.clip(redder / robust_spread(redder[skin]), 0, None)
    z_dark = np.clip(darker / robust_spread(darker[skin]), 0, None)
    z = z_red + config.BLEMISH_DARK_WEIGHT * z_dark

    # round-blob search at sizes from ~1 to ~5 mm across
    r_min, r_max = (d * px_per_mm / 2 for d in config.BLEMISH_DIAMETER_MM)
    blobs = blob_log_fast(
        z / 10,
        min_sigma=r_min / 1.414,
        max_sigma=r_max / 1.414,
        num_sigma=8,
        threshold=0.05,
        overlap=0.3,
    )
    edge = round(config.BLEMISH_EDGE_MM * px_per_mm)
    # not on the mask edge; gaps left by single hairs (beard, stubble) are not an edge
    solid = skin | _small_holes(skin, config.BLEMISH_HAIR_GAP_MM2 * px_per_mm**2)
    inner = ndimage.binary_erosion(solid, iterations=max(edge, 1)) & search
    h, w = skin.shape
    found = []
    for y, x, s in blobs:
        y, x = int(y), int(x)
        if not inner[y, x]:
            continue
        r = s * 1.414
        # every per-blob test within the disk's bounding box (a whole-image mask per blob is slow)
        ri = int(np.ceil(r))
        win = np.s_[max(y - ri, 0) : min(y + ri + 1, h), max(x - ri, 0) : min(x + ri + 1, w)]
        yy, xx = np.ogrid[win]
        disk = ((yy - y) ** 2 + (xx - x) ** 2 <= r * r) & skin[win]
        score = float(z[win][disk].mean())
        a_contrast = float((lab[win][..., 1] - a_bg[win])[disk].mean())
        l_contrast = float((lab[win][..., 0] - l_bg[win])[disk].mean())
        if (
            score < config.BLEMISH_MIN_SCORE
            or z_red[win][disk].mean() < config.BLEMISH_MIN_RED_Z
            or a_contrast < config.BLEMISH_MIN_A_CONTRAST
            or a_contrast < config.BLEMISH_MIN_RED_RATIO * -l_contrast
        ):
            continue  # too faint, or mostly darker (a brown mark, a shadow, hair)
        found.append(
            Blemish(
                x=float(x * back),  # plain floats: numpy float32 is not JSON-serialisable
                y=float(y * back),
                radius=float(r * back),
                score=score,
                a_star_contrast=a_contrast,
                l_star_contrast=l_contrast,
                area_px=round(disk.sum() * back * back),
            )
        )
    gap = config.BLEMISH_MERGE_MM * px_per_mm * back  # in input pixels
    return _merge(sorted(found, key=lambda b: -b.score), gap)


def _small_holes(mask: np.ndarray, max_area_px: float) -> np.ndarray:
    """Holes in `mask` smaller than max_area_px (hair gaps; eyes and lips are far larger)."""
    holes = ndimage.binary_fill_holes(mask) & ~mask
    labels, n = ndimage.label(holes)
    if n == 0:
        return holes
    sizes = ndimage.sum(holes, labels, index=np.arange(1, n + 1))
    return np.isin(labels, 1 + np.nonzero(sizes < max_area_px)[0])


def robust_spread(values: np.ndarray) -> float:
    """SD of skin texture from the half of a contrast map that spots do not reach (values
    are oriented so spots are positive): a face with many marks does not raise its own
    bar. For normal noise, median - 25th percentile = 0.674 SD."""
    q25, q50 = np.percentile(values, [25, 50])
    return float(max((q50 - q25) / 0.6745, 1e-6))


def _merge(blemishes: list[Blemish], min_gap_px: float) -> list[Blemish]:
    """One spot found twice at nearby sizes counts once (keep the strongest)."""
    kept: list[Blemish] = []
    for b in blemishes:
        if all(np.hypot(b.x - k.x, b.y - k.y) > max(min_gap_px, b.radius + k.radius) for k in kept):
            kept.append(b)
    return kept
