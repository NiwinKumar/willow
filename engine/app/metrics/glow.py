"""glow (docs/METRICS.md C3): a change-only composite on the visible cheeks: brightness
(median L*), colour richness (median chroma) and smoothness (low fine-scale L* texture).
Never compared between people: only the person's own change from their baseline means
anything (a lighter person does not "glow more"). Shine highlights are left out (shine
has its own metric). Indicative; the parts are in extras so the app can say which moved."""

import cv2
import numpy as np

from app import config
from app.metrics.shine import specular


def glow(
    lab: np.ndarray, linear: np.ndarray, cheeks: np.ndarray, px_per_mm: float
) -> tuple[float | None, dict]:
    if cheeks.sum() < config.GLOW_MIN_MM2 * px_per_mm**2:
        return None, {}
    hi = specular(lab, linear, cheeks, px_per_mm)
    skin = cheeks & ~hi
    L = lab[..., 0].astype(np.float32)
    L = np.where(hi, np.median(L[skin]), L)  # so the texture blur does not spread a glint
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    # fine texture: L* minus its ~0.5 mm blur (pores, roughness), SD over the cheek skin
    fine = L - cv2.GaussianBlur(L, (0, 0), config.GLOW_TEXTURE_MM * px_per_mm)
    l_star = float(np.median(L[skin]))
    c_star = float(np.median(chroma[skin]))
    texture = float(np.std(fine[skin]))
    value = l_star + c_star - config.GLOW_TEXTURE_WEIGHT * texture
    return value, {
        "l_star": round(l_star, 2),
        "chroma": round(c_star, 2),
        "fine_texture": round(texture, 3),
    }
