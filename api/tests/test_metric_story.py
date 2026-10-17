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


def test_points_compare_with_last_week_and_name_the_routine():
    s = _story(_world())
    assert s["points"][0] == "Last check-in (23 Oct): 7.95."
    assert s["points"][1] == "This check-in (30 Oct): 7.35, more even tone than last time."
    assert "real change" in s["points"][2]
    assert s["points"][3] == (
        "In your routine for this: Minimalist Alpha Arbutin 2% Serum "
        "(started 24 Oct, used 5 of 7 planned days)."
    )
    assert [p["name"] for p in s["products"]] == ["Alpha Arbutin 2% Serum"]
    assert s["reasons"] == [] and s["source"] == "facts"  # Gemini offline in tests


def test_small_change_reads_as_about_the_same():
    s = _story(_world(), "s_20261023_bbbbbbbb")
    assert s["points"][1].endswith("about the same as last time.")


GOOD_POINTS = [
    "Last week (23 Oct) your tone evenness was 7.95; this week it is 7.35, a more even tone.",
    "Across your check-ins it has moved steadily towards a more even tone since 16 Oct.",
    "Compared with your start, this is a real change, more than your photos usually vary.",
    "You started Minimalist Alpha Arbutin 2% Serum on 24 Oct and used it 5 of 7 planned days.",
]


def _gemini(monkeypatch, points, reasons=(), calls=None):
    def fake(prompt_id, contents, schema, **kw):
        if calls is not None:
            calls.append(json.loads(contents[0]))
        return schema(points=list(points), reasons=list(reasons))

    monkeypatch.setattr(metric_story.gemini, "generate_json", fake)


def test_gemini_writes_the_points_from_the_whole_history(monkeypatch):
    store, calls = _world(), []
    good = "Steady use of the serum since 24 Oct lines up with the more even tone."
    _gemini(monkeypatch, GOOD_POINTS, [good, "It improved by 40 percent."], calls)
    s = _story(store)
    assert s["source"] == "gemini" and s["points"] == GOOD_POINTS
    assert s["reasons"] == [good]  # 40 is not in the facts: that reason is dropped
    history = calls[0]["FACTS"]["history"]
    assert [h["day"] for h in history] == ["2026-10-16", "2026-10-23"]  # every earlier check-in
    assert _story(store)["points"] == GOOD_POINTS and len(calls) == 1  # kept: no second call


def test_a_point_with_jargon_or_an_invented_number_falls_back_to_the_facts(monkeypatch):
    for bad in ("The delta is 0.6 against a noise band of 0.3.", "It improved by 12 percent."):
        _gemini(monkeypatch, [*GOOD_POINTS[:2], bad])
        s = _story(_world())
        assert s["source"] == "facts" and s["points"][0] == "Last check-in (23 Oct): 7.95."


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
        _gemini(monkeypatch, [*GOOD_POINTS[:2], bad])
        assert _story(_world())["source"] == "facts", bad


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
