"""Ask the retailer data (docs/RETAILER_INSIGHTS.md): a question in plain words, answered by
Gemini from the aggregates the retailer view already shows, optionally with one bar chart.

Gemini never sees rows, only the suppressed aggregates (groups under 10 hidden), so nothing it
says can identify a person. Every number in the answer and every bar value must already be in the
aggregates (a rate may be written as a whole percent); every bar label must be a product, brand,
goal, category or routine issue that is in them. Anything else is rejected and asked again once.

The reply also carries what the page needs to show it honestly, computed here, not by Gemini:
`refused` (no numbers were given: the question asked about individuals or data that is not in
the aggregates, or no draft passed the checks), `n` per percent bar (the group the rate is of)
and `source` (which aggregate tables the chart and the answer drew on).
"""

import calendar
import copy
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, Field

from app import catalog, gemini, numbers
from app.explain import BANNED
from app.settings import get_settings

log = logging.getLogger("willow.retailer_ask")

DAILY_LIMIT = 20

INSTRUCTIONS = """You are an analyst for a multi-brand skincare retailer. Answer the question
using only INSIGHTS (JSON): aggregated, anonymised outcomes of people tracking their skin with
Willow. "rate" fields are the share of people whose goal metric was still improved beyond their
own photo noise at week 8 (an outcome, not a purchase). "cells" are the same rate per skin-tone
band, "cells_skin" per self-reported skin type (in "skin_types" order); a suppressed cell had
fewer than 10 people. "base" is people with the same goal who do not use the product (k of n,
rate) and "lift" is the product's rate minus theirs. "cont" is the share still using it after
week 4, "cont8" at week 8. "weeks" is the median weeks to the first visible change.
"needs_by_month" counts people with each goal among those with a reading that month
("share_of_peak" = share of that month's most-chosen goal). "categories[].flows" are, per
product category and goal, users of the category's products for that goal: "changed" = how many
had a real change by weeks 2, 4 and 8, "using" = how many still used one at those weeks, "base" =
people with the goal using none of them. "conflicts" are rule-table findings, as a share of
"routines_checked". "perception" is self-reported: per product, "felt" is the share of "n" people
who said it is working for them; quote it only as what people said, never as a measured result.
- Quote numbers exactly as they appear; a fraction may be written as a whole percent (0.36 -> 36%).
  Never compute new numbers (no differences, sums, averages or ratios you derive yourself).
- refused: true when the question asks about individual people (who, which user, a named
  person) or for something INSIGHTS does not hold (sales, revenue, prices paid, profit, margins,
  returns, stock levels, anything per person); then give no numbers and no chart, say what
  is not available and what group-level view could answer instead. Otherwise false.
- Skin-tone bands describe coverage of the cohort; never rank or compare people by skin tone and
  never imply lighter skin is better.
- If cohort.real is 0, say once that the cohort is synthetic demo data.
- Cosmetic language; no medical claims. British spelling. 2 to 4 sentences.
- chart: only when a comparison helps, at most 8 bars whose labels are product names, brand names,
  goals, categories or routine issues exactly as written in INSIGHTS, and whose values are numbers
  from INSIGHTS (rates as whole percents with unit "percent"; people or product counts with unit
  "count"; weeks with unit "weeks"). Otherwise null."""


class Unavailable(Exception):
    """Gemini could not be reached; not the same as an answer that failed the checks."""


class Bar(BaseModel):
    label: str = Field(max_length=120)
    value: float


class Chart(BaseModel):
    title: str = Field(max_length=90)
    unit: Literal["percent", "count", "weeks"]
    bars: list[Bar] = Field(min_length=2, max_length=8)


class Answer(BaseModel):
    answer: str = Field(max_length=900)
    refused: bool = False
    chart: Chart | None = None
    follow_ups: list[str] = Field(default_factory=list, max_length=3)


def _month(key: str) -> str:
    year, month = key.split("-")
    return f"{calendar.month_name[int(month)]} {year}"


def view(insights: dict[str, Any]) -> dict[str, Any]:
    """What Gemini sees: the aggregates without page plumbing (filters, empty flag), months in
    words, and products listed once (the top rows keep their cells; the rest are in
    product_outcomes)."""
    top = {p["product_id"] for p in insights.get("products", []) if "product_id" in p}
    nbm = insights.get("needs_by_month") or {}
    out = {
        k: v
        for k, v in insights.items()
        if k not in ("filters", "empty", "product_outcomes", "needs_by_month")
    }
    out["product_outcomes"] = {
        pid: o for pid, o in (insights.get("product_outcomes") or {}).items() if pid not in top
    }
    if nbm.get("months"):
        out["needs_by_month"] = {**nbm, "months": [_month(m) for m in nbm["months"]]}
    return out


