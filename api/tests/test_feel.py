"""How a product feels (app/feel.py): the person's answer, the cohort's, and what brands see."""

from collections import Counter
from datetime import UTC, date, datetime, timedelta

from app import cohort, feel, retail_intel, retailer
from tests.test_retail_intel import CICA, M, _changed, _f, _tables, _use, _user


def _entry(client, started: str) -> dict:
    r = client.post(
        "/v1/routine",
        json={"custom_name": "Night cream", "source": "manual", "started_at": started},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_answer_is_saved_one_per_week_on_current_and_stopped_products(client, fake):
    started = (datetime.now(UTC).date() - timedelta(days=17)).isoformat()
    e = _entry(client, started)
    assert e["feel"] is None and e["feel_history"] == []

    first = client.put(f"/v1/routine/{e['id']}/feel", json={"verdict": "unsure"})
    assert first.status_code == 200, first.text
    assert first.json()["feel"]["verdict"] == "unsure"
    assert first.json()["feel"]["week"] == 2  # 17 days in

    again = client.put(
        f"/v1/routine/{e['id']}/feel",
        json={"verdict": "working", "tags": ["absorbs", "softer", "absorbs"]},
    ).json()
    assert again["feel"]["verdict"] == "working"
    assert again["feel"]["tags"] == ["absorbs", "softer"]
    assert len(again["feel_history"]) == 1  # the same week's answer is replaced

    listed = client.get("/v1/routine").json()["entries"][0]
    assert listed["feel"]["verdict"] == "working"

    client.patch(f"/v1/routine/{e['id']}", json={"ended_at": datetime.now(UTC).date().isoformat()})
    stopped = client.put(f"/v1/routine/{e['id']}/feel", json={"verdict": "not_for_me"})
    assert stopped.status_code == 200 and stopped.json()["feel"]["verdict"] == "not_for_me"


def test_bad_answers_are_refused(client, fake):
    e = _entry(client, "2026-10-01")
    url = f"/v1/routine/{e['id']}/feel"
    assert client.put(url, json={"verdict": "amazing"}).status_code == 422
    assert client.put(url, json={"verdict": "working", "tags": ["glowing"]}).status_code == 422
    five = ["feels_nice", "absorbs", "softer", "looks_better", "heavy"]
    assert client.put(url, json={"verdict": "working", "tags": five}).status_code == 422
    assert client.put("/v1/routine/r_missing/feel", json={"verdict": "working"}).status_code == 404
    assert client.put("/v1/routine/bad id!/feel", json={"verdict": "working"}).status_code == 404


def test_history_keeps_one_answer_a_week():
    doc = {"started_at": "2026-09-01"}
    for days, verdict in [(3, "unsure"), (10, "unsure"), (12, "working"), (30, "working")]:
        feel.record(doc, verdict, [], datetime(2026, 9, 1, tzinfo=UTC) + timedelta(days=days))
    assert [(h["week"], h["verdict"]) for h in doc["feel_history"]] == [
        (0, "unsure"),
        (1, "working"),
        (4, "working"),
    ]
    assert feel.week_of(None, date(2026, 10, 1)) == 0
    assert feel.words(doc["feel"]) == {"verdict": "It's working for me", "feels": [], "week": 4}


def test_synthetic_answers_leave_every_other_number_alone():
    rows = _tables()["routine_flat"]
    said = [r for r in rows if r["feel"]]
    assert 0.3 < len(said) / len(rows) < 0.7
    assert all(r["feel_week"] >= 2 for r in said)
    assert all(t in feel.TAGS for r in said for t in r["feel_tags"])
    # the same people, routines and readings as without feel (its draws use their own stream)
    keys = ("user_hash", "product_id", "started_week", "stopped_week")
    again = cohort.generate(date(2026, 10, 15))["routine_flat"]
    assert [tuple(r[k] for k in keys) for r in again] == [tuple(r[k] for k in keys) for r in rows]
    verdicts = Counter(r["feel"] for r in said)
    assert set(verdicts) == set(feel.VERDICTS)


def _said(i, verdict, week=4, tags=()):
    return {**_use(i, CICA), "feel": verdict, "feel_week": week, "feel_tags": list(tags)}


def test_brands_see_totals_of_ten_or_more_never_mixed_into_the_tier():
    users = [_user(i) for i in range(30)]
    first = [_changed(i) for i in range(12)] + [_changed(i, start=8) for i in (20, 21, 22)]
    plain = _f(users, first=first, routine=[_use(i, CICA) for i in range(20)])
    routine = [
        _said(i, "working" if i < 8 else "not_for_me", tags=["stings"] if i >= 8 else [])
        for i in range(14)
    ] + [_said(i, "working", week=1) for i in range(14, 16)]  # too early to count
    routine += [_use(i, CICA) for i in range(16, 20)]
    f = _f(users, first=first, routine=routine)

    row = retail_intel._stats(f, CICA)["row"]
    assert row["felt_n"] == 14 and row["felt"] == round(8 / 14, 2)
    base = retail_intel._stats(plain, CICA)["row"]
    assert {k: row[k] for k in base if k not in ("felt", "felt_n")} == {
        k: base[k] for k in base if k not in ("felt", "felt_n")
    }  # the Proof numbers do not move

    view = retail_intel._feel(f, CICA)
    assert view["n"] == 14 and view["working"] == round(8 / 14, 2)
    assert [t["tag"] for t in view["tags"]] == []  # 6 said stings: under 10
    # felt vs measured: users 0-7 felt and 0-11 changed
    assert view["agree"] == {
        "n": 14,
        "both": round(8 / 14, 2),
        "felt_only": 0.0,
        "measured_only": round(4 / 14, 2),
        "neither": round(2 / 14, 2),
    }

    few = _f(users, first=first, routine=[_said(i, "working") for i in range(M - 1)])
    assert retail_intel._feel(few, CICA) is None
    assert retail_intel._stats(few, CICA)["row"]["felt"] is None


def test_the_product_view_and_brief_carry_feel_from_the_cohort():
    raw = retailer.raw_from_tables(_tables())
    f = retail_intel.build_facts(raw)
    proven = next(r for r in retail_intel.rows(f) if r["tier"] == "proven")
    view = retail_intel.product_view(f, proven["product_id"])
    assert view["feel"]["n"] >= M and view["feel"]["note"].startswith("Self-reported")
    cards = retail_intel._retailer_cards(f)
    gap = [c for c in cards if c["id"] == "feel_gap"]
    assert gap and "self-reported" in gap[0]["body"]
