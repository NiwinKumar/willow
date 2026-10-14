"""dark_circles (docs/METRICS.md B1): how much darker the under-eye skin is than the same
person's cheek on the same side, in L*. Relative to the person's own cheek, so it works
at every skin tone. Negative = darker under-eye. It is appearance (pigment, thin skin and
shadow together), as the eye sees it in that photo; it does not separate the causes."""

import numpy as np

from app.metrics.evenness import melanin_index

SIDES = ("right", "left")


def dark_circles(
    lab: np.ndarray, linear: np.ndarray, skin: dict[str, np.ndarray], min_px: int
) -> tuple[float | None, dict]:
    """skin: ROI name -> skin mask (same frame as lab / linear). Uses every side where both
    the under-eye and the cheek have at least min_px skin pixels; averages the sides.
    Returns (delta L*, extras) or (None, {}) when no side is usable."""
    mi = melanin_index(linear[..., 0])
    d_l, d_a, d_mi = [], [], []
    for side in SIDES:
        eye, cheek = skin.get(f"{side}_under_eye"), skin.get(f"{side}_cheek")
        if eye is None or cheek is None or eye.sum() < min_px or cheek.sum() < min_px:
            continue
        d_l.append(float(np.median(lab[..., 0][eye]) - np.median(lab[..., 0][cheek])))
        d_a.append(float(np.median(lab[..., 1][eye]) - np.median(lab[..., 1][cheek])))
        d_mi.append(float(np.median(mi[eye]) - np.median(mi[cheek])))
    if not d_l:
        return None, {}
    extras = {
        "delta_a_star": round(float(np.mean(d_a)), 2),
        "delta_melanin_proxy": round(float(np.mean(d_mi)), 2),
        "sides": len(d_l),
    }
    return float(np.mean(d_l)), extras
