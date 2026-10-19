"""Deterministic explanation (GEMINI_SPEC.md section 2, the template fallback).

Used until the Gemini explanation lands, and afterwards whenever Gemini's output fails the number
validator twice. Every number here is copied from the metrics, so it always passes.
"""

import json
import logging
import re
import time
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


# Everyday words for a change in each direction, (lower, higher) (web/src/lib/metrics.ts
# METRIC_META decrease / increase). Skin tone has none: it is descriptive, never a direction.
DIRECTION_WORDS = {
    "pigment_spots": ("fewer or fainter dark spots", "more visible dark spots"),
    "tone_evenness": ("a more even tone", "a less even tone"),
    "redness": ("calmer skin", "more redness"),
    "blemishes": ("fewer blemishes", "more blemishes"),
    "pores": ("less visible pores", "more visible pores"),
    "texture": ("smoother skin", "rougher skin"),
    "lines": ("softer lines", "more visible lines"),
    "dark_circles": ("a darker under-eye", "a brighter under-eye"),
    "shine": ("less shine", "more shine"),
    "glow": ("less glow", "more glow"),
}
# Words people do not know: never in an explanation (GEMINI_SPEC: plain calm words).
JARGON = re.compile(
    r"\b(delta|noise band|noise threshold|mdc\d*|variance|standard deviation|sd|threshold)\b"
    r"|ΔL\*|\ba\*",
    re.I,
)


# The direction people usually want (web/src/lib/verdict.ts WANTED): lower for most metrics,
# higher for under-eye brightness and glow. Skin tone has none.
WANTED_HIGHER = {"dark_circles", "glow"}
# A change the other way is said gently, never "worse" (UX_SPEC copy rules).
OTHER_WAY = "moved the other way"


def way_of(metric: dict[str, Any], delta: float | None) -> str | None:
    """'improved', 'other_way' or (skin tone) 'shifted' for a delta; None without one."""
    if metric["id"] == "tone_ita" or metric["id"] not in DIRECTION_WORDS:
        return "shifted"
    if not delta:
        return None
    wanted_up = metric["id"] in WANTED_HIGHER
    return "improved" if (delta > 0) == wanted_up else "other_way"


def since_start(metric: dict[str, Any], delta: float) -> str:
    """'fewer blemishes than at your start'; the other way 'moved the other way since your start';
    skin tone only ever 'a shift from your start'."""
    if metric["id"] == "tone_ita":
        return "a shift from your start"
    if way_of(metric, delta) == "other_way":
        return f"{OTHER_WAY} since your start"
    low, high = DIRECTION_WORDS.get(metric["id"], ("a lower reading", "a higher reading"))
    return f"{low if delta < 0 else high} than at your start"


def change_headline(real: list[dict[str, Any]]) -> str:
    """'3 improved since your baseline', '2 improved, 1 moved the other way since your baseline'."""
    counts = {"improved": 0, "other_way": 0, "shifted": 0}
    for m in real:
        counts[way_of(m, m.get("delta")) or "shifted"] += 1
    words = {"improved": "improved", "other_way": OTHER_WAY, "shifted": "shifted"}
    parts = [f"{n} {words[w]}" for w, n in counts.items() if n]
    return f"{', '.join(parts)} since your baseline"


# The app's names where they differ from the engine's labels (web/src/lib/metrics.ts)
APP_LABEL = {"dark_circles": "Under-eye", "tone_ita": "Skin tone (ITA°)"}


def label_of(metric: dict[str, Any]) -> str:
    return APP_LABEL.get(metric["id"], metric["label"])


