import math

import numpy as np
import pytest
from PIL import Image

from app import config
from app.landmarks import Face, FaceNotFound, _euler_degrees, detect_face
from app.metrics.evenness import tone_evenness
from app.metrics.pigment import find_spots, pigment_spots
from app.pipeline_face import analyze_face

PX_PER_MM = 10.0  # synthetic scale: 1 mm = 10 px


def _skin_red(value, shape=(300, 300), seed=0):
    rng = np.random.default_rng(seed)
    return np.clip(value + rng.normal(0, 0.004, shape), 0.01, 1).astype(np.float32)


def _add_spots(red, centres, radius_px, factor):
    yy, xx = np.ogrid[: red.shape[0], : red.shape[1]]
    for cx, cy in centres:
        red[(xx - cx) ** 2 + (yy - cy) ** 2 <= radius_px**2] *= factor  # less red light = darker
    return red


# ---- tone_evenness ---------------------------------------------------------------------


def test_evenness_low_for_uniform_skin_higher_for_patchy():
    skin = np.ones((100, 100), bool)
    red = {n: _skin_red(0.4, (100, 100), i) for i, n in enumerate("abcde")}
    flat = {n: (np.full((100, 100), 60.0), red[n], skin) for n in red}
    patchy = {n: (np.full((100, 100), 55.0 + 3 * i), red[n], skin) for i, n in enumerate(red)}
    low, _ = tone_evenness(flat, PX_PER_MM)
    high, _ = tone_evenness(patchy, PX_PER_MM)
    assert low < 0.5 and high > low + 3


def test_evenness_ignores_camera_grain_but_sees_blotches():
    skin = np.ones((200, 200), bool)
    grainy = _skin_red(0.4, (200, 200)) * np.random.default_rng(9).normal(1, 0.05, (200, 200))
    blotchy = _add_spots(_skin_red(0.4, (200, 200)), [(60, 60), (140, 140)], 30, 0.8)  # evenness
    L = np.full((200, 200), 60.0)
    grain_score, _ = tone_evenness({"a": (L, grainy, skin), "b": (L, grainy, skin)}, PX_PER_MM)
    blotch_score, _ = tone_evenness({"a": (L, blotchy, skin), "b": (L, blotchy, skin)}, PX_PER_MM)
    assert blotch_score > 3 * grain_score


# ---- pigment_spots ---------------------------------------------------------------------


def _lab(L, a=12.0, b=18.0, seed=0, shape=(300, 300)):
    rng = np.random.default_rng(seed)
    lab = np.empty((*shape, 3))
    for i, v in enumerate((L, a, b)):
        lab[..., i] = v + rng.normal(0, 0.6, shape)
    return lab


def _dot(lab, cx, cy, r, d_l, chroma_scale=1.0):
    yy, xx = np.ogrid[: lab.shape[0], : lab.shape[1]]
    disk = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
    lab[disk, 0] += d_l
    lab[disk, 1:] *= chroma_scale
    return lab


def _spots(lab):
    skin = np.ones(lab.shape[:2], bool)
    return find_spots(lab, skin, skin, PX_PER_MM)


def test_no_spots_on_plain_skin():
    assert _spots(_lab(60)) == []


@pytest.mark.parametrize("L", [80.0, 65.0, 45.0, 28.0])  # very light -> very deep skin
def test_brown_spots_found_at_every_tone(L):
    lab = _lab(L)
    for cx, cy in [(60, 60), (230, 80), (150, 230)]:
        _dot(lab, cx, cy, r=15, d_l=-6.0, chroma_scale=1.1)  # 3 mm, darker, a bit browner
    spots = _spots(lab)
    assert len(spots) == 3
    pct, extras = pigment_spots(spots, lab.shape[0] * lab.shape[1])
    assert extras["count"] == 3 and extras["mean_contrast"] > 3 and 0 < pct < 15


def test_grey_mark_on_deep_skin_is_a_spot():
    # post-acne marks on deep skin go darker AND greyer, like shading; they still count
    lab = _dot(_lab(32), 150, 150, r=15, d_l=-8.0, chroma_scale=0.7)
    assert len(_spots(lab)) == 1


def test_specks_smaller_than_min_size_are_ignored():
    lab = _dot(_lab(60), 150, 150, r=2, d_l=-15.0)  # 0.4 mm speck
    assert _spots(lab) == []


def test_spots_must_be_inside_search_area():
    lab = _dot(_lab(60), 60, 60, r=15, d_l=-6.0, chroma_scale=1.1)
    skin = np.ones(lab.shape[:2], bool)
    search = skin.copy()
    search[:150, :150] = False  # e.g. a shadow guard beside the nose
    assert find_spots(lab, skin, search, PX_PER_MM) == []


