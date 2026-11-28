"""Proof never stalls on a rebuild it doesn't need (Nov 28): the same BigQuery rows keep the data
version, and at the day change yesterday's facts are served while today's are built."""

import threading
import time
from datetime import UTC, date, datetime
from types import SimpleNamespace

from app import retail_intel, retailer


def test_the_same_rows_keep_the_data_version():
    raw = {"data": {"users": [{"u": 1}]}, "at": 0.0, "version": 3}
    retailer._refresh(raw, lambda: {"users": [{"u": 1}]})
    assert raw["version"] == 3 and raw["at"] > 0  # refreshed, nothing to rebuild
    retailer._refresh(raw, lambda: {"users": [{"u": 2}]})
    assert raw["version"] == 4


def test_at_the_day_change_yesterdays_facts_are_served_while_todays_build(monkeypatch):
    class Clock:
        day = date(2026, 11, 27)

        @classmethod
        def now(cls, tz=None):
            return datetime(cls.day.year, cls.day.month, cls.day.day, 12, tzinfo=UTC)

    gate = threading.Event()
    built: list[str] = []

    def build(rows, meta):
        built.append(meta["today"])
        if len(built) > 1:
            gate.wait(5)  # today's build is slow
        return SimpleNamespace(memo={}, day=meta["today"])

    monkeypatch.setattr(retail_intel, "datetime", Clock)
    monkeypatch.setattr(retail_intel, "_facts", {})
    monkeypatch.setattr(retail_intel, "build_facts", build)
    monkeypatch.setattr(retailer, "_rows", lambda: ({}, 1))
    monkeypatch.setattr(retailer, "select", lambda *a: [])

    assert retail_intel.facts("real", "all")[0].day == "2026-11-27"
    Clock.day = date(2026, 11, 28)
    started = time.monotonic()
    f, _, day = retail_intel.facts("real", "all")
    assert f.day == "2026-11-27" and day == date(2026, 11, 27)  # served at once, not waited for
    assert time.monotonic() - started < 1
    gate.set()
    deadline = time.monotonic() + 5
    while retail_intel._facts[("real", "all")][1] != Clock.day and time.monotonic() < deadline:
        time.sleep(0.01)
    assert retail_intel.facts("real", "all")[0].day == "2026-11-28"
    assert built == ["2026-11-27", "2026-11-28"]  # one rebuild, in the background
