"""What else changed since the last check-in (app/changes.py, app/changes_ai.py)."""

import json
from datetime import datetime

from app import changes, changes_ai, metric_story
from app.store import MemoryStore

UID = "u_test"


def _blemishes(value, mdc95=4.0, zones=None):
    m = {
        "id": "blemishes",
        "group": "texture",
        "label": "Blemishes",
        "unit": "count",
        "confidence": "indicative",
        "value": value,
        "within_session_sd": 1.0,
        "mdc95": mdc95,
        "delta": None,
        "verdict": "within_noise",
        "direction": "none",
        "extras": {},
    }
    return m


def _session(
    store, sid, day, metrics, tags=None, answered=True, zones=None, mode="uncalibrated", passed=True
):
    result = {
        "site": "face_full",
        "capture_mode": mode,
        "metrics": metrics,
        "quality": {"passed": passed},
    }
    if zones:  # the metric's own extras.by_zone (engine 0.4.1+)
        for m in metrics:
            if m["id"] == "blemishes":
                m["extras"] = {"by_zone": {z: {"value": v} for z, v in zones.items()}}
    doc = {
        "site": "face_full",
        "capture_mode": mode,
        "status": "done",
        "measured": True,
        "is_baseline": False,
        "n_frames": 3,
        "created_at": datetime.fromisoformat(f"{day}T12:00:00+00:00"),
        "result_json": json.dumps(result),
    }
    if answered:
        doc["changes"] = {"tags": tags or [], "other": None, "nothing": not tags}
    store.session_set(UID, sid, doc)


def _weeks(store, rows):
    """rows: (blemish count, tags, chin count)."""
    for i, (value, tags, chin) in enumerate(rows):
        day = f"2026-09-{i + 1:02d}" if i < 9 else f"2026-10-{i - 8:02d}"
        sid = f"s_{day.replace('-', '')}_{i:08x}"
        _session(store, sid, day, [_blemishes(value)], tags, zones={"chin": chin, "forehead": 5})


# ---------------------------------------------------------------- saving and reading back


def _create(client):
    res = client.post(
        "/v1/sessions",
        json={
            "site": "face_full",
            "capture_mode": "uncalibrated",
            "n_frames": 3,
            "content_types": ["image/jpeg"] * 3,
        },
    )
    assert res.status_code == 200, res.text
    return res.json()["session_id"]


def test_changes_are_kept_on_the_session_with_their_words(client, fake):
    sid = _create(client)
    res = client.patch(
        f"/v1/sessions/{sid}",
        json={"changes": {"tags": ["period", "stress_study", "period"], "other": "  exams  "}},
    )
    assert res.status_code == 200, res.text
    got = res.json()["session"]["changes"]
    assert got["tags"] == ["period", "stress_study"]
    assert got["words"] == ["had a period", "study stress or exams"]
    assert got["other"] == "exams" and got["nothing"] is False and got["answered_at"]
    # the session list carries it too
    listed = client.get("/v1/sessions").json()["sessions"][0]["session"]["changes"]
    assert listed["tags"] == ["period", "stress_study"]


def test_an_empty_answer_is_nothing_different_and_null_clears_it(client, fake):
    sid = _create(client)
    got = client.patch(f"/v1/sessions/{sid}", json={"changes": {}}).json()["session"]["changes"]
    assert got["nothing"] is True and got["tags"] == []
    cleared = client.patch(f"/v1/sessions/{sid}", json={"changes": None}).json()
    assert cleared["session"]["changes"] is None


def test_unknown_tags_and_long_text_are_refused(client, fake):
    sid = _create(client)
    assert (
        client.patch(f"/v1/sessions/{sid}", json={"changes": {"tags": ["acne"]}}).status_code == 422
    )
    long = {"changes": {"other": "x" * 281}}
    assert client.patch(f"/v1/sessions/{sid}", json=long).status_code == 422


