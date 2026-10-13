"""tone_ita: Individual Typology Angle (docs/METRICS.md A1). Descriptive, never a score."""

import math

import numpy as np

from app import config


def ita_degrees(l_star: float, b_star: float) -> float:
    """ITA = atan2(L* - 50, b*) in degrees."""
    return math.degrees(math.atan2(l_star - 50.0, b_star))


def ita_band(ita: float) -> str:
    return next(name for lower, name in config.ITA_BANDS if ita > lower)


def tone_ita(lab: np.ndarray, mask: np.ndarray) -> tuple[float, dict]:
    """Median L* and b* over skin pixels (medians resist stray hairs/freckles), then ITA."""
    l_star = float(np.median(lab[..., 0][mask]))
    b_star = float(np.median(lab[..., 2][mask]))
    ita = ita_degrees(l_star, b_star)
    return ita, {"l_star": round(l_star, 2), "b_star": round(b_star, 2), "ita_band": ita_band(ita)}
