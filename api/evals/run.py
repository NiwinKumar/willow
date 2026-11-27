"""Run the Gemini eval set against the real endpoint and score it with Willow's own validators.

    cd api && uv run python -m evals.run \\
        --models gemini-3.8-flash,gemini-3.5-flash-lite,gemini-4-hydrogen \\
        --out evals/results/2026-11-27.json --docs

Application Default Credentials, the project and the global endpoint come from app/settings.py
and app/gemini.py, as in production. Each model runs alone (main model = that model, no fallback
model and so no hedge), so a row is that model's own quality; the production fallback model runs
without a thinking level, as it does in production. Kept answers are off. A hard cap on model
calls (--max-calls) stops the run before it gets expensive; cases past the cap are "skipped".
"""

import argparse
import json
import logging
import sys
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from google.genai import types

from app import gemini, kept, retailer
from app.settings import get_settings
from evals import jobs, report
from evals.metrics import CaseResult, summarise

CASES = Path(__file__).resolve().parent / "cases"
PRODUCTION_FALLBACK = "gemini-3.5-flash-lite"


class CapReached(Exception):
    """The run's call budget is spent (not transient: the job falls back, the case is marked)."""


class Meter:
    """Counts model calls and tokens per model, and refuses calls past the cap."""

    def __init__(self, cap: int) -> None:
        self.cap = cap
        self.calls: Counter[str] = Counter()
        self.tokens: dict[str, Counter[str]] = defaultdict(Counter)
        self.lock = threading.Lock()

    def total(self) -> int:
        return sum(self.calls.values())

    def wrap(self, real_models: Any) -> Any:
        meter = self

        class Models:
            def generate_content(self, *, model, contents, config=None, **kw):
                with meter.lock:
                    if meter.total() >= meter.cap:
                        raise CapReached(f"eval call cap {meter.cap} reached")
                    meter.calls[model] += 1
                if model == PRODUCTION_FALLBACK and config is not None and config.thinking_config:
                    # as in production (gemini.config_for): the fallback model never thinks
                    config = config.model_copy(update={"thinking_config": None})
                res = real_models.generate_content(model=model, contents=contents, config=config)
                usage = res.usage_metadata
                with meter.lock:
                    t = meter.tokens[model]
                    t["input"] += getattr(usage, "prompt_token_count", 0) or 0
                    t["output"] += getattr(usage, "candidates_token_count", 0) or 0
                    t["thinking"] += getattr(usage, "thoughts_token_count", 0) or 0
                return res

            def __getattr__(self, name):
                return getattr(real_models, name)

        return Models()


class SchemaFailures(logging.Handler):
    """Counts gemini.py's 'schema validation failed' and call-failure lines per model."""

    def __init__(self) -> None:
        super().__init__(logging.INFO)
        self.model = ""
        self.counts: dict[str, Counter[str]] = defaultdict(Counter)

    def emit(self, record: logging.LogRecord) -> None:
        msg = record.getMessage()
        if "schema validation failed" in msg:
            self.counts[self.model]["schema_failures"] += 1
        elif " failed: " in msg or "retrying on" in msg:
            code = next((c for c in ("429", "503", "504", "404", "400") if c in msg), "other")
            self.counts[self.model][f"call_error_{code}"] += 1


def load_cases(only: list[str] | None) -> dict[str, list[dict[str, Any]]]:
    out = {}
    for name in jobs.JOBS:
        if only and name not in only:
            continue
        out[name] = json.loads((CASES / f"{name}.json").read_text())["cases"]
    return out


def probe(model: str, tries: int = 3) -> str | None:
    """None when the model answers a one-word prompt; else the error (404 = not on this
    project/endpoint, 429 = no quota right now)."""
    last = ""
    for i in range(tries):
        try:
            gemini.client().models.generate_content(
                model=model,
                contents="Reply with the word ok.",
                config=types.GenerateContentConfig(
                    max_output_tokens=64, safety_settings=gemini.SAFETY_SETTINGS
                ),
            )
            return None
        except CapReached:
            raise
        except Exception as exc:
            last = f"{type(exc).__name__}: {str(exc)[:160]}"
            if "404" in last or "NOT_FOUND" in last:
                break
            time.sleep(10 * (i + 1))
    return last


def run_model(
    model: str, cases: dict[str, list[dict[str, Any]]], meter: Meter, workers: int
) -> list[CaseResult]:
    s = get_settings()
    s.gemini_model, s.gemini_fallback_model = model, ""
    todo = [(job, c) for job, cs in cases.items() for c in cs]

    def one(item: tuple[str, dict[str, Any]]) -> CaseResult:
        job, case = item
        if meter.total() >= meter.cap - 4:
            return CaseResult(job, case["id"], case.get("slice", "normal"), model, "skipped")
        r = jobs.run_case(job, case, model)
        mark = "ok" if r.behaviour_ok and r.final_pass else r.source
        print(f"  {model} {job}/{case['id']}: {mark} {r.latency_ms / 1000:.1f}s", flush=True)
        return r

    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(one, todo))


