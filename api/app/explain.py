"""Deterministic explanation (GEMINI_SPEC.md section 2, the template fallback).

Used until the Gemini explanation lands, and afterwards whenever Gemini's output fails the number
validator twice. Every number here is copied from the metrics, so it always passes.
"""

import json
import logging
import re
from decimal import ROUND_HALF_UP, Decimal
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


RETAKE = {
    "face_full": "Retake facing a window or lamp, hair back, hands away from your face, looking "
    "straight into the camera.",
    "forearm_treated": "Retake with all four pen dots in view and white paper beside the arm.",
    "forearm_control": "Retake with all four pen dots in view and white paper beside the arm.",
}
RETAKE_DEFAULT = "Retake in the same light, holding the phone steady."


def template(result: dict[str, Any]) -> dict[str, Any]:
    metrics = result["metrics"]
    real = [m for m in metrics if m["verdict"] == "real_change"]
    if not result["quality"]["passed"]:
        headline = "These photos could not be measured"
        steps = [RETAKE.get(result.get("site", ""), RETAKE_DEFAULT)]
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
# "cannot be called a real change yet" or "no noise band yet to confirm a real change" is the
# hedge we ask for, not a claim: within a sentence, a mention of "real (change)" after a negation
# does not count. "Improved", "better" and "worse" always count.
NEGATION = re.compile(r"\b(?:cannot|can't|can not|could not|not|no|without|too early)\b", re.I)
REAL = re.compile(r"\breal(?:\s+change)?\b", re.I)


def _claims_change(text: str) -> bool:
    for sentence in re.split(r"[.!?;]", text):
        neg = NEGATION.search(sentence)
        if neg:
            head, tail = sentence[: neg.start()], sentence[neg.start() :]
            sentence = head + REAL.sub(" ", tail)
        if CHANGE_WORDS.search(sentence):
            return True
    return False


INSTRUCTIONS = """Explain one skin-measurement session to the person, in plain calm words.
Rules:
- Use only the metrics given. Quote numbers exactly as given (value, delta, mdc95, days); never
  compute new numbers, percentages or estimates.
- verdict real_change: say it changed beyond normal photo variation, with the delta and the noise
  threshold (mdc95). within_noise: "no clear change yet". no_baseline with a delta: the change is
  shown but there is no noise band yet, so it cannot be called real. no_baseline without a delta:
  this is the first reading. low_quality: the photo could not be compared.
- confidence indicative: call it a trend.
- With frames_used of 2 or more, blemishes and dark spots count only marks seen in at least two
  of the photos (one photo's grain or a stray hair does not count); say so if the count is low.
- Never attribute causation with certainty; at most "may be linked to" a routine product, and only
  if it started before this session.
- Skin tone (tone_ita) is descriptive: never better or worse, never lighter or darker as a goal.
- No disease names, no diagnosis, no "better/worse" skin.
- is_baseline in the session data tells you which kind of session this is: true means the first
  reading (say so); false means a later session compared with the baseline, so never call it
  "initial" or "first". A delta of 0 or 0.0 means no measurable difference; never write "-0.0".
- British spelling (colour, centre), as in the rest of the app.
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


# How the app displays each unit (web/src/lib/metrics.ts UNIT_LABEL): Gemini quotes these.
UNIT_DISPLAY = {
    "deg": "°",
    "a_star": " a*",
    "pct_area": "% of area",
    "index": "",
    "count": "",
    "per_cm2": " per cm²",
    "delta_l_star": " ΔL*",
}


def decimals(metric: dict[str, Any]) -> int:
    """Decimals the app shows a metric with (web/src/lib/metrics.ts decimalsFor): never more
    precision than its noise band supports. Counts are whole numbers."""
    if metric.get("unit") == "count":
        return 0
    band = metric.get("mdc95")
    band = 1.0 if band is None else band
    return 0 if band >= 5 else 1 if band >= 0.5 else 2


def _shown(x: float | None, places: int) -> float | int | None:
    if x is None:
        return None
    # Round half away from zero, like the web's toFixed for these values: 2.5 blemishes shows as
    # 3 on screen, so Gemini must see 3 too (Python's round() would give 2). A delta that rounds
    # to zero is written as 0, never -0.
    q = Decimal(str(x)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
    return (int(q) if places == 0 else float(q)) + 0


def shown_numbers(metric: dict[str, Any]) -> dict[str, Any]:
    """value, delta and mdc95 exactly as the app shows them."""
    places = decimals(metric)
    return {k: _shown(metric.get(k), places) for k in ("value", "delta", "mdc95")}


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
                # Unit as the app writes it; none for counts and indexes (never "index").
                "unit": UNIT_DISPLAY.get(m["unit"], m["unit"]).strip(),
                **shown_numbers(m),
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
        elif verdicts[item.metric_id] != "real_change" and _claims_change(item.summary):
            found.append(f"change language for {item.metric_id} ({verdicts[item.metric_id]})")
    if not any(v == "real_change" for v in verdicts.values()) and _claims_change(exp.headline):
        found.append("change language in headline")
    return found


def generate(result: dict[str, Any], context: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """(explanation, source): Gemini when it passes the validator, else the template."""
    if not result["metrics"] or not result["quality"]["passed"]:
        # Nothing was measured: the fixed text says why and how to retake (Gemini would be told
        # this is a first reading, which a session that failed quality never is).
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
                attempts=2,  # a pause and one more try on a rate limit or a slow answer
                timeout_ms=35_000,
            )
        except gemini.GeminiError:
            break
        issues = problems(exp, data)
        if not issues:
            out = exp.model_dump()
            out["disclaimer"] = DISCLAIMER
            return out, "gemini"
        log.warning(
            "explanation rejected: %s | %s",
            issues[:3],
            [i.summary[:160] for i in exp.items if f"for {i.metric_id} " in " ".join(issues)],
        )
    return template(result), "template"