# Where a label or name can come from, as the source tables the page and docs name.
SOURCES = {
    "products": "product_outcomes",
    "product_outcomes": "product_outcomes",
    "brands": "brands",
    "categories": "category_flows",
    "needs": "needs",
    "needs_by_month": "needs_by_month",
    "gaps": "assortment_gaps",
    "conflicts": "routine_conflicts",
    "tiles": "summary",
}


def _index(insights: dict[str, Any]) -> dict[str, tuple[str, int | None]]:
    """Every name in the aggregates (lower case) -> (source table, the group's n or None)."""
    idx: dict[str, tuple[str, int | None]] = {}

    def put(name: str | None, source: str, n: int | None) -> None:
        if name:
            idx.setdefault(name.lower(), (SOURCES[source], n))

    for c in insights.get("conflicts", []):
        put(c["pair"], "conflicts", c.get("n"))
    for key in ("products", "product_outcomes"):
        rows = insights.get(key) or []
        for p in rows.values() if isinstance(rows, dict) else rows:
            put(p["product"], key, p["n"])
            put(f"{p['brand']} {p['product']}", key, p["n"])
    for b in insights.get("brands", []):
        put(b["brand"], "brands", b["n"])
    for n in insights.get("needs", []):
        put(n["goal"], "needs", n["n"])
    for c in insights.get("categories", []):
        put(c["label"], "categories", None)
        for b in c.get("brands", []):
            put(b["brand"], "categories", b["n"])
    for g in insights.get("gaps", []):
        put(g["goal"], "gaps", None)
    for t in insights.get("tiles", []):
        put(t["label"], "tiles", None)
    # Brands and concerns that only appear on product rows.
    for key in ("products", "product_outcomes"):
        rows = insights.get(key) or []
        for p in rows.values() if isinstance(rows, dict) else rows:
            put(p["brand"], key, None)
            put(p.get("concern"), key, None)
    return idx


def _names(insights: dict[str, Any]) -> set[str]:
    return set(_index(insights))


# -- whose question it is (Proof organisations, routes/proof_routes.py POST .../ask) --------------
#
# A brand organisation asks about its own brand ("we", "our", "mine"). When the retailer's
# policy keeps competitor names off for brands (research/finals/06 section 4.2), Gemini never sees
# another brand's name: other brands read "Brand A", "Brand B"... (the letters the web uses: the
# catalog's brands in code-point order) and their products "Brand C's serum", and any answer,
# follow-up or chart label that still names one (from Gemini's own knowledge) is rejected.

_ORDINALS = ("first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth")


def letters(i: int) -> str:
    """0 -> "A", 25 -> "Z", 26 -> "AA" (the web's letters(), features/retail/masking.ts)."""
    s = ""
    n = i
    while True:
        s = chr(65 + n % 26) + s
        n = n // 26 - 1
        if n < 0:
            return s


@dataclass(frozen=True)
class Scope:
    """`brand`: the asking organisation's brand (None: the retailer). `hidden`: every name Gemini
    may not see or write, mapped to the alias it sees instead (empty when names are allowed)."""

    brand: str | None = None
    hidden: dict[str, str] = field(default_factory=dict)
    # the asking brand's own names: matched first, so another brand's shorter product name
    # inside one of them ("Vitamin C Serum" in "Vitamin C Serum 10%") is never masked
    kept: frozenset[str] = frozenset()

    @property
    def masked(self) -> bool:
        return bool(self.hidden)


def scope_for(brand: str | None, hide_others: bool) -> Scope:
    """The scope of a question from `brand`'s team; other brands anonymised when `hide_others`."""
    if not brand or not hide_others:
        return Scope(brand=brand)
    products = catalog.products()
    brands = sorted({p["brand"] for p in products})
    alias = {b: f"Brand {letters(i)}" for i, b in enumerate(brands)}
    hidden: dict[str, str] = {b: alias[b] for b in brands if b != brand}
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for p in sorted(products, key=lambda p: p["product_id"]):
        if p["brand"] != brand:
            groups.setdefault((p["brand"], p.get("category") or "product"), []).append(p)
    for (b, category), rows in groups.items():
        for k, p in enumerate(rows):
            nth = f"{_ORDINALS[k]} " if len(rows) > 1 and k < len(_ORDINALS) else ""
            hidden.setdefault(p["name"], f"{alias[b]}'s {nth}{category}")
            hidden.setdefault(f"{b} {p['name']}", f"{alias[b]}'s {nth}{category}")
    own = [p for p in products if p["brand"] == brand]
    kept = frozenset([brand, *(p["name"] for p in own), *(f"{brand} {p['name']}" for p in own)])
    return Scope(brand=brand, hidden=hidden, kept=kept - set(hidden))


