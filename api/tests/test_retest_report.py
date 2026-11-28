"""Test-retest report (scripts/retest_report.py): a retest within a day is paired with the
baseline, and a `real_change` on it counts as a false change."""

import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import retest_report  # noqa: E402

from app.store import MemoryStore  # noqa: E402

T0 = datetime(2026, 11, 29, 10, tzinfo=UTC)


def _session(store, uid, sid, at, verdicts, baseline=False, passed=True):
    metrics = [
        {"id": "tone_ita", "value": 30, "extras": {"ita_band": "tan"}},
        *[
            {"id": k, "value": 5.0, "delta": d, "mdc95": 1.0, "verdict": v}
            for k, (v, d) in verdicts.items()
        ],
    ]
    result = {"site": "face_full", "metrics": metrics, "quality": {"passed": passed}}
    store.session_set(
        uid,
        sid,
        {
            "site": "face_full",
            "capture_mode": "uncalibrated",
            "status": "done",
            "measured": True,
            "is_baseline": baseline,
            "created_at": at,
            "result_json": json.dumps(result),
        },
    )


def test_a_retest_within_a_day_is_paired_and_false_changes_are_counted():
    store = MemoryStore()
    _session(store, "a", "s1", T0, {"redness": ("no_baseline", None)}, baseline=True)
    _session(
        store,
        "a",
        "s2",
        T0 + timedelta(hours=2),
        {"redness": ("within_noise", 0.4), "blemishes": ("real_change", 1.5)},
    )
    # a third check-in a week later is a real follow-up, not a retest
    _session(store, "a", "s3", T0 + timedelta(days=7), {"redness": ("real_change", 3.0)})
    # someone whose retest failed the quality check has no pair
    _session(store, "b", "s1", T0, {"redness": ("no_baseline", None)}, baseline=True)
    _session(
        store, "b", "s2", T0 + timedelta(hours=1), {"redness": ("real_change", 2)}, passed=False
    )
    out = retest_report.report(store, ["a", "b"])
    assert (out["people"], out["readings"], out["false_changes"]) == (1, 2, 1)
    assert out["false_change_rate"] == 0.5
    assert out["by_tone_band"] == [{"band": "tan", "people": 1, "readings": 2, "false_changes": 1}]
    by = {r["metric_id"]: r for r in out["by_reading"]}
    assert by["redness"]["median_move_vs_noise_band"] == 0.4
