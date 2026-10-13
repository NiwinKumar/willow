"""Write the retailer aggregates to small BigQuery tables for the Looker Studio report.

The tables hold exactly what GET /v1/retailer/insights shows (groups under 10 people already
suppressed), so the report can be shared by link without exposing any person's rows. Re-run after
scripts/export_bq.py. Rates are written as percents for Looker's charts.

    uv run python scripts/publish_looker.py
"""

import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from google.cloud import bigquery  # noqa: E402

from app import retailer  # noqa: E402
from app.settings import get_settings  # noqa: E402

S = bigquery.SchemaField


def pct(x: float | None) -> float | None:
    return None if x is None else round(x * 100, 1)


def tables(d: dict) -> dict[str, tuple[list, list[dict]]]:
    synthetic = d["cohort"]["real"] == 0
    note = "synthetic demo cohort" if synthetic else "includes people who opted in"
    return {
        "looker_product_outcomes": (
            [
                S("product", "STRING"),
                S("brand", "STRING"),
                S("goal", "STRING"),
                S("people", "INTEGER"),
                S("still_improved_pct", "FLOAT"),
                S("median_weeks_to_change", "FLOAT"),
                S("still_using_pct", "FLOAT"),
                S("data", "STRING"),
            ],
            [
                {
                    "product": p["product"],
                    "brand": p["brand"],
                    "goal": p["concern"],
                    "people": p["n"],
                    "still_improved_pct": pct(p["rate"]),
                    "median_weeks_to_change": p["weeks"],
                    "still_using_pct": pct(p["cont"]),
                    "data": note,
                }
                for p in d["product_outcomes"].values()
            ],
        ),
        "looker_tone_coverage": (
            [
                S("product", "STRING"),
                S("tone_band", "STRING"),
                S("people", "INTEGER"),
                S("still_improved_pct", "FLOAT"),
                S("shown", "BOOLEAN"),
            ],
            [
                {
                    "product": p["product"],
                    "tone_band": band,
                    "people": c["n"],
                    "still_improved_pct": None if c["suppressed"] else pct(c["value"]),
                    "shown": not c["suppressed"],
                }
                for p in d["products"]
                for band, c in zip(d["tone_bands"], p["cells"], strict=True)
            ],
        ),
        "looker_goals": (
            [
                S("goal", "STRING"),
                S("people", "INTEGER"),
                S("real_change", "INTEGER"),
                S("no_clear_change", "INTEGER"),
                S("too_early", "INTEGER"),
            ],
            [
                {
                    "goal": n["goal"],
                    "people": n["n"],
                    "real_change": n["real"],
                    "no_clear_change": n["none"],
                    "too_early": n["early"],
                }
                for n in d["needs"]
            ],
        ),
        "looker_brands": (
            [
                S("brand", "STRING"),
                S("people", "INTEGER"),
                S("still_improved_pct", "FLOAT"),
                S("low_pct", "FLOAT"),
                S("high_pct", "FLOAT"),
                S("still_using_pct", "FLOAT"),
            ],
            [
                {
                    "brand": b["brand"],
                    "people": b["n"],
                    "still_improved_pct": pct(b["rate"]),
                    "low_pct": pct(b["lo"]),
                    "high_pct": pct(b["hi"]),
                    "still_using_pct": pct(b["cont"]),
                }
                for b in d["brands"]
            ],
        ),
        "looker_routine_conflicts": (
            [S("issue", "STRING"), S("share_pct", "FLOAT"), S("fix", "STRING")],
            [
                {"issue": c["pair"], "share_pct": pct(c["share"]), "fix": c["fix"]}
                for c in d["conflicts"]
            ],
        ),
        "looker_assortment": (
            [
                S("goal", "STRING"),
                S("price_tier", "STRING"),
                S("options", "INTEGER"),
                S("still_improved_pct", "FLOAT"),
            ],
            [
                {
                    "goal": g["goal"],
                    "price_tier": tier,
                    "options": g[tier]["options"],
                    "still_improved_pct": pct(g[tier]["rate"]),
                }
                for g in d["gaps"]
                for tier in ("budget", "mid", "premium")
            ],
        ),
        "looker_about": (
            [
                S("synthetic_people", "INTEGER"),
                S("real_people", "INTEGER"),
                S("weeks", "INTEGER"),
                S("published_at", "TIMESTAMP"),
                S("note", "STRING"),
            ],
            [
                {
                    "synthetic_people": d["cohort"]["synthetic"],
                    "real_people": d["cohort"]["real"],
                    "weeks": d["cohort"]["weeks"],
                    "published_at": datetime.now(UTC).isoformat(),
                    "note": "Outcome = still improved beyond the person's own photo noise at "
                    "week 8. Groups under 10 people are hidden.",
                }
            ],
        ),
    }


def main() -> int:
    s = get_settings()
    client = bigquery.Client(project=s.project_id, location="us-central1")
    data = retailer.aggregate(retailer.fetch())
    for name, (schema, rows) in tables(data).items():
        client.load_table_from_json(
            rows,
            f"{s.project_id}.{s.bq_dataset}.{name}",
            job_config=bigquery.LoadJobConfig(schema=schema, write_disposition="WRITE_TRUNCATE"),
        ).result()
        print(f"{name}: {len(rows)} rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
