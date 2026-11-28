"""The load test's results, and what they mean for production (infra/README.md "Scale").

Reads the two local runs in results/ (drive.py: no line, line on) and the production engine time
and price per face check-in from the `cost` key of web/src/data/evidence.json (cost_report.py:
median of production logs, list prices). Writes the `scale` key of that file (the Evidence page's
"Scale" section; every other key is kept) and prints the README table.

Two kinds of numbers, never mixed:
- measured: the local runs, on one laptop (engine_pool.py: K engine processes standing in for
  Cloud Run instances). Errors, end-to-end times and engine seconds are what happened there.
- projection: production's own median engine time per check-in (production logs), put through
  the same line: M instances each measure one check-in at a time, so 200 people starting together
  finish in rounds of M. The local run checks that model (its predicted and measured times are
  both shown). Gemini (about 5 s, on Vertex) and cold starts are not in the projection.

    cd api && uv run python scripts/loadtest/report.py [--no-write]
"""

import argparse
import json
import math
from datetime import UTC, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
EVIDENCE = HERE.parents[2] / "web/src/data/evidence.json"
# The pair: five face photos, 2 local engine workers (the shared machine's load limit; Nov 28).
# The cheek close-up (three photos) was run without the line too.
NO_LINE = HERE / "results/2026-11-28-face-no-line.json"
LINE = HERE / "results/2026-11-28-face-line.json"
OTHER_NO_LINE = HERE / "results/2026-11-28-cheek-no-line.json"
OTHER_PHOTOS = "the three cheek close-ups"
PEOPLE = 200
NOW_MAX = 8  # willow-engine --max-instances (infra/README.md)
QUOTA_VCPU = 20  # the region's Cloud Run vCPU quota (infra/README.md); api takes 3
ENGINE_VCPU, ENGINE_GIB = 2, 4
INSTANCE_OPTIONS = (8, 25, 50, 100)


