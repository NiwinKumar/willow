"""The redness layer of each view's photo (pipeline_face._view_redness_map, Nov 28): it covers
the skin that photo measures (a front photo: forehead, nose, around the mouth and chin, and the
cheeks when there are no side photos), and draws each pixel against the skin around it, so the
same mark shows whatever the skin tone or light."""

from types import SimpleNamespace as M

import numpy as np

from app import config, facemap
from app.overlay import redness_rgba, to_preview
from app.pipeline_face import _local_a, _view_redness_map, _view_skin

FOREHEAD = facemap.ZONES.index("forehead") + 1
CHEEK = facemap.ZONES.index("right_cheek") + 1
PX_PER_MM = 2.0


def _frame(view, a_star, label, owned_px=None):
    """A face crop the size of the photo (box at 0,0); `owned_px` stands in for the triangles."""
    f = {
        "view": view,
        "a_star": a_star.astype(np.float32),
        "zone_label": label.astype(np.uint8),
        "box": M(x=0, y=0),
        "shape": (*a_star.shape, 3),
        "face": M(px_per_mm=PX_PER_MM),
        "redness_map": None,
    }
    if owned_px is not None:  # one triangle per pixel row: owned by row
        tri = np.repeat(np.arange(a_star.shape[0], dtype=np.int16)[:, None], a_star.shape[1], 1)
        f["tri_map"], f["owned"] = tri, owned_px.any(axis=1)
    return f


def _two_zones(h=240, w=200):
    label = np.zeros((h, w), np.uint8)
    label[20:110, 20:180] = FOREHEAD
    label[130:220, 20:180] = CHEEK
    return label


def test_a_front_photo_without_side_photos_draws_all_of_its_skin():
    label = _two_zones()
    f = _frame("front", np.full(label.shape, 12.0), label)
    skin = _view_skin(f)
    assert (
        skin[label == FOREHEAD].all() and skin[label == CHEEK].all() and not skin[label == 0].any()
    )


def test_a_front_photo_with_side_photos_draws_only_the_skin_it_measures():
    label = _two_zones()
    own = np.zeros(label.shape, bool)
    own[:120] = True  # the forehead rows are the front's; the cheek went to a side photo
    f = _frame("front", np.full(label.shape, 12.0), label, own)
    skin = _view_skin(f)
    assert skin[label == FOREHEAD].all() and not skin[label == CHEEK].any()
    red = _view_redness_map(f)
    assert red is not None and red["den"][40:80, 40:150].min() > 0.9  # the forehead is drawn


def test_the_same_spot_is_drawn_the_same_on_any_tone_or_light():
    label = _two_zones()
    skin = label > 0
    yy, xx = np.mgrid[: label.shape[0], : label.shape[1]]
    spot = ((yy - 60) ** 2 + (xx - 100) ** 2 <= 8**2) * 6.0  # a 4 mm red mark on the forehead
    light = [
        np.full(label.shape, 10.0),  # fair skin, even light
        np.full(label.shape, 22.0),  # deeper skin: a* higher everywhere
        10.0 + xx * 0.05,  # light from one side: a* drifts across the face
    ]
    local = [_local_a(base + spot, skin, PX_PER_MM) for base in light]
    for la in local:
        assert abs(la[60, 100] - local[0][60, 100]) < 0.6  # the mark stands out the same
        assert abs(np.median(la[skin])) < 0.6  # the rest of the skin is left as it is


def test_an_area_redder_as_a_whole_is_not_painted_as_a_block():
    label = _two_zones()
    a = np.where(label == CHEEK, 18.0, 12.0)  # one area 6 a* redder or warmer-lit throughout
    f = _frame("front", a, label)
    core = (slice(160, 190), slice(60, 140))  # well inside it, away from the border
    local = redness_rgba(_view_redness_map(f), PX_PER_MM)[*core, 3]
    # drawn against one value for the whole face (before Nov 28), the area was a solid block
    plain = redness_rgba(to_preview(f["a_star"], label > 0, label.shape), PX_PER_MM)[*core, 3]
    assert plain.min() >= config.OVERLAY_ALPHA[1] * 255 * 0.7  # the whole area, evenly
    assert local.max() <= plain.min() * 0.5  # now a light wash at most
