"""Find the 4 pen dots around the measured skin spot, and the white paper, automatically."""

from itertools import combinations

import numpy as np
from skimage import measure, morphology
from skimage.filters import gaussian

from app.roi import Box

SCALE = 4  # work on a 4x smaller copy: dots are still ~5-15 px across, and it is 16x faster
DOT_MIN_CONTRAST = 15.0  # dot must differ from the skin around it by this many grey levels
SKIN_MIN_WARMTH = 0.12  # (R - B) / R: skin is warm at every tone, paper is ~0
DOT_AREA_PX = (3, 400)  # dot size range in the small copy
MAX_CANDIDATES = 40
SQUARE_SIDE_FRAC = (0.03, 0.20)  # dot spacing as a fraction of photo width (~2-6 cm squares)
PAIR_GAP_SIDES = 4.0
PAPER_BAND_BOXES = 1.5  # paper within 1.5 box-heights above/below the skin box
PAPER_MIN_PX = 2000  # in the small copy; fewer -> use the whole sheet  # two squares must be within 4 side-lengths of each other
ROI_FRACTION = 0.30  # half-size of the measured square as a fraction of the dot spacing


def _small_grey(srgb8: np.ndarray) -> np.ndarray:
    return srgb8[::SCALE, ::SCALE].astype(np.float32).mean(axis=-1)


def _skin_like(rgb: np.ndarray) -> bool:
    """Rough 'is this skin?' test on the blurred colour around a dot: R > G >= B with some
    warmth relative to its own brightness. Uses proportions, not brightness, so it works the
    same from very light to very dark skin; neutral white paper fails it."""
    r, g, b = (float(v) for v in rgb)
    return bool(r > g >= b and (r - b) / max(r, 1.0) >= SKIN_MIN_WARMTH)


def dot_candidates(srgb8: np.ndarray) -> list[tuple[float, float, float]]:
    """Small round blobs on skin that stand out from it: (x, y, contrast), strongest first."""
    small = srgb8[::SCALE, ::SCALE].astype(np.float32)
    grey = small.mean(axis=-1)
    # dots may be darker (pen) or lighter (white marker on deep skin) than the skin around them
    contrast = np.abs(gaussian(grey, sigma=8, preserve_range=True) - grey)
    around = gaussian(small, sigma=8, channel_axis=-1, preserve_range=True)
    labels = measure.label(contrast > DOT_MIN_CONTRAST)
    out = []
    for r in measure.regionprops(labels, intensity_image=contrast):
        if not DOT_AREA_PX[0] <= r.area <= DOT_AREA_PX[1] or r.eccentricity > 0.9:
            continue
        y, x = r.centroid
        if not _skin_like(around[int(y), int(x)]):
            continue  # specks on the table, paper edge or clothes are not pen dots
        out.append((x * SCALE, y * SCALE, float(r.intensity_mean)))
    return sorted(out, key=lambda c: -c[2])[:MAX_CANDIDATES]


def _square_scores(pts: np.ndarray, combos: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """For each 4-point combo: (shape score, side length). Score 0 = perfect square."""
    quad = pts[combos]  # (C, 4, 2)
    pairs = [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)]
    d = np.sort(np.stack([np.linalg.norm(quad[:, i] - quad[:, j], axis=1) for i, j in pairs], 1))
    sides, diags = d[:, :4], d[:, 4:]
    side = sides.mean(axis=1)
    score = sides.std(axis=1) / side + np.abs(diags.mean(axis=1) / side - np.sqrt(2))
    return score, side


def _candidate_squares(cands: list, width: int, max_score: float) -> list[tuple]:
    """All square-ish 4-dot groups of a plausible size: (score, side, combo), best first."""
    if len(cands) < 4:
        return []
    pts = np.array([c[:2] for c in cands])
    combos = np.array(list(combinations(range(len(cands)), 4)))
    score, side = _square_scores(pts, combos)
    lo, hi = SQUARE_SIDE_FRAC[0] * width, SQUARE_SIDE_FRAC[1] * width
    ok = (score < max_score) & (side > lo) & (side < hi)
    order = np.argsort(score[ok])
    return [(score[ok][i], side[ok][i], combos[ok][i]) for i in order]


