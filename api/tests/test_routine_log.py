"""Routine use log: ticks per day and slot, and each product's recent use."""

from datetime import timedelta

from app import routine_log


def _day(offset: int = 0) -> str:
    return (routine_log.today() + timedelta(days=offset)).isoformat()


def _add(client, slots=("am", "pm"), started=-10, name="Gentle cleanser"):
    body = {"custom_name": name, "slots": list(slots), "started_at": _day(started)}
    res = client.post("/v1/routine", json=body)
    assert res.status_code == 200, res.text
    return res.json()["id"]


def test_tick_untick_and_read_back(client, fake):
    eid = _add(client)
    day = client.put(f"/v1/routine/log/{_day()}/{eid}/pm").json()
    assert day == {"date": _day(), "used": {eid: ["pm"]}}
    client.put(f"/v1/routine/log/{_day()}/{eid}/am")
    again = client.put(f"/v1/routine/log/{_day()}/{eid}/am").json()  # idempotent
    assert again["used"][eid] == ["am", "pm"]
    client.put(f"/v1/routine/log/{_day(-1)}/{eid}/am")

    log = client.get("/v1/routine/log").json()
    assert [d["date"] for d in log["days"]] == [_day(-1), _day()]

    gone = client.delete(f"/v1/routine/log/{_day(-1)}/{eid}/am").json()
    assert gone == {"date": _day(-1), "used": {}}
    assert [d["date"] for d in client.get("/v1/routine/log").json()["days"]] == [_day()]


def test_ticks_are_checked_against_the_routine(client, fake):
    eid = _add(client, slots=("pm",), started=-3)
    assert client.put(f"/v1/routine/log/{_day()}/{eid}/am").status_code == 409  # not an AM product
    assert client.put(f"/v1/routine/log/{_day(-5)}/{eid}/pm").status_code == 409  # before start
    assert client.put(f"/v1/routine/log/{_day(-40)}/{eid}/pm").status_code == 422  # too far back
    assert client.put(f"/v1/routine/log/{_day(3)}/{eid}/pm").status_code == 422  # future
    assert client.put(f"/v1/routine/log/{_day()}/{eid}/noon").status_code == 422
    assert client.put(f"/v1/routine/log/{_day()}/r_nope/pm").status_code == 404
    assert client.put(f"/v1/routine/log/2026-13-01/{eid}/pm").status_code == 422
    assert client.put(f"/v1/routine/log/{_day(1)}/{eid}/pm").status_code == 200  # ahead of UTC


def test_routine_entries_carry_recent_use(client, fake):
    eid = _add(client, started=-9)  # in the routine 10 days, today included
    assert client.get("/v1/routine").json()["entries"][0]["recent_use"] is None  # nothing ticked
    for offset in (0, -1, -4):
        client.put(f"/v1/routine/log/{_day(offset)}/{eid}/pm")
    [entry] = client.get("/v1/routine").json()["entries"]
    # counted from the first tick (4 days ago), not from the start: never "0 of 10" for days
    # before ticking existed
    assert entry["recent_use"] == {"days_used": 3, "of_days": 5}


def test_log_range_is_bounded(client, fake):
    assert (
        client.get("/v1/routine/log", params={"from": _day(-100), "to": _day()}).status_code == 422
    )
    assert client.get("/v1/routine/log", params={"from": _day(), "to": _day(-1)}).status_code == 422


def test_delete_my_data_removes_the_log(client, fake):
    eid = _add(client)
    client.put(f"/v1/routine/log/{_day()}/{eid}/am")
    assert client.delete("/v1/me").status_code == 204
    assert fake.store.routine_log == {}


def test_a_tick_can_be_removed_after_the_product_changed_or_was_removed(client, fake):
    eid = _add(client)
    client.put(f"/v1/routine/log/{_day()}/{eid}/am")
    client.patch(f"/v1/routine/{eid}", json={"slots": ["pm"]})  # no longer an AM product
    assert client.delete(f"/v1/routine/log/{_day()}/{eid}/am").json()["used"] == {}
    client.put(f"/v1/routine/log/{_day()}/{eid}/pm")
    client.patch(f"/v1/routine/{eid}", json={"ended_at": _day(-2)})  # stopped before today
    assert client.delete(f"/v1/routine/log/{_day()}/{eid}/pm").json()["used"] == {}


def test_removing_a_product_removes_its_ticks_and_an_absent_tick_writes_nothing(client, fake):
    keep, gone = _add(client, name="Keep"), _add(client, name="Gone")
    for eid in (keep, gone):
        client.put(f"/v1/routine/log/{_day(-1)}/{eid}/am")
    assert client.delete(f"/v1/routine/{gone}").status_code == 204
    [day] = client.get("/v1/routine/log").json()["days"]
    assert day["used"] == {keep: ["am"]}
    client.delete(f"/v1/routine/log/{_day(1)}/{keep}/pm")  # never ticked: no empty doc written
    assert (("u_test", _day(1))) not in fake.store.routine_log


def test_recent_use_counts_the_persons_own_today_and_stops_at_the_stop_date(client, fake):
    eid = _add(client, started=-5)
    client.put(f"/v1/routine/log/{_day(-3)}/{eid}/am")
    client.put(f"/v1/routine/log/{_day(-2)}/{eid}/am")
    entry = client.get("/v1/routine", params={"today": _day(1)}).json()["entries"][0]
    assert entry["recent_use"] == {"days_used": 2, "of_days": 5}  # day -3 .. tomorrow (their day)
    far = client.get("/v1/routine", params={"today": _day(9)}).json()["entries"][0]
    assert far["recent_use"]["of_days"] == 5  # clamped to a day either side of UTC
    client.patch(f"/v1/routine/{eid}", json={"ended_at": _day(-2)})
    stopped = client.get("/v1/routine", params={"today": _day()}).json()["entries"][0]
    assert stopped["recent_use"] == {"days_used": 2, "of_days": 2}


def test_default_range_is_the_last_two_weeks_and_ranges_are_bounded(client, fake):
    log = client.get("/v1/routine/log").json()
    assert (log["from"], log["to"]) == (_day(-13), _day(1))
    ok = client.get("/v1/routine/log", params={"from": _day(-91), "to": _day()})
    assert ok.status_code == 200  # 92 days
    long = client.get("/v1/routine/log", params={"from": _day(-92), "to": _day()})
    assert long.status_code == 422  # 93 days


def test_one_persons_ticks_are_not_anothers(client, fake):
    eid = _add(client)
    client.put(f"/v1/routine/log/{_day()}/{eid}/am")
    other = client.get("/v1/routine/log", headers={"X-Dev-Uid": "u_other"}).json()
    assert other["days"] == []
    assert (
        client.put(
            f"/v1/routine/log/{_day()}/{eid}/am", headers={"X-Dev-Uid": "u_other"}
        ).status_code
        == 404
    )


def test_the_judge_routine_can_be_ticked_for_yesterday(client, fake):
    assert client.post("/v1/demo/judge-setup").json()["routine_added"] > 0
    entry = client.get("/v1/routine").json()["entries"][0]
    slot = entry["slots"][0]
    assert client.put(f"/v1/routine/log/{_day(-1)}/{entry['id']}/{slot}").status_code == 200
