"""Checked for me: one product against one person's safety profile (POST /v1/safety/check).

Rules live in `seed/safety_rules.json`, one row per flag, each with its source and an evidence
grade (A: a regulation or a professional body's rule; B: body guidance or consistent studies;
C: weak or self-reported evidence, or convention). Everything here is plain code over the label
(INCI and key actives) and what the person told Willow; Gemini never adds or removes a flag.

A flag never says a product is "safe": the best status is "clear" ("No flags for you"). Labels can
be incomplete, and a name missing from a label is "not listed", never "free from". A catalog
product whose ingredient list Willow does not have yet (an index product, docs/CATALOG_SPEC.md)
is "unknown" ("Not checked yet"), never "clear".
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
# "Anything you've reacted to before?": ingredient names the person typed or picked
MAX_AVOID_INGREDIENTS = 30
INGREDIENT_NAME = re.compile(r"^[\w][\w ().,/'+&-]{1,79}$")
# "Tell us about past reactions or breakouts": free text, read only by the note reader
# (app/safety_note.py) and Wisp; never a flag by itself, never exported
MAX_NOTE = 500
Status = Literal["clear", "check", "avoid", "not_sold", "unknown"]
STATUS_WORDS = {
    "clear": "No flags for you",
    "check": "Check this",
    "avoid": "Not advised for you",
    "not_sold": "Not sold as a cosmetic in your market",
    "unknown": "Not checked yet",
}
LABELS_NOTE = "Labels can be incomplete."
# The one explanation an "unknown" check carries: nothing on the label was read.
NO_LABEL = "No ingredient list yet \u2014 scan the label to check it"


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
    avoid_ingredients: list[str] = Field(default_factory=list, max_length=MAX_AVOID_INGREDIENTS)
    note: str | None = Field(default=None, max_length=MAX_NOTE)

    @field_validator("avoid_ingredients")
    @classmethod
    def _ingredients(cls, v: list[str]) -> list[str]:
        out: dict[str, str] = {}
        for raw in v:
            name = " ".join(raw.split())
            if not INGREDIENT_NAME.match(name):
                raise ValueError("avoid_ingredients are ingredient names (2 to 80 characters)")
            out.setdefault(name.lower(), name)  # one per name, whatever its case
        return list(out.values())

    @field_validator("note")
    @classmethod
    def _note(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None

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


def _ingredient_forms(name: str) -> set[str]:
    """Ways one label entry can be named: as written, without its brackets, each bracket's text,
    and each part of an "A (and) B" blend, all lower case."""
    out: set[str] = set()
    for part in re.split(r"\s*\(and\)\s*", name.lower()):
        low, bare = _forms(part)
        out |= {low, bare}
        out |= {" ".join(b.split()) for b in re.findall(r"\(([^)]*)\)", low)}
    return {f for f in out if f}


def _lists_ingredient(wanted: str, product: dict[str, Any]) -> str | None:
    """The label entry that is this ingredient (case does not matter): the same name, or a name
    that starts with it ("lanolin" lists "Lanolin Alcohol"; "alcohol" does not list "Cetyl
    Alcohol"). None when the label does not list it."""
    w = " ".join(wanted.lower().split())
    for raw in product.get("inci") or []:
        if any(f == w or f.startswith(w + " ") for f in _ingredient_forms(str(raw))):
            return str(raw)
    return None


def _reacted_flags(product: dict[str, Any], names: list[str]) -> list[dict[str, Any]]:
    out = []
    for name in names:
        listed = _lists_ingredient(name, product)
        if listed is None:
            continue
        same = listed.lower() == name.lower()
        out.append(
            {
                "rule": f"avoid_ingredient:{name.lower()}",
                "id": "avoid_ingredient",
                "level": "avoid",
                "title": f"You've reacted to {name}",
                "detail": f"You told Willow you've reacted to {name}. "
                + ("It is on this label." if same else f"The label lists {listed}."),
                "source": {"label": "What you told Willow", "url": None},
                "grade": "A",
            }
        )
    return out


def flags(product: dict[str, Any], profile: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Every flag for this product and person; one per rule group (the stronger level wins)."""
    out: dict[str, dict[str, Any]] = {}
    if profile and product.get("product_id") in (profile.get("avoid_products") or []):
        out["avoid_product"] = dict(AVOID_PRODUCT_FLAG)
    for flag in _reacted_flags(product, list((profile or {}).get("avoid_ingredients") or [])):
        out[flag["rule"]] = flag
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


def _check_without_label(
    product: dict[str, Any], profile: dict[str, Any] | None, market: str | None
) -> dict[str, Any]:
    """No ingredient list: nothing on the label can be flagged, so never "clear". What is known
    without it still counts: the person's own avoid list ("avoid"), and a name or key active that
    makes it a medicine where they are ("not_sold"). The regulatory class is given only when the
    name or actives show it is not a plain cosmetic; otherwise it is null (not known)."""
    if profile and product.get("product_id") in (profile.get("avoid_products") or []):
        return {
            "status": "avoid",
            "flags": [dict(AVOID_PRODUCT_FLAG)],
            "regulatory": None,
            "explanation": NO_LABEL,
        }
    reg = regulatory.of(product, market)
    return {
        "status": "not_sold" if _not_sold(product, market) else "unknown",
        "flags": [],
        "regulatory": reg if reg["class"] != "cosmetic" else None,
        "explanation": NO_LABEL,
    }


def has_label(product: dict[str, Any]) -> bool:
    """Willow has this product's ingredient list (index products do not, yet)."""
    return bool(product.get("inci"))


def check(
    product: dict[str, Any], profile: dict[str, Any] | None, market: str | None = None
) -> dict[str, Any]:
    """{status, flags, regulatory}, plus `explanation` when there is no ingredient list.
    `market` overrides the profile's."""
    market = market or (profile or {}).get("market")
    if not has_label(product):
        return _check_without_label(product, profile, market)
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


# --- public views: the rule families and the ingredient vocabulary --------------------------

# How /checks names each rule group, and who it applies to (words, never a condition).
FAMILIES: dict[str, tuple[str, str]] = {
    "medicine_ingredient": ("Medicines, not cosmetics", "Everyone"),
    "mi_leave_on": ("Restricted preservative left on the skin", "Everyone"),
    "retinoid_life_stage": ("Retinoids", "Pregnant, trying for a baby or breastfeeding"),
    "hydroquinone_life_stage": ("Hydroquinone", "Pregnant, trying for a baby or breastfeeding"),
    "salicylic_life_stage": ("Salicylic acid left on, or in a peel", "Pregnant"),
    "fragrance": (
        "Fragrance and the labelled fragrance allergens",
        "Skin reacts easily, or you avoid fragrance",
    ),
    "essential_oils": ("Essential oils", "Skin reacts easily, or you avoid them"),
    "drying_alcohol": ("Drying alcohol", "Skin reacts easily, or you avoid it"),
    "cooling_agents": ("Menthol, camphor and other cooling agents", "Skin reacts easily"),
    "witch_hazel": ("Witch hazel", "Skin reacts easily"),
    "bpo_reactive": ("Benzoyl peroxide", "Skin reacts easily"),
    "retinoid_reactive": ("Retinoids", "Skin reacts easily"),
    "acid_reactive": ("Exfoliating acids (AHA, BHA)", "Skin reacts easily"),
    "azelaic_reactive": ("Azelaic acid", "Skin reacts easily"),
    "scrub": ("Gritty scrubs", "Skin reacts easily"),
    "stack_reactive": ("Two strong actives in one product", "Skin reacts easily"),
    "rx_treatment": ("Strong actives beside a prescription skin treatment", "You use one"),
    "lanolin": ("Lanolin", "You avoid it"),
    "nut_oils": ("Nut oils", "You avoid them"),
    "mi_preservatives": ("MI preservatives", "You avoid them"),
    "under_18": ("Actives made for adult skin", "Under 18"),
}


def rule_families() -> list[dict[str, Any]]:
    """GET /v1/safety/rules: each rule group with its sources and grades (no person data)."""
    groups: dict[str, dict[str, Any]] = {}
    for r in rules():
        label, applies = FAMILIES.get(r.group, (r.group.replace("_", " ").capitalize(), ""))
        g = groups.setdefault(
            r.group,
            {
                "id": r.group,
                "label": label,
                "applies": applies,
                "levels": [],
                "grades": [],
                "sources": [],
                "rules": [],
            },
        )
        if r.level not in g["levels"]:
            g["levels"].append(r.level)
        if r.grade not in g["grades"]:
            g["grades"].append(r.grade)
        src = r.source.model_dump()
        if src not in g["sources"]:
            g["sources"].append(src)
        g["rules"].append({"id": r.id, "title": r.title, "level": r.level, "grade": r.grade})
    for g in groups.values():
        g["levels"].sort(key=lambda lv: lv != "avoid")
        g["grades"].sort()
    return list(groups.values())


# Words too general to be an ingredient someone reacted to.
_GENERIC = frozenset(
    {
        "water",
        "aqua",
        "eau",
        "oil",
        "extract",
        "acid",
        "vitamin",
        "and",
        "fragrance",
        "parfum",
        "perfume",
        "alcohol",
    }
)


def _display(name: str) -> str:
    """Catalog labels shout in places ("SODIUM HYALURONATE"): read them in title case."""
    name = " ".join(name.split()).strip(" .;,")
    return name.title() if name.isupper() else name


@lru_cache
def vocabulary() -> tuple[str, ...]:
    """Every ingredient name on a catalog label, plus the rule file's ingredient names: what the
    "reacted to" typeahead offers and the only names the note reader may suggest. One spelling
    per name (case and brackets aside), blends split into their parts."""
    from app import catalog

    seen: dict[str, str] = {}

    def add(raw: str) -> None:
        for part in re.split(r"\s*\(and\)\s*", raw, flags=re.I):
            name = _display(part)
            bare = _forms(name)[1]
            if not re.search(r"[a-z]{3}", bare) or not INGREDIENT_NAME.match(name):
                continue
            # "1,2-Hexanediol" and "1,2- Hexanediol" are one name
            seen.setdefault(re.sub(r"[^a-z0-9]", "", bare), name)

    for p in catalog.products():
        for i in p.get("inci") or []:
            add(str(i))
    for r in rules():
        for term in [
            *r.match.inci_any,
            *r.match.actives_any,
            *(t for g in r.match.all_groups for t in g),
        ]:
            add(term[:1].upper() + term[1:])
    return tuple(sorted(seen.values(), key=str.lower))


@lru_cache
def vocabulary_index() -> dict[str, str]:
    """Each way a vocabulary name can be written (lower case) to its spelling in the vocabulary."""
    index: dict[str, str] = {}
    for name in vocabulary():
        for form in _forms(name):
            index.setdefault(form, name)
    return index


def in_vocabulary(name: str) -> str | None:
    """The vocabulary's spelling of this ingredient, or None when no label or rule names it."""
    low = " ".join(name.lower().split())
    return vocabulary_index().get(low) or vocabulary_index().get(_forms(low)[1])
