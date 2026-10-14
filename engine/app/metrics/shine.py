"""shine (docs/METRICS.md C2): share of the T-zone (forehead, nose, chin) that is
specular highlight. A highlight is brighter than this person's skin within a few mm AND
greyer (oil and sweat reflect the light's colour, not the skin's), or clipped white.
Relative to the person's own skin, so it holds at every tone. Indicative: it depends on
the light and on how long after washing the photo is taken. Broad even sheen with no
local highlight is not counted."""

import cv2
import numpy as np

from app import config
from app.landmarks import _local_mean


def specular(lab: np.ndarray, linear: np.ndarray, skin: np.ndarray, px_per_mm: float) -> np.ndarray:
    """Highlight pixels inside `skin`."""
    L = lab[..., 0]
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    clipped = linear.max(axis=-1) >= config.CLIP_LEVEL
    # "skin around it" = local median over SHINE_WINDOW_MM: a median ignores a shiny patch
    # that covers less than half the window (a mean is pulled up by it). Non-skin pixels
    # (hair, eyes) are filled with the nearby skin mean first so they do not drag it.
    k = max(round(config.SHINE_WINDOW_MM * px_per_mm) | 1, 3)
    fill = 4 * px_per_mm
    background = []
    for v, scale in ((L, 2.55), (chroma, 2.0)):
        filled = np.where(skin, v, _local_mean(v, skin, fill))
        q = np.clip(filled * scale, 0, 255).astype(np.uint8)
        background.append(cv2.medianBlur(q, min(k, 255)).astype(np.float32) / scale)
    brighter = L > background[0] + config.SHINE_DELTA_L
    greyer = chroma < config.SHINE_CHROMA_FRAC * background[1]
    hi = skin & ((brighter & greyer) | clipped)
    return hi


def shine(
    lab: np.ndarray,
    linear: np.ndarray,
    t_zone: np.ndarray,
    u_zone: np.ndarray,
    px_per_mm: float,
) -> tuple[float | None, dict]:
    """Value = % of T-zone skin that is highlight; extras the U-zone (cheeks) share."""
    if t_zone.sum() < config.SHINE_MIN_MM2 * px_per_mm**2:
        return None, {}
    hi = specular(lab, linear, t_zone | u_zone, px_per_mm)
    t = 100.0 * float(hi[t_zone].mean())
    u = 100.0 * float(hi[u_zone].mean()) if u_zone.any() else None
    return t, {"t_zone_pct": round(t, 2), "u_zone_pct": None if u is None else round(u, 2)}
