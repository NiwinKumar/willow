"""lines (docs/METRICS.md C1): share of skin covered by fine lines in the forehead,
crow's feet and nasolabial regions. Lines are thin dark ridges (Sato ridge filter on L*,
0.3-0.8 mm wide) kept only if long, narrow and clearly elongated, away from detected
blemishes and dark spots (bumps and marks also look dark). Each region is skipped when
the expression that creases it is on (raised brows, squint, smile). Indicative: phone
photos resolve deep lines and folds, not the finest lines."""

import cv2
import numpy as np
from scipy import ndimage
from skimage.filters import sato

from app import config
from app.metrics.blemish import working_scale

# region -> (expression scores that crease it, limit). MediaPipe's browOuterUp scores are
# not used: they read 0.45-0.97 on neutral selfies (Oct 14), so they cannot gate anything.
GATES = {
    "forehead": (("browInnerUp",), "LINES_MAX_BROW_RAISE"),
    "crows_feet": (
        ("eyeSquintLeft", "eyeSquintRight", "mouthSmileLeft", "mouthSmileRight"),
        "LINES_MAX_EXPRESSION",
    ),
    "nasolabial": (("mouthSmileLeft", "mouthSmileRight"), "LINES_MAX_EXPRESSION"),
}


def line_pixels(
    lab: np.ndarray, region: np.ndarray, marks: list, px_per_mm: float
) -> tuple[np.ndarray, float]:
    """(line mask at the working scale, factor back to input pixels)."""
    lab, (region,), px, back = working_scale(lab, [region], px_per_mm)
    edge = max(round(config.LINES_EDGE_MM * px), 1)
    inner = ndimage.binary_erosion(region, iterations=edge)  # hair / outline edges
    if not inner.any():
        return inner, back
    ridge = sato(
        lab[..., 0].astype(np.float64),
        sigmas=[m * px for m in config.LINES_SIGMAS_MM],
        black_ridges=True,
    )
    cand = (ridge > config.LINES_MIN_RIDGE) & inner
    near_mark = np.zeros_like(cand)
    yy, xx = np.ogrid[: cand.shape[0], : cand.shape[1]]
    for m in marks:
        r = m.radius / back + 0.5 * px
        near_mark |= (yy - m.y / back) ** 2 + (xx - m.x / back) ** 2 <= r * r
    n, labels, _, _ = cv2.connectedComponentsWithStats(cand.astype(np.uint8), connectivity=8)
    keep = np.zeros_like(cand)
    for k in range(1, n):
        piece = labels == k
        ys, xs = np.nonzero(piece)
        if len(xs) < 5 or near_mark[piece].mean() > 0.3:
            continue
        ev = np.linalg.eigvalsh(np.cov(np.vstack([xs, ys])))
        length = 4 * np.sqrt(max(ev[1], 1e-9))  # long axis of the piece
        if (
            length >= config.LINES_MIN_LENGTH_MM * px
            and np.sqrt(ev[1] / max(ev[0], 1e-9)) >= config.LINES_MIN_ELONGATION
            and len(xs) / length <= config.LINES_MAX_WIDTH_MM * px
        ):
            keep |= piece
    return keep, back


def lines(
    lab: np.ndarray,
    regions: dict[str, np.ndarray],
    marks: list,
    px_per_mm: float,
    expression: dict[str, float],
) -> tuple[float | None, dict]:
    """regions: 'forehead', 'right_crows_feet', ... -> skin mask over lab. Value = mean
    line density (% of region skin) over the measured regions; extras per group (None when
    skipped or too small). None when no region could be measured."""
    min_px = config.LINES_MIN_MM2 * px_per_mm**2
    groups: dict[str, list[float]] = {g: [] for g in GATES}
    skipped = []
    for name, mask in regions.items():
        group = next(g for g in GATES if name.endswith(g))
        scores, limit = GATES[group]
        if max(expression.get(e, 0.0) for e in scores) > getattr(config, limit):
            skipped.append(group)
            continue
        if mask.sum() < min_px:
            continue
        line, _ = line_pixels(lab, mask, marks, px_per_mm)
        small = cv2.resize(
            mask.astype(np.uint8), line.shape[::-1], interpolation=cv2.INTER_NEAREST
        ).astype(bool)
        groups[group].append(100.0 * float(line[small].mean()) if small.any() else 0.0)
    per = {g: (round(float(np.mean(v)), 2) if v else None) for g, v in groups.items()}
    measured = [v for v in per.values() if v is not None]
    extras = {f"{g}_pct": v for g, v in per.items()}
    extras["skipped_for_expression"] = sorted(set(skipped))
    return (float(np.mean(measured)) if measured else None), extras
