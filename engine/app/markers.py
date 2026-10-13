"""Find the 4 pen dots around the measured skin spot, and the white paper, automatically."""

from itertools import combinations

import numpy as np
from skimage import measure, morphology
from skimage.filters import gaussian

from app.roi import Box

SCALE = 4  # work on a 4x smaller copy: dots are still ~5-15 px across, and it is 16x faster
DOT_MIN_CONTRAST = 25.0  # dot must be this many grey levels darker than skin around it
DOT_AREA_PX = (3, 400)  # dot size range in the small copy
MAX_CANDIDATES = 25
ROI_FRACTION = 0.30  # half-size of the measured square as a fraction of the dot spacing


def _small_grey(srgb8: np.ndarray) -> np.ndarray:
    return srgb8[::SCALE, ::SCALE].astype(np.float32).mean(axis=-1)


def dot_candidates(srgb8: np.ndarray) -> list[tuple[float, float, float]]:
    """Small dark round blobs: (x, y, contrast) in full-res pixels, darkest first."""
    grey = _small_grey(srgb8)
    darker = gaussian(grey, sigma=8, preserve_range=True) - grey  # >0 where darker than nearby
    labels = measure.label(darker > DOT_MIN_CONTRAST)
    out = []
    for r in measure.regionprops(labels, intensity_image=darker):
        if not DOT_AREA_PX[0] <= r.area <= DOT_AREA_PX[1] or r.eccentricity > 0.9:
            continue
        y, x = r.centroid
        out.append((x * SCALE, y * SCALE, float(r.intensity_mean)))
    return sorted(out, key=lambda c: -c[2])[:MAX_CANDIDATES]


def _square_score(pts: np.ndarray) -> float:
    """0 for a perfect square; grows as the 4 points get less square-like."""
    d = sorted(np.linalg.norm(a - b) for a, b in combinations(pts, 2))
    sides, diags = np.array(d[:4]), np.array(d[4:])
    side = sides.mean()
    return float(sides.std() / side + abs(diags.mean() / side - np.sqrt(2)))


def find_dot_square(srgb8: np.ndarray, max_score: float = 0.25) -> tuple[Box, np.ndarray]:
    """Pick the 4 candidates that form the best square; return the skin box inside them."""
    cands = dot_candidates(srgb8)
    best, best_score = None, max_score
    for combo in combinations(range(len(cands)), 4):
        pts = np.array([cands[i][:2] for i in combo])
        score = _square_score(pts)
        if score < best_score:
            best, best_score = pts, score
    if best is None:
        raise ValueError(f"could not find 4 pen dots in a square ({len(cands)} dark spots seen)")
    cx, cy = best.mean(axis=0)
    spacing = np.mean(sorted(np.linalg.norm(a - b) for a, b in combinations(best, 2))[:4])
    half = ROI_FRACTION * spacing  # stays inside the dots even if the square is rotated
    return Box(round(cx - half), round(cy - half), round(2 * half), round(2 * half)), best


def paper_pixels(linear: np.ndarray, srgb8: np.ndarray) -> np.ndarray:
    """Linear RGB of the white paper: the largest bright, colourless region, edges trimmed."""
    small = srgb8[::SCALE, ::SCALE].astype(np.int16)
    bright = small.min(axis=-1) > 150
    neutral = (small.max(axis=-1) - small.min(axis=-1)) < 35
    labels = measure.label(morphology.opening(bright & neutral, morphology.disk(3)))
    if labels.max() == 0:
        raise ValueError("could not find the white paper")
    largest = max(measure.regionprops(labels), key=lambda r: r.area)
    mask = morphology.erosion(labels == largest.label, morphology.disk(6))
    return linear[::SCALE, ::SCALE][mask]
