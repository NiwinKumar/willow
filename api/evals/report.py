"""Markdown for docs/EVALS.md: each tool owns one marked section and rewrites only that."""

import re
from pathlib import Path
from typing import Any

from evals.metrics import pct

DOC = Path(__file__).resolve().parents[2] / "docs" / "EVALS.md"


def replace_section(text: str, name: str, body: str) -> str:
    """Replace the block between <!-- name:start --> and <!-- name:end --> (append it when the
    markers are not there yet)."""
    start, end = f"<!-- {name}:start -->", f"<!-- {name}:end -->"
    block = f"{start}\n{body.strip()}\n{end}"
    pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
    if pattern.search(text):
        return pattern.sub(lambda _: block, text)
    return text.rstrip() + "\n\n" + block + "\n"


def write_section(name: str, body: str, doc: Path = DOC) -> None:
    text = doc.read_text() if doc.exists() else "# Gemini evals\n"
    doc.write_text(replace_section(text, name, body))


JOB_NAMES = {
    "explanation": "Explanation",
    "advisor": "Wisp advisor",
    "label_scan": "Label scan",
    "routine_check": "Routine check",
    "proof_claims": "Proof claim drafts",
    "retailer_ask": "Retailer Ask",
    "retailer_ask_seats": "Ask, brand and retailer seats",
}


def _s(x: float | None) -> str:
    return "–" if x is None else f"{x:g}"


def eval_table(run: dict[str, Any]) -> str:
    """Job x model table plus the per-model invented-number line."""
    lines = [
        "| Job | Model | Cases (adv.) | First-try validator pass | Final pass (model answer "
        "shown) | Fallback / fixed reply | Behaviour ok (adversarial) | p50 / p95 s |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for model, m in run["models"].items():
        if not m.get("available"):
            why = (m.get("error") or "unavailable").split(". {")[0][:70]
            lines.append(f"| all jobs | `{model}` | not run: {why} | – | – | – | – | – |")
            continue
        for job, s in m["jobs"].items():
            if not s["cases"]:
                continue
            lines.append(
                f"| {JOB_NAMES.get(job, job)} | `{model}` | {s['cases']} ({s['adversarial']}) | "
                f"{pct(s['first_try_pass'])} | {pct(s['final_pass'])} | {pct(s['fallback'])} | "
                f"{pct(s['behaviour_ok'])} ({pct(s['adversarial_ok'])}) | "
                f"{_s(s['p50_s'])} / {_s(s['p95_s'])} |"
            )
    lines.append("")
    for model, m in run["models"].items():
        if m.get("available"):
            t = m["totals"]
            lines.append(
                f"- `{model}`: invented numbers that reached a user: **{t['invented_shown']} of "
                f"{t['cases']}** answers; build-spec wording slips shown: {t['wording_shown']}; "
                f"{t['calls']} model calls, {t['input_tokens']:,} input / "
                f"{t['output_tokens']:,} output tokens; errors {t['errors']}, skipped "
                f"{t['skipped']}."
            )
    return "\n".join(lines)
