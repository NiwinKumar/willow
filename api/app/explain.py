"""Deterministic explanation (GEMINI_SPEC.md section 2, the template fallback).

Used until the Gemini explanation lands, and afterwards whenever Gemini's output fails the number
validator twice. Every number here is copied from the metrics, so it always passes.
"""

from typing import Any

DISCLAIMER = "Cosmetic appearance tracking, not a diagnosis."


def _num(x: float | int | None) -> str:
    if x is None:
        return ""
    if isinstance(x, int) or float(x).is_integer():
        return str(int(x))
    return f"{x:g}"


def _signed(x: float | int) -> str:
    s = _num(x)
    return s if s.startswith("-") or s == "0" else f"+{s}"


def item(metric: dict[str, Any]) -> dict[str, Any]:
    label = metric["label"]
    verdict = metric["verdict"]
    delta, mdc = metric.get("delta"), metric.get("mdc95")
    trend = " (trend only)" if metric["confidence"] == "indicative" else ""
    quoted: list[str] = []
    if verdict == "no_baseline":
        summary = f"{label}: first reading. Future photos are compared to it."
    elif verdict == "low_quality":
        summary = f"{label}: photo quality too low to compare this time."
    elif delta is not None and mdc is not None:
        quoted = [_signed(delta), _num(mdc)]
        words = "a real change" if verdict == "real_change" else "within normal photo variation"
        summary = f"{label}: {words}{trend} (change {quoted[0]}, noise threshold {quoted[1]})."
    elif delta is not None:
        quoted = [_signed(delta)]
        summary = f"{label}: no clear change yet{trend} (change {quoted[0]})."
    else:
        summary = f"{label}: no clear change yet{trend}."
    return {"metric_id": metric["id"], "summary": summary, "quoted_numbers": quoted}


def template(result: dict[str, Any]) -> dict[str, Any]:
    metrics = result["metrics"]
    real = [m for m in metrics if m["verdict"] == "real_change"]
    if not result["quality"]["passed"]:
        headline = "These photos could not be compared"
        steps = ["Retake in the same light with the card in view."]
    elif metrics and all(m["verdict"] == "no_baseline" for m in metrics):
        headline = "Your first reading"
        steps = ["Take your next photos in the same spot and light."]
    elif real:
        headline = f"{len(real)} real change{'s' if len(real) != 1 else ''} since your baseline"
        steps = ["Keep the routine steady so the next reading is comparable."]
    else:
        headline = "No clear change since your baseline yet"
        steps = ["Most changes take a few weeks to show. Keep the same light and distance."]
    ordered = real + [m for m in metrics if m["verdict"] != "real_change"]
    return {
        "headline": headline,
        "items": [item(m) for m in ordered],
        "next_steps": steps,
        "disclaimer": DISCLAIMER,
    }
