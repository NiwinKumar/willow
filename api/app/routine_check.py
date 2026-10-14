"""Routine compatibility check (GEMINI_SPEC.md section 4).

The rule table runs as plain code, so its findings are always the same and always marked
`source: "rule"`. Gemini may add other well-known cosmetic interactions as `source: "model"`;
those are validated (known products only, no invented numbers, never the niacinamide + vitamin C
myth) and dropped if they fail. If Gemini is unavailable the rule findings stand alone.
"""

import re
from itertools import combinations
from typing import Any, Literal

from pydantic import BaseModel, Field

from app import gemini, numbers
from app.explain import BANNED

Entry = dict[str, Any]

# Activity classes, matched on key actives and on the first part of the INCI list (where an
# ingredient is present at a meaningful level). Names are lower-cased before matching.
CLASSES: dict[str, tuple[str, ...]] = {
    "retinoid": (
        "retinol",
        "retinal",
        "retinaldehyde",
        "adapalene",
        "tretinoin",
        "retinyl retinoate",
        "hydroxypinacolone retinoate",
    ),
    "aha": ("glycolic acid", "lactic acid", "mandelic acid"),
    "bha": ("salicylic acid", "betaine salicylate"),
    "pha": ("gluconolactone", "lactobionic acid"),
    "bpo": ("benzoyl peroxide",),
    "laa": ("ascorbic acid",),  # L-ascorbic acid only; derivatives are matched separately
    "copper_peptide": ("copper tripeptide-1", "copper peptide"),
    "niacinamide": ("niacinamide",),
}
INCI_DEPTH = 12
LABEL = {
    "retinoid": "a retinoid",
    "aha": "an AHA",
    "bha": "a BHA",
    "pha": "a PHA",
    "bpo": "benzoyl peroxide",
    "laa": "vitamin C (L-ascorbic acid)",
    "copper_peptide": "copper peptides",
    "niacinamide": "niacinamide",
}


def _names(entry: Entry) -> list[str]:
    actives = [a["name"].lower() for a in entry.get("key_actives") or []]
    inci = [i.lower() for i in (entry.get("inci") or [])[:INCI_DEPTH]]
    return actives + inci


def classes_of(entry: Entry) -> set[str]:
    found = set()
    for name in _names(entry):
        for cls, terms in CLASSES.items():
            for term in terms:
                if term == "ascorbic acid":
                    # "ascorbic acid" but not "ethyl ascorbic acid" / "ascorbyl ..."
                    if re.search(r"(^|[^a-z-])l?-?ascorbic acid", name) and "ethyl" not in name:
                        found.add(cls)
                elif term in name:
                    found.add(cls)
    return found


def is_sunscreen(entry: Entry) -> bool:
    text = f"{entry.get('category', '')} {entry.get('custom_name', '')}".lower()
    return entry.get("category") == "sunscreen" or "spf" in text


def _shared_slot(a: Entry, b: Entry) -> bool:
    return bool(set(a.get("slots") or []) & set(b.get("slots") or []))


def _name(e: Entry) -> str:
    return f"{e.get('brand', '')} {e.get('custom_name', '')}".strip()


def rule_findings(entries: list[Entry]) -> dict[str, Any]:
    active = [e for e in entries if not e.get("ended_at")]
    cls = {e["id"]: classes_of(e) for e in active}
    conflicts: list[dict[str, Any]] = []

    def pair_rule(x: set[str], y: set[str], issue: str, suggestion: str, severity: str) -> None:
        for a, b in combinations(active, 2):
            if not _shared_slot(a, b):
                continue
            for p, q in ((a, b), (b, a)):
                if cls[p["id"]] & x and cls[q["id"]] & y:
                    conflicts.append(
                        {
                            "products": [p["id"], q["id"]],
                            "issue": issue,
                            "severity": severity,
                            "suggestion": suggestion,
                            "source": "rule",
                        }
                    )
                    break  # one finding per pair (not both orders); other pairs still count

    pair_rule(
        {"retinoid"},
        {"aha", "bha"},
        "A retinoid and an exfoliating acid in the same routine can irritate.",
        "Alternate nights: the retinoid one night, the acid the next.",
        "caution",
    )
    pair_rule(
        {"retinoid"},
        {"bpo"},
        "Benzoyl peroxide and a retinoid in the same routine can irritate and some "
        "retinoids break down with it.",
        "Use benzoyl peroxide in the morning and the retinoid at night.",
        "caution",
    )
    pair_rule(
        {"laa"},
        {"bpo"},
        "Benzoyl peroxide can oxidise L-ascorbic acid when they are layered.",
        "Use them at different times: one in the morning, one at night.",
        "caution",
    )
    pair_rule(
        {"copper_peptide"},
        {"aha", "bha", "laa"},
        "Copper peptides are less stable next to strong acids or L-ascorbic acid.",
        "Use them in separate routines.",
        "info",
    )

    exfoliants = [e for e in active if cls[e["id"]] & {"aha", "bha", "pha"}]
    if len(exfoliants) >= 2:
        conflicts.append(
            {
                "products": [e["id"] for e in exfoliants],
                "issue": "Several exfoliating products across your routine can over-exfoliate.",
                "severity": "caution",
                "suggestion": "Reduce how often you use them, or keep one.",
                "source": "rule",
            }
        )

    duplicates = []
    for c in ("retinoid", "aha", "bha", "bpo", "laa", "niacinamide"):
        with_c = [e for e in active if c in cls[e["id"]]]
        if len(with_c) >= 2:
            duplicates.append(
                {
                    "active": LABEL[c],
                    "products": [e["id"] for e in with_c],
                    "note": "The same active in more than one product adds up; keeping one is "
                    "usually enough.",
                }
            )

    gaps = []
    strong = [e for e in active if cls[e["id"]] & {"retinoid", "aha", "bha"}]
    has_am_spf = any(is_sunscreen(e) and "am" in (e.get("slots") or []) for e in active)
    if strong and not has_am_spf:
        gaps.append(
            {
                "need": "Daily sunscreen in the morning",
                "why": "Retinoids and exfoliating acids make skin more sensitive to the sun.",
                "suggestion": "Add a broad-spectrum SPF 30 or higher to the morning routine.",
            }
        )

    notes = []
    if any("niacinamide" in cls[e["id"]] for e in active) and any(
        "laa" in cls[e["id"]] for e in active
    ):
        notes.append("Niacinamide and vitamin C are fine together; that pairing is not flagged.")
    return {"conflicts": conflicts, "duplicates": duplicates, "gaps": gaps, "notes": notes}