def item(metric: dict[str, Any], first_reading: bool = True) -> dict[str, Any]:
    label = label_of(metric)
    verdict = metric["verdict"]
    # the numbers exactly as the app shows them, so the sentence matches the card above it
    shown = shown_numbers(metric)
    delta, mdc = shown["delta"], shown["mdc95"]
    # the app's confidence word for these readings (web lib/verdict.ts confidenceOf)
    trend = " (indicative)" if metric["confidence"] == "indicative" else ""
    quoted: list[str] = []
    # one number at most (the size of a real change), the rest in words
    if verdict == "no_baseline" and delta is not None:
        summary = (
            f"{label}: {since_start(metric, delta)}{trend}. Your baseline needs more photos before "
            "Willow can say if this is a real change."
        )
    elif verdict == "no_baseline" and first_reading:
        summary = f"{label}: first reading. Future photos are compared to it."
    elif verdict == "no_baseline":
        # a later session that could not compare this one (a measurement newer than the
        # baseline, a side view, counts from a different photo count): never "first reading"
        summary = f"{label}: not compared with your baseline this time."
    elif verdict == "low_quality":
        summary = f"{label}: photo quality too low to compare this time."
    elif verdict == "real_change" and delta is not None:
        quoted = [_num(abs(delta))]
        summary = f"{label}: {since_start(metric, delta)} (by {quoted[0]}){trend}."
    elif delta is not None and mdc is not None:
        summary = f"{label}: about the same as at your start{trend}."
    else:
        summary = f"{label}: no clear change yet{trend}."
    return {"metric_id": metric["id"], "summary": summary, "quoted_numbers": quoted}


RETAKE = {
    "face_full": "Retake facing a window or lamp, hair back, hands away from your face, looking "
    "straight into the camera.",
    "forearm_treated": "Retake with all four pen dots in view and white paper beside the arm.",
    "forearm_control": "Retake with all four pen dots in view and white paper beside the arm.",
    "cheek_macro": "Retake with the phone about 10 cm from your cheek, one eye still in the photo, "
    "facing a window or lamp.",
    "nose_macro": "Retake with the phone about 10 cm from your nose, one eye still in the photo, "
    "facing a window or lamp.",
    "left_cheek_macro": "Retake with the phone about 10 cm from your left cheek, one eye still in "
    "the photo, facing a window or lamp.",
    "right_cheek_macro": "Retake with the phone about 10 cm from your right cheek, one eye still "
    "in the photo, facing a window or lamp.",
    "forehead_macro": "Retake with the phone about 10 cm from your forehead, hair back and your "
    "brows still in the photo, facing a window or lamp.",
    "chin_macro": "Retake with the phone about 10 cm from your chin, your lower lip still in the "
    "photo, facing a window or lamp.",
}
RETAKE_DEFAULT = "Retake in the same light, holding the phone steady."


