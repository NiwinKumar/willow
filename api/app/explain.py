"""Deterministic explanation (GEMINI_SPEC.md section 2, the template fallback).

Used until the Gemini explanation lands, and afterwards whenever Gemini's output fails the number
validator twice. Every number here is copied from the metrics, so it always passes.
"""

import json
import logging
import re
from typing import Any

from pydantic import BaseModel, Field

from app import gemini, numbers

log = logging.getLogger("willow.explain")

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
    if verdict == "no_baseline" and delta is not None:
        quoted = [_signed(delta)]
        summary = (
            f"{label}: change {quoted[0]}{trend}. Your baseline has one photo, so there is no "
            "noise band yet and this cannot be called a real change."
        )
    elif verdict == "no_baseline":
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
        if any(m.get("delta") is not None for m in metrics):
            headline = "Compared with your baseline (no noise band yet)"
            steps = ["Take 5 photos in one session and make it your baseline."]
        else:
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


# --- Gemini explanation (GEMINI_SPEC.md section 2) -------------------------------------------

BANNED = re.compile(
    r"\b(diagnos\w*|rosacea|eczema|psoriasis|melasma|dermatitis|melanoma|cancer|disease|"
    r"whiten\w*|fairer|fairness|lighter skin|skin age|flaw\w*)\b",
    re.I,
)
CHANGE_WORDS = re.compile(r"\b(real change|improv\w*|worse\w*|better)\b", re.I)

INSTRUCTIONS = """Explain one skin-measurement session to the person, in plain calm words.
Rules:
- Use only the metrics given. Quote numbers exactly as given (value, delta, mdc95, days); never
  compute new numbers, percentages or estimates.
- verdict real_change: say it changed beyond normal photo variation, with the delta and the noise
  threshold (mdc95). within_noise: "no clear change yet". no_baseline with a delta: the change is
  shown but there is no noise band yet, so it cannot be called real. no_baseline without a delta:
  this is the first reading. low_quality: the photo could not be compared.
- confidence indicative: call it a trend.
- Never attribute causation with certainty; at most "may be linked to" a routine product, and only
  if it started before this session.
- Skin tone (tone_ita) is descriptive: never better or worse, never lighter or darker as a goal.
- No disease names, no diagnosis, no "better/worse" skin.
- headline: one short sentence. items: one per metric, most important first. next_steps: up to 3
  short practical capture or routine tips. disclaimer: "Cosmetic appearance tracking, not a
  diagnosis.\""""


class _Item(BaseModel):
    metric_id: str
    summary: str = Field(max_length=320)
    quoted_numbers: list[str] = Field(default_factory=list, max_length=6)


class _Explanation(BaseModel):
    headline: str = Field(max_length=140)
    items: list[_Item] = Field(max_length=11)
    next_steps: list[str] = Field(default_factory=list, max_length=3)
    disclaimer: str = Field(max_length=120)


# How the app displays each unit (web/src/lib/metrics.ts): Gemini quotes these, not raw floats.
UNIT_DISPLAY = {
    "deg": ("°", 1),
    "a_star": (" a*", 1),
    "pct_area": ("% of area", 1),
    "index": ("", 2),
    "count": ("", 0),
    "per_cm2": (" per cm²", 0),
    "delta_l_star": (" ΔL*", 1),
}


def _shown(x: float | None, unit: str) -> float | None:
    if x is None:
        return None
    return round(x, UNIT_DISPLAY.get(unit, ("", 2))[1])


def gemini_input(result: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    return {
        "site": result["site"],
        "capture_mode": result["capture_mode"],
        "frames_used": result["frames_used"],
        "quality_passed": result["quality"]["passed"],
        "quality_reasons": result["quality"]["reasons"],
        "warnings": result.get("warnings", []),
        "metrics": [
            {
                "id": m["id"],
                "label": m["label"],
                "verdict": m["verdict"],
                "direction": m["direction"],
                "confidence": m["confidence"],
                "unit": UNIT_DISPLAY.get(m["unit"], ("", 2))[0].strip() or m["unit"],
                "value": _shown(m["value"], m["unit"]),
                "delta": _shown(m.get("delta"), m["unit"]),
                "mdc95": _shown(m.get("mdc95"), m["unit"]),
            }
            for m in result["metrics"]
        ],
        **context,
    }


def problems(exp: _Explanation, data: dict[str, Any]) -> list[str]:
    allowed = numbers.collect(data)
    verdicts = {m["id"]: m["verdict"] for m in data["metrics"]}
    found = []
    texts = [exp.headline, *exp.next_steps, *(i.summary for i in exp.items)]
    for text in texts:
        if not numbers.only_known(text, allowed):
            found.append(f"unknown number in: {text}")
        if BANNED.search(text):
            found.append(f"banned wording in: {text}")
    for item in exp.items:
        if item.metric_id not in verdicts:
            found.append(f"unknown metric {item.metric_id}")
        elif verdicts[item.metric_id] != "real_change" and CHANGE_WORDS.search(item.summary):
            found.append(f"change language for {item.metric_id} ({verdicts[item.metric_id]})")
    if not any(v == "real_change" for v in verdicts.values()) and CHANGE_WORDS.search(exp.headline):
        found.append("change language in headline")
    return found


def generate(result: dict[str, Any], context: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """(explanation, source): Gemini when it passes the validator, else the template."""
    if not result["metrics"]:
        return template(result), "template"
    data = gemini_input(result, context)
    prompt = f"Session data (JSON):\n{json.dumps(data)}"
    for _ in range(2):  # at most two Gemini calls, then the template: analysis must stay quick
        try:
            exp = gemini.generate_json(
                "explanation",
                [prompt],
                _Explanation,
                instructions=INSTRUCTIONS,
                temperature=0.3,
                max_output_tokens=4096,
                attempts=1,
            )
        except gemini.GeminiError:
            break
        issues = problems(exp, data)
        if not issues:
            out = exp.model_dump()
            out["disclaimer"] = DISCLAIMER
            return out, "gemini"
        log.warning("explanation rejected: %s", issues[:3])
    return template(result), "template"