# ---- landmarks / pose ------------------------------------------------------------------


def test_euler_from_rotation():
    assert _euler_degrees(np.eye(4)) == pytest.approx((0.0, 0.0, 0.0))
    a = math.radians(10)  # 10 degrees roll: rotation about the viewing axis
    roll = np.eye(4)
    roll[:2, :2] = [[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]]
    assert _euler_degrees(roll)[2] == pytest.approx(10.0)


def test_model_loads_and_reports_no_face_on_blank_image():
    with pytest.raises(FaceNotFound):
        detect_face(np.full((480, 640, 3), 128, np.uint8))


# ---- face pipeline with a stand-in for MediaPipe ---------------------------------------

SQUARES = {  # name -> (x, y) top-left of a 120 px ROI square in a 1000x1000 photo
    "forehead": (440, 150),
    "right_cheek": (250, 450),
    "left_cheek": (630, 450),
    "nose": (440, 450),
    "chin": (440, 750),
    "right_under_eye": (250, 330),
    "left_under_eye": (630, 330),
}


class FakeFace(Face):
    """Stand-in for MediaPipe output: square ROIs, the face = a big central rectangle."""

    def skin_mask(self, shape):
        m = np.zeros(shape, bool)
        m[120:900, 200:820] = True
        return m

    def _disk(self, mm):
        return np.ones((3, 3), np.uint8)

    def shadow_guard(self, shape):
        return np.zeros(shape, bool)

    def edge_guard(self, shape):
        return np.zeros(shape, bool)

    def brow_guard(self, shape):
        return np.zeros(shape, bool)

    def eye_corner_guard(self, shape):
        return np.zeros(shape, bool)

    def lip_band(self, shape, mm):
        return np.zeros(shape, bool)

    def border_band(self, skin, origin=(0, 0), hairline_mm=None, features=None):
        return np.zeros(skin.shape, bool)

    def feature_zones(self, shape):
        none = np.zeros(shape, bool)
        return {"brow_core": none, "brow_zone": none, "nostril_zone": none}

    def t_zone_mask(self, shape):
        m = np.zeros(shape, bool)
        for n in ("forehead", "nose", "chin"):
            x, y = SQUARES[n]
            m[y : y + 120, x : x + 120] = True
        return m

    def all_roi_polygons(self):
        return self.roi_polygons()

    def roi_polygons(self):
        return {
            n: np.array([[x, y], [x + 120, y], [x + 120, y + 120], [x, y + 120]], float)
            for n, (x, y) in SQUARES.items()
        }


def _face_photo(path, seed=0):
    rng = np.random.default_rng(seed)
    img = np.full((1000, 1000, 3), (198, 148, 115), np.float64) + rng.normal(0, 5, (1000, 1000, 1))
    img[:, 880:] = 235  # white paper held at the side
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path, quality=95)


@pytest.fixture
def fake_landmarks(monkeypatch):
    pose = {"yaw": 1.0, "pitch": -2.0, "roll": 0.5}

    def fake_detect(srgb8):
        if srgb8.mean() < 5:  # an all-black photo stands in for "no face"
            raise FaceNotFound("no face")
        pts = np.zeros((478, 2))
        # rigid points used to line photos up (eye corners, nose, mouth, chin, forehead,
        # cheek edges), spread like a real face mesh
        for i, xy in {
            33: (300, 380),
            133: (430, 380),
            362: (570, 380),
            263: (700, 380),
            168: (500, 380),
            6: (500, 430),
            1: (500, 560),
            4: (500, 540),
            61: (420, 700),
            291: (580, 700),
            152: (500, 880),
            10: (500, 130),
            234: (210, 480),
            454: (790, 480),
        }.items():
            pts[i] = xy
        return FakeFace(points=pts, **pose)

    monkeypatch.setattr("app.pipeline_face.detect_face", fake_detect)
    return pose


def test_face_pipeline_end_to_end(tmp_path, fake_landmarks):
    files = []
    for i in range(3):
        _face_photo(tmp_path / f"face{i}.jpg", seed=i)
        files.append(str(tmp_path / f"face{i}.jpg"))
    r = analyze_face(files)  # schema-validated inside
    assert r["site"] == "face_full" and r["frames_used"] == 3
    m = {x["id"]: x for x in r["metrics"]}
    assert set(m) == {
        "tone_ita",
        "pigment_spots",
        "tone_evenness",
        "redness",
        "blemishes",
        "shine",
        "glow",
    }
    assert m["shine"]["value"] < 2.0 and m["shine"]["confidence"] == "indicative"
    assert m["blemishes"]["value"] == 0 and m["blemishes"]["confidence"] == "indicative"
    assert m["pigment_spots"]["extras"]["count"] == 0  # plain synthetic skin has no spots
    assert m["tone_evenness"]["value"] < 2.0  # every ROI is the same colour
    assert {p["name"] for p in r["rois"]} == set(SQUARES)
    assert r["quality"]["pose"] == {"yaw": 1.0, "pitch": -2.0, "roll": 0.5}