def _hidden_pattern(scope: Scope) -> re.Pattern[str] | None:
    if not scope.hidden:
        return None
    # longest first: "Brand X Serum" before "Brand X", and own names before what they contain
    names = sorted({*scope.hidden, *scope.kept}, key=len, reverse=True)
    return re.compile("|".join(rf"(?<![\w]){re.escape(n)}(?![\w])" for n in names))


def mask(insights: dict[str, Any], scope: Scope) -> dict[str, Any]:
    """The aggregates with every hidden name replaced by its alias, in every string (field values
    and words inside text such as a gap's action or a conflict's `resolves`)."""
    pattern = _hidden_pattern(scope)
    if pattern is None:
        return insights

    def walk(x: Any) -> Any:
        if isinstance(x, str):
            return pattern.sub(lambda m: scope.hidden.get(m.group(0), m.group(0)), x)
        if isinstance(x, dict):
            return {k: walk(v) for k, v in x.items()}
        if isinstance(x, list):
            return [walk(v) for v in x]
        return x

    return walk(copy.deepcopy(insights))


def named_others(texts: list[str], scope: Scope) -> list[str]:
    """Hidden names (other brands or their products) that appear in any of `texts`."""
    pattern = _hidden_pattern(scope)
    if pattern is None:
        return []
    found = {m.group(0) for t in texts for m in pattern.finditer(t)}
    return sorted(n for n in found if n in scope.hidden)


def scope_instructions(scope: Scope) -> str:
    if not scope.brand:
        return ""
    out = (
        f"\nSCOPE: the question comes from {scope.brand}'s own team: 'we', 'our' and 'mine' mean "
        f"{scope.brand}. Lead with {scope.brand}'s products; compare them with the category, never "
        "rank people."
    )
    if scope.masked:
        out += (
            " The retailer keeps other brands' names hidden from brands: INSIGHTS calls them "
            "'Brand A', 'Brand B'... and their products \"Brand C's serum\". Use only those labels "
            "or 'the category'; never write, guess or hint at another brand's real name."
        )
    return out


_ASKED_PERCENT = re.compile(r"\d+(?:[.,]\d+)?(?=\s*(?:%|percent))", re.IGNORECASE)
# Proof never says a product is safe, in an answer or a suggested follow-up.
_UNSAFE_WORDS = re.compile(r"\bsafe(?:ly|st|r|ty)?\b", re.IGNORECASE)


def _digit_names(insights: dict[str, Any]) -> set[str]:
    """Product names (lower case, with and without the brand) that contain a digit."""
    out: set[str] = set()
    for key in ("products", "product_outcomes"):
        rows = insights.get(key) or []
        for p in rows.values() if isinstance(rows, dict) else rows:
            name = str(p.get("product") or "")
            if any(c.isdigit() for c in name):
                out |= {name.lower(), f"{p.get('brand', '')} {name}".strip().lower()}
    return out


def problems(
    reply: Answer, insights: dict[str, Any], question: str, scope: Scope | None = None
) -> list[str]:
    """Everything shown is checked: answer, chart title, follow-ups, bar labels and values.
    The question's own digits are not allowed back ("is it 95%?" must not be echoed). In a masked
    scope no text or bar label may name another brand or one of its products."""
    plain, pct = numbers.collect(insights), numbers.percents(insights)
    # A percent the question supplies may not come back, even when the same figure sits somewhere
    # in the data ("is it 95%?" must not be echoed as if it were the answer). Bare numbers in the
    # question (weeks, counts) stay allowed: "by week 8" is a legitimate thing to answer about.
    # A name in the question is not a figure it supplies: "Alpha Arbutin 2% Face Serum" must not
    # stop the answer from naming that product.
    asked_text = question.lower()
    for name in sorted(_digit_names(insights), key=len, reverse=True):
        asked_text = asked_text.replace(name, " ")
    asked = set().union(*(numbers.in_text(m) for m in _ASKED_PERCENT.findall(asked_text)))
    allowed = (plain | pct) - asked
    found = []
    texts = [reply.answer, *reply.follow_ups, reply.chart.title if reply.chart else ""]
    if not all(numbers.only_known(t, allowed) for t in texts):
        found.append("text quotes a number that is not in the data")
    if any(BANNED.search(t) or _UNSAFE_WORDS.search(t) for t in texts):
        found.append("banned wording")
    if reply.refused and reply.chart:
        found.append("a refusal has no chart")
    if scope and scope.masked:
        labels = [b.label for b in reply.chart.bars] if reply.chart else []
        if named := named_others([*texts, *labels], scope):
            found.append(f"names another brand: {', '.join(named)}")
    if reply.chart:
        names = _names(insights)
        # A percent bar must come from a share; a count or weeks bar from the number itself.
        source = pct if reply.chart.unit == "percent" else plain
        for bar in reply.chart.bars:
            if bar.label.lower() not in names:
                found.append(f"chart label not in the data: {bar.label}")
            if not numbers.collect(bar.value) & source:
                found.append(f"chart value not in the data: {bar.value}")
    return found


