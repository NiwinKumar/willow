"""Redness overlay (docs/CONTRACT.md 2.2 `overlays`, engine 0.3.4): an RGBA PNG the web lays
over preview.jpg, pixel for pixel, showing where on the measured skin the camera sees more red
than this person's own skin median. Descriptive and cosmetic: no scale shared between people,
no number, no diagnosis; the redness metric itself is computed elsewhere and does not change.

Two steps so the expensive part runs on small arrays:
- `to_preview` (per photo, while its Lab image is alive): area-average a* over the skin onto
  the preview.jpg grid;
- `redness_rgba` (reference photo only): smooth, take the robust range, colour.
"""

from functools import lru_cache

import cv2
import numpy as np

from app import config
from app.io import preview_size

EPS = 1e-6


def to_preview(
    values: np.ndarray,
    mask: np.ndarray,
    photo_shape: tuple[int, int],
    origin: tuple[float, float] = (0.0, 0.0),
    scale: tuple[float, float] = (1.0, 1.0),
) -> dict:
    """Resample a per-pixel map from a working grid onto the preview.jpg grid of the photo.

    A working pixel u maps to photo pixel x = origin + (u + 0.5) / scale - 0.5 (a crop of the
    photo: origin = its corner, scale 1; a shrunk photo: origin 0, scale = working / photo
    width), the same pixel-centre rule cv2.resize uses for preview.jpg. Returns the preview-
    sized sums of value*mask and of mask: their ratio is the mean value over skin, the mask
    sum is how much of each preview pixel is skin (0 outside it, so no colour bleeds out).
    """
    h, w = photo_shape
    pw, ph = preview_size(h, w)
    sx, sy = pw / w, ph / h
    m = mask.astype(np.float32)
    num = np.where(mask, values, 0).astype(np.float32)
    src_h, src_w = mask.shape
    rx, ry = sx / scale[0], sy / scale[1]
    if rx < 1 or ry < 1:  # area-average down first: the warp below then works at about 1:1
        nw, nh = max(round(src_w * min(rx, 1)), 1), max(round(src_h * min(ry, 1)), 1)
        num = cv2.resize(num, (nw, nh), interpolation=cv2.INTER_AREA)
        m = cv2.resize(m, (nw, nh), interpolation=cv2.INTER_AREA)
        scale = (scale[0] * nw / src_w, scale[1] * nh / src_h)
    # preview x' = (x + 0.5) * sx - 0.5 with x as above
    warp = np.float32(
        [
            [sx / scale[0], 0, (origin[0] + 0.5 / scale[0]) * sx - 0.5],
            [0, sy / scale[1], (origin[1] + 0.5 / scale[1]) * sy - 0.5],
        ]
    )

    def put(a: np.ndarray) -> np.ndarray:
        return cv2.warpAffine(
            a, warp, (pw, ph), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT
        )

    return {"num": put(num), "den": put(m), "preview_scale": sx}


@lru_cache(maxsize=1)
def _ramp() -> np.ndarray:
    """(256, 3) uint8 RGB: OVERLAY_RAMP_LAB interpolated evenly in CIELAB."""
    anchors = np.asarray(config.OVERLAY_RAMP_LAB, np.float32)
    t = np.linspace(0, len(anchors) - 1, 256)
    lab = np.stack([np.interp(t, np.arange(len(anchors)), anchors[:, i]) for i in range(3)], -1)
    rgb = cv2.cvtColor(lab.astype(np.float32)[None], cv2.COLOR_Lab2RGB)[0]  # float 0..1
    return np.clip(np.round(rgb * 255), 0, 255).astype(np.uint8)


def redness_rgba(a_star: dict, px_per_mm: float) -> np.ndarray | None:
    """RGBA uint8 at the preview size from `to_preview` output of a* (px_per_mm: the photo's
    scale). Clear (alpha 0) outside the skin; on it, the colour and opacity rise from the
    skin's own median a* to its OVERLAY_HIGH_PCT percentile (at least OVERLAY_MIN_SPAN_A).
    None when there is no skin to draw."""
    num, den = a_star["num"], a_star["den"]
    skin = den >= 0.5
    if not skin.any():
        return None
    sigma = config.OVERLAY_SMOOTH_MM * px_per_mm * a_star["preview_scale"]
    if sigma >= 0.5:  # normalised blur: smooths within the skin, no colour from outside it
        num_s = cv2.GaussianBlur(num, (0, 0), sigma)
        den_s = cv2.GaussianBlur(den, (0, 0), sigma)
    else:
        num_s, den_s = num, den
    a = num_s / np.maximum(den_s, EPS)
    lo = float(np.median(a[skin]))  # this person's own skin, this photo
    hi = max(float(np.percentile(a[skin], config.OVERLAY_HIGH_PCT)), lo + config.OVERLAY_MIN_SPAN_A)
    t = np.clip((a - lo) / (hi - lo), 0.0, 1.0)
    idx = np.round(t * 255).astype(np.uint8)
    rgba = np.empty((*a.shape, 4), np.uint8)
    rgba[..., :3] = _ramp()[idx]
    a0, a1 = config.OVERLAY_ALPHA
    # feathered inside the skin edge (no hard ROI outline); exactly 0 where there is no skin
    cover = np.clip(den, 0.0, 1.0) * np.clip((den_s - 0.25) / 0.5, 0.0, 1.0)
    alpha = (a0 + (a1 - a0) * t) * cover * 255
    alpha[den < 1e-3] = 0
    rgba[..., 3] = np.round(alpha).astype(np.uint8)
    return rgba
