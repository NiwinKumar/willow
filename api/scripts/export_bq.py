"""Load the retailer tables into BigQuery `willow_insights` (docs/RETAILER_INSIGHTS.md).

    uv run python scripts/export_bq.py

Writes (WRITE_TRUNCATE, batch loads, no streaming):
- products: the catalog, with price tier and the metrics each product targets
- sessions_flat, routine_flat, routine_conflicts: the synthetic cohort (is_synthetic = true)
  plus real rows from people who opted in to aggregate insights (consent stored on users/{uid});
  there are none until the consent screen writes to the api, so the view says "synthetic only".
"""

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from google.cloud import bigquery  # noqa: E402

from app import catalog, cohort  # noqa: E402
from app.results import measured_result  # noqa: E402
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


def real_rows(store) -> dict[str, list[dict]]:
    """Measured sessions and routines of people who opted in, under a one-way hash."""
    out: dict[str, list[dict]] = {"sessions_flat": [], "routine_flat": [], "routine_conflicts": []}
    for uid, doc in store.users_list():
        if not ((doc or {}).get("consent") or {}).get("aggregate_insights_opt_in"):
            continue
        uh = "real_" + hashlib.sha256(f"willow-real-{uid}".encode()).hexdigest()[:12]
        for _, d in store.sessions_list(uid):
            result = measured_result(d)
            base = d.get("compared_with") or {}
            if d.get("status") != "done" or result is None or not result["quality"]["passed"]:
                continue
            created, base_at = d.get("created_at"), base.get("session_created_at")
            weeks = ((created - base_at).days // 7) if created and base_at else 0
            tone = next(
                (
                    m.get("extras", {}).get("ita_band")
                    for m in result["metrics"]
                    if m["id"] == "tone_ita"
                ),
                None,
            )
            for m in result["metrics"]:
                if m["value"] is None:
                    continue
                up = m["id"] in cohort.UP_IS_GOOD
                out["sessions_flat"].append(
                    {
                        "user_hash": uh,
                        "is_synthetic": False,
                        "region": "unknown",
                        "tone_band": tone or "unknown",
                        "goals": [],
                        "site": d["site"],
                        "session_ts": created.isoformat() if created else None,
                        "weeks_since_baseline": weeks,
                        "metric_id": m["id"],
                        "delta": m.get("delta"),
                        "mdc95": m.get("mdc95"),
                        "verdict": m["verdict"],
                        "improved": m["verdict"] == "real_change"
                        and ((m.get("delta") or 0) > 0) == up,
                    }
                )
        for _, e in store.routine_list(uid):
            p = catalog.by_id(e.get("product_id") or "")
            if p:
                out["routine_flat"].append(
                    {
                        "user_hash": uh,
                        "is_synthetic": False,
                        "product_id": p["product_id"],
                        "brand": p["brand"],
                        "category": p["category"],
                        "concerns": p["concerns"],
                        "tier": cohort.tier(p["price"]),
                        "started_week": 0,
                        "stopped_week": None,
                    }
                )
    return out


def main() -> int:
    from app.store import FirestoreStore

    s = get_settings()
    client = bigquery.Client(project=s.project_id, location="us-central1")
    tables = {"products": product_rows(), **cohort.generate()}
    real = real_rows(FirestoreStore())
    for name, rows in real.items():
        tables[name] = tables[name] + rows
    print(f"real people who opted in: {len({r['user_hash'] for r in real['sessions_flat']})}")
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