def template(result: dict[str, Any], first_reading: bool = True) -> dict[str, Any]:
    metrics = result["metrics"]
    real = [m for m in metrics if m["verdict"] == "real_change"]
    if not result["quality"]["passed"]:
        headline = "These photos could not be measured"
        steps = [RETAKE.get(result.get("site", ""), RETAKE_DEFAULT)]
    elif metrics and all(m["verdict"] == "no_baseline" for m in metrics):
        if any(m.get("delta") is not None for m in metrics):
            headline = "Compared with your baseline (it needs more photos to judge changes)"
            steps = ["Take 5 photos in one session and make it your baseline."]
        elif first_reading:
            headline = "Your first reading"
            steps = ["Take your next photos in the same spot and light."]
        else:
            headline = "Not compared with your baseline this time"
            steps = ["Take your next photos in the same spot and light."]
    elif real:
        headline = change_headline(real)
        steps = ["Keep the routine steady so the next reading is comparable."]
    else:
        headline = "No clear change since your baseline yet"
        steps = ["Most changes take a few weeks to show. Keep the same light and distance."]
    ordered = real + [m for m in metrics if m["verdict"] != "real_change"]
    return {
        "headline": headline,
        "items": [item(m, first_reading) for m in ordered],
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
- Write for someone with no science background: everyday words, short sentences, the way a friend
  would say it ("7 fewer blemishes than at your start", "your tone looks more even"), using each
  metric's when_lower / when_higher words for the direction of its delta. Never write the words
  delta, noise band, mdc, threshold, variance, standard deviation, value, reading, index, a* or ΔL*.
- At most ONE number per item, and only for a real_change: the size of the change for counts
  ("7 fewer blemishes"); for every other metric say it in words, with no number ("your tone looks
  more even"). Never quote the measured value itself, how much photos usually vary, degrees,
  percentages or scores. The headline has no numbers except the days since the start.
- Each item is one sentence of at most 25 words. Lead with what it means for the person.
- Use only the metrics given. Quote numbers exactly as given (delta without its sign, days); never
  compute new numbers, percentages or estimates. Never quote dates or photo numbers ("photo 3").
- verdict real_change: say which way it went, using the metric's way field (no need to explain
  how this is judged). way improved: say it improved, warmly and encouragingly. way other_way: say
  gently that it moved the other way; never "worse", "worsened", "declined", "deteriorated" or
  "got bad", and never alarm. way shifted (skin tone): say it shifted, with no direction.
  within_noise: "about the same as at your start", with no number. no_baseline with a delta:
  the change is shown but the baseline needs more photos before it can be called real.
  no_baseline without a delta: this is the first reading, but only when is_baseline is true;
  on a later session it means this one could not be compared with the baseline this time (say
  so, never "first").
  low_quality: the photo could not be compared.
- confidence indicative: call it a trend.
- Never explain how counting or measuring works (photos compared, marks confirmed, averages).
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
    summary: str = Field(max_length=200)
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


# Where the contract's unit is too generic ("index"), the metric's own (web/src/lib/metrics.ts)
METRIC_UNIT_DISPLAY = {"lines": "mm/cm²"}


def unit_of(metric: dict[str, Any]) -> str:
    """The unit as the app writes it after the number ("" for counts and indexes)."""
    own = METRIC_UNIT_DISPLAY.get(metric["id"])
    return own if own is not None else UNIT_DISPLAY.get(metric["unit"], metric["unit"]).strip()


def plain_unit(metric: dict[str, Any]) -> str:
    """The unit for text people read: none for the colour-science scores (a*, ΔL*), which are
    plain scores to a reader; the rest as the app writes them."""
    unit = unit_of(metric)
    return "" if unit in ("a*", "ΔL*") else unit


def decimals(metric: dict[str, Any]) -> int:
    """Decimals the app shows a metric with (web/src/lib/metrics.ts decimalsFor): never more
    precision than its noise band supports. Counts are whole numbers."""
    if metric.get("unit") == "count":
        return 0
    # the band the screen formats with (this session's own), even when the band quoted is the
    # baseline's (see with_bands)
    band = metric.get("display_mdc95", metric.get("mdc95"))
    band = 1.0 if band is None else band
    return 0 if band >= 5 else 1 if band >= 0.5 else 2


def with_bands(result: dict[str, Any], bands: dict[str, float | None] | None) -> dict[str, Any]:
    """The result with each compared metric's mdc95 set to the band its verdict used: the
    baseline's. A session's own mdc95 is its spread for later comparisons; quoting it as "the
    noise threshold" contradicted the verdict (and is null for a one-photo session)."""
    if not bands:
        return result
    metrics = []
    for m in result["metrics"]:
        if m.get("delta") is not None and m["id"] in bands:
            m = {**m, "display_mdc95": m.get("mdc95"), "mdc95": bands[m["id"]]}
        metrics.append(m)
    return {**result, "metrics": metrics}


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
                "label": label_of(m),
                "verdict": m["verdict"],
                "direction": m["direction"],
                "confidence": m["confidence"],
                # Unit as the app writes it; none for counts and indexes (never "index"), and
                # none for the a* / ΔL* scores (jargon in a sentence)
                "unit": plain_unit(m),
                **(
                    {}
                    if m["id"] == "tone_ita"
                    else dict(
                        zip(
                            ("when_lower", "when_higher"),
                            gentle_words(m),
                            strict=True,
                        )
                    )
                ),
                **_way_field(m),
                **shown_numbers(m),
            }
            for m in result["metrics"]
        ],
        **context,
    }


