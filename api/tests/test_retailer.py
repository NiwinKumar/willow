from functools import lru_cache

from fastapi.testclient import TestClient

from app import cohort, retailer
from app.main import app


@lru_cache
def _data():
    return retailer.aggregate(retailer.raw_from_tables(cohort.generate()))


def test_cohort_rows_are_all_synthetic_and_reproducible():
    a, b = cohort.generate(), cohort.generate()
    assert a == b
    assert all(r["is_synthetic"] for t in a.values() for r in t)


def test_small_groups_are_suppressed_everywhere():
    d = _data()
    for p in d["products"]:
        assert p["n"] >= retailer.MIN_GROUP
        for c in p["cells"]:
            assert (c["value"] is None) == (c["n"] < retailer.MIN_GROUP) or c["suppressed"]
    assert all(b["n"] >= retailer.MIN_GROUP for b in d["brands"])
    assert all(n["n"] >= retailer.MIN_GROUP for n in d["needs"])


def test_shapes_and_ranges():
    d = _data()
    assert d["cohort"]["real"] == 0 and d["cohort"]["synthetic"] == cohort.USERS
    for n in d["needs"]:
        assert n["real"] + n["none"] + n["early"] == 100
    for b in d["brands"]:
        assert 0 <= b["lo"] <= b["rate"] <= b["hi"] <= 1
    assert all(0 <= c["share"] <= 1 for c in d["conflicts"])
    assert len(d["tone_bands"]) == len(cohort.TONE_BANDS) == len(d["products"][0]["cells"])


def test_outcome_needs_the_improvement_to_hold_at_week_8():
    raw = {
        "users": [
            {
                "user_hash": f"u{i}",
                "synthetic": True,
                "region": "IN",
                "tone": "tan",
                "goals": ["redness_sensitivity"],
                "last_week": 8,
            }
            for i in range(12)
        ],
        "first": (
            [
                {"user_hash": f"u{i}", "metric_id": "redness", "improved_weeks": [6, 7, 8]}
                for i in range(6)
            ]
            + [
                {"user_hash": f"u{i}", "metric_id": "redness", "improved_weeks": [3]}
                for i in range(6, 12)
            ]
        ),
        "routine": [],
        "conflicts": [],
    }
    d = retailer.aggregate(raw)
    calm = next(n for n in d["needs"] if n["goal"] == "Calmer skin")
    assert calm["real"] == 50  # a single lucky reading at week 3 does not count
    assert d["tiles"][3]["value"] == "6"  # the held run started at week 6


def test_route_is_public_and_degrades(monkeypatch):
    client = TestClient(app)
    monkeypatch.setattr(retailer, "insights", _data)
    assert client.get("/v1/retailer/insights").status_code == 200

    def down():
        raise RuntimeError("bq down")

    monkeypatch.setattr(retailer, "insights", down)
    res = client.get("/v1/retailer/insights")
    assert res.status_code == 503


def test_every_retailer_goal_names_a_real_app_goal():
    """APP_GOAL must use the app's goal labels exactly (web/src/lib/metrics.ts GOALS)."""
    import re
    from pathlib import Path

    from app import retailer

    web = (Path(__file__).resolve().parents[2] / "web/src/lib/metrics.ts").read_text()
    app_labels = set(re.findall(r"label: '([^']+)', metrics:", web))
    assert set(retailer.APP_GOAL) == set(retailer.GOAL_LABEL)
    assert len(app_labels) == 8
    assert {g for g in retailer.APP_GOAL.values() if g} == app_labels
