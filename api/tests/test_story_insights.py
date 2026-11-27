"""The metric story's facts beyond the whole-face number: areas, spots and product timing."""

from datetime import UTC, date, datetime

from app import metric_story, story_insights


def _m(metric_id, zones, unit="count", mdc95=1.5):
    return {
        "id": metric_id,
        "unit": unit,
        "mdc95": mdc95,
        "extras": {"by_zone": {z: {"value": v, "mdc95": b, "n": 5} for z, (v, b) in zones.items()}},
    }


def test_areas_are_judged_on_their_own_band():
    base = _m("blemishes", {"chin": (5.0, 1.5), "left_cheek": (15.0, 1.5), "nose": (1.0, None)})
    prev = _m("blemishes", {"chin": (6.0, 1.5)})
    now = _m("blemishes", {"chin": (9.0, 1.5), "left_cheek": (14.0, 1.5), "nose": (0.0, 1.5)})
    rows = {r["area"]: r for r in story_insights.areas(now, prev, base)}
    chin = rows["chin"]
    assert chin["verdict_vs_baseline"] == "real_change" and chin["way"] == "other_way"
    assert chin["change_vs_baseline"] == 4.0 and chin["change_vs_previous"] == 3.0
    assert chin["normal_range"] == 1.5  # a band is never rounded to a whole count
    assert rows["left_cheek"]["verdict_vs_baseline"] == "within_noise"  # 1 fewer, band 1.5
    assert rows["nose"]["verdict_vs_baseline"] == "no_band"  # its baseline had no band
    assert story_insights.areas(now, prev, base)[0]["area"] == "chin"  # real changes first


def test_no_areas_from_an_older_engine():
    assert story_insights.areas({"id": "redness", "extras": {}}, None, None) == []


def test_since_start_waits_two_weeks_and_two_check_ins():
    earlier = [(date(2026, 10, 23), 52.0), (date(2026, 10, 30), 50.0)]
    early = story_insights.since_start(
        "2026-10-28", "blemishes", date(2026, 11, 6), 40.0, earlier, 1.5, 0
    )
    assert early["status"] == "too_early" and early["weeks"] == 1


def test_since_start_compares_with_the_check_in_before_it():
    earlier = [
        (date(2026, 10, 23), 52.0),
        (date(2026, 10, 30), 50.0),
        (date(2026, 11, 6), 45.0),
        (date(2026, 11, 13), 41.0),
    ]
    s = story_insights.since_start(
        "2026-10-28", "blemishes", date(2026, 11, 20), 40.0, earlier, 1.5, 0
    )
    assert s["from_day"] == "2026-10-23" and s["from_value"] == 52.0  # last one before 28 Oct
    assert s["change"] == -12.0 and s["status"] == "helping" and s["check_ins"] == 4
    other = story_insights.since_start(
        "2026-10-28", "blemishes", date(2026, 11, 20), 60.0, earlier, 1.5, 0
    )
    assert other["status"] == "moving_other_way"
    flat = story_insights.since_start(
        "2026-10-28", "blemishes", date(2026, 11, 20), 51.0, earlier, 1.5, 0
    )
    assert flat["status"] == "no_change_yet"


def _track_session(sid, day, marks):
    return {"id": sid, "created_at": datetime(2026, 11, day, tzinfo=UTC), "marks": marks}


def _mark(x, y, zone, kind="blemish"):
    return {
        "candidate_id": f"c_{x}",
        "kind": kind,
        "x": x,
        "y": y,
        "zone": zone,
        "stage": "red_spot",
        "label": None,
        "diameter_mm": 3.0,
        "contrast": 5.0,
        "confirmed_here": True,
        "bbox": None,
        "crop_uri": None,
        "context_crop_uri": None,
    }


def test_spots_by_area_new_and_still_there():
    used = [
        _track_session("s1", 6, [_mark(-40, 0, "right_cheek")]),
        _track_session(
            "s2",
            13,
            [_mark(-40, 0, "right_cheek"), _mark(0, 60, "forehead"), _mark(0, -80, "chin", "spot")],
        ),
    ]
    out = story_insights.spots("blemishes", used)
    rows = {r["area"]: r for r in out["areas"]}
    assert rows["forehead"]["new_this_time"] == 1
    assert rows["right_cheek"]["still_there"] == 1 and rows["right_cheek"]["new_this_time"] == 0
    assert "chin" not in rows  # a dark spot is not a blemish
    assert story_insights.spots("redness", used) is None
    assert story_insights.spots("blemishes", used[:1]) is None  # nothing to compare with yet


def test_a_change_is_only_claimed_where_it_happened():
    f = {
        "metric_id": "blemishes",
        "verdict_vs_baseline": "real_change",
        "change_vs_previous": -3,
        "areas": [
            {
                "area": "chin",
                "label": "chin",
                "verdict_vs_baseline": "real_change",
                "way": "other_way",
            },
            {"area": "nose", "label": "nose", "verdict_vs_baseline": "within_noise"},
        ],
        "routine": [{"name": "Retinol 0.3%", "since_start": {"status": "too_early"}}],
    }
    allowed = metric_story._allowed(f)
    ok = metric_story._problem
    assert ok("More blemishes on the chin than at your start.", f, allowed) is None
    assert (
        ok("The nose improved since your start.", f, allowed)
        == "change claimed without a real change"
    )
    assert ok("Retinol 0.3% improved your skin.", f, allowed) is not None
    assert ok("Blemishes improved overall since your start.", f, allowed) is None


def test_a_named_area_is_held_to_its_own_direction():
    f = {
        "metric_id": "blemishes",
        "verdict_vs_baseline": "real_change",
        "change_vs_previous": -3,  # the whole face has fewer
        "areas": [
            {
                "area": "chin",
                "label": "chin",
                "verdict_vs_baseline": "real_change",
                "way": "other_way",
                "change_vs_baseline": 4.0,
                "change_vs_previous": 3.0,
            }
        ],
        "routine": [],
    }
    allowed = metric_story._allowed(f)
    assert metric_story._problem("Fewer blemishes on the chin.", f, allowed) == "wrong direction"
    assert metric_story._problem("More blemishes on the chin.", f, allowed) is None
