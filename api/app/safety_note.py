"""Willow reads your note (POST /v1/safety/note/read): from "Tell us about past reactions or
breakouts", suggest what to add to the product checks. Nothing is applied here: the app shows
each suggestion as a chip the person taps to add.

Gemini only picks: ingredient names from candidates the code found in the note (every one is a
name on a catalog label or in the rule file), avoid-list ids from the fixed enum, and whether the
note says the skin reacts easily or names a life stage. Anything outside those lists, a summary
with a banned word or a number the note does not have, sends the whole answer to the keyword
matcher below, which needs no Gemini. Flags themselves are still computed by app/safety.py.
"""

import logging
import re
from functools import lru_cache
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app import gemini, numbers, safety
from app.explain import BANNED

log = logging.getLogger("willow.safety_note")

AVOID_IDS: tuple[str, ...] = tuple(safety.AVOID_LABEL)
LIFE_STAGES = ("pregnant", "breastfeeding", "trying")
MAX_INGREDIENTS = 6
MAX_CANDIDATES = 40
MAX_SUMMARY = 220


class NoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    note: str = Field(min_length=1, max_length=safety.MAX_NOTE)

    @field_validator("note")
    @classmethod
    def _text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("note is empty")
        return v


class Suggest(BaseModel):
    avoid: list[str] = Field(default_factory=list)
    avoid_ingredients: list[str] = Field(default_factory=list)
    reactive: bool | None = None
    life_stage: str | None = None


class NoteRead(BaseModel):
    """Gemini's answer (plain strings: the validator below checks every value)."""

    avoid: list[str] = Field(default_factory=list, max_length=len(AVOID_IDS))
    avoid_ingredients: list[str] = Field(default_factory=list, max_length=MAX_INGREDIENTS)
    reactive: bool | None = None
    life_stage: str | None = None
    summary: str = ""


# --- keyword reading (the fallback, and where the candidates come from) ----------------------

AVOID_WORDS: dict[str, re.Pattern[str]] = {
    "fragrance": re.compile(r"\b(fragrance\w*|parfum|perfume\w*|scent\w*)\b", re.I),
    "essential_oils": re.compile(
        r"\b(essential oils?|tea tree|lavender|peppermint|eucalyptus|citrus oils?)\b", re.I
    ),
    "drying_alcohol": re.compile(
        r"\b(alcohol denat\w*|denatured alcohol|sd alcohol|drying alcohol|"
        r"(?<!cetyl )(?<!stearyl )(?<!cetearyl )(?<!benzyl )alcohol)\b",
        re.I,
    ),
    "lanolin": re.compile(r"\b(lanolin|wool (?:wax|fat|alcohol))\b", re.I),
    "nut_oils": re.compile(
        r"\b(nut oils?|nuts?|almond|macadamia|shea|argan|hazelnut|walnut|cashew|brazil nut)\b",
        re.I,
    ),
    # "MI" only in capitals: "mi" is a word in other languages and a common typo
    "mi_preservatives": re.compile(
        r"\b(methyl\w*isothiazolinone|isothiazolinone|MCI)\b|\bMI\b", re.I
    ),
}
REACTIVE_WORDS = re.compile(
    r"\b(sting\w*|stung|burn\w*|itch\w*|rash\w*|react\w*|irritat\w*|flush\w*|hives|"
    r"redness|swell\w*|sensitive)\b",
    re.I,
)
LIFE_WORDS: dict[str, re.Pattern[str]] = {
    "pregnant": re.compile(r"\bpregnan\w*\b", re.I),
    "breastfeeding": re.compile(r"\b(breast-?feed\w*|nursing)\b", re.I),
    "trying": re.compile(r"\b(trying (?:to conceive|for a baby)|ttc)\b", re.I),
}
NEGATION = re.compile(r"\b(no|not|never|fine|ok|okay|without)\b|n't\b", re.I)
_GENERIC = safety._GENERIC  # "water", "oil", "alcohol"…: too general to be the ingredient


