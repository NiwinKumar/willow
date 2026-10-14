"""Spot diary: marks followed across face sessions by their place on the canonical face."""

import json
from datetime import UTC, datetime, timedelta

from app import tracks

T0 = datetime(2026, 10, 10, 8, 0, tzinfo=UTC)


def _mark(x, y, cid="c_001", kind="blemish", stage_label=None, contrast=3.0, zone=4, seen=None):
    f = {"face_x_mm": x, "face_y_mm": y, "zone": float(zone), "diameter_mm": 3.0}
    f["a_star_contrast" if kind == "blemish" else "l_star_contrast"] = contrast
    if seen is not None:
        f["seen_in_fraction"] = seen
    return {"id": cid, "kind": kind, "bbox": [1, 2, 3, 3], "features": f}, stage_label


def _session(day, marks, frames=1):
    cands = [c for c, _ in marks]
    labels = {c["id"]: lab for c, lab in marks if lab}
    result = {"frames_used": frames, "candidates": cands}
    return {
        "id": f"s{day}",
        "created_at": T0 + timedelta(days=day),
        "marks": tracks.observations(result, labels),
    }


def test_a_mark_seen_then_missing_twice_is_gone_with_a_range():
    s = [
        _session(0, []),
        _session(1, [_mark(30.0, -5.0)]),
        _session(2, [_mark(31.5, -4.0)]),  # 1.8 mm away: the same mark
        _session(4, []),
        _session(5, []),
    ]
    d = tracks.follow(s)
    [t] = d["tracks"]
    assert t["status"] == "gone" and t["zone"] == "left_cheek"
    assert t["days_visible"] == {"at_least": 1.0, "at_most": 3.0}  # seen day 1-2, gone by day 4
    assert not t["there_from_start"]


def test_missing_once_is_not_gone():
    s = [_session(i, [] if i == 2 else [_mark(-30.0, 0.0, zone=3)]) for i in range(4)]
    [t] = tracks.follow(s)["tracks"]
    assert t["status"] == "still_there" and len(t["observations"]) == 3
    assert t["there_from_start"]


def test_seen_once_in_one_photo_is_not_shown_but_two_photos_confirm_it():
    single = tracks.follow([_session(0, [_mark(0.0, 60.0, zone=1)]), _session(1, [])])
    assert single["tracks"] == [] and single["unconfirmed"] == 1
    multi = tracks.follow([_session(0, [_mark(0.0, 60.0, zone=1, seen=0.67)], frames=3)])
    assert multi["tracks"][0]["status"] == "new" and multi["tracks"][0]["confirmed"]


def test_a_bump_that_turns_into_a_mark_is_fading():
    s = [
        _session(0, [_mark(20.0, -50.0, stage_label="papule_pustule", zone=7)]),
        _session(1, [_mark(20.5, -50.0, stage_label="papule_pustule", zone=7)]),
        _session(2, [_mark(20.0, -49.0, kind="spot", stage_label="post_blemish_mark", zone=7)]),
    ]
    [t] = tracks.follow(s)["tracks"]
    assert t["status"] == "fading"
    assert [o["stage"] for o in t["observations"]] == ["bump", "bump", "mark"]


def test_hair_and_moles_are_never_followed():
    s = [
        _session(
            0,
            [
                _mark(10.0, 10.0, stage_label="hair_or_artifact"),
                _mark(-10.0, 10.0, "c_002", stage_label="mole"),
            ],
        ),
        _session(
            1,
            [
                _mark(10.0, 10.0, stage_label="hair_or_artifact"),
                _mark(-10.0, 10.0, "c_002", stage_label="mole"),
            ],
        ),
    ]
    assert tracks.follow(s)["tracks"] == []


def test_a_new_mark_where_one_faded_came_back_and_zones_need_three_faded_for_a_typical_time():
    s = [_session(0, [])]
    day = 1
    # three marks on the left cheek, each visible 2 sessions then gone
    for k, x in enumerate((25.0, 40.0, 55.0)):
        s += [
            _session(day, [_mark(x, -10.0, f"c_{k}")]),
            _session(day + 1, [_mark(x, -10.0, f"c_{k}")]),
            _session(day + 2, []),
            _session(day + 3, []),
        ]
        day += 4
    s += [_session(day, [_mark(26.0, -12.0)]), _session(day + 1, [_mark(26.0, -12.0)])]
    d = tracks.follow(s)
    back = [t for t in d["tracks"] if t["came_back"]]
    assert len(back) == 1 and back[0]["earlier_track"] == d["tracks"][0]["id"]
    [zone] = d["zones"]
    assert zone["zone"] == "left_cheek" and zone["faded"] == 3 and zone["came_back"] == 1
    assert zone["typical_days_visible"] == {"at_least": 1.0, "at_most": 2.0, "from": 3}
    assert d["enough_data"]


