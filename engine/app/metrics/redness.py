"""redness: mean a* plus erythema index (docs/METRICS.md A2)."""

import numpy as np

EPS = 1e-6  # avoids log(0) on black pixels


def erythema_index(linear: np.ndarray, mask: np.ndarray) -> float:
    """EI = 100 * (log10(1/G) - log10(1/R)) = 100 * log10(R/G), averaged over skin pixels.

    Blood absorbs green light much more than red, so redder skin -> higher R/G.
    """
    r = linear[..., 0][mask] + EPS
    g = linear[..., 1][mask] + EPS
    return float(np.mean(100.0 * np.log10(r / g)))


def redness(lab: np.ndarray, linear: np.ndarray, mask: np.ndarray) -> tuple[float, dict]:
    # median, not mean: hairs and pen ink inside the square pull a mean, not a median
    a_star = float(np.median(lab[..., 1][mask]))
    return a_star, {"erythema_index": round(erythema_index(linear, mask), 2)}