def rounds_finish(people: int, instances: int, seconds: float) -> tuple[float, float, float]:
    """(p50, p95, last) seconds until a person's measurement is done when `people` start together
    and `instances` each measure one at a time, `seconds` each, oldest first."""
    done = sorted((k // instances + 1) * seconds for k in range(people))
    pick = lambda p: done[min(people - 1, math.ceil(p * people) - 1)]  # noqa: E731
    return pick(0.5), pick(0.95), done[-1]


def build() -> dict:
    no_line = json.loads(NO_LINE.read_text())
    line = json.loads(LINE.read_text())
    evidence = json.loads(EVIDENCE.read_text())
    face = next(r for r in evidence["cost"]["rows"] if r["unit"] == "Face check-in")
    engine = next(p for p in face["parts"] if p.get("engine_site") == "face_full")
    prices = evidence["cost"]["prices"]["cloud_run_usd"]
    t_prod = engine["median_seconds"]
    per_second = ENGINE_VCPU * prices["vcpu_second"] + ENGINE_GIB * prices["gib_second"]
    engine_usd = t_prod * per_second

    workers = len(line["engine"]["per_worker"])
    t_local = line["engine"]["engine_s_p50"]
    local_model = rounds_finish(PEOPLE, workers, t_local)

    projection = []
    for m in INSTANCE_OPTIONS:
        p50, p95, last = rounds_finish(PEOPLE, m, t_prod)
        vcpu = m * ENGINE_VCPU + 3
        projection.append(
            {
                "max_instances": m,
                "vcpu": vcpu,
                "needs_quota_increase": vcpu > QUOTA_VCPU,
                "done_p50_s": round(p50),
                "done_p95_s": round(p95),
                "last_done_s": round(last),
                "per_hour": round(m * 3600 / t_prod),
                "burst_engine_usd": round(PEOPLE * engine_usd, 2),
            }
        )

    def run(r: dict) -> dict:
        return {
            "label": r["label"],
            "people": r["people"],
            "succeeded": r["succeeded"],
            "failed": r["failed"],
            "errors": r["errors"],
            "e2e_s": r["e2e_s"],
            "wall_s": r["wall_s"],
            "max_place_in_line": r.get("max_place_in_line"),
            "asks_per_person_mean": r["asks_per_person"]["mean"],
            "poll_p95_s": r["poll_latency_s"]["p95"],
            "engine_s_p50": r["engine"]["engine_s_p50"],
            "workers": len(r["engine"]["per_worker"]),
            "engine_answered_429": r["engine"]["answered_429"],
        }

    return {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "tested_on": line["date"],
        "where": f"one laptop (Apple M5, 10 cores, shared with other work): "
        f"the real api and {workers} real engine processes, one analysis each at a time, standing "
        "in for Cloud Run instances",
        "people": PEOPLE,
        "photos": "the demo sample's five face photos (Mei, generated)",
        "measured": {
            "no_line": run(no_line),
            "line": run(line),
            "other_no_line": {
                **run(json.loads(OTHER_NO_LINE.read_text())),
                "photos": OTHER_PHOTOS,
            },
        },
        "model_check": {
            "workers": workers,
            "engine_s_p50": t_local,
            "predicted_last_s": round(local_model[2]),
            "measured_wall_s": line["wall_s"],
        },
        "production": {
            "engine_s_median": t_prod,
            "runs_seen": engine["runs_seen"],
            "engine_usd_per_checkin": round(engine_usd, 4),
            "checkin_usd": face["usd"],
            "now_max_instances": NOW_MAX,
            "quota_vcpu": QUOTA_VCPU,
        },
        "projection": projection,
    }


def cost_table(cost: dict) -> str:
    """Measured cost per use (the `cost` key, cost_report.py): production medians x list prices."""
    lines = [
        f"Cost per use, medians of {cost['window_days']} days of production logs at list prices "
        f"read on {cost['priced_on']} (idle minimum instances, storage, Firestore and BigQuery "
        "not included):",
        "",
        "| Unit | US$ | Measured from |",
        "|---|---|---|",
    ]
    for r in cost["rows"]:
        parts = []
        for p in r["parts"]:
            if p.get("engine_site"):
                parts.append(f"{p['runs_seen']} engine runs, median {p['median_seconds']} s")
            else:
                times = f" x{p['per_unit']}" if p.get("per_unit", 1) > 1 else ""
                parts.append(f"{p['job']}{times}: {p['calls_seen']} calls")
        lines.append(f"| {r['unit']} | {r['usd']} | {'; '.join(parts)} |")
    return "\n".join(lines)


def table(s: dict) -> str:
    m, p = s["measured"], s["production"]
    mins = lambda x: f"{x / 60:.1f} min" if x >= 90 else f"{x:.0f} s"  # noqa: E731
    lines = [
        f"Measured locally on {s['tested_on']}: {s['where']}; {s['people']} people press Measure "
        f"at once, {s['photos']}.",
        "",
        "| Run | Succeeded | Errors | End to end p50 / p95 / p99 | Poll p95 | Engine s/analysis |",
        "|---|---|---|---|---|---|",
    ]
    other = {**m["other_no_line"], "label": f"{m['other_no_line']['label']}, {OTHER_PHOTOS}"}
    for r in (m["no_line"], m["line"], other):
        e = r["e2e_s"]
        errs = ", ".join(f"{v} {k}" for k, v in r["errors"].items()) or "none"
        lines.append(
            f"| {r['label']} | {r['succeeded']}/{r['people']} | {errs} | "
            f"{e['p50']} / {e['p95']} / {e['p99']} s | {r['poll_p95_s']} s | {r['engine_s_p50']} |"
        )
    c = s["model_check"]
    lines += [
        "",
        f"Model check: {c['workers']} local instances at {c['engine_s_p50']} s each predict the "
        f"last of {s['people']} done at {c['predicted_last_s']} s; "
        f"measured {c['measured_wall_s']} s.",
        "",
        f"Projection for production (not measured): {p['engine_s_median']} s per face check-in on "
        f"the engine (median of {p['runs_seen']} production runs), the same line, Gemini and cold "
        f"starts left out. Engine cost per check-in ${p['engine_usd_per_checkin']} at list price "
        f"(whole check-in with Gemini ${p['checkin_usd']}); it is the same at any instance count.",
        "",
        "| Engine max instances | vCPU (with api) | 200 people: half done | 95% done | all done "
        "| Check-ins per hour | Engine cost of the burst |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in s["projection"]:
        quota = " (quota increase)" if r["needs_quota_increase"] else ""
        now = " (now)" if r["max_instances"] == p["now_max_instances"] else ""
        lines.append(
            f"| {r['max_instances']}{now} | {r['vcpu']}{quota} | {mins(r['done_p50_s'])} | "
            f"{mins(r['done_p95_s'])} | {mins(r['last_done_s'])} | {r['per_hour']} | "
            f"${r['burst_engine_usd']} |"
        )
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-write", action="store_true")
    a = ap.parse_args()
    s = build()
    print(table(s))
    print()
    print(cost_table(json.loads(EVIDENCE.read_text())["cost"]))
    if not a.no_write:
        evidence = json.loads(EVIDENCE.read_text())
        evidence["scale"] = s
        EVIDENCE.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n")
        print(f"\nwrote the scale key of {EVIDENCE}")


if __name__ == "__main__":
    main()
