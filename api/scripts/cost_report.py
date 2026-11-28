"""Measured cost per check-in and per answer, from production logs (finals, Nov 28).

Reads the last DAYS of Cloud Logging for willow-api (one JSON line per Gemini call: prompt_id,
model, tokens, latency; app/gemini.py) and willow-engine (one line per analysis with its
timings), takes medians per job, and prices them with the list prices below. Writes the `cost`
key of web/src/data/evidence.json (the in-app Evidence page) and prints the table.

    cd api && uv run python scripts/cost_report.py [--days 30] [--no-write]

Needs gcloud signed in with log read access. Prices are list prices as read on PRICED_ON; they are
inputs, not measurements: change them here when Google does. Nothing is estimated beyond
"median tokens x price" and "median seconds x instance size x price".
"""

import argparse
import json
import statistics
import subprocess
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

PROJECT = "willow-511508"
PRICED_ON = "2026-11-28"
# USD per 1M tokens (input, output). Sources: Gemini Enterprise Agent Platform pricing page.
# 3.8 Flash: introductory price through Dec 31, 2026.
MODEL_PRICE = {
    "gemini-3.8-flash": (0.75, 3.75),
    "gemini-3.5-flash-lite": (0.15, 1.25),
}
DEFAULT_MODEL = "gemini-3.8-flash"
# Cloud Run request-based billing, us-central1: USD per vCPU-second and per GiB-second.
RUN_CPU, RUN_MEM = 0.000024, 0.0000025
ENGINE_VCPU, ENGINE_GIB = 2, 4  # infra/README.md
EVIDENCE = Path(__file__).resolve().parents[2] / "web" / "src" / "data" / "evidence.json"

# What one unit of use is made of: (job, calls per unit). The spot labeller runs twice per
# check-in and keeps a label only when both runs agree (app/labeller.py).
UNITS = {
    "Face check-in": {
        "engine": "face_full",
        "jobs": [("explanation", 1), ("candidate_labels", 2)],
        "what": "Engine measurement, Gemini explanation, spot labels read twice",
    },
    "Wisp answer": {"jobs": [("advisor_reply", 1)], "what": "One advisor reply with its checks"},
    "Routine check": {"jobs": [("routine_check", 1)], "what": "Rule table plus Gemini findings"},
    "Reading story": {"jobs": [("metric_story", 1)], "what": "What changed for one reading"},
    "Proof Ask answer": {"jobs": [("retailer_ask", 1)], "what": "One question over the aggregates"},
}


def _logs(service: str, needle: str, days: int) -> list[dict]:
    flt = (
        f'resource.type="cloud_run_revision" AND resource.labels.service_name="{service}" '
        f"AND textPayload:{json.dumps(needle)}"
    )
    out = subprocess.run(
        [
            "gcloud",
            "logging",
            "read",
            flt,
            f"--project={PROJECT}",
            f"--freshness={days}d",
            "--limit=20000",
            "--format=value(textPayload)",
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    rows = []
    for line in out.splitlines():
        i = line.find("{")
        if i < 0:
            continue
        try:
            rows.append(json.loads(line[i:]))
        except json.JSONDecodeError:
            continue
    return rows


def _med(xs: list[float]) -> float:
    return statistics.median(xs) if xs else 0.0


def report(days: int) -> dict:
    by_job: dict[str, list[dict]] = defaultdict(list)
    for r in _logs("willow-api", "input_tokens", days):
        if r.get("prompt_id") and r.get("input_tokens") is not None:
            by_job[r["prompt_id"]].append(r)
    engine: dict[str, list[float]] = defaultdict(list)
    for r in _logs("willow-engine", '"event": "analyze"', days):
        total = (r.get("timings_ms") or {}).get("total")
        if total and r.get("site"):
            engine[r["site"]].append(total / 1000)

    def job_cost(job: str) -> tuple[float, dict] | None:
        calls = by_job.get(job)
        if not calls:
            return None
        tin = _med([c["input_tokens"] or 0 for c in calls])
        tout = _med(
            [(c.get("output_tokens") or 0) + (c.get("thinking_tokens") or 0) for c in calls]
        )
        models = [c.get("model") or DEFAULT_MODEL for c in calls]
        model = max(set(models), key=models.count)
        pin, pout = MODEL_PRICE.get(model, MODEL_PRICE[DEFAULT_MODEL])
        usd = tin * pin / 1e6 + tout * pout / 1e6
        return usd, {
            "job": job,
            "calls_seen": len(calls),
            "model": model,
            "median_input_tokens": round(tin),
            "median_output_tokens": round(tout),
            "median_seconds": round(_med([(c.get("latency_ms") or 0) / 1000 for c in calls]), 1),
        }

    rows = []
    for unit, spec in UNITS.items():
        usd, parts, ok = 0.0, [], True
        if site := spec.get("engine"):
            secs = engine.get(site)
            if not secs:
                ok = False
            else:
                s = _med(secs)
                usd += s * (ENGINE_VCPU * RUN_CPU + ENGINE_GIB * RUN_MEM)
                parts.append(
                    {
                        "engine_site": site,
                        "runs_seen": len(secs),
                        "median_seconds": round(s, 1),
                        "vcpu": ENGINE_VCPU,
                        "gib": ENGINE_GIB,
                    }
                )
        for job, n in spec["jobs"]:
            jc = job_cost(job)
            if jc is None:
                ok = False
                break
            usd += jc[0] * n
            parts.append({**jc[1], "per_unit": n})
        if ok:
            rows.append({"unit": unit, "what": spec["what"], "usd": round(usd, 4), "parts": parts})
    return {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "window_days": days,
        "priced_on": PRICED_ON,
        "prices": {
            "models_usd_per_1m_tokens": MODEL_PRICE,
            "cloud_run_usd": {"vcpu_second": RUN_CPU, "gib_second": RUN_MEM},
        },
        "note": "Medians from production logs times list prices. Idle minimum instances, storage, "
        "Firestore and BigQuery are not included.",
        "rows": rows,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--no-write", action="store_true")
    a = ap.parse_args()
    cost = report(a.days)
    for r in cost["rows"]:
        print(f"{r['unit']:20} US${r['usd']:.4f}  ({r['what']})")
        for p in r["parts"]:
            print("    ", p)
    if not a.no_write:
        data = json.loads(EVIDENCE.read_text()) if EVIDENCE.exists() else {}
        data["cost"] = cost
        EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
        EVIDENCE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote cost to {EVIDENCE}")


if __name__ == "__main__":
    main()
