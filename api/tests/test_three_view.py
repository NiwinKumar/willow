"""Sessions with front and cheek photos: each view's photo is signed, and the spot diary counts
a session with a front photo whatever else it has."""

from app import tracks, views
from app.settings import get_settings


def _uri(name: str) -> str:
    return f"gs://{get_settings().bucket}/{name}"


def _views():
    return [
        {
            "view": v,
            "frame_index": i,
            "image_size": {"width": 1200, "height": 1600},
            "preview_uri": _uri(f"results/u/s/views/{v}.jpg"),
            "redness_uri": _uri(f"results/u/s/overlays/redness_{v}.png"),
            "rois": [],
        }
        for i, v in enumerate(("front", "right", "left"))
    ]


def test_each_view_photo_is_signed_with_its_size():
    result = {"views": _views()}
    signed = {
        "results/u/s/views/front.jpg": "https://f",
        "results/u/s/overlays/redness_front.png": "https://fr",
        "results/u/s/views/right.jpg": "https://r",
    }
    out = views.view_photos(result, signed)
    assert [v["view"] for v in out] == ["front", "right"]  # left's photo is missing: left out
    assert out[0]["preview"] == {"url": "https://f", "width": 1200, "height": 1600}
    assert out[0]["redness_url"] == "https://fr" and out[1]["redness_url"] is None
    assert views.view_photos(None, signed) == []


def test_a_session_with_a_front_photo_counts_in_the_diary():
    assert tracks.is_front({"views": _views()})
    assert not tracks.is_front({"views": _views()[1:2], "rois": [{"name": "forehead"}]})
    assert tracks.is_front({"rois": [{"name": "forehead"}]})  # engines before views
