import importlib.util
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app import retailer
from app.store import MemoryStore

spec = importlib.util.spec_from_file_location(
    "export_bq", Path(__file__).resolve().parent.parent / "scripts" / "export_bq.py"
)
export_bq = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export_bq)

BASE = datetime(2026, 8, 3, 9, tzinfo=UTC)


def _session(week: int, delta: float) -> dict:
    result = {
        "quality": {"passed": True},
        "metrics": [
            {
                "id": "redness",
                "value": 10.0,
                "delta": delta,
                "mdc95": 0.8,
                "verdict": "real_change",
            },
            {
                "id": "tone_ita",
                "value": 30.0,
                "extras": {"ita_band": "tan"},
                "verdict": "within_noise",
            },
        ],
    }
    return {
        "status": "done",
        "site": "face_full",
        "created_at": BASE + timedelta(weeks=week),
        "compared_with": {"session_created_at": BASE},
        "result_json": json.dumps(result),
        "measured": True,
    }


def test_real_rows_take_goals_and_skin_type_from_the_profile_and_count_findings():
    store = MemoryStore()
    store.users["in"] = {
        "consent": {"aggregate_insights_opt_in": True},
        "profile": {"goals": ["redness", "dark_spots"], "skin_type": "sensitive"},
    }
    store.users["out"] = {"consent": {"aggregate_insights_opt_in": False}}
    for w in (1, 8, 9):
        store.session_set("in", f"s{w}", _session(w, -1.0))
        store.session_set("out", f"s{w}", _session(w, -1.0))
    store.routine_set(
        "in",
        "r1",
        {
            "product_id": "the-ordinary-niacinamide-10-zinc-1",
            "started_at": "2026-08-03",
            "ended_at": "2026-08-25",
            "slots": ["pm"],
            "custom_name": "Niacinamide",
            "key_actives": [{"name": "niacinamide"}],
            "inci": [],
        },
    )
    store.routine_set(
        "in",
        "r2",
        {
            "product_id": "cerave-pm-facial-moisturizing-lotion",
            "started_at": "2026-08-17",
            "ended_at": None,
            "slots": ["pm"],
            "custom_name": "PM lotion",
            "key_actives": [{"name": "niacinamide"}],
            "inci": [],
        },
    )
    out = export_bq.real_rows(store)
    (user,) = out["users_flat"]
    assert user["goals"] == ["redness", "dark_spots"] and user["skin_type"] == "sensitive"
    assert user["last_week"] == 9 and user["tone_band"] == "tan" and not user["is_synthetic"]
    assert {r["month"] for r in out["goals_monthly"]} == {"2026-08", "2026-09", "2026-10"}
    assert all(r["goals"] == ["redness", "dark_spots"] for r in out["sessions_flat"])
    weeks = {r["product_id"]: (r["started_week"], r["stopped_week"]) for r in out["routine_flat"]}
    assert weeks == {
        "the-ordinary-niacinamide-10-zinc-1": (0, 3),
        "cerave-pm-facial-moisturizing-lotion": (2, None),
    }
    # the ended product no longer counts, so one niacinamide product: no duplicate
    assert [r["kind"] for r in out["routine_conflicts"]] == ["none"]
    # the rows feed the same aggregation as the synthetic cohort
    raw = retailer.raw_from_tables(out)
    assert raw["users"][0]["skin_type"] == "sensitive"


def test_dry_run_builds_every_table_without_loading(capsys):
    assert export_bq.main(["--dry-run", "--synthetic-only", "--today", "2026-10-15"]) == 0
    printed = capsys.readouterr().out
    for name in ("products", "sessions_flat", "users_flat", "goals_monthly", "routine_flat"):
        assert f"{name}: " in printed
