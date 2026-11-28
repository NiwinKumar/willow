"""Gemini without being asked (Nov 29): routine fix proposals, note tags, the reminder line."""

from datetime import date

import pytest

from app import gemini, note_tags, reminder_text, reminders, routine_fix
from app.store import MemoryStore

TODAY = date(2026, 11, 29)


def e(id_, name, actives=(), slots=("pm",), category="serum", schedule=None):
    return {
        "id": id_,
        "brand": "B",
        "custom_name": name,
        "category": category,
        "key_actives": [{"name": a, "pct": None} for a in actives],
        "inci": [],
        "slots": list(slots),
        "schedule": schedule,
        "ended_at": None,
    }


ROUTINE = [
    e("r_ret", "Retinol Serum", ["retinol"]),
    e("r_bha", "BHA Liquid", ["salicylic acid"]),
    e("r_c", "Vitamin C Serum", ["ascorbic acid"], slots=("am",)),
    e("r_bpo", "Spot Gel", ["benzoyl peroxide"], slots=("am",)),
    e("r_spf", "Sunscreen SPF 50", category="sunscreen", slots=("am",)),
]


def answer(*fixes):
    return lambda *a, **k: routine_fix.Proposals.model_validate({"fixes": list(fixes)})


@pytest.fixture(autouse=True)
def fresh():
    routine_fix.clear()


def test_only_schedule_fixable_pairs_are_offered():
    found = routine_fix.fixable(ROUTINE, None, TODAY)
    pairs = {frozenset(c["products"]) for c in found}
    assert pairs == {frozenset({"r_ret", "r_bha"}), frozenset({"r_c", "r_bpo"})}


def test_alternating_nights_passes_and_is_applied_as_dates(monkeypatch):
    refs = {frozenset(c["products"]): f"c{i + 1}" for i, c in
            enumerate(routine_fix.fixable(ROUTINE, None, TODAY))}  # fmt: skip
    ref = refs[frozenset({"r_ret", "r_bha"})]
    monkeypatch.setattr(
        gemini,
        "generate_json",
        answer(
            {
                "conflict": ref,
                "changes": [
                    {"product": "r_ret", "schedule": "alternate_from_tonight"},
                    {"product": "r_bha", "schedule": "alternate_from_tomorrow"},
                ],
                "reason": "Retinol Serum and BHA Liquid on alternate nights never meet.",
            }
        ),
    )
    fixes, complete = routine_fix.propose(ROUTINE, None, TODAY)
    assert complete and len(fixes) == 1
    fix = fixes[0]
    assert {c["id"]: c["schedule"]["anchor"] for c in fix["changes"]} == {
        "r_ret": "2026-11-29",
        "r_bha": "2026-11-30",
    }
    assert routine_fix.kept(ROUTINE, None, TODAY) == fixes  # the hour's answer, no new call


RET_BHA, C_BPO = {"r_ret", "r_bha"}, {"r_c", "r_bpo"}


def conflict(pair):
    return next(c for c in routine_fix.fixable(ROUTINE, None, TODAY) if set(c["products"]) == pair)


@pytest.mark.parametrize(
    "pair, changes, reason",
    [
        (RET_BHA, [{"product": "r_ret", "slots": ["am"]}], "Retinol Serum in the morning."),
        (C_BPO, [{"product": "r_c", "slots": ["pm"]}], "Use it 2 times a day."),  # new number
        (RET_BHA, [{"product": "r_spf", "slots": ["pm"]}], "Sunscreen at night."),  # not in pair
        (RET_BHA, [{"product": "r_bha", "schedule": "keep"}], "Keep it."),  # changes nothing
        (C_BPO, [{"product": "r_bpo", "slots": ["pm"]}], "Spot Gel at night."),  # meets retinol
    ],
)
def test_bad_proposals_are_dropped(pair, changes, reason):
    p = routine_fix.Proposal(conflict="c1", changes=changes, reason=reason)
    assert routine_fix.validate(p, conflict(pair), ROUTINE, None, TODAY) is None