def model_entry(rows: list[CaseResult], usage: dict[str, int]) -> dict[str, Any]:
    by_job: dict[str, list[CaseResult]] = defaultdict(list)
    for r in rows:
        by_job[r.job].append(r)
    ran = [r for r in rows if r.source != "skipped"]
    return {
        "available": True,
        "jobs": {job: summarise(by_job[job]) for job in jobs.JOBS if job in by_job},
        "usage": usage,
        "totals": {
            "cases": len(ran),
            "skipped": len(rows) - len(ran),
            "errors": sum(r.source == "error" for r in ran),
            "invented_shown": sum(bool(r.invented_numbers) for r in ran),
            "wording_shown": sum(bool(r.wording) for r in ran),
            **usage,
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=f"gemini-3.8-flash,{PRODUCTION_FALLBACK}")
    ap.add_argument("--jobs", default="", help="comma list; default all")
    ap.add_argument("--out", default=f"evals/results/{datetime.now(UTC).date()}.json")
    ap.add_argument("--max-calls", type=int, default=380)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--docs", action="store_true", help="rewrite the table in docs/EVALS.md")
    ap.add_argument(
        "--merge", action="store_true", help="rerun these jobs/models into an existing --out file"
    )
    args = ap.parse_args()

    settings = get_settings()
    settings.keep_gemini_answers = False
    kept.clear_memory()
    insights = jobs.data("insights.json")
    retailer.insights = lambda *a, **k: insights  # advisor tool outcomes: the frozen aggregates
    jobs.install_recorder()
    meter = Meter(args.max_calls)
    real = gemini.client()
    proxy = SimpleNamespace(models=meter.wrap(real.models))
    gemini.client = lambda: proxy
    handler = SchemaFailures()
    wlog = logging.getLogger("willow")
    wlog.setLevel(logging.INFO)
    wlog.addHandler(handler)
    wlog.propagate = False

    cases = load_cases([j for j in args.jobs.split(",") if j] or None)
    path = Path(args.out)
    started = datetime.now(UTC)
    out: dict[str, Any] = {
        "started_at": started.isoformat(timespec="seconds"),
        "project": settings.project_id,
        "location": settings.vertex_location,
        "max_calls": args.max_calls,
        "models": {},
        "cases": [],
    }
    if args.merge and path.exists():
        out = json.loads(path.read_text())
        out.setdefault("reruns", []).append(
            {"at": started.isoformat(timespec="seconds"), "models": args.models, "jobs": [*cases]}
        )
    for model in [m for m in args.models.split(",") if m]:
        handler.model = model
        error = probe(model)
        if error:
            print(f"{model}: not run ({error})", flush=True)
            if not out["models"].get(model, {}).get("available"):
                out["models"][model] = {"available": False, "error": error}
            continue
        rows = run_model(model, cases, meter, args.workers)
        # a rerun replaces this model's rows for the jobs it ran and adds its usage
        kept_rows = [
            CaseResult(**c) for c in out["cases"] if c["model"] == model and c["job"] not in cases
        ]
        out["cases"] = [c for c in out["cases"] if c["model"] != model or c["job"] not in cases]
        out["cases"] += [r.as_dict() for r in rows]
        usage = Counter((out["models"].get(model) or {}).get("usage") or {})
        usage.update(
            {
                "calls": meter.calls[model],
                "input_tokens": meter.tokens[model]["input"],
                "output_tokens": meter.tokens[model]["output"],
                "thinking_tokens": meter.tokens[model]["thinking"],
                **handler.counts[model],
            }
        )
        out["models"][model] = model_entry(kept_rows + rows, dict(usage))
    out["finished_at"] = datetime.now(UTC).isoformat(timespec="seconds")
    out["total_calls"] = sum(m.get("usage", {}).get("calls", 0) for m in out["models"].values())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=1, default=str))
    table = report.eval_table(out)
    print(table)
    print(f"\n{meter.total()} model calls this run; results in {path}")
    if args.docs:
        head = (
            f"Run {out['started_at'][:16]} UTC"
            + (f" (reruns: {len(out['reruns'])})" if out.get("reruns") else "")
            + f", `{settings.vertex_location}` endpoint, {out['total_calls']} model calls, "
            f"results file `api/{path}`."
        )
        report.write_section("eval-table", f"{head}\n\n{table}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