class ModelConflict(BaseModel):
    products: list[str] = Field(min_length=1, max_length=4)
    issue: str = Field(max_length=240)
    severity: Literal["info", "caution", "avoid_same_routine"]
    suggestion: str = Field(max_length=200)


class ModelAdditions(BaseModel):
    conflicts: list[ModelConflict] = Field(default_factory=list, max_length=4)
    notes: list[str] = Field(default_factory=list, max_length=3)


INSTRUCTIONS = """You review a skincare routine for cosmetic compatibility.
The rule-based findings below are already final; do not repeat or contradict them.
Add only other well-known cosmetic interactions you are confident about (for example two
strong actives that destabilise each other), or say nothing. Never flag niacinamide with
vitamin C. In "products" lists use the ids given; in any sentence name products by brand and
name, never by id. No percentages or other numbers unless they appear in the input. Calm,
plain, cosmetic language; no medical claims."""

ENTRY_ID = re.compile(r"\br_[A-Za-z0-9_]+\b")


def _readable(text: str, names: dict[str, str]) -> str | None:
    """Swap any entry id Gemini wrote into the product's name; None if an unknown id is left."""
    for entry_id, name in names.items():
        text = re.sub(rf"\b{re.escape(entry_id)}\b", name, text)
    return None if ENTRY_ID.search(text) else text


MYTH = re.compile(r"niacinamide", re.I)


def _valid(add: ModelConflict, ids: set[str], allowed: set[str], rules: list[dict]) -> bool:
    if not set(add.products) <= ids:
        return False
    text = f"{add.issue} {add.suggestion}"
    if MYTH.search(text) and re.search(r"vitamin c|ascorbic", text, re.I):
        return False
    if not numbers.only_known(text, allowed) or BANNED.search(text):
        return False
    same = {frozenset(r["products"]) for r in rules}
    return frozenset(add.products) not in same


def check(entries: list[Entry], use_model: bool = True) -> dict[str, Any]:
    result = rule_findings(entries)
    active = [e for e in entries if not e.get("ended_at")]
    if not use_model or len(active) < 2:
        return result
    listing = "\n".join(
        f"- id {e['id']}: {_name(e)} ({', '.join(e.get('slots') or []) or 'no time set'}); "
        f"actives: {', '.join(a['name'] for a in e.get('key_actives') or []) or 'not listed'}; "
        f"ingredients: {', '.join((e.get('inci') or [])[:INCI_DEPTH])}"
        for e in active
    )
    prompt = f"Routine:\n{listing}\n\nRule-based findings (final):\n{result}"
    try:
        extra = gemini.generate_json(
            "routine_check",
            [prompt],
            ModelAdditions,
            instructions=INSTRUCTIONS,
            temperature=0.0,
            max_output_tokens=4096,
        )
    except gemini.GeminiError:
        return result
    ids = {e["id"] for e in active}
    names = {e["id"]: _name(e) for e in active}
    allowed = numbers.in_text(listing)
    for add in extra.conflicts:
        issue, suggestion = _readable(add.issue, names), _readable(add.suggestion, names)
        if issue and suggestion and _valid(add, ids, allowed, result["conflicts"]):
            result["conflicts"].append(
                {**add.model_dump(), "issue": issue, "suggestion": suggestion, "source": "model"}
            )
    for raw in extra.notes:
        note = _readable(raw, names)
        if (
            note
            and numbers.only_known(note, allowed)
            and not BANNED.search(note)
            and not (MYTH.search(note) and re.search(r"vitamin c|ascorbic", note, re.I))
        ):
            result["notes"].append(note)
    return result