def test_face_pose_gate(tmp_path, fake_landmarks):
    fake_landmarks["yaw"] = config.SIDE_MAX_YAW + 5  # beyond even a side view
    _face_photo(tmp_path / "turned.jpg")
    r = analyze_face([str(tmp_path / "turned.jpg")])
    assert not r["quality"]["passed"] and "pose_out_of_range" in r["quality"]["reasons"]


def test_face_not_found(tmp_path, fake_landmarks):
    Image.new("RGB", (400, 400), (0, 0, 0)).save(tmp_path / "dark.jpg")
    r = analyze_face([str(tmp_path / "dark.jpg")])
    assert r["quality"]["per_frame"][0]["reasons"] == ["face_not_found"]
    assert "too_few_frames" in r["quality"]["reasons"] and r["rois"] == []


def test_refine_skin_keeps_a_mark_but_cuts_hair_and_brow():
    from app.landmarks import refine_skin

    rng = np.random.default_rng(4)
    L = 60 + rng.normal(0, 0.5, (400, 400))
    mask = np.zeros((400, 400), bool)
    mask[50:350, 50:350] = True
    L[50:70, 50:350] = 25  # hair along the top edge of the face
    yy, xx = np.ogrid[:400, :400]
    L[(yy - 200) ** 2 + (xx - 200) ** 2 <= 6**2] = 50  # a small darker mark, 10 L* down
    brow = np.zeros_like(mask)
    brow[120:135, 100:180] = True
    L[brow] = 35
    zones = {"brow_core": brow, "brow_zone": brow, "nostril_zone": np.zeros_like(mask)}
    skin = refine_skin(L, mask, zones, px_per_mm=PX_PER_MM)
    assert skin[200, 200]  # the mark stays: it is skin, not hair
    assert not skin[55, 200] and not skin[127, 140]  # hair and brow are cut
    assert skin[250, 250]  # plain skin stays


def test_blemish_candidates_with_crops(tmp_path, fake_landmarks):
    path = tmp_path / "face.jpg"
    rng = np.random.default_rng(0)
    img = np.full((1000, 1000, 3), (198, 148, 115), np.float64) + rng.normal(0, 3, (1000, 1000, 1))
    yy, xx = np.ogrid[:1000, :1000]
    img[(xx - 500) ** 2 + (yy - 600) ** 2 <= 9**2] = (215, 120, 105)  # a red bump on the cheek
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path, quality=95)
    r = analyze_face([str(path)], output_prefix=str(tmp_path / "out"))
    import json

    json.dumps(r)  # the API and CLI must be able to serialise every result
    blem = next(m for m in r["metrics"] if m["id"] == "blemishes")
    assert blem["value"] == 1 and len(r["candidates"]) == 1
    c = r["candidates"][0]
    assert c["kind"] == "blemish" and abs(c["bbox"][0] + c["bbox"][2] / 2 - 500) < 6
    assert Image.open(c["crop_uri"]).size[0] >= 64
    assert Image.open(c["context_crop_uri"]).size[0] == 3 * Image.open(c["crop_uri"]).size[0]


def _bump_photo(path, bumps, seed=0):
    rng = np.random.default_rng(seed)
    img = np.full((1000, 1000, 3), (198, 148, 115), np.float64) + rng.normal(0, 3, (1000, 1000, 1))
    yy, xx = np.ogrid[:1000, :1000]
    for cx, cy in bumps:
        img[(xx - cx) ** 2 + (yy - cy) ** 2 <= 9**2] = (215, 120, 105)
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path, quality=95)


def test_spot_persistence_across_photos(tmp_path, fake_landmarks):
    # the bump at (500, 600) is in all 3 photos; the one at (350, 750) only in the first
    files = []
    for i in range(3):
        bumps = [(500, 600)] + ([(350, 750)] if i == 0 else [])
        _bump_photo(tmp_path / f"f{i}.jpg", bumps, seed=i)
        files.append(str(tmp_path / f"f{i}.jpg"))
    r = analyze_face(files)
    seen = {
        round(c["bbox"][0] + c["bbox"][2] / 2, -2): c["features"]["seen_in_fraction"]
        for c in r["candidates"]
    }
    assert seen == {500.0: 1.0, 400.0: 0.33}
