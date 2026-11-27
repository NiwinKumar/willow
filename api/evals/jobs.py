"""One adapter per Gemini job: build the job's real input from a case, run the job's real public
function (so retries, validators and fallbacks are the product's own), then score what came back.

Every model answer the job asked for is recorded (`record`, installed by evals/run.py around
gemini.generate_json), so "first try" is the first answer the job got and "final" is what the
person would have seen.
"""

import base64
import copy
import json
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app import (
    advisor,
    catalog,
    explain,
    gemini,
    label_scan,
    numbers,
    proof_ai,
    retailer_ask,
    routine_check,
)
from app import advisor_blocks as blocks_mod
from app.store import MemoryStore
from evals import labels
from evals.metrics import (
    CaseResult,
    declined,
    invented_ingredients,
    must_not,
    recall,
    unknown_numbers,
    wording_slips,
)

ROOT = Path(__file__).resolve().parent
CASES_DIR = ROOT / "cases"
SAMPLE_RESULT = ROOT.parents[1] / "fixtures" / "analysis_result.sample.json"
_local = threading.local()


def data(name: str) -> Any:
    return json.loads((ROOT / "data" / name).read_text())


# ── recording ───────────────────────────────────────────────────────────────────────────────


def recorded() -> list[dict[str, Any]]:
    """Answers the current case's job got from gemini.generate_json, in order."""
    return _local.__dict__.setdefault("calls", [])


def install_recorder() -> None:
    """Wrap gemini.generate_json (every job calls it as an attribute, so this sees each call)."""
    orig = gemini.generate_json
    if getattr(orig, "_eval_wrapped", False):
        return

    def wrapped(prompt_id, contents, schema, **kw):
        try:
            out = orig(prompt_id, contents, schema, **kw)
        except Exception as exc:
            recorded().append({"prompt_id": prompt_id, "out": None, "error": str(exc)[:200]})
            raise
        recorded().append({"prompt_id": prompt_id, "out": out, "error": None})
        return out

    wrapped._eval_wrapped = True  # type: ignore[attr-defined]
    gemini.generate_json = wrapped

    orig_tool = advisor.run_tool

    def tool(name, args, store, uid):
        out = orig_tool(name, args, store, uid)
        _local.__dict__.setdefault("tools", []).append({"tool": name, "args": args, "result": out})
        return out

    advisor.run_tool = tool


def _first(prompt_id: str) -> Any:
    calls = [c for c in recorded() if c["prompt_id"] == prompt_id]
    return calls[0]["out"] if calls else None


def _answers(prompt_id: str) -> int:
    return sum(c["prompt_id"] == prompt_id for c in recorded())


# ── explanation (explain.generate) ─────────────────────────────────────────────────────────


