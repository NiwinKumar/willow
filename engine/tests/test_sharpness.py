"""Face sharpness gate: judged by blur in millimetres, so a soft but usable webcam face
passes and a genuinely smeared one fails at any resolution."""

import cv2
import numpy as np
import pytest

from app.quality import check_frame


def _face_patch(px_per_mm, blur_mm=0.0, seed=0):
    """A 40 mm square of skin-like texture (pores and fine detail about 0.2 mm), as a
    face photo at this resolution, optionally blurred by blur_mm."""
    rng = np.random.default_rng(seed)
    side = round(40 * px_per_mm)
    tex = cv2.GaussianBlur(
        rng.normal(0, 1, (side, side)).astype(np.float32), (0, 0), 0.1 * px_per_mm
    )
    grey = 150 + tex / tex.std() * 6
    if blur_mm:
        grey = cv2.GaussianBlur(grey, (0, 0), blur_mm * px_per_mm)
    srgb8 = np.repeat(np.clip(grey, 0, 255)[..., None], 3, axis=2).astype(np.uint8)
    linear = (srgb8 / 255.0) ** 2.2
    return linear, srgb8


@pytest.mark.parametrize("px_per_mm", [3.2, 6.0])  # laptop webcam, phone selfie
def test_sharp_face_passes_and_smeared_face_fails(px_per_mm):
    sharp = check_frame(*_face_patch(px_per_mm), px_per_mm=px_per_mm)
    soft = check_frame(*_face_patch(px_per_mm, blur_mm=0.15), px_per_mm=px_per_mm)
    smeared = check_frame(*_face_patch(px_per_mm, blur_mm=0.5), px_per_mm=px_per_mm)
    assert "blurry" not in sharp.reasons
    assert "blurry" not in soft.reasons  # slight webcam softness is fine for 1-5 mm spots
    assert "blurry" in smeared.reasons