def _phrase(form: str, text: str) -> re.Match[str] | None:
    return re.search(rf"(?<![a-z0-9]){re.escape(form)}(?![a-z0-9])", text)


def _negated(text: str, start: int) -> bool:
    """A negation in the few words before (and in the same clause): "fine with niacinamide"."""
    before = re.split(r"[.;!?,]|\bbut\b", text[:start])[-1]
    return bool(NEGATION.search(" ".join(before.split()[-4:])))


def candidates(note: str) -> list[dict[str, Any]]:
    """Vocabulary names the note mentions, by their name or a bracketed common name ("tea
    tree"), longest phrase first; `negated` when the note says it is fine with it."""
    text = " ".join(note.lower().split())
    found: dict[str, dict[str, Any]] = {}
    for name in safety.vocabulary():
        low, bare = safety._forms(name)
        forms = {bare, low} | {" ".join(b.split()) for b in re.findall(r"\(([^)]*)\)", low)}
        for form in sorted(forms, key=len, reverse=True):
            if len(form) < 4 or form in _GENERIC or not re.search(r"[a-z]{3}", form):
                continue
            m = _phrase(form, text)
            if not m:
                continue
            kept = found.get(form)
            # one name per phrase: the name itself, then the one on most labels, then the shortest
            rank = (bare != form, -_on_labels().get(name, 0), len(name))
            if kept is None or rank < kept["rank"]:
                found[form] = {
                    "name": name,
                    "phrase": form,
                    "exact": bare == form,
                    "negated": _negated(text, m.start()),
                    "rank": rank,
                }
            break
    # a phrase inside a longer found phrase ("tree" in "tea tree") is the longer one's
    phrases = sorted(found, key=len, reverse=True)
    out, taken = [], []
    for ph in phrases:
        if any(ph in t for t in taken):
            continue
        taken.append(ph)
        out.append(found[ph])
    return [{k: v for k, v in c.items() if k != "rank"} for c in out[:MAX_CANDIDATES]]


@lru_cache
def _on_labels() -> dict[str, int]:
    """How many catalog labels list each vocabulary name (the common spelling wins a tie)."""
    from app import catalog

    counts: dict[str, int] = {}
    for p in catalog.products():
        for raw in p.get("inci") or []:
            name = safety.in_vocabulary(str(raw))
            if name:
                counts[name] = counts.get(name, 0) + 1
    return counts


def _keyword_avoid(text: str) -> list[str]:
    out = []
    for key, pat in AVOID_WORDS.items():
        for m in pat.finditer(text):
            if m.group(0).lower() == "mi" and m.group(0) != "MI":
                continue  # "MI" only in capitals
            if not _negated(text.lower(), m.start()):
                out.append(key)
                break
    return out


def _life_stage(text: str) -> str | None:
    for stage, pat in LIFE_WORDS.items():
        m = pat.search(text)
        if m and not _negated(text.lower(), m.start()):
            return stage
    return None


def keyword_read(note: str) -> dict[str, Any]:
    """The code's own reading: no Gemini, same answer every time."""
    picked = [c["name"] for c in candidates(note) if not c["negated"]][:MAX_INGREDIENTS]
    avoid = _keyword_avoid(note)
    m = REACTIVE_WORDS.search(note)
    reactive = True if m and not _negated(note.lower(), m.start()) else None
    suggest = Suggest(
        avoid=avoid, avoid_ingredients=picked, reactive=reactive, life_stage=_life_stage(note)
    )
    return {"suggest": suggest.model_dump(), "summary": _summary_of(suggest), "source": "rules"}


def _summary_of(s: Suggest) -> str:
    groups = [safety.AVOID_LABEL[a] for a in s.avoid]
    groups = [g if g[1:2].isupper() else g.lower() for g in groups]  # "MI preservatives" stays
    named: list[str] = []
    for n in [*groups, *s.avoid_ingredients]:
        if n.lower() not in [x.lower() for x in named]:
            named.append(n)
    if not named:
        return "Willow found no ingredient names it knows in your note."
    shown = ", ".join(named[:3]) + (f" and {len(named) - 3} more" if len(named) > 3 else "")
    return f"Your note mentions {shown}."


