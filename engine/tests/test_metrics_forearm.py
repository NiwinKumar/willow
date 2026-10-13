import math

import numpy as np
import pytest
from PIL import Image

from app.aggregate import mdc95, summarize
from app.color import linear_srgb_to_lab, white_balance
from app.metrics.redness import erythema_index
from app.metrics.tone import ita_band, ita_degrees
from app.pipeline import analyze_forearm
from app.quality import check_frame
from app.roi import Box

SKIN_SRGB = (190, 140, 110)  # a mid skin tone
TINT = np.array([1.0, 0.85, 0.65])  # warm lamp: less blue and green


def test_ita_known_angles():
    assert ita_degrees(50.0, 20.0) == pytest.approx(0.0)
    assert ita_degrees(70.0, 20.0) == pytest.approx(45.0)
    assert ita_band(45.0) == "light"
    assert ita_band(30.0) == "intermediate"
    assert ita_band(-40.0) == "dark"


def test_erythema_index_ratio():
    mask = np.ones((2, 2), bool)
    equal = np.full((2, 2, 3), 0.4, np.float32)
    assert erythema_index(equal, mask) == pytest.approx(0.0, abs=1e-3)
    red = equal.copy()
    red[..., 1] = 0.04  # R = 10 x G
    assert erythema_index(red, mask) == pytest.approx(100.0, abs=0.1)


def test_white_balance_makes_paper_neutral():
    paper = np.full((10, 10, 3), 0.8, np.float32) * TINT
    balanced = white_balance(paper, paper)
    lab = linear_srgb_to_lab(balanced)
    assert abs(lab[..., 1]).max() < 0.5 and abs(lab[..., 2]).max() < 0.5  # a*, b* ~ 0 = grey


def test_white_balance_rejects_clipped_paper():
    with pytest.raises(ValueError):
        white_balance(np.ones((4, 4, 3), np.float32), np.ones((4, 4, 3), np.float32))


def test_mdc_and_verdicts():
    assert mdc95(1.0) == pytest.approx(1.96 * math.sqrt(2))
    s = summarize([10.0, 11.0, 12.0], {"mean": 8.0, "mdc95": 1.0})
    assert s["value"] == 11.0 and s["delta"] == 3.0
    assert s["verdict"] == "real_change" and s["direction"] == "increase"
    assert summarize([10.0], {"mean": 9.5, "mdc95": 1.0})["verdict"] == "within_noise"
    assert summarize([10.0], None)["verdict"] == "no_baseline"


def test_flat_image_is_blurry():
    flat8 = np.full((50, 50, 3), 128, np.uint8)
    q = check_frame(flat8 / 255.0, flat8)
    assert not q.passed and "blurry" in q.reasons


def _fake_photo(path, rng, tint=None):
    """Skin patch with fine texture (so it is 'sharp') plus a white paper patch."""
    img = np.full((300, 400, 3), 60.0)
    img[50:250, 50:250] = SKIN_SRGB + rng.normal(0, 12, (200, 200, 1))
    img[50:250, 280:380] = 235.0
    if tint is not None:  # apply a lamp tint in linear light, then back to sRGB
        lin = (np.clip(img, 0, 255) / 255.0) ** 2.2 * tint
        img = 255.0 * lin ** (1 / 2.2)
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path, quality=95)


def test_pipeline_forearm_end_to_end(tmp_path):
    rng = np.random.default_rng(0)  # fixed seed: same input -> same output
    files = []
    for i in range(3):
        _fake_photo(tmp_path / f"f{i}.jpg", rng)
        files.append(str(tmp_path / f"f{i}.jpg"))
    skin, paper = Box(70, 70, 160, 160), Box(290, 70, 80, 160)
    result = analyze_forearm(files, "forearm_treated", [skin] * 3, [paper] * 3)  # schema-checked

    assert result["frames_used"] == 3 and result["quality"]["passed"]
    ita = next(m for m in result["metrics"] if m["id"] == "tone_ita")
    assert all(m["confidence"] == "indicative" for m in result["metrics"])
    assert ita["mdc95"] is not None and ita["verdict"] == "no_baseline"
    assert 10 < ita["value"] < 41  # a mid tone lands in the tan/intermediate range


def test_white_paper_cancels_lamp_tint(tmp_path):
    skin, paper = Box(70, 70, 160, 160), Box(290, 70, 80, 160)
    _fake_photo(tmp_path / "plain.jpg", np.random.default_rng(1))
    _fake_photo(tmp_path / "warm.jpg", np.random.default_rng(1), tint=TINT)

    def ita(name, white):
        r = analyze_forearm(
            [str(tmp_path / name)], "forearm_control", [skin], [white], auto_white=white is not None
        )
        return r["metrics"][0]["value"]

    plain = ita("plain.jpg", paper)
    assert abs(ita("warm.jpg", paper) - plain) < 1.5  # corrected: close to the truth
    assert abs(ita("warm.jpg", None) - plain) > 5  # uncorrected: lamp shifts the tone a lot


def _arm_with_dots(squares, decoy=None):
    """Plain skin image with pen-dot squares; optional dark 'table' squares off the skin."""
    img = np.full((1200, 1000, 3), (190, 140, 110), np.uint8)
    rng = np.random.default_rng(2)
    img = np.clip(img + rng.normal(0, 4, img.shape), 0, 255).astype(np.uint8)
    img[:, 850:] = (235, 235, 235)  # paper strip on the right
    yy, xx = np.ogrid[:1200, :1000]
    for x0, y0, side in squares + ([decoy] if decoy else []):
        for cx, cy in [(x0, y0), (x0 + side, y0), (x0, y0 + side), (x0 + side, y0 + side)]:
            img[(xx - cx) ** 2 + (yy - cy) ** 2 <= 12**2] = (40, 35, 35)
    img[100:140, 100:800] = (60, 40, 30)  # a dark stripe (e.g. table edge) must be ignored
    return img


def test_find_dot_square_on_synthetic_arm():
    from app.markers import find_dot_square

    box, _ = find_dot_square(_arm_with_dots([(400, 500, 150)]))
    assert abs(box.x + box.w / 2 - 475) < 8 and abs(box.y + box.h / 2 - 575) < 8
    assert 80 < box.w < 100  # inside the dots: 0.6 x spacing = 90 px


def test_find_two_dot_squares_top_to_bottom():
    from app.markers import find_dot_squares

    img = _arm_with_dots([(400, 750, 150), (400, 300, 150)], decoy=(870, 300, 100))
    (top, _), (bottom, _) = find_dot_squares(img, 2)
    assert abs(top.y + top.h / 2 - 375) < 8 and abs(bottom.y + bottom.h / 2 - 825) < 8


def test_paper_found_automatically(tmp_path):
    from app.markers import paper_pixels

    _fake_photo(tmp_path / "p.jpg", np.random.default_rng(3))
    from app.pipeline import _load

    linear, srgb8 = _load(str(tmp_path / "p.jpg"))
    px = paper_pixels(linear, srgb8)
    assert len(px) > 300 and px.mean() > 0.7  # paper is the bright patch, not skin/background
