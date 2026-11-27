"""What changed for one metric, in points (app/metric_story.py, GET /v1/sessions/{id}/story/{m})."""

import json
from datetime import UTC, datetime

from app import metric_story
from app.store import MemoryStore

UID = "u_story"


def _metric(value, delta=None, verdict="no_baseline", mdc95=0.3):
    return {
        "id": "tone_evenness",
        "group": "tone_pigment",
        "label": "Tone evenness",
        "unit": "index",
        "confidence": "indicative",
        "value": value,
        "within_session_sd": 0.1,
        "mdc95": mdc95,
        "delta": delta,
        "verdict": verdict,
        "direction": "none",
        "extras": {},
    }


def _session(store, sid, day, metric, baseline=False):
    result = {"site": "face_full", "capture_mode": "uncalibrated", "metrics": [metric]}
    store.session_set(
        UID,
        sid,
        {
            "site": "face_full",
            "capture_mode": "uncalibrated",
            "status": "done",
            "measured": True,
            "is_baseline": baseline,
            "created_at": datetime.fromisoformat(f"{day}T12:00:00+00:00"),
            "result_json": json.dumps(result),
        },
    )


def _world():
    store = MemoryStore()
    _session(store, "s_20261016_aaaaaaaa", "2026-10-16", _metric(8.02), baseline=True)
    _session(store, "s_20261023_bbbbbbbb", "2026-10-23", _metric(7.95, -0.07, "within_noise"))
    _session(store, "s_20261030_cccccccc", "2026-10-30", _metric(7.35, -0.67, "real_change"))
    store.routine_set(
        UID,
        "r_1",
        {
            "custom_name": "Alpha Arbutin 2% Serum",
            "brand": "Minimalist",
            "concerns": ["uneven_tone", "dark_spots_pigmentation"],
            "started_at": "2026-10-24",
            "ended_at": None,
            "schedule": None,
            "slots": ["pm"],
        },
    )
    store.routine_set(
        UID,
        "r_2",
        {  # not aimed at tone evenness: never listed
            "custom_name": "Barrier cream",
            "brand": "X",
            "concerns": ["dryness_barrier"],
            "started_at": "2026-10-01",
            "ended_at": None,
            "schedule": None,
            "slots": ["pm"],
        },
    )
    for day in ("2026-10-24", "2026-10-25", "2026-10-27", "2026-10-28", "2026-10-30"):
        store.routine_log_mark(UID, day, "r_1", "pm", True)
    return store


def _story(store, sid="s_20261030_cccccccc"):
    return metric_story.story(store, UID, sid, store.session_get(UID, sid), "tone_evenness")


def test_the_intro_compares_with_the_start_then_last_week():
    s = _story(_world())
    # a short intro: how it compares with the start, then with last time; the rows hold the rest
    assert s["points"] == [
        "Improved since your start, beyond your normal range.",
        "More even tone than at your last check-in on 23 Oct.",
    ]
    assert s["products"][0]["since_start"]["status"] == "too_early"  # 6 days, 1 check-in
    assert [p["name"] for p in s["products"]] == ["Alpha Arbutin 2% Serum"]
    assert s["reasons"] == [] and s["source"] == "facts"  # Gemini offline in tests


def test_small_change_reads_as_about_the_same():
    s = _story(_world(), "s_20261023_bbbbbbbb")
    assert s["points"][-1] == "About the same as your last check-in on 16 Oct."


GOOD_POINTS = [
    "Your tone is more even than at your start, more than your photos usually vary.",
    "It also moved that way since your last check-in on 23 Oct.",
]
FACTS_START = "Improved since your start, beyond your normal range."


def _gemini(monkeypatch, points, reasons=(), calls=None):
    def fake(prompt_id, contents, schema, **kw):
        if calls is not None:
            calls.append(json.loads(contents[0]))
        return schema(points=list(points), reasons=list(reasons))

    monkeypatch.setattr(metric_story.gemini, "generate_json", fake)


