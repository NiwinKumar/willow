"""What Gemini did in production, from Cloud Logging (07 §C3). Read-only.

    cd api && uv run python scripts/gemini_report.py --days 30          # print the tables
    cd api && uv run python scripts/gemini_report.py --days 30 --docs   # and in docs/EVALS.md

Reads willow-api's own log lines with `gcloud logging read` (your gcloud login; nothing is
written to the project):
- answers rejected by a validator before a person saw them: the "... rejected" warnings, by
  logger (willow.explain, willow.advisor, willow.retailer_ask, willow.proof_ai, ...), plus
  gemini.py's "schema validation failed" lines by prompt id;
- latency: gemini.py's JSON line per call (prompt_id, attempt, model, latency_ms, tokens),
  p50 / p95 per prompt and model;
- hedge rate: `hedged_after_s` lines per first attempt; kept-answer hit rate: `"kept": true`
  lines against first attempts plus hits.
Lines carry no prompt text and no personal data (gemini.py logs ids, model, timings, tokens).
Not counted: routine-check additions dropped by its filter (dropped silently, no log line).
"""

import argparse
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.settings import get_settings  # noqa: E402
from evals.metrics import percentile  # noqa: E402
from evals.report import write_section  # noqa: E402

SERVICE = 'resource.type="cloud_run_revision" AND resource.labels.service_name="willow-api"'
REJECTED = f'{SERVICE} AND (textPayload:"rejected" OR textPayload:"schema validation failed")'
JSON_LINES = (
    f'{SERVICE} AND (textPayload:"latency_ms" OR textPayload:"hedged_after_s" '
    'OR textPayload:"\\"kept\\": true")'
)
TOOL_ROUND = "(tool round)"
OLD = "(not logged, before Nov 2)"
SCHEMA = re.compile(r"gemini (\S+) attempt \d+: schema validation failed")


def read(filter_: str, days: int, project: str, limit: int) -> list[dict[str, Any]]:
    out = subprocess.run(
        [
            "gcloud",
            "logging",
            "read",
            filter_,
            f"--freshness={days}d",
            f"--limit={limit}",
            f"--project={project}",
            "--format=json(textPayload,timestamp)",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(out.stdout or "[]")


def split(text: str) -> tuple[str, str]:
    """'willow.explain: explanation rejected ...' -> ('willow.explain', 'explanation ...')."""
    name, _, msg = text.partition(": ")
    return name.strip(), msg


def rejections(entries: list[dict[str, Any]]) -> tuple[Counter, Counter]:
    by_logger: Counter[str] = Counter()
    schema: Counter[str] = Counter()
    for e in entries:
        name, msg = split(e.get("textPayload") or "")
        m = SCHEMA.search(msg)
        if m:
            schema[m.group(1)] += 1
        elif "rejected" in msg:
            by_logger[name] += 1
    return by_logger, schema


def calls(entries: list[dict[str, Any]]) -> dict[str, Any]:
    latency: dict[tuple[str, str], list[float]] = defaultdict(list)
    first: Counter[str] = Counter()
    hedged: Counter[str] = Counter()
    kept: Counter[str] = Counter()
    for e in entries:
        _, msg = split(e.get("textPayload") or "")
        try:
            row = json.loads(msg)
        except ValueError:
            continue
        pid = row.get("prompt_id", "?")
        if row.get("kept"):
            kept[pid] += 1
        elif "hedged_after_s" in row:
            hedged[pid] += 1
        elif "latency_ms" in row:
            # the advisor's tool round logs its own timing line with no model; lines before
            # Nov 2 did not name the model
            model = TOOL_ROUND if "tools" in row else row.get("model") or OLD
            latency[(pid, model)].append(row["latency_ms"] / 1000)
            if model != TOOL_ROUND and row.get("attempt", 1) == 1:
                first[pid] += 1
    return {"latency": latency, "first": first, "hedged": hedged, "kept": kept}


def _p(xs: list[float], p: float) -> str:
    v = percentile(xs, p)
    return "–" if v is None else f"{v:.1f}"


def markdown(days: int, rej: list[dict], js: list[dict], limit: int) -> str:
    by_logger, schema = rejections(rej)
    c = calls(js)
    stamps = sorted(e["timestamp"] for e in rej + js if e.get("timestamp"))
    since = stamps[0][:10] if stamps else "n/a"
    total = sum(by_logger.values()) + sum(schema.values())
    answered = sum(len(v) for (pid, m), v in c["latency"].items() if m != TOOL_ROUND)
    lines = [
        f"Cloud Logging, last {days} days (oldest line found: {since}; log retention bounds "
        f"this). Read with `scripts/gemini_report.py`.",
        "",
        f"**Since {since}: {total} answers rejected before a person saw them** "
        f"({sum(by_logger.values())} by Willow's validators, {sum(schema.values())} failed the "
        f"schema), out of {answered} logged model calls.",
        "",
        "| Rejected by | Answers |",
        "|---|---|",
        *[f"| `{k}` validator | {v} |" for k, v in by_logger.most_common()],
        *[f"| schema, `{k}` | {v} |" for k, v in schema.most_common()],
        "",
        "Hedged and kept-hit shares are per prompt (all models), shown on each of its rows.",
        "",
        "| Prompt | Model | Calls | p50 s | p95 s | Hedged | Kept hits |",
        "|---|---|---|---|---|---|---|",
    ]
    for (pid, model), xs in sorted(c["latency"].items(), key=lambda kv: -len(kv[1])):
        first, hedged, kept = c["first"][pid], c["hedged"][pid], c["kept"][pid]
        # per prompt (all models): a hedge or a kept hit is not tied to one model's line
        hedge = f"{hedged / first:.0%}" if first and model != TOOL_ROUND else "–"
        hit = f"{kept / (first + kept):.0%}" if kept and model != TOOL_ROUND else "–"
        lines.append(
            f"| `{pid}` | `{model}` | {len(xs)} | {_p(xs, 50)} | {_p(xs, 95)} | {hedge} | {hit} |"
        )
    if len(js) >= limit or len(rej) >= limit:
        lines.append(f"\nThe read hit the {limit}-line limit: counts are a lower bound.")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--limit", type=int, default=50_000)
    ap.add_argument("--docs", action="store_true")
    args = ap.parse_args()
    project = get_settings().project_id
    rej = read(REJECTED, args.days, project, args.limit)
    js = read(JSON_LINES, args.days, project, args.limit)
    body = markdown(args.days, rej, js, args.limit)
    print(body)
    if args.docs:
        write_section("production", body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
