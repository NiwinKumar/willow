"""Ask the retailer data (docs/RETAILER_INSIGHTS.md): a question in plain words, answered by
Gemini from the aggregates the retailer view already shows, optionally with one bar chart.

Gemini never sees rows, only the suppressed aggregates (groups under 10 hidden), so nothing it
says can identify a person. Every number in the answer and every bar value must already be in the
aggregates (a rate may be written as a whole percent); every bar label must be a product, brand,
goal or routine issue that is in them. Anything else is rejected and asked again once.
"""

import json
import logging
from typing import Any, Literal

from pydantic import BaseModel, Field

from app import gemini, numbers
from app.explain import BANNED
from app.settings import get_settings

log = logging.getLogger("willow.retailer_ask")

DAILY_LIMIT = 20

INSTRUCTIONS = """You are an analyst for a multi-brand skincare retailer. Answer the question
using only INSIGHTS (JSON): aggregated, anonymised outcomes of people tracking their skin with
Willow. "rate" fields are the share of people whose goal metric was still improved beyond their
own photo noise at week 8 (an outcome, not a purchase). "cells" are the same rate per skin-tone
band; a suppressed cell had fewer than 10 people. "lift" is the product's rate minus the average
for the same concern. "cont" is the share still using it at week 8.
- Quote numbers exactly as they appear; a fraction may be written as a whole percent (0.36 -> 36%).
  Never compute new numbers (no differences, sums, averages or ratios you derive yourself).
- If the data cannot answer the question, say so and name what would be needed.
- Skin-tone bands describe coverage of the cohort; never rank or compare people by skin tone and
  never imply lighter skin is better.
- If cohort.real is 0, say once that the cohort is synthetic demo data.
- Cosmetic language; no medical claims. 2 to 4 sentences.
- chart: only when a comparison helps, at most 8 bars whose labels are product names, brand names,
  goals or routine issues exactly as written in INSIGHTS, and whose values are numbers from
  INSIGHTS (rates as whole percents with unit "percent"; people or product counts with unit
  "count"; weeks with unit "weeks"). Otherwise null."""


class Bar(BaseModel):
    label: str = Field(max_length=120)
    value: float


class Chart(BaseModel):
    title: str = Field(max_length=90)
    unit: Literal["percent", "count", "weeks"]
    bars: list[Bar] = Field(min_length=2, max_length=8)


class Answer(BaseModel):
    answer: str = Field(max_length=900)
    chart: Chart | None = None
    follow_ups: list[str] = Field(default_factory=list, max_length=3)


def _names(insights: dict[str, Any]) -> set[str]:
    names: set[str] = set()
    for p in insights.get("products", []):
        names |= {p["product"], f"{p['brand']} {p['product']}", p["brand"], p["concern"]}
    names |= {b["brand"] for b in insights.get("brands", [])}
    names |= {n["goal"] for n in insights.get("needs", [])}
    names |= {g["goal"] for g in insights.get("gaps", [])}
    names |= {c["pair"] for c in insights.get("conflicts", [])}
    names |= {t["label"] for t in insights.get("tiles", [])}
    return {n.lower() for n in names}


def problems(reply: Answer, insights: dict[str, Any], question: str) -> list[str]:
    allowed = numbers.collect(insights) | numbers.percents(insights) | numbers.in_text(question)
    found = []
    if not numbers.only_known(reply.answer, allowed):
        found.append("answer quotes a number that is not in the data")
    if BANNED.search(reply.answer):
        found.append("banned wording")
    if reply.chart:
        names = _names(insights)
        for bar in reply.chart.bars:
            if bar.label.lower() not in names:
                found.append(f"chart label not in the data: {bar.label}")
            if not numbers.collect(bar.value) & allowed:
                found.append(f"chart value not in the data: {bar.value}")
    return found


def ask(question: str, insights: dict[str, Any]) -> dict[str, Any]:
    prompt = f"INSIGHTS (JSON):\n{json.dumps(insights)}\n\nQUESTION: {question}"
    for attempt in range(2):
        try:
            reply = gemini.generate_json(
                "retailer_ask",
                [prompt],
                Answer,
                instructions=INSTRUCTIONS,
                temperature=0.2,
                max_output_tokens=2048,
                attempts=1,
            )
        except gemini.GeminiError:
            break
        found = problems(reply, insights, question)
        if not found:
            return {
                **reply.model_dump(),
                "checks": {
                    "model": get_settings().gemini_model,
                    "numbers_checked": len(set(numbers.NUMBER.findall(reply.answer)))
                    + (len(reply.chart.bars) if reply.chart else 0),
                    "rejected_attempts": attempt,
                },
            }
        log.warning("retailer answer rejected: %s", found)
    return {
        "answer": "I could not put together an answer that only uses numbers from this data. "
        "Try asking about one goal, product or brand at a time.",
        "chart": None,
        "follow_ups": [],
        "checks": None,
    }