def _way_field(metric: dict[str, Any]) -> dict[str, str]:
    """{"way": ...} for a real change (improved, other_way, shifted), else nothing."""
    way = way_of(metric, metric.get("delta")) if metric["verdict"] == "real_change" else None
    return {"way": way} if way else {}


def gentle_words(metric: dict[str, Any]) -> tuple[str, str]:
    """(when_lower, when_higher) with the unwanted side said gently ("moved the other way")."""
    low, high = DIRECTION_WORDS.get(metric["id"], ("lower", "higher"))
    return (OTHER_WAY, high) if metric["id"] in WANTED_HIGHER else (low, OTHER_WAY)


# Harsh words for a change the other way: never in an explanation (it softens the news).
HARSH = re.compile(r"\b(wors\w*|declin\w*|deteriorat\w*|got bad|bad news)\b", re.I)


# Direction words: an item may not contradict the measured direction (an "increase" for a
# delta that went down). "more" / "less" are left out: "more even" is not a direction claim.
UP_WORDS = re.compile(r"\b(increas\w*|rose|risen|higher|went up|up by|gone up)\b", re.I)
DOWN_WORDS = re.compile(
    r"\b(decreas\w*|fell|fallen|lower|went down|down by|gone down|dropped|drop of)\b", re.I
)
SIGNED = re.compile(r"(?<![\d\w])([+\-−])\s?(\d+(?:[.,]\d+)?)")  # not a range: "1-2 weeks"
# Comparisons and scale explanations are not direction claims: "lower than the noise band",
# "the band is higher than the change", "lower values mean smoother skin".
COMPARATIVE = re.compile(r"\b(higher|lower)\s+(than|is|means?|values?|numbers?|scores?)\b", re.I)


def _allowed(data: dict[str, Any]) -> set[str]:
    """Numbers Gemini may quote: the metrics' own, the photo count, the days since the
    baseline and product names ("Retinol 0.3%"). Never dates: "2026-10-01" would let 10, 1
    and 2026 through as made-up day counts."""
    out = numbers.collect(data["metrics"]) | numbers.collect(data.get("frames_used"))
    out |= numbers.collect(data.get("days_since_baseline"))
    for r in data.get("routine") or []:
        out |= numbers.in_text(r.get("product") or "")
    return out


def _direction_problem(summary: str, metric: dict[str, Any]) -> str | None:
    """A delta quoted with the wrong sign, or words that contradict the measured direction."""
    delta = metric.get("delta")
    if not delta:
        return None
    shown = numbers.collect(abs(float(delta)))
    for sign, digits in SIGNED.findall(summary):
        quoted_negative = sign in "-−"
        if digits.replace(",", ".") in shown and quoted_negative != (float(delta) < 0):
            return f"wrong sign for {metric['id']}: {summary}"
    plain = COMPARATIVE.sub(" ", summary)
    up, down = UP_WORDS.search(plain), DOWN_WORDS.search(plain)
    if (float(delta) < 0 and up and not down) or (float(delta) > 0 and down and not up):
        return f"direction contradicts the delta for {metric['id']}: {summary}"
    return None


NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


def too_many_numbers(text: str, most: int) -> bool:
    """People read words, not figures: an item says at most one number (the change)."""
    return len(NUMBER.findall(text)) > most


def plain_enough(explanation: dict[str, Any] | None) -> bool:
    """A saved explanation that today's rules would still accept on wording (no jargon, few
    numbers); older ones are rewritten by scripts/reexplain.py."""
    if not explanation:
        return True
    texts = [
        explanation.get("headline", ""),
        *(i.get("summary", "") for i in explanation.get("items", [])),
    ]
    if any(JARGON.search(t) for t in texts):
        return False
    return not any(too_many_numbers(i.get("summary", ""), 1) for i in explanation.get("items", []))


