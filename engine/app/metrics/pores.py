"""pores (docs/METRICS.md A5) and blackheads (B2, nose close-up): small round dark blobs
0.05-0.3 mm across in a close-up, found with a Laplacian-of-Gaussian blob search on the
darkness below this person's own skin nearby. Thresholds are relative to the person's skin
texture, never an absolute L*. Value = pores per cm2 of skin; extras mean diameter (mm).
A blackhead is a pore that is much darker AND greyer than the skin around it (an open
comedone's oxidised plug), at least BLACKHEAD_MIN_DIAMETER_MM across."""

from dataclasses import dataclass

import cv2
import numpy as np
from skimage.feature import blob_log

from app import config
from app.metrics.blemish import _local_mean, robust_spread


@dataclass
class Pore:
    x: float  # input pixels
    y: float
    diameter_mm: float
    dark_l: float  # L* darker than the skin nearby
    chroma_ratio: float  # chroma / chroma of the skin nearby (1 = same colour)


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
    for i in range(len(pores)):
        near = np.hypot(*(xy - xy[i]).T) <= reach
        if near.sum() < config.PORE_CHAIN_MIN + 1:
            continue
        ev = np.linalg.eigvalsh(np.cov(xy[near].T))
        if ev[1] > config.PORE_CHAIN_ELONGATION**2 * max(ev[0], 1e-9):
            drop |= near
    return [p for p, d in zip(pores, drop, strict=True) if not d]


def find_pores(
    lab: np.ndarray, skin: np.ndarray, px_per_mm: float, marks: list | None = None
) -> list[Pore]:
    """Pores in `skin`, away from `marks` (blemishes / dark spots with x, y, radius in the
    input's pixels: a pimple's or mark's edge is not a pore)."""
    lab, px, back = _to_work(lab.astype(np.float32), px_per_mm)
    skin = cv2.resize(skin.astype(np.uint8), lab.shape[1::-1], interpolation=cv2.INTER_NEAREST) > 0
    L = lab[..., 0]
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    sigma_bg = config.PORE_BACKGROUND_MM * px
    l_bg = _local_mean(L, skin, sigma_bg)
    c_bg = _local_mean(chroma, skin, sigma_bg)
    darker = np.where(skin, l_bg - L, 0).astype(np.float32)
    spread = robust_spread(darker[skin])
    z = np.clip(darker / spread, 0, None)
    r_min, r_max = (d * px / 2 for d in config.PORE_DIAMETER_MM)
    blobs = blob_log(
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
    yy, xx = np.ogrid[: L.shape[0], : L.shape[1]]
    out = []
    for y, x, s in blobs:
        y, x = int(y), int(x)
        if not inner[y, x]:
            continue
        r = max(s * 1.414, 1.0)
        disk = ((yy - y) ** 2 + (xx - x) ** 2 <= r * r) & skin
        if not disk.any() or float(z[disk].mean()) < config.PORE_MIN_SCORE:
            continue
        out.append(
            Pore(
                x=float(x * back),
                y=float(y * back),
                diameter_mm=float(2 * r / px),
                dark_l=float(darker[disk].mean()),
                chroma_ratio=float(chroma[disk].mean() / max(c_bg[y, x], 1e-6)),
            )
        )
    for m in marks or []:
        reach = m.radius + config.PORE_MARK_GAP_MM * px_per_mm
        out = [p for p in out if np.hypot(p.x - m.x, p.y - m.y) > reach]
    return _drop_chains(out, px_per_mm)


def pores_per_cm2(pores: list[Pore], skin_px: int, px_per_mm: float) -> tuple[float | None, dict]:
    area_cm2 = skin_px / px_per_mm**2 / 100.0
    if area_cm2 < config.MACRO_MIN_SKIN_CM2:
        return None, {}
    mean_d = float(np.mean([p.diameter_mm for p in pores])) if pores else 0.0
    return len(pores) / area_cm2, {"mean_diameter_mm": round(mean_d, 3), "count": len(pores)}


def blackheads(pores: list[Pore]) -> int:
    return sum(
        p.dark_l >= config.BLACKHEAD_MIN_DL
        and p.chroma_ratio <= config.BLACKHEAD_MAX_CHROMA_RATIO
        and p.diameter_mm >= config.BLACKHEAD_MIN_DIAMETER_MM
        for p in pores
    )
