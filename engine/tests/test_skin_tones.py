"""The forearm pipeline must work the same from very light to very dark skin (CLAUDE.md rule 3)."""

import numpy as np
import pytest
from PIL import Image

from app.color import linear_srgb_to_lab
from app.config import WHITE_REF_TARGET
from app.decode import srgb_to_linear
from app.markers import find_dot_squares
from app.metrics.tone import ita_band, ita_degrees
from app.pipeline import analyze_forearm

PEN = (30, 28, 35)  # dark pen
WHITE_MARKER = (225, 220, 215)  # light marker, for skin where a dark pen barely shows
PAPER = (235, 235, 235)

# Rough sRGB skin colours spanning all ITA bands (very light -> very dark).
TONES = {
    "very_light": ((244, 214, 196), PEN),
    "light": ((232, 190, 160), PEN),
    "intermediate": ((198, 148, 115), PEN),
    "tan": ((170, 120, 85), PEN),
    "brown": ((120, 80, 55), PEN),
    "dark": ((80, 55, 40), PEN),
    "very_dark": ((55, 38, 30), WHITE_MARKER),
}


def _arm_photo(path, skin, ink, seed=0):
    """Skin with fine texture, paper strips on both sides, two dotted squares."""
    rng = np.random.default_rng(seed)
    img = np.empty((1600, 1200, 3), np.float64)
    img[:] = skin
    img += rng.normal(0, 4, (1600, 1200, 1))  # fine skin texture so the photo counts as sharp
    img[:, :250] = PAPER
    img[:, 950:] = PAPER
    yy, xx = np.ogrid[:1600, :1200]
    for x0, y0 in [(500, 450), (500, 950)]:  # two 200 px squares, one above the other
        for cx, cy in [(x0, y0), (x0 + 200, y0), (x0, y0 + 200), (x0 + 200, y0 + 200)]:
            img[(xx - cx) ** 2 + (yy - cy) ** 2 <= 14**2] = ink
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path, quality=95)


def _expected_ita(skin) -> float:
    """ITA of the skin colour after the same white-paper scaling the engine applies."""
    gain = WHITE_REF_TARGET / srgb_to_linear(np.array(PAPER[:1], np.uint8))[0]
    lab = linear_srgb_to_lab(srgb_to_linear(np.array(skin, np.uint8)) * gain)
    return ita_degrees(float(lab[0]), float(lab[2]))


@pytest.mark.parametrize("tone", TONES)
def test_both_dot_squares_found_at_every_tone(tmp_path, tone):
    skin, ink = TONES[tone]
    _arm_photo(tmp_path / "a.jpg", skin, ink)
    srgb8 = np.asarray(Image.open(tmp_path / "a.jpg").convert("RGB"))
    (top, _), (bottom, _) = find_dot_squares(srgb8, 2)
    assert abs(top.y + top.h / 2 - 550) < 10 and abs(bottom.y + bottom.h / 2 - 1050) < 10


@pytest.mark.parametrize("tone", TONES)
def test_pipeline_reads_ita_at_every_tone(tmp_path, tone):
    skin, ink = TONES[tone]
    files = []
    for i in range(3):
        _arm_photo(tmp_path / f"f{i}.jpg", skin, ink, seed=i)
        files.append(str(tmp_path / f"f{i}.jpg"))
    result = analyze_forearm(files, "forearm_control", [None] * 3, [None] * 3, square=1)
    assert result["quality"]["passed"], result["quality"]
    ita = next(m for m in result["metrics"] if m["id"] == "tone_ita")
    expected = _expected_ita(skin)
    assert ita["value"] == pytest.approx(expected, abs=1.5)  # JPEG + texture tolerance
    assert ita["extras"]["ita_band"] == ita_band(expected)
    assert ita["within_session_sd"] < 0.5  # identical skin -> tiny spread at every tone