# --- Gemini's reading, and its validator ---------------------------------------------------

INSTRUCTIONS = f"""You read a short note a person wrote about past skin reactions or breakouts
to products, and suggest what Willow should check products for. You never diagnose, never name a
skin condition, and never say a product or ingredient is safe.
Input: NOTE (their words) and CANDIDATES (ingredient names found in the note; some may be ones
the note says are fine).
- avoid_ingredients: only names copied exactly from CANDIDATES, and only those the note says
  they reacted to or broke out from. Leave out ones the note says are fine. At most
  {MAX_INGREDIENTS}.
- avoid: ids from {list(AVOID_IDS)} only, for groups the note says they reacted to (perfume or
  scented products: fragrance; tea tree, lavender and similar oils: essential_oils; alcohol that
  dries or stings: drying_alcohol; wool wax: lanolin; almond, shea and other nut oils: nut_oils;
  methylisothiazolinone: mi_preservatives).
- reactive: true only if the note says their skin reacts easily or often (stings, burns,
  flushes, itches with products); false only if it says it does not; otherwise null.
- life_stage: one of {list(LIFE_STAGES)} only if the note says so; otherwise null.
- summary: one plain sentence in cosmetic language about what the note mentions ("Your note
  mentions fragrance and lanolin."). No advice, no condition names, no numbers the note does
  not contain. British spelling."""


def problems(read: NoteRead, note: str, allowed_names: set[str]) -> list[str]:
    """Why Gemini's reading cannot be shown; empty when it can."""
    out = []
    for a in read.avoid:
        if a not in AVOID_IDS:
            out.append(f"unknown avoid id {a!r}")
    for name in read.avoid_ingredients:
        if safety.in_vocabulary(name) is None:
            out.append(f"not a known ingredient {name!r}")
        elif name not in allowed_names:
            out.append(f"not mentioned in the note {name!r}")
    if read.life_stage is not None and read.life_stage not in LIFE_STAGES:
        out.append(f"unknown life stage {read.life_stage!r}")
    elif read.life_stage is not None and not LIFE_WORDS[read.life_stage].search(note):
        out.append("life stage the note does not say")
    summary = read.summary.strip()
    if not summary or len(summary) > MAX_SUMMARY:
        out.append("summary missing or too long")
    if BANNED.search(summary) or re.search(r"\bsafe(ly|ty)?\b", summary, re.I):
        out.append("summary uses a banned word")
    if not numbers.only_known(summary, numbers.in_text(note)):
        out.append("summary has a number the note does not")
    return out


def read(note: str, use_model: bool = True) -> dict[str, Any]:
    """{suggest, summary, source}: Gemini's reading when it passes the validator, else the
    keyword reading. The note is never logged."""
    if not use_model:
        return keyword_read(note)
    found = candidates(note)
    names = {c["name"] for c in found}
    prompt = "NOTE:\n" + note + "\n\nCANDIDATES:\n" + "\n".join(sorted(names) or ["(none)"])
    try:
        answer = gemini.generate_json(
            "safety_note",
            [prompt],
            NoteRead,
            instructions=INSTRUCTIONS,
            temperature=0.0,
            max_output_tokens=1024,
            attempts=1,
            timeout_ms=12_000,
        )
    except gemini.GeminiError:
        log.info("note read: model unavailable, keyword reading")
        return {**keyword_read(note), "model_failed": True}
    wrong = problems(answer, note, names)
    if wrong:
        log.info("note read: model answer rejected (%d problems)", len(wrong))
        return keyword_read(note)
    suggest = Suggest(
        avoid=list(dict.fromkeys(answer.avoid)),
        avoid_ingredients=list(dict.fromkeys(answer.avoid_ingredients))[:MAX_INGREDIENTS],
        reactive=answer.reactive,
        life_stage=answer.life_stage,
    )
    return {"suggest": suggest.model_dump(), "summary": answer.summary.strip(), "source": "model"}