def test_a_slot_move_that_clears_the_pair_passes():
    p = routine_fix.Proposal(
        conflict="c1", changes=[{"product": "r_c", "slots": ["pm"]}], reason="Vitamin C at night."
    )
    fix = routine_fix.validate(p, conflict(C_BPO), ROUTINE, None, TODAY)
    assert fix["changes"] == [{"id": "r_c", "slots": ["pm"]}]


def test_routes_fall_back_to_nothing_when_gemini_is_down(client, fake):
    for x in ROUTINE[:2]:
        fake.store.routine_set("u_test", x["id"], {k: v for k, v in x.items() if k != "id"})
    assert client.post("/v1/routine/fixes?today=2026-11-29").json() == {"fixes": []}


def test_note_is_read_into_listed_tags_only(client, fake, monkeypatch):
    fake.store.routine_set("u_test", "r_1", {k: v for k, v in ROUTINE[0].items() if k != "id"})
    monkeypatch.setattr(
        gemini,
        "generate_json",
        lambda *a, **k: note_tags.NoteRead.model_validate(
            {
                "tags": [
                    {"tag": "stinging", "confidence": "high"},
                    {"tag": "scent_issue", "confidence": "medium"},
                    {"tag": "dryness", "confidence": "low"},
                    {"tag": "none", "confidence": "high"},
                ]
            }
        ),
    )
    r = client.put("/v1/routine/r_1/note", json={"text": "tingles and smells odd"}).json()
    assert r["note"]["text"] == "tingles and smells odd"
    assert r["note"]["tags"] == ["stinging", "scent_issue"] and r["note"]["source"] == "gemini"
    assert client.put("/v1/routine/r_1/note", json={"text": ""}).json()["note"] is None


def test_note_is_kept_untagged_when_gemini_is_down(client, fake):
    fake.store.routine_set("u_test", "r_1", {k: v for k, v in ROUTINE[0].items() if k != "id"})
    r = client.put("/v1/routine/r_1/note", json={"text": "feels tight"}).json()
    assert r["note"]["tags"] == [] and r["note"]["source"] == "none"
    assert client.put("/v1/routine/r_9/note", json={"text": "x"}).status_code == 404


def _person(store):
    store.routine_set(
        "u1",
        "r_1",
        {**{k: v for k, v in ROUTINE[0].items() if k != "id"}, "feel": {"verdict": "working"}},
    )
    return {"profile": {}}


def test_reminder_body_is_gemini_once_a_week(monkeypatch):
    store = MemoryStore()
    user = _person(store)
    calls = []

    def fake(*a, **k):
        calls.append(a)
        return reminder_text.Lines(
            body="Your cheek close-up is due; same window light as last time.",
            recap="Retinol Serum is working for you, you said.",
        )

    monkeypatch.setattr(gemini, "generate_json", fake)
    msg = reminder_text.checkin_message(store, "u1", user, ["cheek_macro"], TODAY)
    assert msg["body"].startswith("Your cheek close-up") and msg["tag"] == "willow-checkin"
    again = reminder_text.checkin_message(store, "u1", store.user_get("u1"), ["cheek_macro"], TODAY)
    assert again["body"] == msg["body"] and len(calls) == 1


@pytest.mark.parametrize(
    "body",
    [
        "Your skin improved 12% this week.",  # a new number
        "Time to check your acne.",  # a banned word
        "x" * 141,  # too long
    ],
)
def test_reminder_falls_back_to_the_template(monkeypatch, body):
    store = MemoryStore()
    user = _person(store)
    monkeypatch.setattr(
        gemini, "generate_json", lambda *a, **k: reminder_text.Lines(body=body, recap="ok")
    )
    msg = reminder_text.checkin_message(store, "u1", user, ["cheek_macro"], TODAY)
    assert msg == reminders.payload("checkin", ["cheek_macro"])
