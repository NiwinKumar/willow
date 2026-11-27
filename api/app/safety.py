"""Checked for me: one product against one person's safety profile (POST /v1/safety/check).

Rules live in `seed/safety_rules.json`, one row per flag, each with its source and an evidence
grade (A: a regulation or a professional body's rule; B: body guidance or consistent studies;
C: weak or self-reported evidence, or convention). Everything here is plain code over the label
(INCI and key actives) and what the person told Willow; Gemini never adds or removes a flag.

A flag never says a product is "safe": the best status is "clear" ("No flags for you"). Labels can
be incomplete, and a name missing from a label is "not listed", never "free from".
"""

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app import regulatory

RULES_PATH = Path(__file__).resolve().parent.parent / "seed" / "safety_rules.json"

AvoidKey = Literal[
    "fragrance", "essential_oils", "drying_alcohol", "lanolin", "nut_oils", "mi_preservatives"
]
AVOID_LABEL = {
    "fragrance": "Fragrance",
    "essential_oils": "Essential oils",
    "drying_alcohol": "Drying alcohol",
    "lanolin": "Lanolin",
    "nut_oils": "Nut oils",
    "mi_preservatives": "MI preservatives",
}
PRODUCT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,119}$")
MAX_AVOID_PRODUCTS = 200
Status = Literal["clear", "check", "avoid", "not_sold"]
STATUS_WORDS = {
    "clear": "No flags for you",
    "check": "Check this",
    "avoid": "Not advised for you",
    "not_sold": "Not sold as a cosmetic in your market",
}
LABELS_NOTE = "Labels can be incomplete."


class SafetyProfile(BaseModel):
    """users/{uid}.profile.safety: what the person chose to tell Willow. Never inferred."""

    model_config = ConfigDict(extra="forbid")
    adult: bool | None = None  # confirmed 18 or over; null = not asked
    life_stage: Literal["none", "pregnant", "breastfeeding", "trying"] | None = None
    reactive: bool | None = None  # skin reacts easily
    avoid: list[AvoidKey] = Field(default_factory=list, max_length=len(AVOID_LABEL))
    avoid_products: list[str] = Field(default_factory=list, max_length=MAX_AVOID_PRODUCTS)
    rx_treatment: bool | None = None  # uses a prescription skin treatment
    market: regulatory.Market | None = None

    @field_validator("avoid")
    @classmethod
    def _avoid(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(v))

    @field_validator("avoid_products")
    @classmethod
    def _products(cls, v: list[str]) -> list[str]:
        if any(not PRODUCT_ID.match(p) for p in v):
            raise ValueError("avoid_products are catalog product ids")
        return list(dict.fromkeys(v))


class Source(BaseModel):
    label: str
    url: str | None


class Match(BaseModel):
    model_config = ConfigDict(extra="forbid")
    inci_any: list[str] = Field(default_factory=list)
    inci_regex: list[str] = Field(default_factory=list)
    actives_any: list[str] = Field(default_factory=list)
    all_groups: list[list[str]] = Field(default_factory=list)
    inci_depth: int | None = None  # only the first N INCI entries (meaningful amounts)
    pct_min: float | None = None  # only key actives with a stated strength at least this
    category: list[str] | None = None
    category_not: list[str] = Field(default_factory=list)


class When(BaseModel):
    model_config = ConfigDict(extra="forbid")
    always: bool = False
    life_stage_in: list[str] | None = None
    avoid_has: str | None = None
    reactive: bool | None = None
    rx_treatment: bool | None = None
    adult: bool | None = None


class Rule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    group: str
    match: Match
    when: When
    level: Literal["check", "avoid"]
    title: str
    detail: str
    source: Source
    grade: Literal["A", "B", "C"]


@lru_cache
def rules() -> tuple[Rule, ...]:
    data = json.loads(RULES_PATH.read_text())
    return tuple(Rule.model_validate(r) for r in data["rules"])


@lru_cache(maxsize=512)
def _compiled(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.I)


def _forms(name: str) -> tuple[str, str]:
    """The name as written (lower case) and without its brackets: "melaleuca alternifolia (tea
    tree) leaf oil" also reads "melaleuca alternifolia leaf oil"; "retinol(0.1%)" reads
    "retinol"."""
    low = " ".join(name.lower().split())
    bare = " ".join(re.sub(r"\([^)]*\)", " ", low).split())
    return low, bare


def _term(term: str, forms: tuple[str, str]) -> bool:
    pat = _compiled(rf"(?<![a-z]){re.escape(term)}(?![a-z])")
    return any(pat.search(f) for f in forms)


def _pct_text(pct: Any) -> str:
    return f"{int(pct) if float(pct).is_integer() else pct}%"


