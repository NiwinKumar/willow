"""Routine schedules: every day, every other day, chosen weekdays; recent use and the check."""

from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from app import routine_check, routine_log, schedule
from app.schedule import Schedule


def _day(offset: int = 0) -> str:
    return (routine_log.today() + timedelta(days=offset)).isoformat()


def test_applies_on_each_kind():
    monday = date(2026, 10, 12)
    assert schedule.applies_on(None, monday)
    assert schedule.applies_on({"kind": "daily"}, monday)
    alt = {"kind": "alternate", "anchor": "2026-10-12"}
    assert [schedule.applies_on(alt, monday + timedelta(days=i)) for i in range(4)] == [
        True,
        False,
        True,
        False,
    ]
    assert schedule.applies_on(alt, monday - timedelta(days=2))  # before the anchor too
    days = {"kind": "days", "days": [0, 3]}  # Monday, Thursday
    assert [schedule.applies_on(days, monday + timedelta(days=i)) for i in range(4)] == [
        True,
        False,
        False,
        True,
    ]


def test_share_a_day():
    a = {"kind": "alternate", "anchor": "2026-10-12"}
    b = {"kind": "alternate", "anchor": "2026-10-13"}
    assert not schedule.share_a_day(a, b)  # opposite nights
    assert schedule.share_a_day(a, {"kind": "alternate", "anchor": "2026-10-14"})
    assert schedule.share_a_day(a, None)
    assert schedule.share_a_day(a, {"kind": "days", "days": [2]})  # reaches every weekday
    assert not schedule.share_a_day({"kind": "days", "days": [0]}, {"kind": "days", "days": [1]})


def test_schedule_model_validates():
    assert Schedule(kind="days", days=[3, 0, 3]).days == [0, 3]
    assert Schedule(kind="alternate").anchor is not None  # defaults to today
    assert Schedule(kind="daily", days=[1]).days is None
    with pytest.raises(ValidationError):
        Schedule(kind="days", days=[])
    with pytest.raises(ValidationError):
        Schedule(kind="days", days=[7])
    with pytest.raises(ValidationError):
        Schedule(kind="alternate", anchor="2020-01-01")


def _add(client, **extra):
    body = {"custom_name": "Serum", "slots": ["pm"], "started_at": _day(-9), **extra}
    res = client.post("/v1/routine", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def test_schedule_set_on_create_and_patch_stamps_updated_at(client, fake):
    entry = _add(client, schedule={"kind": "days", "days": [0, 2, 4]})
    assert entry["schedule"] == {
        "kind": "days",
        "days": [0, 2, 4],
        "anchor": entry["schedule"]["anchor"],
    }
    assert entry["updated_at"] == entry["created_at"]

    alt = client.patch(
        f"/v1/routine/{entry['id']}", json={"schedule": {"kind": "alternate", "anchor": _day()}}
    )
    assert alt.status_code == 200
    assert alt.json()["schedule"] == {"kind": "alternate", "days": None, "anchor": _day()}
    assert alt.json()["updated_at"] >= entry["updated_at"]

    daily = client.patch(f"/v1/routine/{entry['id']}", json={"schedule": None})
    assert daily.json()["schedule"] is None
    # an untouched schedule stays when another field changes
    client.patch(f"/v1/routine/{entry['id']}", json={"schedule": {"kind": "alternate"}})
    kept = client.patch(f"/v1/routine/{entry['id']}", json={"slots": ["am", "pm"]}).json()
    assert kept["schedule"]["kind"] == "alternate"

    bad = client.patch(f"/v1/routine/{entry['id']}", json={"schedule": {"kind": "weekly"}})
    assert bad.status_code == 422
    assert (
        client.patch(f"/v1/routine/{entry['id']}", json={"schedule": {"kind": "days"}}).status_code
        == 422
    )


def test_entries_without_a_schedule_read_as_every_day(client, fake):
    entry = _add(client)
    assert entry["schedule"] is None
    [listed] = client.get("/v1/routine").json()["entries"]
    assert listed["schedule"] is None and listed["updated_at"]


def test_routine_entries_carry_the_catalog_photo(client, fake):
    client.post(
        "/v1/routine",
        json={"product_id": "the-ordinary-niacinamide-10-zinc-1", "slots": ["pm"]},
    )
    _add(client)
    by_source = {e["product_id"]: e for e in client.get("/v1/routine").json()["entries"]}
    assert by_source["the-ordinary-niacinamide-10-zinc-1"]["image_url"].startswith("https://")
    assert by_source["the-ordinary-niacinamide-10-zinc-1"]["image_source"].startswith("https://")
    assert by_source[None]["image_url"] is None


def test_rest_days_are_not_missed_days(client, fake):
    # every other day, used today (anchor today): 5 use days in the last 10
    entry = _add(client, schedule={"kind": "alternate", "anchor": _day()})
    for offset in (0, -2, -4):
        client.put(f"/v1/routine/log/{_day(offset)}/{entry['id']}/pm")
    client.put(f"/v1/routine/log/{_day(-5)}/{entry['id']}/pm")  # a tick on a rest day still counts
    [listed] = client.get("/v1/routine", params={"today": _day()}).json()["entries"]
    # ticking started 5 days ago: days -5..0 = 6 days, of which -4, -2, 0 are use days, plus the
    # ticked rest day -5
    assert listed["recent_use"] == {"days_used": 4, "of_days": 4}


def _entry(eid, actives, slots=("pm",), sched=None):
    return {
        "id": eid,
        "custom_name": eid,
        "brand": "",
        "key_actives": [{"name": a, "pct": None} for a in actives],
        "inci": [],
        "slots": list(slots),
        "schedule": sched,
    }


def test_alternating_products_are_not_flagged_together():
    retinal = _entry("r_ret", ["retinal"])
    acid = _entry("r_gly", ["glycolic acid"])
    same = routine_check.rule_findings([retinal, acid])
    assert len(same["conflicts"]) == 1
    assert "Alternate" in same["conflicts"][0]["suggestion"]

    retinal["schedule"] = {"kind": "alternate", "anchor": _day()}
    acid["schedule"] = {"kind": "alternate", "anchor": _day(1)}
    apart = routine_check.rule_findings([retinal, acid])
    assert apart["conflicts"] == []
    assert any("alternate" in n for n in apart["notes"])

    acid["schedule"] = {"kind": "alternate", "anchor": _day(2)}  # same nights again
    assert len(routine_check.rule_findings([retinal, acid])["conflicts"]) == 1
