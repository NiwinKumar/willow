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


def test_linear_srgb_roundtrip():
    from app.decode import linear_to_srgb8

    values = np.arange(256, dtype=np.uint8)
    assert np.array_equal(linear_to_srgb8(srgb_to_linear(values)), values)


def test_capture_mode_from_file_types():
    from app.pipeline import capture_mode_for

    assert capture_mode_for(["a.DNG", "b.dng"]) == "calibrated_raw"
    assert capture_mode_for(["a.heic", "b.jpg"]) == "uncalibrated"
    with pytest.raises(ValueError):
        capture_mode_for(["a.dng", "b.jpg"])


def test_apple_focus_reads_the_maker_note_and_ignores_others():
    from app.decode import apple_focus

    entry = (0x002F).to_bytes(2, "big") + (9).to_bytes(2, "big") + (1).to_bytes(4, "big")
    note = b"Apple iOS\x00\x00\x01MM" + (1).to_bytes(2, "big") + entry + (165).to_bytes(4, "big")
    assert apple_focus(note) == (165, None)
    assert apple_focus(b"Nikon\x00" + bytes(40)) == (None, None)
    assert apple_focus(b"Apple iOS\x00\x00\x01MM\x00\x05") == (None, None)  # cut short