def problems(exp: _Explanation, data: dict[str, Any]) -> list[str]:
    allowed = _allowed(data)
    verdicts = {m["id"]: m["verdict"] for m in data["metrics"]}
    by_id = {m["id"]: m for m in data["metrics"]}
    found = []
    texts = [exp.headline, *exp.next_steps, *(i.summary for i in exp.items)]
    for text in texts:
        if not numbers.only_known(text, allowed):
            found.append(f"unknown number in: {text}")
        if BANNED.search(text):
            found.append(f"banned wording in: {text}")
        if JARGON.search(text):
            found.append(f"jargon in: {text}")
        if HARSH.search(text):
            found.append(f"harsh wording in: {text}")
    if too_many_numbers(exp.headline, 1):
        found.append(f"numbers in headline: {exp.headline}")
    for item in exp.items:
        if too_many_numbers(
            item.summary, 1 if verdicts.get(item.metric_id) == "real_change" else 0
        ):
            found.append(f"too many numbers in: {item.summary}")
    for item in exp.items:
        if item.metric_id not in verdicts:
            found.append(f"unknown metric {item.metric_id}")
        elif verdicts[item.metric_id] != "real_change" and _claims_change(item.summary):
            found.append(f"change language for {item.metric_id} ({verdicts[item.metric_id]})")
        elif issue := _direction_problem(item.summary, by_id[item.metric_id]):
            found.append(issue)
        elif by_id[item.metric_id].get("way") == "other_way" and re.search(
            r"\b(improv\w*|better)\b", item.summary, re.I
        ):
            found.append(f"improvement claimed for a change the other way: {item.summary}")
    if not any(v == "real_change" for v in verdicts.values()) and _claims_change(exp.headline):
        found.append("change language in headline")
    return found


# One call's own deadline when nobody gives a shorter one (scripts/reexplain.py).
CALL_TIMEOUT_S = 35.0
# The second try (after a rejected first answer) only when this much time is left: an
# explanation takes about 5-10 s, and a try cut off by the deadline is wasted.
SECOND_TRY_MIN_S = 12.0
# Not worth a first try with less than this left.
FIRST_TRY_MIN_S = 2.0


def fallback(result: dict[str, Any], context: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """(template explanation, "template"): the deterministic text, numbers from the metrics."""
    context = dict(context)
    result = with_bands(result, context.pop("bands", None))
    return template(result, context.get("is_baseline", True)), "template"


def generate(
    result: dict[str, Any], context: dict[str, Any], deadline: float | None = None
) -> tuple[dict[str, Any], str]:
    """(explanation, source): Gemini when it passes the validator, else the template.

    `deadline` (time.monotonic()) caps every Gemini call; the second try is made only when
    SECOND_TRY_MIN_S are left, else the template answers."""
    if not result["metrics"] or not result["quality"]["passed"]:
        # Nothing was measured: the fixed text says why and how to retake (Gemini would be told
        # this is a first reading, which a session that failed quality never is).
        return fallback(result, context)
    context = dict(context)
    banded = with_bands(result, context.pop("bands", None))
    data = gemini_input(banded, context)
    prompt = f"Session data (JSON):\n{json.dumps(data)}"
    for attempt in range(2):  # at most two Gemini calls, then the template: analysis stays quick
        timeout_s = CALL_TIMEOUT_S
        if deadline is not None:
            left = deadline - time.monotonic()
            if left < (SECOND_TRY_MIN_S if attempt else FIRST_TRY_MIN_S):
                break
            timeout_s = min(timeout_s, left)
        try:
            exp = gemini.generate_json(
                "explanation",
                [prompt],
                _Explanation,
                instructions=INSTRUCTIONS,
                temperature=0.3,
                max_output_tokens=4096,
                # the loop is the retry (GEMINI_SPEC: retry once): two calls at most, so with
                # the engine the analysis stays well inside Cloud Run's 300 s
                attempts=1,
                timeout_ms=max(1_000, round(timeout_s * 1000)),
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
    return template(banded, context.get("is_baseline", True)), "template"