def test_gemini_writes_the_points_from_the_whole_history(monkeypatch):
    store, calls = _world(), []
    _gemini(monkeypatch, GOOD_POINTS, ["Steady use lines up with it."], calls)
    s = _story(store)
    assert s["source"] == "gemini" and s["points"] == GOOD_POINTS
    assert s["reasons"] == []  # the intro has no reasons block
    history = calls[0]["FACTS"]["history"]
    assert [h["day"] for h in history] == ["2026-10-16", "2026-10-23"]  # every earlier check-in
    assert _story(store)["points"] == GOOD_POINTS and len(calls) == 1  # kept: no second call


def test_a_point_with_jargon_or_an_invented_number_falls_back_to_the_facts(monkeypatch):
    for bad in ("The delta is 0.6 against a noise band of 0.3.", "It improved by 12 percent."):
        _gemini(monkeypatch, [GOOD_POINTS[0], bad])
        s = _story(_world())
        assert s["source"] == "facts" and s["points"][0] == FACTS_START


def test_no_real_change_may_not_be_claimed(monkeypatch):
    _gemini(monkeypatch, ["Your tone evenness shows a real change since last week."])
    s = _story(_world(), "s_20261023_bbbbbbbb")  # within_noise against the baseline
    assert s["source"] == "facts"


def test_years_causes_and_the_wrong_direction_fall_back_to_the_facts(monkeypatch):
    for bad in (
        "Your tone is more even than in 2026.",  # a year is not a measurement
        "The serum caused the more even tone.",
        "At 7.35 it is a less even tone than last time.",  # the value went down: more even
    ):
        _gemini(monkeypatch, [GOOD_POINTS[0], bad])
        assert _story(_world())["source"] == "facts", bad


def test_a_long_intro_falls_back_to_the_facts(monkeypatch):
    long = "Your tone is more even than at your start, more than your photos usually vary. " * 4
    _gemini(monkeypatch, [long])
    assert _story(_world())["source"] == "facts"  # over MAX_WORDS: the rows hold the details


def test_skin_tone_is_never_written_by_gemini(monkeypatch):
    store, calls = _world(), []
    _gemini(monkeypatch, ["Your skin tone is a better result."], calls=calls)
    m = _metric(55.0, 2.0, "real_change") | {"id": "tone_ita", "label": "Skin tone", "unit": "deg"}
    _session(store, "s_20261031_dddddddd", "2026-10-31", m)
    s = metric_story.story(
        store, UID, "s_20261031_dddddddd", store.session_get(UID, "s_20261031_dddddddd"), "tone_ita"
    )
    assert s["source"] == "facts" and calls == []


def test_past_the_daily_cap_the_story_comes_from_the_facts(monkeypatch):
    store, calls = _world(), []
    _gemini(monkeypatch, GOOD_POINTS, calls=calls)
    monkeypatch.setitem(metric_story.limits.CAPS, "metric_story", (0, 10))
    assert _story(store)["source"] == "facts" and calls == []


def test_no_reading_gives_none():
    store = _world()
    sid = "s_20261030_cccccccc"
    assert metric_story.story(store, UID, sid, store.session_get(UID, sid), "redness") is None


def test_route(client, monkeypatch):
    from app.main import app
    from app.store import get_store

    store = MemoryStore()
    for sid, day, m, b in (
        ("s_20261016_aaaaaaaa", "2026-10-16", _metric(8.02), True),
        ("s_20261030_cccccccc", "2026-10-30", _metric(7.35, -0.67, "real_change"), False),
    ):
        result = {"site": "face_full", "capture_mode": "uncalibrated", "metrics": [m]}
        store.session_set(
            "u_test",
            sid,
            {
                "site": "face_full",
                "capture_mode": "uncalibrated",
                "status": "done",
                "measured": True,
                "is_baseline": b,
                "result_json": json.dumps(result),
                "created_at": datetime.fromisoformat(f"{day}T12:00:00").replace(tzinfo=UTC),
            },
        )
    app.dependency_overrides[get_store] = lambda: store
    try:
        r = client.get("/v1/sessions/s_20261030_cccccccc/story/tone_evenness")
        assert r.status_code == 200 and r.json()["has_previous"] is True
        assert client.get("/v1/sessions/s_20261030_cccccccc/story/Bad!").status_code == 404
    finally:
        app.dependency_overrides.pop(get_store, None)