def _inner_box(pts: np.ndarray, side: float) -> Box:
    cx, cy = pts.mean(axis=0)
    half = ROI_FRACTION * side  # stays inside the dots even if the square is rotated
    return Box(round(cx - half), round(cy - half), round(2 * half), round(2 * half))


def find_dot_squares(
    srgb8: np.ndarray, n: int = 1, max_score: float = 0.25
) -> list[tuple[Box, np.ndarray]]:
    """Find 1 or 2 dotted squares, returned top-to-bottom in the photo.

    For 2, pick the best-shaped PAIR of squares that are the same size and close together
    (pen-dot squares drawn side by side), which rules out chance squares on the table.
    """
    cands = dot_candidates(srgb8)
    pts = np.array([c[:2] for c in cands]) if cands else np.zeros((0, 2))
    squares = _candidate_squares(cands, srgb8.shape[1], max_score)
    chosen = None
    if n == 1 and squares:
        chosen = [squares[0]]
    elif n == 2:
        best = np.inf
        for i, (s1, side1, c1) in enumerate(squares):
            if s1 >= best:
                break  # sorted by score: nothing later can beat the best pair
            for s2, side2, c2 in squares[i + 1 :]:
                if s1 + s2 >= best:
                    break
                if set(c1) & set(c2) or abs(side2 / side1 - 1) > 0.35:
                    continue
                gap = np.linalg.norm(pts[c1].mean(0) - pts[c2].mean(0))
                if gap < PAIR_GAP_SIDES * (side1 + side2) / 2:
                    best, chosen = s1 + s2, [(s1, side1, c1), (s2, side2, c2)]
    elif n not in (1, 2):
        raise ValueError("only 1 or 2 squares supported")
    if chosen is None:
        raise ValueError(f"could not find {n} dotted square(s) ({len(cands)} dark spots seen)")
    found = [(_inner_box(pts[c], side), pts[c]) for _, side, c in chosen]
    return sorted(found, key=lambda f: f[1][:, 1].mean())


def find_dot_square(srgb8: np.ndarray, max_score: float = 0.25) -> tuple[Box, np.ndarray]:
    """The single best dotted square; returns the skin box inside it and the 4 dot centres."""
    return find_dot_squares(srgb8, 1, max_score)[0]


def paper_pixels(linear: np.ndarray, srgb8: np.ndarray, near: Box | None = None) -> np.ndarray:
    """Linear RGB of the white paper: the largest bright, colourless region, edges trimmed.

    With `near`, only paper in a band at the same height as that box is used, because lamp
    light falls off across the table and paper next to the skin sees the same light as it.
    Falls back to the whole sheet if the band has too little paper.
    """
    small = srgb8[::SCALE, ::SCALE].astype(np.int16)
    bright = small.min(axis=-1) > 150
    neutral = (small.max(axis=-1) - small.min(axis=-1)) < 35
    labels = measure.label(morphology.opening(bright & neutral, morphology.disk(3)))
    if labels.max() == 0:
        raise ValueError("could not find the white paper")
    largest = max(measure.regionprops(labels), key=lambda r: r.area)
    mask = morphology.erosion(labels == largest.label, morphology.disk(6))
    ys, xs = np.nonzero(mask)
    if near is not None:
        cy = (near.y + near.h / 2) / SCALE
        band = np.abs(ys - cy) <= PAPER_BAND_BOXES * near.h / SCALE
        if band.sum() >= PAPER_MIN_PX:
            ys, xs = ys[band], xs[band]
    return linear[::SCALE, ::SCALE][ys, xs]
