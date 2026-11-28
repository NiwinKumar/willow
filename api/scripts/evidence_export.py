"""The `evals` and `armor` parts of web/src/data/evidence.json (the Evidence page, /evidence).

Reads the latest api/evals/results/*.json (written by `python -m evals.run`), the cases it ran
(api/evals/cases/<job>.json, for the question each case asked), the production block of
docs/EVALS.md (written by scripts/gemini_report.py) and infra/api-env.yaml (is Model Armor
configured). Every figure on the page's eval section comes from here; nothing is typed in.
Other keys of evidence.json (`cost`, `a11y`) are left as they are.

    cd api && python scripts/evidence_export.py [--no-write] [--a11y audit/summary.json]

`--a11y` also writes the `a11y` key from an audit summary: `{meta: {audited_at, base, lighthouse,
axe}, rows: [{page, mode: desktop|mobile, lighthouse, axe: [{id, impact, n}]}]}`, as written by
the audit script described in docs/EVIDENCE.md (axe-core and Lighthouse's accessibility category
in headless Chrome).

Standard library only: no model call, no network.
"""

import argparse
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "api" / "evals" / "results"
CASES = ROOT / "api" / "evals" / "cases"
EVALS_DOC = ROOT / "docs" / "EVALS.md"
API_ENV = ROOT / "infra" / "api-env.yaml"
EVIDENCE = ROOT / "web" / "src" / "data" / "evidence.json"

# The job's name on the page, and the validator that decides its first-try pass (docs/EVALS.md,
# "Columns").
JOBS: dict[str, tuple[str, str, str]] = {
    "explanation": ("Check-in explanation", "explain.problems", "api/app/explain.py"),
    "advisor": ("Wisp answer", "the advisor reply checks", "api/app/advisor.py"),
    "label_scan": ("Label photo", "the label schema", "api/app/label_scan.py"),
    "routine_check": ("Routine check", "the routine-check filter", "api/app/routine_check.py"),
    "proof_claims": ("Proof claim drafts", "the claim-draft check", "api/app/proof_ai.py"),
    "retailer_ask": ("Proof Ask", "retailer_ask.problems", "api/app/retailer_ask.py"),
    "retailer_ask_seats": (
        "Proof Ask, brand and retailer seats",
        "retailer_ask.problems",
        "api/app/retailer_ask.py",
    ),
}
MAX_FAILURES = 5
# The page uses cosmetic language only, so a case whose question or answer names a condition is
# counted but not quoted (the same words as evals/metrics.py WORDING["condition name"]).
CONDITION = re.compile(
    r"\b(acne|rosacea|eczema|psoriasis|melasma|dermatitis|melanoma|cancer|vitiligo|"
    r"isotretinoin|tretinoin)\b",
    re.I,
)
PRODUCTION = re.compile(
    r"Since (\d{4}-\d{2}-\d{2}): (\d+) answers rejected before a person saw them\*\* "
    r"\((\d+) by Willow's validators, (\d+) failed the schema\), out of (\d+) logged model calls"
)


def latest_results() -> Path:
    files = sorted(RESULTS.glob("*.json"))
    if not files:
        raise SystemExit(f"no results in {RESULTS}")
    return files[-1]


def asked(job: str) -> dict[str, str]:
    """case id -> the question or request the case put to the job, when it has one."""
    path = CASES / f"{job}.json"
    if not path.exists():
        return {}
    out = {}
    for c in json.loads(path.read_text()).get("cases", []):
        ctx = c.get("context") or {}
        text = (
            c.get("question")
            or next((m["text"] for m in reversed(c.get("messages", [])) if m["role"] == "user"), "")
            or ctx.get("person_asked")
            or ctx.get("note")
            or ""
        )
        if text:
            out[c["id"]] = text
    return out


def kind_of(c: dict[str, Any]) -> str | None:
    """fallback: the person got the fixed reply; slipped: a model answer was shown and an eval
    check found something in it; fixed: the first answer was rejected and a later one passed."""
    if c["source"] == "fallback":
        return "fallback"
    if not c["behaviour_ok"] or c["invented_numbers"] or c["wording"]:
        return "slipped"
    if not c["first_try_pass"]:
        return "fixed"
    return None


def check_of(c: dict[str, Any], kind: str) -> str:
    name, validator, _ = JOBS.get(c["job"], (c["job"], "the job's validator", ""))
    if kind == "slipped":
        found = [
            f"must not say “{n.replace(chr(92) + 'b', '')}”" if "\\" in n else n for n in c["notes"]
        ]
        found += [w.split(" in ")[0] for w in c["wording"]]
        found += [f"number not in the input: {n}" for n in c["invented_numbers"]]
        return "; ".join(found) or "behaviour check"
    extra = "; ".join(c.get("info", []))
    return validator + (f" ({extra})" if extra else "")


