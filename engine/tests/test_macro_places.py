"""Close-ups of one place: left cheek, right cheek, forehead, chin (left and right are the
person's own). Regions on the canonical face, and the metrics each place returns."""

import numpy as np
import pytest
from test_macro import _macro, _metric

from app import config
from app.facemap import canonical
from app.landmarks import Face
from app.pipeline_macro import REGIONS, SITE_METRICS, _region, analyze_macro

PX_PER_MM = 6.0
NEW_SITES = ("left_cheek_macro", "right_cheek_macro", "forehead_macro", "chin_macro")
mesh = canonical()
needs_mesh = pytest.mark.skipif(mesh is None, reason="face model not downloaded")


def _face(yaw: float = 0.0) -> Face:
    verts = mesh[0]
    pts = np.zeros((478, 2))
    eyes = float(np.linalg.norm(verts[263, :2] - verts[33, :2]))
    k = PX_PER_MM * config.EYE_DISTANCE_MM / eyes
    pts[: len(verts)] = verts[:, :2] * [1, -1] * k
    pts[: len(verts)] -= pts[: len(verts)].min(axis=0) - 20 * PX_PER_MM
    return Face(points=pts, yaw=yaw, pitch=0.0, roll=0.0)


def _shape(face: Face) -> tuple[int, int]:
    h, w = (np.ceil(face.points[:468].max(axis=0)) + 20 * PX_PER_MM).astype(int)[::-1]
    return int(h), int(w)


def _centre(mask: np.ndarray) -> np.ndarray:
    ys, xs = np.nonzero(mask)
    return np.array([xs.mean(), ys.mean()])


@needs_mesh
def test_each_place_is_its_own_part_of_the_face():
    face = _face()
    shape = _shape(face)
    area = {
        r: _region(face, r, shape)
        for r in ("cheek", "left_cheek", "right_cheek", "forehead", "chin")
    }
    assert all(m.sum() > 100 for m in area.values())
    nose = face.points[1]
    # a front photo is mirrored: the person's right cheek is on the photo's left
    assert _centre(area["right_cheek"])[0] < nose[0] < _centre(area["left_cheek"])[0]
    assert not (area["left_cheek"] & area["right_cheek"]).any()
    assert np.array_equal(area["left_cheek"] | area["right_cheek"], area["cheek"])
    brows = face.points[[105, 334], 1].min()
    lip = face.points[17, 1]
    assert _centre(area["forehead"])[1] < brows
    assert _centre(area["chin"])[1] > lip
    for a, b in (("forehead", "chin"), ("forehead", "cheek"), ("chin", "cheek")):
        assert not (area[a] & area[b]).any()


@needs_mesh
def test_a_cheek_turned_away_from_the_camera_has_no_region():
    face = _face(yaw=-(config.MAX_ABS_YAW + 20))  # one cheek faces the camera
    shape = _shape(face)
    shown = face.cheeks[0]
    hidden = "left_cheek" if shown == "right_cheek" else "right_cheek"
    assert _region(face, shown, shape).any()
    assert not _region(face, hidden, shape).any()


@pytest.mark.parametrize("site", NEW_SITES)
def test_a_close_up_of_one_place_gets_every_skin_metric(tmp_path, site):
    _macro(tmp_path / "a.jpg")
    r = analyze_macro([str(tmp_path / "a.jpg")], site)
    assert r["site"] == site and r["quality"]["passed"]
    assert [m["id"] for m in r["metrics"]] == list(SITE_METRICS[site])
    assert _metric(r, "pores")["value"] is not None
    assert _metric(r, "tone_ita")["value"] is not None
    assert r["rois"] and {x["name"] for x in r["rois"]} == {REGIONS[site]}


def test_the_older_cheek_and_nose_close_ups_keep_their_metrics():
    assert SITE_METRICS["cheek_macro"] == SITE_METRICS["left_cheek_macro"]
    assert SITE_METRICS["nose_macro"] == ("blemishes", "pores")
