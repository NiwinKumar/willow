"""Sessions with front and cheek photos: each view's photo is signed, and the spot diary counts
a session with a front photo whatever else it has."""

from app import baselines, tracks, views
from app.settings import get_settings
from app.store import MemoryStore


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


# --- counts compare with a check-in taken the same way (with or without cheek photos) ---


def _result(blemishes, spots, cheeks, sid="s"):
    return {
        "site": "face_full",
        "session_id": sid,
        "engine_version": "0.4.0",
        "frames_used": 5 if cheeks else 3,
        "quality": {"passed": True},
        "views": _views() if cheeks else [{"view": "front"}],
        "metrics": [
            {"id": "blemishes", "value": blemishes, "mdc95": 2.0, "verdict": "no_baseline"},
            {"id": "pigment_spots", "value": spots, "mdc95": 0.2, "verdict": "no_baseline"},
            {"id": "redness", "value": 10.0, "mdc95": 1.0, "verdict": "within_noise", "delta": 0.5},
        ],
    }


DOC = {"site": "face_full", "capture_mode": "uncalibrated", "created_at": "2026-10-03"}


def _metric(r, mid):
    return next(m for m in r["metrics"] if m["id"] == mid)


def test_cheek_check_ins_compare_counts_with_the_first_cheek_check_in():
    store = MemoryStore()
    front_base = baselines.build("b", DOC, _result(3, 0.02, cheeks=False))
    # first cheek check-in: nothing to compare its counts with yet; it becomes the reference
    first = _result(11, 0.9, cheeks=True, sid="c1")
    assert baselines.match_counts(store, "u", "c1", DOC, first, front_base) is None
    assert _metric(first, "blemishes")["verdict"] == "no_baseline"
    assert _metric(first, "redness")["delta"] == 0.5  # front metrics keep the baseline's comparison
    assert any("first check-in with cheek photos" in w for w in first["warnings"])
    baselines.remember_counts(store, "u", "c1", DOC, first)
    store.session_set("u", "c1", {"site": "face_full"})
    # a week later, with cheek photos again: compared with c1, not the front-only baseline
    later = _result(15, 0.7, cheeks=True, sid="c2")
    seen = baselines.match_counts(store, "u", "c2", DOC, later, front_base)
    assert seen["session_id"] == "c1"
    b = _metric(later, "blemishes")
    assert (b["delta"], b["direction"], b["verdict"]) == (4.0, "increase", "real_change")
    p = _metric(later, "pigment_spots")
    assert p["verdict"] == "within_noise" and p["direction"] == "decrease"
    baselines.remember_counts(store, "u", "c2", DOC, later)  # the first one stays the reference
    key = baselines.counts_key(baselines.key("face_full", "uncalibrated"), True)
    assert store.baseline_get("u", key)["session_id"] == "c1"


def test_same_kind_as_the_baseline_keeps_the_engines_comparison():
    store = MemoryStore()
    front_base = baselines.build("b", DOC, _result(3, 0.02, cheeks=False))
    r = _result(4, 0.03, cheeks=False, sid="f2")
    r["metrics"][0].update(delta=1.0, verdict="within_noise")
    assert baselines.match_counts(store, "u", "f2", DOC, r, front_base) is None
    assert _metric(r, "blemishes")["delta"] == 1.0 and "warnings" not in r


def test_a_side_only_check_in_never_compares_or_becomes_a_reference():
    store = MemoryStore()
    cheek_base = baselines.build("b", DOC, _result(14, 0.5, cheeks=True))
    side = _result(5, 0.1, cheeks=True, sid="s1")
    side["views"] = _views()[1:2]  # the front photo failed: one cheek only
    side["metrics"][0].update(delta=-9.0, verdict="real_change", direction="decrease")
    assert not baselines.with_cheeks(side) and baselines.side_only(side)
    assert baselines.match_counts(store, "u", "s1", DOC, side, cheek_base) is None
    assert _metric(side, "blemishes")["verdict"] == "no_baseline"
    baselines.remember_counts(store, "u", "s1", DOC, side)
    for cheeks in (True, False):
        key = baselines.counts_key(baselines.key("face_full", "uncalibrated"), cheeks)
        assert store.baseline_get("u", key) is None


def test_a_poor_photo_keeps_saying_so_and_a_deleted_reference_is_not_used():
    store = MemoryStore()
    front_base = baselines.build("b", DOC, _result(3, 0.02, cheeks=False))
    first = _result(11, 0.9, cheeks=True, sid="c1")
    baselines.remember_counts(store, "u", "c1", DOC, first)  # c1 is never saved as a session
    later = _result(15, 0.7, cheeks=True, sid="c2")
    later["metrics"][1]["verdict"] = "low_quality"
    assert baselines.match_counts(store, "u", "c2", DOC, later, front_base) is None
    assert _metric(later, "blemishes")["verdict"] == "no_baseline"  # c1 is gone
    assert _metric(later, "pigment_spots")["verdict"] == "low_quality"
