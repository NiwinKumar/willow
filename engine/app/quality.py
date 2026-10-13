"""Per-frame quality checks on the skin ROI (docs/CONTRACT.md 2.3)."""

from dataclasses import dataclass, field

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


def check_frame(linear_roi: np.ndarray, srgb8_roi: np.ndarray) -> FrameQuality:
    peak = linear_roi.max(axis=-1)
    q = FrameQuality(
        sharpness=laplacian_variance(srgb8_roi.mean(axis=-1)),
        clipped_pct=float(np.mean(peak >= config.CLIP_LEVEL) * 100),
        dark_pct=float(np.mean(peak <= config.DARK_LEVEL) * 100),
    )
    if q.sharpness < config.SHARPNESS_MIN:
        q.reasons.append("blurry")
    if q.clipped_pct > config.CLIPPED_PCT_MAX:
        q.reasons.append("overexposed")
    if q.dark_pct > config.DARK_PCT_MAX:
        q.reasons.append("underexposed")
    return q
