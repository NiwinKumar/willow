"""pores (docs/METRICS.md A5): small round dark blobs
0.05-0.3 mm across in a close-up, found with a Laplacian-of-Gaussian blob search on the
darkness below this person's own skin nearby. Thresholds are relative to the person's skin
texture, never an absolute L*. Value = pores per cm2 of skin; extras mean diameter (mm)."""

from dataclasses import dataclass

import cv2
import numpy as np
from scipy.spatial import cKDTree

from app import config
from app.metrics.blemish import _local_mean, robust_spread
from app.metrics.blobs import blob_log_fast


@dataclass
class Pore:
    x: float  # input pixels
    y: float
    diameter_mm: float
    dark_l: float  # L* darker than the skin nearby


def _to_work(img: np.ndarray, px_per_mm: float, interp=cv2.INTER_AREA):
    scale = min(config.MACRO_WORK_PX_PER_MM / px_per_mm, 1.0)
    if scale == 1.0:
        return img, px_per_mm, 1.0
    h, w = img.shape[:2]
    size = (max(round(w * scale), 1), max(round(h * scale), 1))
    return cv2.resize(img, size, interpolation=interp), px_per_mm * scale, 1.0 / scale


def _drop_chains(pores: list[Pore], px_per_mm: float) -> list[Pore]:
    """Pores in a straight row are a hair or a crease, not pores: drop every pore whose
    neighbours within PORE_CHAIN_MM are PORE_CHAIN_MIN or more and lie along a line."""
    if len(pores) < config.PORE_CHAIN_MIN + 1:
        return pores
    xy = np.array([(p.x, p.y) for p in pores])
    reach = config.PORE_CHAIN_MM * px_per_mm
    drop = np.zeros(len(pores), bool)
    # neighbours from a k-d tree (a distance to every pore from every pore was thousands
    # squared), then the exact test below on those few, in index order
    tree = cKDTree(xy)
    for i, cand in enumerate(tree.query_ball_point(xy, reach * (1 + 1e-9) + 1e-9)):
        if len(cand) < config.PORE_CHAIN_MIN + 1:
            continue
        cand = np.sort(np.asarray(cand, dtype=np.intp))
        idx = cand[np.hypot(*(xy[cand] - xy[i]).T) <= reach]
        if len(idx) < config.PORE_CHAIN_MIN + 1:
            continue
        ev = np.linalg.eigvalsh(np.cov(xy[idx].T))
        if ev[1] > config.PORE_CHAIN_ELONGATION**2 * max(ev[0], 1e-9):
            drop[idx] = True
    return [p for p, d in zip(pores, drop, strict=True) if not d]


def _disk_means(
    maps: list[np.ndarray], skin: np.ndarray, ys: np.ndarray, xs: np.ndarray, radii: list
) -> tuple[list[np.ndarray], np.ndarray]:
    """Per blob (centre ys, xs; radius radii): the mean of each map over the skin pixels of
    its disk (pixel centres within the radius, as `(dy**2 + dx**2) <= r * r`), and how many
    there are. Blobs come in a few radii (one per blob-search scale): each radius's disk
    offsets are gathered for all its blobs at once."""
    n = len(ys)
    sums = [np.zeros(n) for _ in maps]
    count = np.zeros(n)
    if n == 0:
        return sums, count
    pad = int(np.ceil(max(radii)))
    sk = np.pad(skin, pad).astype(np.float64)
    vals = [np.pad(np.where(skin, m, 0), pad).astype(np.float64) for m in maps]
    groups: dict[float, list[int]] = {}
    for i, r in enumerate(radii):
        groups.setdefault(float(r), []).append(i)
    for idx in groups.values():
        r = radii[idx[0]]  # the radius as the blob search gave it (r * r in its own type)
        ri = int(np.ceil(r))
        dy, dx = np.mgrid[-ri : ri + 1, -ri : ri + 1]
        inside = dy**2 + dx**2 <= r * r
        dy, dx = dy[inside], dx[inside]
        sel = np.asarray(idx)
        rows = ys[sel, None] + pad + dy
        cols = xs[sel, None] + pad + dx
        count[sel] = sk[rows, cols].sum(axis=1)
        for v, total in zip(vals, sums, strict=True):
            total[sel] = v[rows, cols].sum(axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        return [t / count for t in sums], count


def find_pores(
    lab: np.ndarray, skin: np.ndarray, px_per_mm: float, marks: list | None = None
) -> list[Pore]:
    """Pores in `skin`, away from `marks` (blemishes / dark spots with x, y, radius in the
    input's pixels: a pimple's or mark's edge is not a pore)."""
    lab, px, back = _to_work(lab.astype(np.float32), px_per_mm)
    skin = cv2.resize(skin.astype(np.uint8), lab.shape[1::-1], interpolation=cv2.INTER_NEAREST) > 0
    L = lab[..., 0]
    sigma_bg = config.PORE_BACKGROUND_MM * px
    l_bg = _local_mean(L, skin, sigma_bg)
    darker = np.where(skin, l_bg - L, 0).astype(np.float32)
    spread = robust_spread(darker[skin])
    z = np.clip(darker / spread, 0, None)
    r_min, r_max = (d * px / 2 for d in config.PORE_DIAMETER_MM)
    blobs = blob_log_fast(
        z / 10,
        min_sigma=max(r_min / 1.414, 0.5),
        max_sigma=r_max / 1.414,
        num_sigma=6,
        threshold=config.PORE_MIN_SCORE / 10 * 0.5,
        overlap=0.3,
    )
    # away from the skin's edge: a nostril rim, lid or hairline edge is a row of dark dots
    edge = max(round(config.PORE_EDGE_MM * px), 2)
    inner = cv2.erode(skin.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=edge) > 0
    keep = [(int(y), int(x), max(s * 1.414, 1.0)) for y, x, s in blobs]
    keep = [b for b in keep if inner[b[0], b[1]]]
    ys = np.array([b[0] for b in keep], np.intp)
    xs = np.array([b[1] for b in keep], np.intp)
    radii = [b[2] for b in keep]
    # mean darkness score over the skin of each blob's disk (pores are thousands: all at once)
    (score, dark), n = _disk_means([z, darker], skin, ys, xs, radii)
    ok = (n > 0) & (score >= config.PORE_MIN_SCORE)
    # away from marks (a pimple's or mark's edge is not a pore)
    px_x, px_y = xs * back, ys * back
    for m in marks or []:
        reach = m.radius + config.PORE_MARK_GAP_MM * px_per_mm
        ok &= np.hypot(px_x - m.x, px_y - m.y) > reach
    out = [
        Pore(
            x=float(x * back),
            y=float(y * back),
            diameter_mm=float(2 * r / px),
            dark_l=float(d),
        )
        for y, x, r, d, good in zip(ys.tolist(), xs.tolist(), radii, dark, ok, strict=True)
        if good
    ]
    return _drop_chains(out, px_per_mm)


def pores_per_cm2(pores: list[Pore], skin_px: int, px_per_mm: float) -> tuple[float | None, dict]:
    area_cm2 = skin_px / px_per_mm**2 / 100.0
    if area_cm2 < config.MACRO_MIN_SKIN_CM2:
        return None, {}
    mean_d = float(np.mean([p.diameter_mm for p in pores])) if pores else 0.0
    return len(pores) / area_cm2, {"mean_diameter_mm": round(mean_d, 3), "count": len(pores)}