def test_the_prefill_names_routine_products_started_since_the_last_check_in(client, fake):
    store = fake.store
    _session(store, "s_20261101_aaaaaaaa", "2026-11-01", [_blemishes(20)])
    _session(store, "s_20261108_bbbbbbbb", "2026-11-08", [_blemishes(18)], answered=False)
    store.routine_set(
        UID,
        "r_1",
        {
            "custom_name": "Mandelic 8% Serum",
            "brand": "Mixi",
            "concerns": ["acne_blemishes"],
            "started_at": "2026-11-03",
            "ended_at": None,
            "schedule": None,
            "slots": ["pm"],
        },
    )
    for day in ("2026-11-03", "2026-11-04", "2026-11-06"):
        store.routine_log_mark(UID, day, "r_1", "pm", True)
    got = client.get("/v1/sessions/s_20261108_bbbbbbbb/changes").json()
    assert got["since"] == "2026-11-01" and got["changes"] is None
    assert got["routine"] == [
        {
            "name": "Mandelic 8% Serum",
            "brand": "Mixi",
            "started": "2026-11-03",
            "stopped": None,
            "use": {"days_used": 3, "of_days": 6},
        }
    ]


# ---------------------------------------------------------------- reading free text


def test_without_gemini_a_word_list_reads_the_text(client, fake):
    sid = _create(client)
    res = client.post(
        f"/v1/sessions/{sid}/changes/read",
        json={"text": "Went to Bali for a week, lots of sun at the beach, ate junk food"},
    )
    got = res.json()
    assert got["source"] == "words"
    assert {"travel", "travel_humid", "sun", "diet"} <= set(got["tags"])
    assert got["reaction"] is False


def test_gemini_reads_tags_and_only_products_named_in_the_text(monkeypatch):
    def fake(prompt_id, contents, schema, **kw):
        assert prompt_id == "changes_read"
        return schema(
            tags=["routine_new", "sport_swim"],
            products=["Mixi Mandelic 8% Serum", "A Serum Gemini Made Up", "the new serum"],
            reaction=False,
        )

    monkeypatch.setattr(changes_ai.gemini, "generate_json", fake)
    text = "Started Mixi Mandelic 8% Serum and it stings a bit, the new serum is fine"
    got = changes_ai.read(MemoryStore(), UID, text)
    assert got["source"] == "gemini"
    assert got["tags"] == ["sport_swim", "routine_new"]  # in the list's order
    assert [p["text"] for p in got["products"]] == ["Mixi Mandelic 8% Serum"]
    assert got["reaction"] is True  # "stings": the reaction words count even when Gemini says no


def test_past_the_cap_the_word_list_answers(monkeypatch):
    from fastapi import HTTPException

    def capped(*a, **k):
        raise HTTPException(429, "cap")

    monkeypatch.setattr(changes_ai.limits, "take", capped)
    got = changes_ai.read(MemoryStore(), UID, "exams and no sleep")
    assert got["source"] == "words" and got["tags"] == ["stress_study", "sleep_poor"]


# ---------------------------------------------------------------- patterns


def test_a_pattern_needs_three_weeks_each_side_beyond_the_normal_range():
    store = MemoryStore()
    _weeks(
        store,
        [
            (40, ["period"], 12),
            (22, [], 3),
            (24, ["sun"], 4),
            (41, ["period", "stress_work"], 11),
            (20, [], 3),
            (38, ["period"], 10),
            (23, [], 4),
        ],
    )
    got = changes.find(store, UID)
    period = [p for p in got["patterns"] if p["group"] == "period"]
    assert len(period) == 1
    p = period[0]
    assert p["metric_id"] == "blemishes" and p["higher"] and p["way"] == "other_way"
    assert (p["noted"], p["same_way"], p["others"]) == (3, 3, 4)
    assert p["areas"] == ["on your chin"]  # the forehead was the same on both sides
    assert p["text"].startswith(
        "Blemishes were higher on 3 of the 3 check-ins where you noted your period"
    )
    assert "caus" not in p["text"]
    # stress and sun were noted once: still learning (no numbers), never a pattern
    assert {b["group"] for b in got["learning"]} == {"stress", "sun"}
    assert got["same"] == []


