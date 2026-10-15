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
    for offset in (0, -1, -4):
        client.put(f"/v1/routine/log/{_day(offset)}/{eid}/pm")
    [entry] = client.get("/v1/routine").json()["entries"]
    assert entry["recent_use"] == {"days_used": 3, "of_days": 10}


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
