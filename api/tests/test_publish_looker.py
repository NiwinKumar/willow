import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "publish_looker", Path(__file__).resolve().parent.parent / "scripts" / "publish_looker.py"
)
publish_looker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish_looker)

INSIGHTS = {
    "cohort": {"synthetic": 500, "real": 0, "weeks": 8},
    "product_outcomes": {
        "p1": {
            "n": 40,
            "rate": 0.61,
            "weeks": 6.5,
            "product": "Gel",
            "brand": "Acme",
            "concern": "dark spots",
            "cont": 0.77,
        }
    },
    "products": [
        {
            "product": "Gel",
            "cells": [
                {"value": 0.5, "n": 12, "suppressed": False},
                {"value": None, "n": 4, "suppressed": True},
            ],
        }
    ],
    "tone_bands": ["light", "brown"],
    "needs": [{"goal": "Fewer dark spots", "n": 100, "real": 24, "none": 61, "early": 15}],
    "brands": [{"brand": "Acme", "n": 40, "rate": 0.6, "lo": 0.5, "hi": 0.7, "cont": 0.7}],
    "conflicts": [{"pair": "Two exfoliants", "share": 0.18, "fix": "Reduce"}],
    "gaps": [
        {
            "goal": "Fewer dark spots",
            "budget": {"options": 3, "rate": 0.33},
            "mid": {"options": 0, "rate": None},
            "premium": {"options": 1, "rate": 0.2},
        }
    ],
}


def test_tables_carry_only_suppressed_aggregates_as_percents():
    t = publish_looker.tables(INSIGHTS)
    (row,) = t["looker_product_outcomes"][1]
    assert row["still_improved_pct"] == 61.0 and row["data"] == "synthetic demo cohort"
    tone = t["looker_tone_coverage"][1]
    assert tone[1] == {
        "product": "Gel",
        "tone_band": "brown",
        "people": 4,
        "still_improved_pct": None,
        "shown": False,
    }
    assert len(t["looker_assortment"][1]) == 3
    for name, (schema, rows) in t.items():
        fields = {f.name for f in schema}
        assert all(set(r) == fields for r in rows), name
