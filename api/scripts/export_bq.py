"""Load the retailer tables into BigQuery `willow_insights` (docs/RETAILER_INSIGHTS.md).

    uv run python scripts/export_bq.py

Writes (WRITE_TRUNCATE, batch loads, no streaming):
- products: the catalog, with price tier and the metrics each product targets
- sessions_flat, routine_flat, routine_conflicts: the synthetic cohort (is_synthetic = true)
  plus real rows from people who opted in to aggregate insights (consent stored on users/{uid});
  there are none until the consent screen writes to the api, so the view says "synthetic only".
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from google.cloud import bigquery  # noqa: E402

from app import catalog, cohort  # noqa: E402
from app.settings import get_settings  # noqa: E402

S = bigquery.SchemaField
SCHEMAS = {
    "products": [
        S("product_id", "STRING"),
        S("brand", "STRING"),
        S("name", "STRING"),
        S("category", "STRING"),
        S("concerns", "STRING", mode="REPEATED"),
        S("target_metrics", "STRING", mode="REPEATED"),
        S("price_amount", "FLOAT"),
        S("price_currency", "STRING"),
        S("tier", "STRING"),
    ],
    "sessions_flat": [
        S("user_hash", "STRING"),
        S("is_synthetic", "BOOL"),
        S("region", "STRING"),
        S("tone_band", "STRING"),
        S("goals", "STRING", mode="REPEATED"),
        S("site", "STRING"),
        S("session_ts", "TIMESTAMP"),
        S("weeks_since_baseline", "INT64"),
        S("metric_id", "STRING"),
        S("delta", "FLOAT"),
        S("mdc95", "FLOAT"),
        S("verdict", "STRING"),
        S("improved", "BOOL"),
    ],
    "routine_flat": [
        S("user_hash", "STRING"),
        S("is_synthetic", "BOOL"),
        S("product_id", "STRING"),
        S("brand", "STRING"),
        S("category", "STRING"),
        S("concerns", "STRING", mode="REPEATED"),
        S("tier", "STRING"),
        S("started_week", "INT64"),
        S("stopped_week", "INT64"),
    ],
    "routine_conflicts": [
        S("user_hash", "STRING"),
        S("is_synthetic", "BOOL"),
        S("kind", "STRING"),
    ],
}


def product_rows() -> list[dict]:
    return [
        {
            "product_id": p["product_id"],
            "brand": p["brand"],
            "name": p["name"],
            "category": p["category"],
            "concerns": p["concerns"],
            "target_metrics": sorted(
                {m for c in p["concerns"] for m in cohort.CONCERN_METRICS.get(c, [])}
            ),
            "price_amount": float(p["price"]["amount"]),
            "price_currency": p["price"]["currency"],
            "tier": cohort.tier(p["price"]),
        }
        for p in catalog.products()
    ]


def main() -> int:
    s = get_settings()
    client = bigquery.Client(project=s.project_id, location="us-central1")
    tables = {"products": product_rows(), **cohort.generate()}
    for name, rows in tables.items():
        job = client.load_table_from_json(
            rows,
            f"{s.project_id}.{s.bq_dataset}.{name}",
            job_config=bigquery.LoadJobConfig(
                schema=SCHEMAS[name], write_disposition="WRITE_TRUNCATE"
            ),
        )
        job.result()
        print(f"{name}: {len(rows)} rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
