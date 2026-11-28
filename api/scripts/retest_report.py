"""Test-retest on real skin (finals, Nov 28): how often does Willow say "changed" when nothing did?

Protocol (research/finals/retest-protocol.md): each volunteer signs in, takes a face check-in (their
baseline), moves to another room and takes a second one within a day, with no product change.
Any "changed beyond your normal range" on the second check-in is a false change. This reads those
people's sessions (read-only) and reports, per reading and per skin-tone band:

- pairs: people with a baseline and a retest of the same site and capture mode within MAX_HOURS;
- false changes: retest readings whose verdict is `real_change`;
- how far the retest moved, as a share of the person's own noise band (|delta| / MDC95).

    cd api && (export the variables in infra/api-env.yaml) && \
      uv run python scripts/retest_report.py --emails a@x.com,b@y.com [--write]

`--write` puts the table into web/src/data/evidence.json (key `retest`) for the in-app Evidence
page: counts and rates only, no names, emails, ids or photos. Fewer than MIN_PEOPLE people: the
table is printed but never written (too few to publish).
"""

import argparse
import json
import statistics
import sys
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.results import measured_result  # noqa: E402
from app.store import FirestoreStore  # noqa: E402

MAX_HOURS = 24
MIN_PEOPLE = 5
EVIDENCE = Path(__file__).resolve().parents[2] / "web" / "src" / "data" / "evidence.json"


def _uids(emails: list[str]) -> list[str]:
    import firebase_admin
    from firebase_admin import auth

    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    out = []
    for e in emails:
        try:
            out.append(auth.get_user_by_email(e.strip()).uid)
        except Exception:
            print(f"no account for {e.strip()}", file=sys.stderr)
    return out


def _passed(doc: dict) -> dict | None:
    if doc.get("status") != "done":
        return None
    result = measured_result(doc)
    return result if result and (result.get("quality") or {}).get("passed") else None


def pairs_of(sessions: list[tuple[str, dict]]) -> list[tuple[dict, dict]]:
    """(baseline result, retest result) per site and capture mode: the baseline and the first
    passed session after it, at most MAX_HOURS later."""
    by: dict[tuple, list[tuple[datetime, dict, dict]]] = defaultdict(list)
    for _, d in sessions:
        r = _passed(d)
        if r and d.get("created_at"):
            by[(d.get("site"), d.get("capture_mode"))].append((d["created_at"], d, r))
    out = []
    for rows in by.values():
        rows.sort(key=lambda x: x[0])
        base = next((x for x in rows if x[1].get("is_baseline")), None)
        if not base:
            continue
        later = [x for x in rows if base[0] < x[0] <= base[0] + timedelta(hours=MAX_HOURS)]
        if later:
            out.append((base[2], later[0][2]))
    return out


def _tone(result: dict) -> str:
    m = next((x for x in result.get("metrics", []) if x["id"] == "tone_ita"), None)
    return ((m or {}).get("extras") or {}).get("ita_band") or "unknown"


def report(store, uids: list[str]) -> dict:
    per_metric: dict[str, dict] = defaultdict(
        lambda: {"pairs": 0, "false_changes": 0, "ratios": []}
    )
    per_tone: dict[str, dict] = defaultdict(
        lambda: {"people": 0, "readings": 0, "false_changes": 0}
    )
    people = 0
    for uid in uids:
        prs = pairs_of(store.sessions_list(uid))
        if not prs:
            continue
        people += 1
        tone = _tone(prs[0][0])
        per_tone[tone]["people"] += 1
        for _, retest in prs:
            for m in retest.get("metrics", []):
                if m["id"] == "tone_ita" or m.get("verdict") in (
                    None,
                    "no_baseline",
                    "low_quality",
                ):
                    continue
                row = per_metric[m["id"]]
                row["pairs"] += 1
                wrong = m["verdict"] == "real_change"
                row["false_changes"] += wrong
                per_tone[tone]["readings"] += 1
                per_tone[tone]["false_changes"] += wrong
                if m.get("delta") is not None and m.get("mdc95"):
                    row["ratios"].append(abs(m["delta"]) / m["mdc95"])
    readings = sum(r["pairs"] for r in per_metric.values())
    wrong = sum(r["false_changes"] for r in per_metric.values())
    return {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "people": people,
        "max_hours_apart": MAX_HOURS,
        "readings": readings,
        "false_changes": wrong,
        "false_change_rate": round(wrong / readings, 3) if readings else None,
        "by_reading": [
            {
                "metric_id": k,
                "pairs": v["pairs"],
                "false_changes": v["false_changes"],
                "median_move_vs_noise_band": round(statistics.median(v["ratios"]), 2)
                if v["ratios"]
                else None,
            }
            for k, v in sorted(per_metric.items())
        ],
        "by_tone_band": [{"band": k, **v} for k, v in sorted(per_tone.items())],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--emails", default="")
    ap.add_argument("--uids", default="")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    uids = [u for u in a.uids.split(",") if u] + (_uids(a.emails.split(",")) if a.emails else [])
    if not uids:
        print("give --emails or --uids")
        return 2
    out = report(FirestoreStore(), uids)
    print(json.dumps(out, indent=2))
    if a.write:
        if out["people"] < MIN_PEOPLE:
            print(f"not written: {out['people']} people (needs {MIN_PEOPLE})")
            return 1
        data = json.loads(EVIDENCE.read_text()) if EVIDENCE.exists() else {}
        data["retest"] = out
        EVIDENCE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote retest to {EVIDENCE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