def failures(cases: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Up to MAX_FAILURES cases, one per (job, case), taking turns between the three kinds and
    adversarial cases first, plus how many of each kind the run had in all."""
    by_kind: dict[str, list[dict[str, Any]]] = {"fallback": [], "slipped": [], "fixed": []}
    questions = {job: asked(job) for job in JOBS}
    for c in cases:
        kind = kind_of(c)
        if kind:
            by_kind[kind].append(c)
    counts = {k: len(v) for k, v in by_kind.items()}
    for v in by_kind.values():
        v.sort(key=lambda c: c["slice"] != "adversarial")
    picked: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    while len(picked) < MAX_FAILURES and any(by_kind.values()):
        for kind, queue in by_kind.items():
            while queue:
                c = queue.pop(0)
                key = (c["job"], c["case_id"])
                question = questions.get(c["job"], {}).get(c["case_id"], "")
                if key in seen or CONDITION.search(question + " " + c["shown"]):
                    continue
                seen.add(key)
                picked.append(
                    {
                        "kind": kind,
                        "job": c["job"],
                        "job_name": JOBS.get(c["job"], (c["job"],))[0],
                        "model": c["model"],
                        "case_id": c["case_id"],
                        "adversarial": c["slice"] == "adversarial",
                        "asked": question,
                        "check": check_of(c, kind),
                        "check_path": JOBS.get(c["job"], ("", "", ""))[2]
                        if kind != "slipped"
                        else "api/evals/metrics.py",
                        "answers_asked": c["answer_calls"],
                        # the runner keeps the first 400 characters of what was shown
                        "shown": c["shown"],
                        "shown_cut": len(c["shown"]) >= 400,
                    }
                )
                break
            if len(picked) >= MAX_FAILURES:
                break
    return picked, counts


def production() -> dict[str, Any] | None:
    if not EVALS_DOC.exists():
        return None
    m = PRODUCTION.search(EVALS_DOC.read_text())
    if not m:
        return None
    since, rejected, by_validators, by_schema, calls = m.groups()
    return {
        "since": since,
        "rejected": int(rejected),
        "by_validators": int(by_validators),
        "by_schema": int(by_schema),
        "logged_calls": int(calls),
    }


def armor_configured() -> bool:
    """True when the deployed api's env file sets a Model Armor template."""
    if not API_ENV.exists():
        return False
    m = re.search(r"^MODEL_ARMOR_TEMPLATE:\s*[\"']?([^\"'\s#]+)", API_ENV.read_text(), re.M)
    return bool(m)


def a11y(summary: Path) -> dict[str, Any]:
    """Per page: the Lighthouse accessibility score and the axe findings at each size (serious
    or critical counted apart from the rest)."""
    data = json.loads(summary.read_text())
    meta = data["meta"]
    pages: dict[str, dict[str, Any]] = {}
    for r in data["rows"]:
        nodes = {True: 0, False: 0}
        for v in r["axe"]:
            nodes[v["impact"] in ("serious", "critical")] += v["n"]
        pages.setdefault(r["page"], {"page": r["page"]})[r["mode"]] = {
            "lighthouse": r["lighthouse"],
            "serious": nodes[True],
            "other": nodes[False],
        }
    local = "localhost" in meta["base"] or "127.0.0.1" in meta["base"]
    return {
        "audited_on": meta["audited_at"],
        "tools": f"Lighthouse {meta['lighthouse']} and axe-core {meta['axe']}",
        "against": "a local build of this version, with a test account" if local else meta["base"],
        "rows": list(pages.values()),
    }


def build(path: Path) -> dict[str, Any]:
    run = json.loads(path.read_text())
    rows, models = [], []
    for model, m in run["models"].items():
        if not m.get("available"):
            models.append(
                {
                    "model": model,
                    "available": False,
                    "error": (m.get("error") or "unavailable")[:90],
                }
            )
            continue
        t = m["totals"]
        models.append(
            {
                "model": model,
                "available": True,
                "cases": t["cases"],
                "invented_shown": t["invented_shown"],
                "wording_shown": t["wording_shown"],
                "errors": t["errors"],
                "calls": t["calls"],
            }
        )
        for job, s in m["jobs"].items():
            if not s["cases"]:
                continue
            rows.append(
                {
                    "job": job,
                    "job_name": JOBS.get(job, (job,))[0],
                    "model": model,
                    **{
                        k: s[k]
                        for k in (
                            "cases",
                            "adversarial",
                            "first_try_pass",
                            "final_pass",
                            "fallback",
                            "behaviour_ok",
                            "adversarial_ok",
                            "p50_s",
                            "p95_s",
                        )
                    },
                }
            )
    cases = run["cases"]
    ran = [m for m in models if m["available"]]
    picked, counts = failures(cases)
    return {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "source": str(path.relative_to(ROOT)),
        "run_started_at": run["started_at"],
        "run_finished_at": run.get("finished_at"),
        "reruns": [{"at": r["at"], "jobs": r["jobs"]} for r in run.get("reruns", [])],
        "model_calls": run.get("total_calls"),
        "headline": {
            "answers": sum(m["cases"] for m in ran),
            "adversarial": sum(c["slice"] == "adversarial" for c in cases),
            "invented_shown": sum(m["invented_shown"] for m in ran),
            "wording_shown": sum(m["wording_shown"] for m in ran),
            "errors": sum(m["errors"] for m in ran),
            "first_try_rejected": sum(not c["first_try_pass"] for c in cases),
            "fixed_on_retry": counts["fixed"],
            "fallback": counts["fallback"],
            "slipped": counts["slipped"],
            "flagged": sum(counts.values()),
        },
        "models": models,
        "rows": rows,
        "failures": picked,
        "production": production(),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--no-write", action="store_true")
    ap.add_argument("--a11y", type=Path, help="audit summary.json to write as the a11y key")
    a = ap.parse_args()
    path = latest_results()
    evals = build(path)
    h = evals["headline"]
    print(
        f"{path.name}: invented numbers shown {h['invented_shown']} of {h['answers']}; "
        f"first try rejected {h['first_try_rejected']}, fallback {h['fallback']}, "
        f"slipped {h['slipped']}; "
        f"{len(evals['failures'])} cases quoted"
    )
    if a.no_write:
        return
    # Read again right before writing: other scripts own other keys of the same file.
    data = json.loads(EVIDENCE.read_text()) if EVIDENCE.exists() else {}
    data["evals"] = evals
    data["armor"] = {"configured": armor_configured(), "source": str(API_ENV.relative_to(ROOT))}
    if a.a11y:
        data["a11y"] = a11y(a.a11y)
    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote evals and armor to {EVIDENCE}")


if __name__ == "__main__":
    main()
