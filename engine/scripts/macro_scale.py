"""Measure the close-up scale once: photograph a mm ruler the same way as a skin close-up
(same phone, macro mode, same distance or cone), ruler across the middle of the frame.

Usage (from engine/):  uv run python -m scripts.macro_scale ../data/<ruler>.(heic|jpg)
Finds the 1 mm tick spacing (the strongest repeat along either axis) and prints the
MACRO_FIELD_WIDTH_MM to put in app/config.py (then set MACRO_SCALE_CALIBRATED = True).
"""

import sys

import cv2
import numpy as np

from app.decode import load_photo_srgb8

MIN_PERIOD_PX = 4  # a tick period below this cannot be resolved


def tick_period_px(grey: np.ndarray) -> tuple[float, float]:
    """(period in px, peak strength) of the strongest repeat along x or y, middle half only."""
    h, w = grey.shape
    centre = grey[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4].astype(np.float64)
    best = (0.0, 0.0)
    for axis in (0, 1):  # profile along x (vertical ticks), then along y
        profile = centre.mean(axis=axis)
        profile = profile - cv2.GaussianBlur(profile.reshape(1, -1), (0, 0), 20).ravel()
        spec = np.abs(np.fft.rfft(profile * np.hanning(profile.size)))
        n = profile.size
        lo, hi = 3, n // MIN_PERIOD_PX  # at least 3 ticks in view
        k = lo + int(np.argmax(spec[lo:hi]))
        a, b, c = spec[k - 1], spec[k], spec[k + 1]  # parabolic peak refinement
        k_fine = k + 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else k
        strength = b / max(np.median(spec[lo:hi]), 1e-9)
        if strength > best[1]:
            best = (n / k_fine, strength)
    return best


def main(path: str) -> None:
    srgb8, _ = load_photo_srgb8(path)
    grey = cv2.cvtColor(srgb8, cv2.COLOR_RGB2GRAY)
    period, strength = tick_period_px(grey)
    long_edge = max(grey.shape)
    print(f"photo         {grey.shape[1]} x {grey.shape[0]} px")
    print(f"tick period   {period:.2f} px  (peak {strength:.0f}x the background)")
    if strength < 5:
        print("weak repeat: is the ruler sharp and across the middle of the frame?")
    print(f"scale         {period:.1f} px/mm")
    print(f"MACRO_FIELD_WIDTH_MM = {long_edge / period:.1f}")


if __name__ == "__main__":
    main(sys.argv[1])
