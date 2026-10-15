"""Load the retailer tables into BigQuery `willow_insights` (docs/RETAILER_INSIGHTS.md).

    uv run python scripts/export_bq.py              # synthetic cohort to today + opted-in people
    uv run python scripts/export_bq.py --dry-run    # build and count every table, load nothing
    uv run python scripts/export_bq.py --today 2026-10-18 --synthetic-only

Idempotent: every table is replaced in full (WRITE_TRUNCATE, batch loads, no streaming), the
dataset is created in us-central1 if it is missing, and the schema below replaces the old one, so
running it twice gives the same tables. Tables:
- products: the catalog, with price tier, goals and the metrics each product targets
- sessions_flat: one row per reading x metric (goals and skin type at that reading)
- users_flat: one row per person (current goals, skin type, first and last reading, last week)
- goals_monthly: one row per person x month with a reading (the goals they had that month)
- routine_flat: one row per person x product (started / stopped week)
- routine_conflicts: the rule-table findings of each person's routine ("none" if clear)
Each holds the synthetic cohort (is_synthetic = true; api/app/cohort.py, generated up to
`--today`) plus people who opted in to aggregate insights (users/{uid}.consent), under a one-way
hash, with the goals and skin type from their profile.
"""

import argparse
import hashlib
import sys
from datetime import UTC, date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import catalog, cohort  # noqa: E402
from app.results import measured_result  # noqa: E402
from app.settings import get_settings  # noqa: E402