def _story_uses(store):
    day = datetime.now(UTC).date().isoformat()
    return store.usage.get((UID, day, "metric_story"), 0)


def test_a_story_gemini_could_not_write_gives_the_use_back(monkeypatch):
    store = _world()
    assert _story(store)["source"] == "facts"  # Gemini offline in tests
    assert _story_uses(store) == 0
    _gemini(monkeypatch, ["It improved by 40 percent."])  # a point that fails the checks
    assert _story(store)["source"] == "facts" and _story_uses(store) == 0
    _gemini(monkeypatch, GOOD_POINTS)
    assert _story(store)["source"] == "gemini" and _story_uses(store) == 1


def test_the_sessions_are_read_once_per_story(monkeypatch):
    store = _world()
    reads = []
    real = store.sessions_list
    monkeypatch.setattr(store, "sessions_list", lambda uid: reads.append(uid) or real(uid))
    s = _story(store)
    assert s["points"][0] == FACTS_START and len(reads) == 1


def test_a_story_kept_meanwhile_for_another_metric_is_not_overwritten(monkeypatch):
    store = _world()
    sid = "s_20261030_cccccccc"
    doc = store.session_get(UID, sid)  # read before another request kept its story
    store.session_update(UID, sid, {"stories": {"redness": {"key": "k", "points": ["x"]}}})
    _gemini(monkeypatch, GOOD_POINTS)
    metric_story.story(store, UID, sid, doc, "tone_evenness")
    assert set(store.session_get(UID, sid)["stories"]) == {"redness", "tone_evenness"}


def test_a_date_may_be_written_with_or_without_a_leading_zero():
    allowed = metric_story._allowed({"routine": [{"started": "2026-08-01"}], "value": 4.2})
    assert {"01", "1", "4.2"} <= allowed
    assert "2026" not in allowed and "08" not in allowed


def test_a_story_is_shown_when_its_session_went_away_meanwhile(monkeypatch):
    store = _world()
    _gemini(monkeypatch, GOOD_POINTS)

    def gone(*a, **kw):
        raise RuntimeError("404 No document to update")

    monkeypatch.setattr(store, "session_update", gone)
    assert _story(store)["points"] == GOOD_POINTS


def test_areas_and_product_timing_only_compare_the_same_engine():
    store = MemoryStore()

    def zoned(value, version):
        m = _metric(value) | {"extras": {"by_zone": {"chin": {"value": value, "mdc95": 0.2}}}}
        return m, version

    for sid, day, (m, version), base in (
        ("s_20261016_aaaaaaaa", "2026-10-16", zoned(8.0, "0.3.4"), True),
        ("s_20261030_cccccccc", "2026-10-30", zoned(7.0, "0.4.2"), False),
    ):
        _session(store, sid, day, m, baseline=base)
        doc = store.session_get(UID, sid)
        result = json.loads(doc["result_json"]) | {"engine_version": version}
        store.session_set(UID, sid, doc | {"result_json": json.dumps(result)})
    sid = "s_20261030_cccccccc"
    f = metric_story.facts(store, UID, sid, store.session_get(UID, sid), "tone_evenness")
    chin = f["areas"][0]
    assert chin["area"] == "chin" and "baseline_value" not in chin  # 0.3 vs 0.4: not compared
    assert "previous_value" not in chin