def _hits(rule: Rule, product: dict[str, Any]) -> list[str]:
    m = rule.match
    category = product.get("category")
    if m.category is not None and category not in m.category:
        return []
    if category in m.category_not:
        return []
    inci = [str(i) for i in product.get("inci") or []]
    inci = inci[: m.inci_depth] if m.inci_depth else inci
    inci_forms = [(i, _forms(i)) for i in inci]
    actives = product.get("key_actives") or []
    found: list[str] = []

    def add(text: str) -> None:
        if text.lower() not in [f.lower() for f in found]:
            found.append(text.lower())

    named: set[str] = set()  # key actives already found, by name

    def active_hits(terms: list[str]) -> list[str]:
        out = []
        for a in actives:
            forms = _forms(a["name"])
            if not any(_term(t, forms) for t in terms):
                continue
            pct = a.get("pct")
            if m.pct_min is not None and (pct is None or float(pct) < m.pct_min):
                continue  # a strength is never guessed
            out.append(f"{a['name']} {_pct_text(pct)}" if pct is not None else a["name"])
            named.update(forms)
        return out

    def inci_hits(terms: list[str], regexes: list[str]) -> list[str]:
        return [
            raw
            for raw, forms in inci_forms
            if any(_term(t, forms) for t in terms)
            or any(_compiled(r).search(f) for r in regexes for f in forms)
        ]

    if m.all_groups:
        groups = [active_hits(g) + inci_hits(g, []) for g in m.all_groups]
        if not all(groups):
            return []
        for g in groups:
            for h in g:
                add(h)
        return found
    for h in active_hits(m.actives_any):
        add(h)
    if m.pct_min is None:  # with a strength floor, only stated strengths count
        for h in inci_hits(m.inci_any, m.inci_regex):
            if not set(_forms(h)) & named:  # already named as a key active, with its strength
                add(h)
    return found


def _applies(when: When, profile: dict[str, Any] | None) -> bool:
    if when.always:
        return True
    if not profile:
        return False
    if when.life_stage_in is not None and profile.get("life_stage") not in when.life_stage_in:
        return False
    if when.avoid_has is not None and when.avoid_has not in (profile.get("avoid") or []):
        return False
    for key in ("reactive", "rx_treatment", "adult"):
        want = getattr(when, key)
        if want is not None and profile.get(key) is not want:
            return False
    return True


def _hit_words(hits: list[str]) -> str:
    shown = [h.rstrip(". ") for h in hits[:4]]
    more = len(hits) - len(shown)
    return ", ".join(shown) + (f" and {more} more" if more else "")


AVOID_PRODUCT_FLAG = {
    "rule": "avoid_product",
    "id": "avoid_product",
    "level": "avoid",
    "title": "On your avoid list",
    "detail": "You added this product to your avoid list, after a reaction or by hand.",
    "source": {"label": "Your own avoid list", "url": None},
    "grade": "A",
}


def flags(product: dict[str, Any], profile: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Every flag for this product and person; one per rule group (the stronger level wins)."""
    out: dict[str, dict[str, Any]] = {}
    if profile and product.get("product_id") in (profile.get("avoid_products") or []):
        out["avoid_product"] = dict(AVOID_PRODUCT_FLAG)
    for rule in rules():
        if not _applies(rule.when, profile):
            continue
        hits = _hits(rule, product)
        if not hits:
            continue
        flag = {
            "rule": rule.group,
            "id": rule.id,
            "level": rule.level,
            "title": rule.title,
            "detail": rule.detail.replace("{hits}", _hit_words(hits)),
            "source": rule.source.model_dump(),
            "grade": rule.grade,
        }
        kept = out.get(rule.group)
        if kept is None or (kept["level"] == "check" and rule.level == "avoid"):
            out[rule.group] = flag
    return sorted(out.values(), key=lambda f: (f["level"] != "avoid", f["grade"], f["rule"]))


def _not_sold(product: dict[str, Any], market: str | None) -> bool:
    if market in regulatory.MARKETS:
        return regulatory.classify(product, market) in ("rx", "pharmacy")
    # unknown market: only what is a medicine everywhere
    return all(regulatory.classify(product, m) in ("rx", "pharmacy") for m in regulatory.MARKETS)


def check(
    product: dict[str, Any], profile: dict[str, Any] | None, market: str | None = None
) -> dict[str, Any]:
    """{status, flags, regulatory}. `market` overrides the profile's."""
    market = market or (profile or {}).get("market")
    found = flags(product, profile)
    if any(f["level"] == "avoid" for f in found):
        status = "avoid"
    elif _not_sold(product, market):
        status = "not_sold"
    elif found:
        status = "check"
    else:
        status = "clear"
    return {"status": status, "flags": found, "regulatory": regulatory.of(product, market)}


def is_complete(profile: dict[str, Any] | None) -> bool:
    """Asked everything a check depends on (the avoid lists may stay empty)."""
    return bool(profile) and all(
        profile.get(k) is not None for k in ("adult", "life_stage", "reactive")
    )


def profile_of(user_doc: dict[str, Any] | None) -> dict[str, Any] | None:
    """The stored safety profile, or None when the person never set one."""
    safety = ((user_doc or {}).get("profile") or {}).get("safety")
    return dict(safety) if safety else None


def has_fragrance(product: dict[str, Any]) -> bool:
    """Lists fragrance or a named fragrance allergen (the fragrance rules' own match)."""
    rule = next(r for r in rules() if r.id == "avoid_fragrance")
    return bool(_hits(rule, product))