def _schemas() -> dict[str, list]:
    from google.cloud import bigquery

    S = bigquery.SchemaField
    return {
        "products": [
            S("product_id", "STRING"),
            S("brand", "STRING"),
            S("name", "STRING"),
            S("category", "STRING"),
            S("concerns", "STRING", mode="REPEATED"),
            S("goals", "STRING", mode="REPEATED"),
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
            S("skin_type", "STRING"),
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
        "users_flat": [
            S("user_hash", "STRING"),
            S("is_synthetic", "BOOL"),
            S("region", "STRING"),
            S("tone_band", "STRING"),
            S("skin_type", "STRING"),
            S("goals", "STRING", mode="REPEATED"),
            S("started_at", "TIMESTAMP"),
            S("first_ts", "TIMESTAMP"),
            S("last_ts", "TIMESTAMP"),
            S("last_week", "INT64"),
        ],
        "goals_monthly": [
            S("user_hash", "STRING"),
            S("is_synthetic", "BOOL"),
            S("month", "STRING"),
            S("last_ts", "TIMESTAMP"),
            S("goals", "STRING", mode="REPEATED"),
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


TABLES_FROM_PEOPLE = (
    "sessions_flat",
    "users_flat",
    "goals_monthly",
    "routine_flat",
    "routine_conflicts",
)


def product_rows() -> list[dict]:
    return [
        {
            "product_id": p["product_id"],
            "brand": p["brand"],
            "name": p["name"],
            "category": p["category"],
            "concerns": p["concerns"],
            "goals": cohort.product_goals(p),
            "target_metrics": sorted(
                {m for c in p["concerns"] for m in cohort.CONCERN_METRICS.get(c, [])}
            ),
            "price_amount": float(p["price"]["amount"]),
            "price_currency": p["price"]["currency"],
            "tier": cohort.tier(p["price"]),
        }
        for p in catalog.products()
    ]


def _when(v) -> datetime | None:
    """Firestore timestamps, ISO strings or dates (routine started_at, ended_at) in UTC."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=UTC)
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day, tzinfo=UTC)
    try:
        return _when(datetime.fromisoformat(str(v).replace("Z", "+00:00")))
    except ValueError:
        return None


def real_rows(store) -> dict[str, list[dict]]:
    """Measured sessions, routines and rule findings of people who opted in, under a one-way
    hash. Goals and skin type come from the profile (users/{uid}.profile); region is not kept."""
    out: dict[str, list[dict]] = {name: [] for name in TABLES_FROM_PEOPLE}
    for uid, doc in store.users_list():
        doc = doc or {}
        if not (doc.get("consent") or {}).get("aggregate_insights_opt_in"):
            continue
        uh = "real_" + hashlib.sha256(f"willow-real-{uid}".encode()).hexdigest()[:12]
        profile = doc.get("profile") or {}
        goals = cohort.goals_of(profile.get("goals") or ([doc["goal"]] if doc.get("goal") else []))
        skin = profile.get("skin_type") if profile.get("skin_type") in cohort.SKIN_TYPES else None
        rows, starts = [], []
        for _, d in store.sessions_list(uid):
            result = measured_result(d)
            base = d.get("compared_with") or {}
            if d.get("status") != "done" or result is None or not result["quality"]["passed"]:
                continue
            created, base_at = _when(d.get("created_at")), _when(base.get("session_created_at"))
            starts += [t for t in (base_at, created) if t]
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
                rows.append(
                    {
                        "user_hash": uh,
                        "is_synthetic": False,
                        "region": "unknown",
                        "tone_band": tone or "unknown",
                        "skin_type": skin,
                        "goals": goals,
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
        dated = [r for r in rows if r["session_ts"]]
        if not dated:
            continue  # no measured reading yet: nothing to count
        out["sessions_flat"] += rows
        start = min(starts)
        stamps = sorted(_when(r["session_ts"]) for r in dated)
        tones = [r["tone_band"] for r in dated if r["tone_band"] != "unknown"]
        out["users_flat"].append(
            {
                "user_hash": uh,
                "is_synthetic": False,
                "region": "unknown",
                "tone_band": tones[-1] if tones else "unknown",
                "skin_type": skin,
                "goals": goals,
                "started_at": start.isoformat(),
                "first_ts": stamps[0].isoformat(),
                "last_ts": stamps[-1].isoformat(),
                "last_week": max(r["weeks_since_baseline"] for r in dated),
            }
        )
        months: dict[str, datetime] = {}
        for t in stamps:
            months[f"{t.year:04d}-{t.month:02d}"] = t
        out["goals_monthly"] += [
            {
                "user_hash": uh,
                "is_synthetic": False,
                "month": key,
                "last_ts": t.isoformat(),
                "goals": goals,  # only the current goals are stored, so every month gets them
            }
            for key, t in sorted(months.items())
        ]
        entries = []
        for eid, e in store.routine_list(uid):
            entries.append({"id": eid, **e})
            p = catalog.by_id(e.get("product_id") or "")
            if not p:
                continue
            began, ended = _when(e.get("started_at")), _when(e.get("ended_at"))
            out["routine_flat"].append(
                {
                    "user_hash": uh,
                    "is_synthetic": False,
                    "product_id": p["product_id"],
                    "brand": p["brand"],
                    "category": p["category"],
                    "concerns": p["concerns"],
                    "tier": cohort.tier(p["price"]),
                    "started_week": max(0, (began.date() - start.date()).days // 7) if began else 0,
                    "stopped_week": max(0, (ended.date() - start.date()).days // 7)
                    if ended
                    else None,
                }
            )
        out["routine_conflicts"] += [
            {"user_hash": uh, "is_synthetic": False, "kind": k}
            for k in cohort.finding_kinds(entries)
        ]
    return out


def build(today: date, synthetic_only: bool = False) -> dict[str, list[dict]]:
    tables = {"products": product_rows(), **cohort.generate(today)}
    if not synthetic_only:
        from app.store import FirestoreStore

        real = real_rows(FirestoreStore())
        for name, rows in real.items():
            tables[name] = tables[name] + rows
        print(f"real people who opted in: {len(real['users_flat'])}")
    return tables


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Load the retailer tables into BigQuery.")
    ap.add_argument("--today", type=date.fromisoformat, default=datetime.now(UTC).date())
    ap.add_argument("--dry-run", action="store_true", help="build and count, load nothing")
    ap.add_argument("--synthetic-only", action="store_true", help="skip Firestore")
    args = ap.parse_args(argv)
    tables = build(args.today, args.synthetic_only)
    if args.dry_run:
        for name, rows in tables.items():
            print(f"{name}: {len(rows)} rows (dry run, not loaded)")
        return 0

    from google.cloud import bigquery

    s = get_settings()
    client = bigquery.Client(project=s.project_id, location="us-central1")
    dataset = bigquery.Dataset(f"{s.project_id}.{s.bq_dataset}")
    dataset.location = "us-central1"
    client.create_dataset(dataset, exists_ok=True)
    schemas = _schemas()
    for name, rows in tables.items():
        # WRITE_TRUNCATE replaces rows and schema together: re-running gives the same table.
        job = client.load_table_from_json(
            rows,
            f"{s.project_id}.{s.bq_dataset}.{name}",
            job_config=bigquery.LoadJobConfig(
                schema=schemas[name],
                write_disposition="WRITE_TRUNCATE",
                create_disposition="CREATE_IF_NEEDED",
            ),
        )
        job.result()
        print(f"{name}: {len(rows)} rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
