"""Daily caps (app/limits.py): an environment override raises a cap for an event (the finale)
without a code change; a bad value never lowers or breaks one."""

import pytest
from fastapi import HTTPException

from app import limits
from app.store import MemoryStore


def test_the_shared_demo_wisp_cap_reads_its_own_variable(monkeypatch):
    assert limits.cap("demo_advisor") == limits.CAPS["demo_advisor"]
    monkeypatch.setenv("DEMO_WISP_DAILY_CAP", "5000")
    # everyone's cap (3000) would cut a 5000 demo count short: lifted with it
    assert limits.cap("demo_advisor") == (5000, 5000)


def test_a_per_person_cap_and_everyones_can_be_set_together(monkeypatch):
    monkeypatch.setenv("DAILY_CAP_ADVISOR", "40/6000")
    assert limits.cap("advisor") == (40, 6000)
    monkeypatch.setenv("DAILY_CAP_SAMPLE_RUNS", "30")
    assert limits.cap("sample_runs") == (30, limits.CAPS["sample_runs"][1])


@pytest.mark.parametrize("raw", ["", "0", "-5", "lots", "40/", "40/x", "4.5"])
def test_a_bad_value_leaves_the_cap_as_it_is(monkeypatch, raw):
    monkeypatch.setenv("DAILY_CAP_ADVISOR", raw)
    assert limits.cap("advisor") == limits.CAPS["advisor"]


def test_take_and_usage_use_the_raised_cap_and_say_its_number(monkeypatch):
    store = MemoryStore()
    monkeypatch.setenv("DAILY_CAP_ADVISOR", "2")
    limits.take(store, "u1", "advisor")
    assert limits.usage(store, "u1")["advisor"]["cap"] == 2
    limits.take(store, "u1", "advisor")
    with pytest.raises(HTTPException) as err:
        limits.take(store, "u1", "advisor")
    assert err.value.detail == {"code": "daily_limit", "message": "That is 2 questions for today."}
