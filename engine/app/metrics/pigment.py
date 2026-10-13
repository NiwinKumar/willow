"""pigment_spots (docs/METRICS.md A4): small round spots darker than this person's own skin
nearby that keep their colour (brown marks, freckles). Shadows lose colour as they darken
and are kept away from by guard zones, so they are not counted. Thresholds are relative
to the person's own skin, never an absolute L*."""

from dataclasses import dataclass

import cv2
import numpy as np
from scipy import ndimage
from skimage.feature import blob_log

from app import config
from app.metrics.blemish import _local_mean, working_scale


@dataclass
class Spot:
    x: float
    y: float
    radius: float
    score: float  # darkness below nearby skin, in units of this person's skin variation
    l_star_contrast: float  # L* relative to nearby skin (negative = darker)
    chroma_change: float  # colourfulness relative to nearby skin (shadows go negative)
    area_px: int


def find_spots(
    lab: np.ndarray, skin: np.ndarray, search: np.ndarray, px_per_mm: float
) -> list[Spot]:
    """Dark spots whose centre lies in `search` (skin minus shadow guards), strongest first.
    `skin` is used for the local background so guarded skin still counts as 'nearby'.
    Coordinates and areas are in the input's pixels."""
    lab, (skin, search), px_per_mm, back = working_scale(lab, [skin, search], px_per_mm)
    sigma_bg = config.SPOT_BACKGROUND_MM * px_per_mm
    l_bg = _local_mean(lab[..., 0], skin, sigma_bg)
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    c_bg = _local_mean(chroma, skin, sigma_bg)
    darker = cv2.GaussianBlur(
        np.where(skin, l_bg - lab[..., 0], 0).astype(np.float32), (0, 0), max(0.15 * px_per_mm, 0.5)
    )
    spread = np.median(np.abs(darker[skin])) * 1.4826
    z = np.clip(darker / max(spread, 1e-6), 0, None)

    r_min, r_max = (d * px_per_mm / 2 for d in config.SPOT_DIAMETER_MM)
    blobs = blob_log(
        z / 10,
        min_sigma=r_min / 1.414,
        max_sigma=r_max / 1.414,
        num_sigma=8,
        threshold=0.05,
        overlap=0.3,
    )
    edge = max(round(config.SPOT_EDGE_MM * px_per_mm), 1)
    inner = ndimage.binary_erosion(search, iterations=edge)  # away from eyes, brows, lips
    yy, xx = np.ogrid[: skin.shape[0], : skin.shape[1]]
    raw_dark = np.where(skin, l_bg - lab[..., 0], 0.0)
    min_area = np.pi * r_min**2
    found = []
    for y, x, s in blobs:
        y, x = int(y), int(x)
        if not inner[y, x]:
            continue
        r = s * 1.414
        disk = ((yy - y) ** 2 + (xx - x) ** 2 <= r * r) & skin
        score = float(z[disk].mean())
        dc = float((chroma - c_bg)[disk].mean())
        if score < config.SPOT_MIN_SCORE or dc < config.SPOT_MIN_CHROMA_CHANGE:
            continue  # too faint, or a shadow (darker AND greyer)
        # true size: pixels at least half as dark as the spot's peak (the blob search blurs
        # a 0.4 mm speck, e.g. a stray lash, up to its smallest scale)
        near = ((yy - y) ** 2 + (xx - x) ** 2 <= (2 * r) ** 2) & skin
        peak = raw_dark[near].max()
        if np.count_nonzero(near & (raw_dark >= peak / 2)) < min_area:
            continue
        found.append(
            Spot(
                x=x * back,
                y=y * back,
                radius=r * back,
                score=score,
                l_star_contrast=float((lab[..., 0] - l_bg)[disk].mean()),
                chroma_change=dc,
                area_px=round(disk.sum() * back * back),
            )
        )
    found.sort(key=lambda s: -s.score)
    kept: list[Spot] = []
    gap = config.BLEMISH_MERGE_MM * px_per_mm * back
    for s in found:  # one spot found at two sizes counts once
        if all(np.hypot(s.x - k.x, s.y - k.y) > max(gap, s.radius + k.radius) for k in kept):
            kept.append(s)
    return kept


def pigment_spots(spots: list[Spot], skin_px: int) -> tuple[float, dict]:
    """Value = % of face skin covered by spots; extras count and mean darkness (L*)."""
    pct = 100.0 * sum(s.area_px for s in spots) / max(skin_px, 1)
    extras = {
        "count": len(spots),
        "mean_contrast": round(float(np.mean([-s.l_star_contrast for s in spots])), 2)
        if spots
        else 0.0,
    }
    return pct, extras
