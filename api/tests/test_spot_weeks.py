"""The spot diary week by week (app/spot_weeks.py, GET /v1/spots/weeks)."""

import json
from datetime import UTC, datetime

from app import storage

UID = "u_test"


def _metric(mid, value, extras):
    return {
        "id": mid,
        "group": "x",
        "label": mid,
        "unit": "count",
        "confidence": "indicative",
        "value": value,
        "within_session_sd": 0.0,
        "mdc95": 1.0,
        "delta": None,
        "verdict": "no_baseline",
        "direction": "none",
        "extras": extras,
    }


def _mark(view, x, y, zone):
    return {"view": view, "frame_index": 0, "x": x, "y": y, "r": 4.0, "zone": zone}


def _result(sid, with_marks=True):
    blem_marks = [
        _mark("front", 100, 100, "forehead"),
        _mark("right", 300, 400, "right_cheek"),
        _mark("right", 320, 420, "right_cheek"),
    ]
    spot_marks = [_mark("right", 350, 450, "right_cheek")]
    blem = {
        "by_zone": {"forehead": {"value": 1.0}, "right_cheek": {"value": 2.0}},
        "face_points": [{"view": "front", "frame_index": 0, "points": [[1.0, 2.0], [3.0, 4.0]]}],
    }
    spots = {"count": 1}
    if with_marks:
        blem["marks"], spots["marks"] = blem_marks, spot_marks
    prefix = storage.object_uri(f"results/{UID}/{sid}/")
    return {
        "site": "face_full",
        "capture_mode": "uncalibrated",
        "quality": {"passed": True, "reasons": []},
        "frames_used": 3,
        "metrics": [_metric("blemishes", 3.0, blem), _metric("pigment_spots", 0.5, spots)],
        "candidates": [
            {
                "id": "c_001",
                "kind": "blemish",
                "bbox": [94.0, 94.0, 12.0, 12.0],
                "features": {"view": 0.0, "frame_index": 0.0, "zone": 1.0},
            },
            {  # a mole on the right cheek: never drawn
                "id": "c_002",
                "kind": "spot",
                "bbox": [344.0, 444.0, 12.0, 12.0],
                "features": {"view": 1.0, "frame_index": 3.0, "zone": 3.0},
            },
        ],
        "views": [
            {
                "view": v,
                "frame_index": i,
                "image_size": {"width": 1000, "height": 1200},
                "preview_uri": f"{prefix}views/{v}.jpg",
                "rois": [{"name": "right_cheek" if v == "right" else "forehead", "polygon": []}],
            }
            for i, v in ((0, "front"), (3, "right"))
        ],
    }


def _session(fake, sid, day, **kw):
    fake.store.session_set(
        UID,
        sid,
        {
            "site": "face_full",
            "capture_mode": "uncalibrated",
            "status": "done",
            "measured": True,
            "n_frames": 5,
            "created_at": datetime.fromisoformat(f"{day}T10:00:00+00:00").astimezone(UTC),
            "result_json": json.dumps(_result(sid, **kw)),
            "labels": {"c_002": "mole"},
        },
    )
    for v in ("front", "right"):
        fake.put(f"results/{UID}/{sid}/views/{v}.jpg", content_type="image/jpeg")


def test_every_mark_on_its_photo_with_the_counts_progress_shows(client, fake):
    _session(fake, "s_20261120_aaaaaaaa", "2026-11-20")
    _session(fake, "s_20261127_bbbbbbbb", "2026-11-27")
    weeks = client.get("/v1/spots/weeks").json()["weeks"]
    assert [w["id"] for w in weeks] == [
        "s_20261120_aaaaaaaa",
        "s_20261127_bbbbbbbb",
    ]  # oldest first
    w = weeks[1]
    assert w["complete"] and (w["blemishes"], w["dark_spots"]) == (3, 1)
    assert w["by_zone"]["right_cheek"] == {"blemishes": 2, "dark_spots": 1}
    front, right = w["views"]
    assert front["photo"]["url"].endswith("views/front.jpg") and front["photo"]["width"] == 1000
    assert front["landmarks"] == [[1.0, 2.0], [3.0, 4.0]] and right["landmarks"] is None
    assert (front["blemishes"], right["blemishes"]) == (1, 2)
    # the right cheek's dark spot sits where Gemini saw a mole: never drawn
    assert right["dark_spots"] == 0 and all(m["kind"] == "blemish" for m in right["marks"])


def test_an_older_check_in_draws_its_candidates_and_gives_no_photo_counts(client, fake):
    _session(fake, "s_20261120_aaaaaaaa", "2026-11-20", with_marks=False)
    w = client.get("/v1/spots/weeks").json()["weeks"][0]
    assert w["complete"] is False
    assert w["blemishes"] == 3  # the check-in's own count stays
    front = w["views"][0]
    assert front["blemishes"] is None and front["marks"] == [
        {"kind": "blemish", "x": 100.0, "y": 100.0, "r": 4.0, "zone": "forehead"}
    ]