def test_too_few_faded_marks_give_no_typical_time():
    s = [_session(0, []), _session(1, [_mark(25.0, -10.0)]), _session(2, [_mark(25.0, -10.0)])]
    s += [_session(3, []), _session(4, [])]
    [zone] = tracks.follow(s)["zones"]
    assert zone["faded"] == 1 and zone["typical_days_visible"] is None


# ---- the route, on the in-memory store -------------------------------------------------


def _doc(day, cands, labels=None, passed=True, front=True, engine="0.3.1"):
    result = {
        "site": "face_full",
        "engine_version": engine,
        "frames_used": 1,
        "quality": {"passed": passed, "per_frame": [{"index": 0, "passed": passed}]},
        "rois": [{"name": "forehead" if front else "left_cheek", "polygon": [[0, 0]]}],
        "candidates": cands,
        "metrics": [],
    }
    return {
        "site": "face_full",
        "status": "done",
        "capture_mode": "uncalibrated",
        "created_at": T0 + timedelta(days=day),
        "result_json": json.dumps(result),
        "measured": True,
        "labels": labels or {},
    }


def _cand(x, y, cid="c_001", crop=True):
    c, _ = _mark(x, y, cid)
    if crop:
        c["crop_uri"] = f"gs://test-bucket/results/u_test/s/crops/{cid}.jpg"
    return c


def test_spots_route_builds_the_diary(fake, client, monkeypatch):
    from app import storage

    monkeypatch.setattr(
        storage, "name_from_uri", lambda uri: uri.removeprefix("gs://test-bucket/") or None
    )
    for day in (0, 1, 2):
        fake.store.session_set("u_test", f"s{day}", _doc(day, [_cand(30.0, -5.0)]))
        fake.put(f"results/u_test/s{day}/preview.jpg", content_type="image/jpeg")
    fake.put("results/u_test/s/crops/c_001.jpg", content_type="image/jpeg")
    # measured before the face map: counted, not used
    old = _doc(3, [{"id": "c_001", "kind": "blemish", "bbox": [0, 0, 1, 1], "features": {}}])
    fake.store.session_set("u_test", "old", old)
    fake.store.session_set("u_test", "side", _doc(4, [_cand(30.0, -5.0)], front=False))
    body = client.get("/v1/spots").json()
    assert [s["id"] for s in body["sessions"]] == ["s0", "s1", "s2"]
    assert body["sessions"][0]["photo_url"].endswith("results/u_test/s0/preview.jpg")
    assert body["sessions"][2]["day"] == 2.0
    assert body["sessions_not_mapped"] == 1
    [t] = body["tracks"]
    assert t["status"] == "still_there" and t["zone"] == "left_cheek"
    assert t["observations"][0]["crop_url"].endswith("crops/c_001.jpg")
    assert "crop_uri" not in t["observations"][0]


def test_spots_route_with_no_sessions(fake, client):
    body = client.get("/v1/spots").json()
    assert body["tracks"] == [] and body["sessions"] == [] and not body["enough_data"]


def test_contrast_jitter_is_not_fading_but_two_low_sightings_are():
    marks = [3.0, 2.0, 3.1]  # one low photo between two normal ones
    s = [_session(i, [_mark(30.0, -5.0, contrast=c)]) for i, c in enumerate(marks)]
    assert tracks.follow(s)["tracks"][0]["status"] == "still_there"
    s = [_session(i, [_mark(30.0, -5.0, contrast=c)]) for i, c in enumerate([3.0, 3.2, 2.0, 1.9])]
    assert tracks.follow(s)["tracks"][0]["status"] == "fading"


def test_a_flicker_that_ended_does_not_make_a_mark_come_back():
    s = [
        _session(0, [_mark(30.0, -5.0)]),  # seen once, one photo: unconfirmed
        _session(1, []),
        _session(2, []),
        _session(3, [_mark(30.5, -5.0)]),
        _session(4, [_mark(30.5, -5.0)]),
    ]
    [t] = tracks.follow(s)["tracks"]
    assert not t["came_back"]