def provenance(reply: Answer, insights: dict[str, Any]) -> dict[str, Any]:
    """Per-bar n (percent bars: the group the rate is of) and the source tables used."""
    idx = _index(insights)
    sources: list[str] = []
    bars = []
    for bar in reply.chart.bars if reply.chart else []:
        source, n = idx.get(bar.label.lower(), (None, None))
        if source and source not in sources:
            sources.append(source)
        bars.append({**bar.model_dump(), "n": n if reply.chart.unit == "percent" else None})
    if not reply.refused:
        text = reply.answer.lower()
        for name, (source, _) in idx.items():
            if len(name) >= 4 and name in text and source not in sources:
                sources.append(source)
    chart = {**reply.chart.model_dump(), "bars": bars} if reply.chart else None
    return {"chart": chart, "source": sources}


NAMES_HIDDEN = (
    "I could not answer without naming other brands, which the retailer's policy keeps hidden "
    "from brands. Ask about your own products, or compare them with the category."
)


HISTORY_TURNS = 2  # earlier turns of a conversation given as context to a follow-up


def masked_text(text: str, scope: Scope) -> str:
    """Free text (a question, an earlier answer) with other brands' names replaced by their
    aliases, as in the aggregates; unchanged when names are allowed."""
    pattern = _hidden_pattern(scope)
    if pattern is None:
        return text
    return pattern.sub(lambda m: scope.hidden.get(m.group(0), m.group(0)), text)


def history_block(history: list[tuple[str, str]] | None, scope: Scope) -> str:
    """The last turns of the conversation (question and answer text only), so "and for dry
    skin?" can be answered. Context, not data: the checks still take every number from INSIGHTS,
    never from an earlier answer. In a masked scope other brands' names are masked here too."""
    turns = (history or [])[-HISTORY_TURNS:]
    if not turns:
        return ""

    def clean(text: str) -> str:
        return masked_text(" ".join(text.split())[:900], scope)

    lines = "\n".join(f"Q: {clean(q)}\nA: {clean(a)}" for q, a in turns)
    return (
        "EARLIER IN THIS CONVERSATION (context only, to resolve what the new question refers "
        "to; quote numbers only from INSIGHTS, never from here):\n"
        f"{lines}\n\n"
    )


def ask(
    question: str,
    insights: dict[str, Any],
    scope: Scope | None = None,
    history: list[tuple[str, str]] | None = None,
) -> dict[str, Any]:
    scope = scope or Scope()
    # A masked scope: Gemini sees aliases only, and the checks (names, numbers, provenance) run
    # on the same masked aggregates.
    insights = mask(insights, scope)
    # the question too: a competitor typed by a brand's team reads as its alias
    question = masked_text(question, scope)
    data = view(insights)
    # Compact JSON: fewer input tokens, a faster answer.
    prompt = (
        f"INSIGHTS (JSON):\n{json.dumps(data, separators=(',', ':'))}\n\n"
        f"{history_block(history, scope)}QUESTION: {question}"
    )
    found: list[str] = []
    for attempt in range(2):
        try:
            reply = gemini.generate_json(
                "retailer_ask",
                [prompt],
                Answer,
                instructions=INSTRUCTIONS + scope_instructions(scope),
                temperature=0.2,
                max_output_tokens=2048,
                attempts=1,
                keep=lambda r: not problems(r, data, question, scope),
                # INSIGHTS is about 25 KB: 25 s was not always enough (Oct 14, deadline exceeded).
                timeout_ms=50_000,
            )
        except gemini.GeminiError as exc:
            # Gemini itself is unavailable: say so (the route refunds the question).
            raise Unavailable from exc
        found = problems(reply, data, question, scope)
        if not found:
            return {
                **reply.model_dump(),
                **provenance(reply, insights),
                "checks": {
                    "model": get_settings().gemini_model,
                    "numbers_checked": len(set(numbers.NUMBER.findall(reply.answer)))
                    + (len(reply.chart.bars) if reply.chart else 0),
                    "rejected_attempts": attempt,
                },
            }
        log.warning("retailer answer rejected: %s", found)
    named = any(f.startswith("names another brand") for f in found)
    return {
        "answer": NAMES_HIDDEN
        if named
        else "I could not put together an answer that only uses numbers from this data. "
        "Try asking about one goal, product or brand at a time.",
        "refused": True,
        "chart": None,
        "follow_ups": [],
        "source": [],
        "checks": None,
    }
