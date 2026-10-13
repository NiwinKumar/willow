from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.decode import decode_dng, decode_photo, srgb_to_linear

GOLDEN = Path(__file__).resolve().parents[2] / "data" / "golden"
DNGS = sorted(GOLDEN.glob("*.dng")) + sorted(GOLDEN.glob("*.DNG")) if GOLDEN.exists() else []


@pytest.mark.skipif(not DNGS, reason="no real DNG in data/golden/ (kept out of git)")
def test_golden_dng_decodes_to_linear_rgb():
    rgb, info = decode_dng(DNGS[0])
    assert rgb.ndim == 3 and rgb.shape[2] == 3
    assert 0.0 <= rgb.min() and rgb.max() <= 1.0
    assert info.white_level > max(info.black_levels)


def test_srgb_to_linear_known_values():
    lin = srgb_to_linear(np.array([0, 10, 128, 255], dtype=np.uint8))
    assert lin[0] == 0.0 and lin[3] == pytest.approx(1.0)
    assert lin[1] == pytest.approx(10 / 255 / 12.92)  # straight-line part of the curve
    assert lin[2] == pytest.approx(0.2158, abs=1e-4)  # mid-grey is ~22% of the light


def test_decode_photo_jpeg_applies_exif_rotation(tmp_path):
    # 40x20 landscape image stored with "rotate 90" EXIF -> should come back 20x40 portrait
    img = Image.new("RGB", (40, 20), (200, 150, 120))
    exif = Image.Exif()
    exif[0x0112] = 6
    path = tmp_path / "frame.jpg"
    img.save(path, quality=95, exif=exif)
    linear, info = decode_photo(path)
    assert linear.shape == (40, 20, 3) and info.size == (20, 40)
    assert linear.dtype == np.float32 and 0.0 <= linear.min() <= linear.max() <= 1.0
    assert info.format == "JPEG"
