"""Is temperature honoured? (07 §0: the 3.6 Flash release note says custom temperature is
ignored; the 3.8 Flash page does not say.)

    cd api && uv run python -m evals.temperature --model gemini-3.8-flash --runs 10 --docs

Sends the same prompt N times through gemini.generate_json (the product's own call: schema,
thinking LOW, safety settings) and counts distinct answers:
- label extraction (label_scan's instructions and schema on a drawn label) at temperature 0;
- the session explanation (explain's instructions and input) at temperature 0 and at 1.0.
Transcription leaves little room to vary, so the free-text explanation is the real test: if
temperature 0 gives as many distinct answers as 1.0, it is not what makes Willow repeatable.
"""

import argparse
import json
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

from google.genai import types

from app import explain, gemini, kept, label_scan
from app.settings import get_settings
from evals import jobs, labels, report

LABEL_CASE = "niacinamide_serum"
EXPLANATION_CASE = "three_real_changes"


def _case(job: str, case_id: str) -> dict[str, Any]:
    cases = json.loads((jobs.CASES_DIR / f"{job}.json").read_text())["cases"]
    return next(c for c in cases if c["id"] == case_id)


def agreement(outputs: list[str]) -> dict[str, Any]:
    """distinct answers and the share equal to the most common one (errors counted apart)."""
    errors = sum(o.startswith("ERROR") for o in outputs)
    outputs = [o for o in outputs if not o.startswith("ERROR")]
    counts = Counter(outputs)
    top = counts.most_common(1)[0][1] if outputs else 0
    return {
        "runs": len(outputs),
        "errors": errors,
        "distinct": len(counts),
        "modal_share": round(top / len(outputs), 2) if outputs else None,
    }


def _repeat(n: int, call) -> list[str]:
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = [pool.submit(call) for _ in range(n)]
    out = []
    for f in futures:
        try:
            out.append(f.result())
        except Exception as exc:  # recorded, not retried: an error is a data point too
            out.append(f"ERROR {type(exc).__name__}")
    return out


def label_runs(n: int) -> list[str]:
    png = labels.render(_case("label_scan", LABEL_CASE)["label"])
    parts = [
        types.Part.from_bytes(data=png, mime_type="image/png"),
        "Transcribe this product label.",
    ]

    def call() -> str:
        out = gemini.generate_json(
            "eval_temperature_label",
            parts,
            label_scan.LabelScan,
            instructions=label_scan.INSTRUCTIONS,
            temperature=0.0,
            max_output_tokens=8192,
            attempts=1,
        )
        return out.model_dump_json()

    return _repeat(n, call)


def explanation_runs(n: int, temperature: float) -> list[str]:
    result, context = jobs.explanation_input(_case("explanation", EXPLANATION_CASE))
    data = explain.gemini_input(result, context)
    prompt = f"Session data (JSON):\n{json.dumps(data)}"

    def call() -> str:
        out = gemini.generate_json(
            "eval_temperature_explanation",
            [prompt],
            explain._Explanation,
            instructions=explain.INSTRUCTIONS,
            temperature=temperature,
            attempts=1,
        )
        return out.model_dump_json()

    return _repeat(n, call)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="gemini-3.8-flash")
    ap.add_argument("--runs", type=int, default=10)
    ap.add_argument("--docs", action="store_true")
    args = ap.parse_args()
    s = get_settings()
    s.keep_gemini_answers, s.gemini_model, s.gemini_fallback_model = False, args.model, ""
    kept.clear_memory()
    results = {
        "label extraction, temperature 0": agreement(label_runs(args.runs)),
        "explanation, temperature 0": agreement(explanation_runs(args.runs, 0.0)),
        "explanation, temperature 1.0": agreement(explanation_runs(args.runs, 1.0)),
    }
    print(json.dumps(results, indent=1))
    t0 = results["explanation, temperature 0"]
    t1 = results["explanation, temperature 1.0"]
    if t0["distinct"] == 1 and t1["distinct"] > 1:
        verdict = f"temperature honoured on `{args.model}` (0 gives one answer, 1.0 varies)"
    elif t0["distinct"] >= t1["distinct"] > 1:
        verdict = f"temperature 0 has no visible effect on `{args.model}` (as varied as 1.0)"
    else:
        verdict = (
            f"temperature partly honoured on `{args.model}`: 0 narrows the answers but does not "
            "make them identical"
        )
    rows = "\n".join(
        f"| {name} | {r['runs']} | {r['distinct']} | {round(r['modal_share'] * 100)}% |"
        for name, r in results.items()
    )
    body = (
        f"Run {datetime.now(UTC).date()}, `{args.model}`, thinking LOW, the product's own "
        "generate_json call, kept answers off.\n\n"
        "| Prompt | Runs | Distinct answers | Same as the most common |\n|---|---|---|---|\n"
        f"{rows}\n\n**Finding: {verdict}.**"
    )
    print(body)
    if args.docs:
        report.write_section("temperature", body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