def test_no_pattern_inside_the_normal_range_or_without_enough_weeks():
    store = MemoryStore()
    _weeks(
        store,
        [
            (22, ["sleep_poor"], 3),
            (21, [], 3),
            (23, ["sleep_poor"], 3),
            (22, [], 3),
            (21, ["sleep_poor"], 3),
            (22, [], 3),
        ],
    )
    got = changes.find(store, UID)
    assert got["patterns"] == []
    # enough check-ins on both sides and no difference: said plainly, as a finding
    assert got["same"] == [
        {
            "group": "sleep",
            "about": "poor sleep",
            "text": "No clear difference in your blemishes on check-ins where you noted "
            "poor sleep.",
        }
    ]
    store2 = MemoryStore()
    _weeks(store2, [(40, ["period"], 3), (20, [], 3), (41, ["period"], 3), (21, [], 3)])
    assert changes.find(store2, UID)["patterns"] == []


def test_check_ins_without_an_answer_count_on_neither_side():
    store = MemoryStore()
    _weeks(
        store,
        [(40, ["period"], 3), (22, [], 3), (41, ["period"], 3), (20, [], 3), (38, ["period"], 3)],
    )
    # two high check-ins with no answer: not "weeks without a period"
    _session(store, "s_20261101_eeeeeeee", "2026-11-01", [_blemishes(45)], answered=False)
    _session(store, "s_20261102_ffffffff", "2026-11-02", [_blemishes(44)], answered=False)
    assert changes.find(store, UID)["answered"] == 5
    assert changes.find(store, UID)["patterns"] == []  # only 2 answered weeks without


def test_the_story_mentions_the_week_and_the_pattern():
    store = MemoryStore()
    _weeks(
        store,
        [
            (40, ["period"], 3),
            (22, [], 3),
            (41, ["period"], 3),
            (20, [], 3),
            (39, ["period", "sleep_poor"], 3),
            (21, [], 3),
        ],
    )
    sid, doc = max(
        ((s, d) for s, d in store.sessions_list(UID) if "sleep_poor" in d["changes"]["tags"]),
        key=lambda r: r[1]["created_at"],
    )
    f = metric_story.facts(store, UID, sid, doc, "blemishes")
    assert f["this_week"] == ["had a period", "slept badly"]
    assert f["patterns"] and f["patterns"][0].startswith("Blemishes were higher")
    out = metric_story.story(store, UID, sid, doc, "blemishes")  # Gemini offline: the facts
    assert out["source"] == "facts"
    # the app shows them in their own row ("What else was going on"), not as points
    assert not any("noted" in p for p in out["points"])
    assert out["this_week"] == ["had a period", "slept badly"] and out["patterns"]


def test_wisp_reads_the_noted_changes_and_the_patterns():
    from app import advisor

    store = MemoryStore()
    rows = [(40, ["period"], 3), (22, [], 3), (41, ["period"], 3), (20, [], 3), (39, ["period"], 3)]
    _weeks(store, rows + [(21, ["sleep_poor"], 3)])
    for sid, d in store.sessions_list(UID):  # the advisor reads sessions whose quality passed
        r = json.loads(d["result_json"])
        r |= {"quality": {"passed": True}, "frames_used": 3}
        store.session_update(UID, sid, {"result_json": json.dumps(r)})
    ctx = advisor.context(store, UID)
    latest = ctx["latest_sessions"]["face_full (uncalibrated)"]
    assert latest["noted_since_last_check_in"] == ["slept badly"]
    assert ctx["life_patterns"][0].startswith("Blemishes were higher on 3 of the 3")


def test_check_ins_that_failed_the_quality_check_count_nowhere():
    store = MemoryStore()
    _weeks(
        store, [(40, ["period"], 12), (22, [], 3), (41, ["period"], 11), (20, [], 3), (23, [], 4)]
    )
    # a third noted week, but its photos were rejected: no pattern from two good weeks
    _session(store, "s_20261020_rejected", "2026-10-20", [_blemishes(39)], ["period"], passed=False)
    assert changes.find(store, UID)["patterns"] == []
    # and a retake after a rejected check-in still asks since the last good one
    doc = {"site": "face_full", "created_at": datetime.fromisoformat("2026-10-21T12:00:00+00:00")}
    prev = changes.previous_session(store, UID, "s_new", doc)
    assert prev is not None and prev[0] != "s_20261020_rejected"