def explanation_input(case: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    result = json.loads(SAMPLE_RESULT.read_text())
    for m in result["metrics"]:
        m.update(case.get("metrics", {}).get(m["id"], {}))
    result["metrics"] = [m for m in result["metrics"] if m["id"] not in case.get("drop", [])]
    return result, copy.deepcopy(case.get("context", {}))


def run_explanation(case: dict[str, Any], r: CaseResult) -> None:
    result, context = explanation_input(case)
    out, source = explain.generate(result, dict(context))
    ctx = dict(context)
    data_ = explain.gemini_input(explain.with_bands(result, ctx.pop("bands", None)), ctx)
    first = _first("explanation")
    r.first_try_pass = first is not None and not explain.problems(first, data_)
    r.answer_calls = _answers("explanation")
    r.source = "model" if source == "gemini" else "fallback"
    r.final_pass = source == "gemini"
    shown = [out["headline"], *(i["summary"] for i in out["items"]), *out["next_steps"]]
    r.shown = " | ".join(shown)[:400]
    if source == "gemini":
        r.invented_numbers = unknown_numbers(shown, explain._allowed(data_))
        r.wording = wording_slips(shown)
    r.notes += must_not(shown, case.get("must_not", []))


# ── Wisp advisor (advisor.chat) ────────────────────────────────────────────────────────────


def advisor_store(case: dict[str, Any], uid: str) -> MemoryStore:
    store = MemoryStore()
    if case.get("with_session", True):
        result, _ = explanation_input(case)
        store.session_set(
            uid,
            "s_eval_1",
            {
                "status": "done",
                "site": result["site"],
                "capture_mode": result["capture_mode"],
                "created_at": datetime(2026, 11, 20, tzinfo=UTC),
                "is_baseline": False,
                "n_frames": result["frames_used"],
                "result_json": json.dumps(result),
                "measured": True,
            },
        )
    for i, item in enumerate(case.get("routine", [])):
        p = catalog.by_id(item["product_id"])
        store.routine_set(
            uid,
            f"r_eval_{i}",
            {
                "product_id": p["product_id"],
                "brand": p["brand"],
                "custom_name": p["name"],
                "category": p["category"],
                "slots": item.get("slots", ["pm"]),
                "started_at": "2026-10-20",
                "key_actives": p["key_actives"],
                "inci": p["inci"],
            },
        )
    return store


def _advisor_texts(reply: dict[str, Any]) -> list[str]:
    out = []
    for b in reply.get("blocks", []):
        if b.get("type") in ("answer", "note") and b.get("text"):
            out.append(blocks_mod.strip(b["text"]))
        elif b.get("type") == "bullets":
            out += [blocks_mod.strip(i) for i in b.get("items") or [] if i]
    return out + list(reply.get("follow_up_suggestions") or [])


def run_advisor(case: dict[str, Any], r: CaseResult) -> None:
    uid = "eval_user"
    store = advisor_store(case, uid)
    _local.tools = []
    reply = advisor.chat(case["messages"], store, uid)
    fixed = {advisor.SCOPE_REPLY, advisor.PHOTO_REFUSAL}
    if "checks" in reply:
        r.source = "model"
    elif reply["message"] in fixed:
        r.source = "refusal"
    else:
        r.source = "fallback"
    r.answer_calls = _answers("advisor_reply")
    r.final_pass = r.source == "model"
    r.first_try_pass = r.final_pass and r.answer_calls == 1
    shown = _advisor_texts(reply) if r.source == "model" else [reply["message"]]
    r.shown = " | ".join(shown)[:400]
    if r.source == "model":
        ctx = advisor.context(store, uid)
        tools = _local.tools
        rates = [t["result"].get("measured_outcomes") for t in tools]
        allowed = numbers.collect(ctx) | numbers.collect(tools) | numbers.percents(rates)
        for m in case["messages"]:
            if m["role"] == "user":
                allowed |= numbers.in_text(m["text"])
        r.invented_numbers = unknown_numbers(shown, allowed)
        r.wording = wording_slips(shown)
    if case.get("expect") == "decline" and not (
        r.source == "refusal" or (r.source == "model" and declined(" ".join(shown)))
    ):
        r.notes.append("expected a decline")
    r.notes += must_not(shown, case.get("must_not", []))


# ── label scan (label_scan.scan) ───────────────────────────────────────────────────────────


def run_label_scan(case: dict[str, Any], r: CaseResult) -> None:
    label = case["label"]
    png = labels.render(label)
    image = label_scan.LabelImage(mime_type="image/png", data_base64=base64.b64encode(png).decode())
    res = label_scan.scan([image])
    scan = res.scan
    r.answer_calls = _answers("label_scan")
    r.first_try_pass = r.answer_calls >= 1 and _first("label_scan") is not None
    r.source = "model"
    expect_failure = case.get("expect_failure")
    read = [i.name for i in scan.inci]
    printed = label.get("inci", [])
    r.shown = f"failure={scan.failure} conf={scan.confidence} inci={len(read)} " + ", ".join(
        f"{a.name} {a.pct}" for a in scan.key_actives
    )
    if expect_failure:
        r.final_pass = scan.unreadable or scan.failure in expect_failure
        if scan.failure not in expect_failure:
            r.notes.append(f"expected failure {expect_failure}, got {scan.failure}")
    else:
        r.final_pass = not scan.unreadable
        rec = recall(read, printed)
        if rec < 0.9:
            r.notes.append(f"recall {rec:.2f}")
    invented = invented_ingredients(read, printed)
    if invented:
        r.notes.append(f"ingredients not on the label: {invented[:4]}")
    printed_numbers = set()
    for line, _ in labels.lines_of(label):
        printed_numbers |= numbers.in_text(line)
    r.invented_numbers = [
        f"{a.name} {a.pct:g}%"
        for a in scan.key_actives
        if a.pct is not None and not numbers.collect(a.pct) & printed_numbers
    ]
    found = [n.lower() for n in read] + [a.name.lower() for a in scan.key_actives]
    r.notes += [f"read '{w}'" for w in case.get("must_not_read", []) if any(w in f for f in found)]


# ── routine check (routine_check.run) ──────────────────────────────────────────────────────


def routine_entries(case: dict[str, Any]) -> list[dict[str, Any]]:
    entries = []
    for i, item in enumerate(case["routine"]):
        if "product_id" in item:
            p = catalog.by_id(item["product_id"])
            fields = {
                "product_id": p["product_id"],
                "brand": p["brand"],
                "custom_name": p["name"],
                "category": p["category"],
                "key_actives": p["key_actives"],
                "inci": p["inci"],
            }
        else:
            fields = dict(item["custom"])
        entries.append(
            {
                "id": f"r_{i + 1}",
                **fields,
                "slots": item.get("slots", ["pm"]),
                "schedule": item.get("schedule"),
            }
        )
    return entries


def run_routine_check(case: dict[str, Any], r: CaseResult) -> None:
    entries = routine_entries(case)
    rules = routine_check.rule_findings(entries)
    result, complete = routine_check.run(entries)
    first = _first("routine_check")
    r.answer_calls = _answers("routine_check")
    model_conflicts = [c for c in result["conflicts"] if c["source"] == "model"]
    model_notes = result["notes"][len(rules["notes"]) :]
    if first is not None:
        raw = len(first.conflicts) + len(first.notes)
        r.first_try_pass = complete and raw == len(model_conflicts) + len(model_notes)
        if not r.first_try_pass:
            dropped = raw - len(model_conflicts) - len(model_notes)
            r.info.append(f"{dropped} model additions dropped by the validator")
    r.final_pass = complete
    r.source = "model" if complete else "fallback"
    shown = [t for c in model_conflicts for t in (c["issue"], c["suggestion"])] + model_notes
    r.shown = " | ".join(shown)[:400] or "(no additions)"
    listing = routine_check._listing(routine_check._active(entries))
    r.invented_numbers = unknown_numbers(shown, numbers.in_text(listing))
    r.wording = wording_slips(shown)
    r.notes += must_not(shown, case.get("must_not", []))


# ── Proof claim drafts (proof_ai.claims) ───────────────────────────────────────────────────


def claim_view(case: dict[str, Any]) -> dict[str, Any]:
    view = copy.deepcopy(data("proof_views.json")[case["product_id"]])
    view["product"].update(case.get("product", {}))
    return view


def run_proof_claims(case: dict[str, Any], r: CaseResult) -> None:
    view = claim_view(case)
    channel = case.get("channel", "pdp")
    out = proof_ai.claims(view, channel)
    by_id = {s["id"]: s for s in proof_ai.sources(view)}
    limit = proof_ai.CHANNELS[channel][1]
    first = _first("proof_claims")
    r.answer_calls = _answers("proof_claims")
    r.first_try_pass = bool(
        first is not None
        and first.drafts
        and all(proof_ai._draft_problem(d, by_id, limit) is None for d in first.drafts)
    )
    r.final_pass = out["source"] == "gemini"
    r.source = "model" if r.final_pass else "fallback"
    shown = [d["text"] for d in out["drafts"]]
    r.shown = " | ".join(shown)[:400]
    if r.final_pass:
        for d in out["drafts"]:
            cited = [by_id[s]["text"] for s in d["sources"] if s in by_id]
            r.invented_numbers += unknown_numbers([d["text"]], proof_ai._allowed(cited))
        r.wording = wording_slips(shown)
    r.notes += must_not(shown, case.get("must_not", []))


# ── Ask the retailer data (retailer_ask.ask) ───────────────────────────────────────────────


def product_names(insights: dict[str, Any]) -> list[str]:
    rows = [*insights.get("products", []), *(insights.get("product_outcomes") or {}).values()]
    return sorted({p["product"] for p in rows} | {f"{p['brand']} {p['product']}" for p in rows})


def run_retailer_ask(case: dict[str, Any], r: CaseResult) -> None:
    insights = data("insights.json")
    view = retailer_ask.view(insights)
    try:
        out = retailer_ask.ask(case["question"], insights)
    except retailer_ask.Unavailable:
        r.source, r.answer_calls = "error", _answers("retailer_ask")
        r.notes.append("Gemini unavailable")
        return
    first = _first("retailer_ask")
    r.answer_calls = _answers("retailer_ask")
    r.first_try_pass = first is not None and not retailer_ask.problems(
        first, view, case["question"]
    )
    r.final_pass = out["checks"] is not None
    r.source = "model" if r.final_pass else "fallback"
    shown = [out["answer"], *out["follow_ups"], (out["chart"] or {}).get("title", "")]
    shown = [s for s in shown if s]
    r.shown = (" | ".join(shown) + (" [chart]" if out["chart"] else ""))[:400]
    if r.final_pass:
        allowed = numbers.collect(view) | numbers.percents(view)
        r.invented_numbers = unknown_numbers(shown, allowed)
        r.wording = wording_slips(shown, product_names(insights))
    if case.get("expect") == "refuse" and not (out["refused"] and not out["chart"]):
        r.notes.append("expected a refusal")
    r.notes += must_not(shown, case.get("must_not", []))


JOBS: dict[str, Callable[[dict[str, Any], CaseResult], None]] = {
    "explanation": run_explanation,
    "advisor": run_advisor,
    "label_scan": run_label_scan,
    "routine_check": run_routine_check,
    "proof_claims": run_proof_claims,
    "retailer_ask": run_retailer_ask,
}


def run_case(job: str, case: dict[str, Any], model: str) -> CaseResult:
    r = CaseResult(
        job=job, case_id=case["id"], slice=case.get("slice", "normal"), model=model, source="error"
    )
    _local.calls = []
    started = time.monotonic()
    try:
        JOBS[job](case, r)
    except Exception as exc:  # a job that raises is scored as an error, never retried here
        r.source = "error"
        r.notes.append(f"{type(exc).__name__}: {str(exc)[:200]}")
    r.latency_ms = round((time.monotonic() - started) * 1000)
    r.behaviour_ok = not r.notes and not r.invented_numbers and not r.wording
    return r
