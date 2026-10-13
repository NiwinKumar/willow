"""Per-frame quality checks on the skin ROI (docs/CONTRACT.md 2.3)."""

from dataclasses import dataclass, field

import cv2
import numpy as np

from app import config


@dataclass
class FrameQuality:
    sharpness: float
    clipped_pct: float
    dark_pct: float
    reasons: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.reasons


def laplacian_variance(grey: np.ndarray) -> float:
    """Sharpness: variance of the 4-neighbour Laplacian. Blur smooths edges -> low variance."""
    g = grey.astype(np.float64)
    lap = -4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    return float(lap.var())


def check_frame(
    linear_roi: np.ndarray, srgb8_roi: np.ndarray, px_per_mm: float | None = None
) -> FrameQuality:
    """Exposure and sharpness gates. With px_per_mm (faces), sharpness is measured at a fixed
    scale so phones with different resolution and noise reduction are judged the same."""
    peak = linear_roi.max(axis=-1)
    grey = srgb8_roi.mean(axis=-1).astype(np.float32)
    threshold = config.SHARPNESS_MIN
    if px_per_mm:
        scale = min(config.SHARPNESS_PX_PER_MM / px_per_mm, 1.0)
        grey = cv2.resize(grey, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        threshold = config.FACE_SHARPNESS_MIN
    q = FrameQuality(
        sharpness=laplacian_variance(grey),
        clipped_pct=float(np.mean(peak >= config.CLIP_LEVEL) * 100),
        dark_pct=float(np.mean(peak <= config.DARK_LEVEL) * 100),
    )
    if q.sharpness < threshold:
        q.reasons.append("blurry")
    if q.clipped_pct > config.CLIPPED_PCT_MAX:
        q.reasons.append("overexposed")
    if q.dark_pct > config.DARK_PCT_MAX:
        q.reasons.append("underexposed")
    return q
