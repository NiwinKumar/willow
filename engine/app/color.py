"""White balance and colour-space conversion (linear sRGB -> CIELAB D65)."""

import warnings

import numpy as np

with warnings.catch_warnings():  # colour-science warns about optional plotting libs we don't use
    warnings.simplefilter("ignore")
    import colour

from app import config


def white_balance(linear: np.ndarray, white_roi: np.ndarray) -> np.ndarray:
    """Scale R, G, B so the white paper always comes out the same neutral white.

    The paper is white, so any tint or dimness it shows comes from the lamp; dividing it out
    removes that from the skin too. This corrects both lamp colour and lamp brightness, so
    sessions are comparable as long as the same kind of paper is used.
    """
    ref = np.median(white_roi.reshape(-1, 3), axis=0)
    if ref.min() < config.WHITE_REF_MIN_LINEAR or ref.max() >= config.CLIP_LEVEL:
        raise ValueError(f"white reference unusable (too dark or clipped): {ref.round(3)}")
    gains = config.WHITE_REF_TARGET / ref
    return np.clip(linear * gains, 0.0, 1.0).astype(np.float32)


def linear_srgb_to_lab(linear: np.ndarray) -> np.ndarray:
    """Linear sRGB (D65) -> XYZ -> CIELAB (D65). Shape (..., 3) in, (..., 3) out."""
    xyz = colour.RGB_to_XYZ(linear, "sRGB", apply_cctf_decoding=False)
    return colour.XYZ_to_Lab(xyz).astype(np.float32)
