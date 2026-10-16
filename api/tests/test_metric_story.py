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
    assert s["points"][1] == "This check-in (30 Oct): 7.35: more even tone than last time."
    assert "real change" in s["points"][2]
    assert s["points"][3] == (
        "In your routine for this: Minimalist Alpha Arbutin 2% Serum "
        "(started 24 Oct, used 5 of 7 planned days)."
    )
    assert [p["name"] for p in s["products"]] == ["Alpha Arbutin 2% Serum"]
    assert s["reasons"] == []  # Gemini offline in tests: the points stand alone


def test_small_change_reads_as_about_the_same():
    s = _story(_world(), "s_20261023_bbbbbbbb")
    assert s["points"][1].endswith("about the same as last time.")


def test_reasons_with_invented_numbers_are_dropped_and_good_ones_cached(monkeypatch):
    store, calls = _world(), []

    def fake(prompt_id, contents, schema, **kw):
        calls.append(prompt_id)
        return schema(
            reasons=[
                "Steady use of the serum since 24 Oct lines up with the more even tone.",
                "It improved by 40 percent.",  # 40 is not in the facts
            ]
        )

    monkeypatch.setattr(metric_story.gemini, "generate_json", fake)
    s = _story(store)
    assert s["reasons"] == [
        "Steady use of the serum since 24 Oct lines up with the more even tone."
    ]
    assert _story(store)["reasons"] == s["reasons"] and calls == ["metric_story"]  # cached


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
