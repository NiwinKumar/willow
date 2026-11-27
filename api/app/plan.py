"""Start-from-zero routine builder (build-spec, POST /v1/plan). Deterministic: no Gemini.

From the person's skin type, goals, budget, market and safety profile it narrows the catalog
step by step (the funnel the app draws), picks one product per slot, says why in plain words,
and lays out when to start each one and when to judge it (the evidence clock, from
`seed/evidence_clock.json`).

Rules a pick must pass: sold where the person is, a cosmetic or sunscreen there
(regulatory.is_suggestible), a price in the budget's currency within the budget (nothing is
converted), not "avoid" or "not sold" for this profile, fragrance-free when the skin reacts
easily or fragrance is on the avoid list. Actives must have no flag at all. Ties go to the proof
tier (Proven, then Promising, when outcome data is available), then concern match, then price.
"""

import json
import logging
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app import catalog, regulatory, routine_check, safety
from app.safety import SafetyProfile

log = logging.getLogger("willow.plan")
CLOCK_PATH = Path(__file__).resolve().parent.parent / "seed" / "evidence_clock.json"

Goal = Literal[
    "dark_spots",
    "even_tone",
    "redness",
    "blemishes",
    "pores_texture",
    "lines",
    "under_eye",
    "oil_glow",
]
GOAL_CONCERNS: dict[str, tuple[str, ...]] = {
    "dark_spots": ("dark_spots_pigmentation",),
    "even_tone": ("uneven_tone", "dullness"),
    "redness": ("redness_sensitivity",),
    "blemishes": ("acne_blemishes",),
    "pores_texture": ("texture_pores",),
    "lines": ("fine_lines",),
    "under_eye": ("dark_circles",),
    "oil_glow": ("oiliness_shine",),
}
# the app's own goal names (web/src/lib/metrics.ts GOALS)
GOAL_LABEL = {
    "dark_spots": "Dark spots",
    "even_tone": "Tone evenness",
    "redness": "Redness",
    "blemishes": "Blemishes",
    "pores_texture": "Pores and texture",
    "lines": "Lines",
    "under_eye": "Under-eye",
    "oil_glow": "Shine and glow",
}
MARKET_REGION = {"US": "US", "IN": "IN", "SG": "SEA", "UK": "UK", "EU": "EU"}
MARKET_WORDS = {"US": "the US", "IN": "India", "SG": "Singapore", "UK": "the UK", "EU": "the EU"}
DEFAULT_CURRENCY = {"US": "USD", "IN": "INR", "SG": "SGD", "UK": "GBP", "EU": "EUR"}
SIGN = {"USD": "$", "INR": "₹", "SGD": "S$", "GBP": "£", "EUR": "€", "AUD": "A$"}
TIER_RANK = {"proven": 0, "promising": 1}
MIN_PRICED = 10  # fewer products priced in the market's currency: fall back to USD prices
FALLBACK_CURRENCY = "USD"
CURRENCY_NOTE = "Prices shown in USD; we don't have local prices for your market yet"

BASE_SLOTS = ("cleanser", "moisturizer", "sunscreen")
ACTIVE_CATEGORIES = ("serum", "treatment", "exfoliant", "toner")
SLOT_WORD = {"cleanser": "cleanser", "moisturizer": "moisturiser", "sunscreen": "sunscreen"}
STRONG = {"retinoid", "aha", "bha", "pha", "bpo"}
# pairs the routine check flags (routine_check.rule_findings): never both in one plan
CLASHES = (
    ({"retinoid"}, {"aha", "bha", "bpo"}),
    ({"laa"}, {"bpo"}),
    ({"copper_peptide"}, {"aha", "bha", "laa"}),
)

LIGHT = re.compile(
    r"\b(gel|foam|foaming|water|watery|fluid|aqua|essence|light|lightweight|matte|mattifying|"
    r"oil[- ]free|sheer|dry[- ]touch|clay|jelly)\b",
    re.I,
)
RICH = re.compile(
    r"\b(cream|balm|butter|rich|barrier|repair|intense|intensive|nourishing|ointment|oil)\b",
    re.I,
)
# what each skin type leaves out, per slot (texture words in the name)
EXCLUDE = {
    "oily": {"cleanser": "rich", "moisturizer": "rich", "sunscreen": "rich"},
    "dry": {"cleanser": "stripping"},
}
STRIPPING = re.compile(r"\b(clay|oil control|oil[- ]free|mattifying|matte)\b", re.I)
PREFER = {"oily": "light", "combination": "light", "dry": "rich", "sensitive": None, "normal": None}
SKIN_TITLE = {
    "oily": "Oily",
    "combination": "Combination",
    "dry": "Dry",
    "normal": "Normal",
    "sensitive": "Sensitive",
}
TRAITS = {
    "oily": ("oil_all_over", "Shine across the face", "Light gel or foam textures sit best."),
    "combination": (
        "oil_t_zone",
        "Shine on the T-zone",
        "Light textures for the oilier centre, enough moisture for the cheeks.",
    ),
    "dry": ("dry_tight", "Feels tight or flaky", "Cream textures and a gentle cleanser help."),
    "normal": ("balanced", "Balanced", "Most textures suit you."),
    "sensitive": ("sensitive", "Sensitive", "Fewer, gentler products."),
}


class Budget(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_per_product: float = Field(gt=0, le=10_000_000)
    currency: str = Field(pattern=r"^[A-Z]{3}$")


class PlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    skin_type: Literal["oily", "combination", "dry", "normal", "sensitive"] = "normal"
    reactive: bool = False
    goals: list[Goal] = Field(default_factory=list, max_length=5)
    budget: Budget | None = None
    tier: Literal["budget", "mid", "premium", "any"] = "any"
    steps: int = Field(default=3, ge=3, le=5)
    market: regulatory.Market | None = None
    # null: the person's saved safety profile
    safety: SafetyProfile | None = None

    @field_validator("goals")
    @classmethod
    def _goals(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(v))


# --- evidence clock ---------------------------------------------------------------------------


@lru_cache
def evidence_clock() -> dict[str, Any]:
    return json.loads(CLOCK_PATH.read_text())


def _term_in(term: str, name: str) -> bool:
    return bool(re.search(rf"(?<![a-z]){re.escape(term)}", name.lower()))


def clock_for(product: dict[str, Any]) -> dict[str, Any] | None:
    """When to look and when to judge a product, from its first key active that has a clock
    entry; None for the basics (cleanser, moisturiser, sunscreen)."""
    clock = evidence_clock()
    if product.get("category") in clock["basics"]:
        return None
    for a in product.get("key_actives") or []:
        for key, entry in clock["actives"].items():
            if any(_term_in(t, a["name"]) for t in entry["match"]):
                out = {k: v for k, v in entry.items() if k != "match"}
                return {"active": key, **out}
    return {"active": None, **clock["default"]}


ACTIVE_WORD = {
    "vitamin_c": "vitamin C",
    "aha": "exfoliating acid",
    "hyaluronic_acid": "hyaluronic acid",
    "alpha_arbutin": "alpha arbutin",
    "tranexamic_acid": "tranexamic acid",
    "kojic_acid": "kojic acid",
    "azelaic_acid": "azelaic acid",
    "salicylic_acid": "salicylic acid",
    "benzoyl_peroxide": "benzoyl peroxide",
}


def _active_word(clock: dict[str, Any] | None, product: dict[str, Any]) -> str:
    key = (clock or {}).get("active")
    if key:
        return ACTIVE_WORD.get(key, key.replace("_", " "))
    actives = product.get("key_actives") or []
    return actives[0]["name"] if actives else ""


# --- facts per product ------------------------------------------------------------------------


def sold_in(product: dict[str, Any], market: str | None) -> bool:
    if market is None:
        return True
    region = MARKET_REGION[market]
    regions = set(product.get("region") or []) | {s.get("region") for s in product["stores"]}
    return bool(regions & {region, "GLOBAL"})


def price_in(product: dict[str, Any], currency: str) -> float | None:
    """The lowest checked price in this currency (the reference price or a store's), never
    converted from another currency."""
    amounts = [product["price"]["amount"]] if product["price"]["currency"] == currency else []
    amounts += [
        s["price"]["amount"]
        for s in product.get("stores") or []
        if s.get("price") and s["price"]["currency"] == currency
    ]
    return min(amounts) if amounts else None


def price_tier(amount: float, currency: str) -> str | None:
    """budget, mid or premium (app/cohort.py's bands); None where no band is set."""
    from app import cohort

    if currency not in ("USD", "INR"):
        return None
    return cohort.tier({"amount": amount, "currency": currency})


def texture(product: dict[str, Any]) -> str:
    name = product["name"]
    light, rich = bool(LIGHT.search(name)), bool(RICH.search(name))
    if light and not rich:
        return "light"
    if rich and not light:
        return "rich"
    return "neutral"


# words that name a texture, as the why line says them ("Gel texture suits oily skin")
TEXTURE_WORD = {
    "gel": "gel",
    "jelly": "jelly",
    "foam": "foam",
    "foaming": "foam",
    "water": "watery",
    "watery": "watery",
    "aqua": "watery",
    "fluid": "fluid",
    "essence": "essence",
    "light": "light",
    "lightweight": "light",
    "cream": "cream",
    "balm": "balm",
    "butter": "butter",
    "oil": "oil",
}


def _texture_word(product: dict[str, Any]) -> str | None:
    t = texture(product)
    if t == "neutral":
        return None
    for m in (LIGHT if t == "light" else RICH).finditer(product["name"]):
        word = TEXTURE_WORD.get(m.group(1).lower())
        if word:
            return word
    return None


def _skin_fits(product: dict[str, Any], skin: str) -> bool:
    rule = EXCLUDE.get(skin, {}).get(product["category"])
    if rule == "rich":
        return texture(product) != "rich"
    if rule == "stripping":
        return not STRIPPING.search(product["name"])
    return True


def _skin_score(product: dict[str, Any], skin: str) -> int:
    want = PREFER.get(skin)
    t = texture(product)
    if want and t == want:
        return 2
    if want and t != "neutral":
        return 0
    return 1


def proof_tiers() -> dict[str, dict[str, Any]]:
    """Proven and Promising products from the outcome data (retail_intel, cached per day),
    each labelled simulated while the cohort is; {} when the data is unavailable."""
    try:
        from app import retail_intel

        view = retail_intel.products()
    except Exception:
        log.info("proof tiers unavailable; the plan ranks without them")
        return {}
    simulated = (view.get("cohort") or {}).get("real", 0) == 0
    return {
        r["product_id"]: {"tier": r["tier"], "n": r["n"], "simulated": simulated}
        for r in view.get("products") or []
        if r.get("tier") in TIER_RANK
    }


# --- building ---------------------------------------------------------------------------------


def _money(amount: float, currency: str) -> str:
    text = f"{amount:,.2f}".removesuffix(".00")
    sign = SIGN.get(currency)
    return f"{sign}{text}" if sign else f"{text} {currency}"


class _Ctx:
    def __init__(self, req: PlanRequest, profile: dict[str, Any] | None, usd: bool = False) -> None:
        self.req = req
        # unknown market: the US (the catalog's largest priced market)
        self.market = req.market or (profile or {}).get("market") or "US"
        self.reactive = (
            req.reactive or req.skin_type == "sensitive" or bool((profile or {}).get("reactive"))
        )
        # what the request says about the skin and market counts in every check, too
        base = profile or SafetyProfile().model_dump()
        self.profile: dict[str, Any] = {
            **base,
            "reactive": True if self.reactive else base.get("reactive"),
            "market": self.market,
        }
        self.no_fragrance = self.reactive or "fragrance" in ((profile or {}).get("avoid") or [])
        self.currency = (
            req.budget.currency if req.budget else DEFAULT_CURRENCY.get(self.market or "")
        )
        self.currency_note: str | None = None
        if self.currency and self.currency != FALLBACK_CURRENCY:
            priced = sum(
                1
                for p in catalog.products()
                if self.in_market(p) and price_in(p, self.currency) is not None
            )
            if usd or priced < MIN_PRICED:
                # too few local prices (no GBP or EUR at all): USD prices of products sold here
                # or globally, compared as they are (never converted), and said so
                self.currency = FALLBACK_CURRENCY
                self.currency_note = CURRENCY_NOTE
        self.tiers = proof_tiers()
        self.checks: dict[str, dict[str, Any]] = {}

    def check(self, p: dict[str, Any]) -> dict[str, Any]:
        pid = p["product_id"]
        if pid not in self.checks:
            self.checks[pid] = safety.check(p, self.profile, self.market)
        return self.checks[pid]

    def price(self, p: dict[str, Any]) -> float | None:
        return price_in(p, self.currency) if self.currency else None

    def in_market(self, p: dict[str, Any]) -> bool:
        return sold_in(p, self.market) and regulatory.is_suggestible(p, self.market)

    def in_budget(self, p: dict[str, Any], with_tier: bool = True) -> bool:
        b = self.req.budget
        if b is None and (self.req.tier == "any" or not self.currency):
            return True
        amount = self.price(p)
        if amount is None:
            return False  # no price in that currency: never converted, so skipped
        if b is not None and amount > b.max_per_product:
            return False
        if with_tier and self.req.tier != "any":
            band = price_tier(amount, self.currency or "")
            return band is None or band == self.req.tier
        return True

    def unflagged(self, p: dict[str, Any]) -> bool:
        if self.check(p)["status"] in ("avoid", "not_sold"):
            return False
        return not (self.no_fragrance and safety.has_fragrance(p))


def _concern_hits(p: dict[str, Any], goals: list[str]) -> int:
    wanted = {c for g in goals for c in GOAL_CONCERNS[g]}
    return len(wanted & set(p["concerns"]))


def _rank(ctx: _Ctx, p: dict[str, Any], goals: list[str]) -> tuple:
    tier = ctx.tiers.get(p["product_id"], {}).get("tier")
    price = ctx.price(p)
    return (
        ctx.check(p)["status"] != "clear",
        -_skin_score(p, ctx.req.skin_type) if p["category"] in BASE_SLOTS else 0,
        TIER_RANK.get(tier or "", 2),
        -_concern_hits(p, goals),
        price if price is not None else math.inf,
        p["product_id"],
    )


def _active_ok(ctx: _Ctx, p: dict[str, Any]) -> bool:
    """An active the plan may add: a stated key active, and no flag at all for this person."""
    return (
        p["category"] in ACTIVE_CATEGORIES
        and bool(p.get("key_actives"))
        and ctx.check(p)["status"] == "clear"
    )


def _compatible(a: dict[str, Any], b: dict[str, Any]) -> bool:
    ca, cb = routine_check.classes_of(a), routine_check.classes_of(b)
    if ca & cb or (ca & STRONG and cb & STRONG):
        return False
    for x, y in CLASHES:
        if (ca & x and cb & y) or (cb & x and ca & y):
            return False
    ka, kb = clock_for(a), clock_for(b)
    return not (ka and kb and ka.get("active") and ka.get("active") == kb.get("active"))


def _why(ctx: _Ctx, p: dict[str, Any], slot: str, goal: str | None) -> list[str]:
    why: list[str] = []
    if slot in BASE_SLOTS:
        word = _texture_word(p)
        skin = ctx.req.skin_type
        if word and _skin_score(p, skin) == 2:
            why.append(f"{word.capitalize()} texture suits {SKIN_TITLE[skin].lower()} skin")
        if slot == "sunscreen":
            why.append("Daily sun protection, the step that matters most with any active")
    else:
        clock = clock_for(p)
        word = _active_word(clock, p)
        if goal and word:
            why.append(f"{word[:1].upper()}{word[1:]} for {GOAL_LABEL[goal].lower()}")
    if not safety.has_fragrance(p):
        why.append("No fragrance listed")
    tier = ctx.tiers.get(p["product_id"])
    if tier:
        label = "Proven" if tier["tier"] == "proven" else "Promising"
        note = " (simulated cohort)" if tier["simulated"] else ""
        why.append(f"Rated {label} in Willow's outcome data{note}")
    if ctx.req.budget:
        why.append("Within your budget")
    flags = ctx.check(p)["flags"]
    if flags:
        why.append(f"Check: {flags[0]['title']}")
    return [w for w in why if w]


def _nothing_fits(ctx: _Ctx, slot: str, pool: list[dict[str, Any]]) -> HTTPException:
    """Which step left this base slot empty, in words; `step` names it (market, price, budget,
    tier, flags or fit)."""
    word = SLOT_WORD[slot]
    inslot = [p for p in pool if p["category"] == slot]
    market = [p for p in inslot if ctx.in_market(p)]
    b = ctx.req.budget
    if not market:
        where = MARKET_WORDS.get(ctx.market or "", "where you are")
        step, msg = "market", f"No {word} in the catalog is sold as a cosmetic in {where} yet."
    elif ctx.currency and not [p for p in market if ctx.price(p) is not None]:
        step, msg = "price", f"No {word} in the catalog has a checked price in {ctx.currency} yet."
    elif b and not [p for p in market if ctx.in_budget(p, with_tier=False)]:
        limit = _money(b.max_per_product, ctx.currency or b.currency)
        step, msg = (
            "budget",
            f"Nothing in the catalog fits a budget under {limit}; try a higher budget.",
        )
    elif not [p for p in market if ctx.in_budget(p)]:
        step = "tier"
        msg = f"No {word} in the catalog is in the {ctx.req.tier} price range; try any range."
    elif not [p for p in market if ctx.in_budget(p) and ctx.unflagged(p)]:
        step = "flags"
        msg = f"Every {word} in your budget is flagged for your profile; try a higher budget."
    else:
        step = "fit"
        msg = f"No {word} in your budget suits {SKIN_TITLE[ctx.req.skin_type].lower()} skin."
    return HTTPException(422, {"code": "nothing_fits", "message": msg, "step": step})


def _profile_block(ctx: _Ctx) -> dict[str, Any]:
    req, prof = ctx.req, ctx.profile or {}
    title = SKIN_TITLE[req.skin_type]
    if ctx.reactive and req.skin_type != "sensitive":
        title += ", easily irritated"
    tid, label, detail = TRAITS[req.skin_type]
    traits = [{"id": tid, "label": label, "detail": detail}]
    if ctx.reactive and req.skin_type != "sensitive":
        traits.append(
            {
                "id": "reactive",
                "label": "Reacts easily",
                "detail": "Fragrance-free picks, and one new product at a time.",
            }
        )
    avoid = [safety.AVOID_LABEL[a] for a in prof.get("avoid") or []]
    if ctx.no_fragrance and "Fragrance" not in avoid:
        avoid.insert(0, "Fragrance")
    stage = prof.get("life_stage")
    cautions = []
    if stage in ("pregnant", "trying", "breastfeeding"):
        words = {
            "pregnant": "while pregnant",
            "trying": "while trying for a baby",
            "breastfeeding": "while breastfeeding",
        }[stage]
        cautions.append(f"Retinoids are left out {words}")
    if prof.get("rx_treatment"):
        cautions.append(
            "Retinoids and exfoliating acids are left out, as you use a prescription skin treatment"
        )
    if prof.get("adult") is False:
        cautions.append("Anti-ageing actives are left out under 18")
    return {
        "title": title,
        "traits": traits,
        "focus": [GOAL_LABEL[g] for g in req.goals],
        "avoid": avoid,
        "cautions": cautions,
    }


def build(req: PlanRequest, profile: dict[str, Any] | None) -> dict[str, Any]:
    """The plan. `profile`: the safety profile (the request's, else the saved one). A market
    whose own prices leave a base slot empty is planned again on USD prices (said so in
    currency_note); if that fails too, the first answer's reason stands."""
    ctx = _Ctx(req, profile)
    try:
        return _build(ctx)
    except HTTPException as exc:
        # only a missing local price is worth a USD plan; a budget too low stays too low
        if ctx.currency in (None, FALLBACK_CURRENCY) or exc.detail.get("step") != "price":
            raise
        try:
            return _build(_Ctx(req, profile, usd=True))
        except HTTPException:
            raise exc from None


def _build(ctx: _Ctx) -> dict[str, Any]:
    req = ctx.req
    goals = list(req.goals)
    everything = list(catalog.products())
    market = [p for p in everything if ctx.in_market(p)]
    budget = [p for p in market if ctx.in_budget(p)]
    unflagged = [p for p in budget if ctx.unflagged(p)]
    max_actives = max(0, req.steps - 3)
    notes_extra: list[str] = []
    if ctx.reactive and max_actives > 1:
        max_actives = 1
        notes_extra.append("Your skin reacts easily, so the plan starts with one active only.")

    def fits(p: dict[str, Any]) -> bool:
        if p["category"] in BASE_SLOTS:
            return _skin_fits(p, req.skin_type)
        return bool(max_actives and goals and _active_ok(ctx, p) and _concern_hits(p, goals))

    fit = [p for p in unflagged if fits(p)]
    funnel = [
        {"id": "catalog", "label": "Products in the catalog", "n": len(everything)},
        {"id": "market", "label": "Sold where you are", "n": len(market)},
        {"id": "budget", "label": "Within your budget", "n": len(budget)},
        {"id": "flags", "label": "Not ruled out by your profile", "n": len(unflagged)},
        {"id": "fit", "label": "Fit your skin and goals", "n": len(fit)},
    ]

    picks: list[dict[str, Any]] = []

    def pick(slot: str, when: str, ranked: list[dict[str, Any]], goal: str | None, start: int):
        chosen = ranked[0]
        clock = clock_for(chosen) if slot == "active" else None
        tier = ctx.tiers.get(chosen["product_id"])
        picks.append(
            {
                "slot": slot,
                "when": when,
                "product": chosen,
                "why": _why(ctx, chosen, slot, goal),
                "check": ctx.check(chosen),
                "start_week": start,
                "verdict_week": start + clock["verdict_weeks"] if clock else None,
                "evidence": clock,
                "proof": tier,
                "alternatives": ranked[1:3],
                "goal": goal,
            }
        )

    for slot in BASE_SLOTS:
        ranked = sorted(
            (p for p in fit if p["category"] == slot), key=lambda p: _rank(ctx, p, goals)
        )
        if not ranked:
            raise _nothing_fits(ctx, slot, everything)
        pick(slot, "am" if slot == "sunscreen" else "both", ranked, None, 0)

    unfilled: list[str] = []
    first_start = 4 if ctx.reactive else 2
    actives_fit = [p for p in fit if p["category"] in ACTIVE_CATEGORIES]
    for n in range(max_actives):
        chosen_actives = [k["product"] for k in picks if k["slot"] == "active"]
        order = goals[n:] + goals[:n] if n else goals
        placed = False
        for goal in order:
            ranked = sorted(
                (
                    p
                    for p in actives_fit
                    if _concern_hits(p, [goal]) and all(_compatible(p, c) for c in chosen_actives)
                ),
                key=lambda p, g=goal: _rank(ctx, p, [g]),
            )
            if not ranked:
                continue
            classes = routine_check.classes_of(ranked[0])
            when = "am" if n == 0 and (classes & {"laa"} or _is_vitamin_c(ranked[0])) else "pm"
            pick("active", when, ranked, goal, first_start + 4 * n)
            placed = True
            break
        if not placed:
            unfilled.append(GOAL_LABEL[goals[0]].lower() if goals else "")
            break

    actives = [k for k in picks if k["slot"] == "active"]
    return {
        "profile": _profile_block(ctx),
        "funnel": funnel,
        "picks": picks,
        "schedule": _schedule(picks),
        "notes": _notes(ctx, actives, unfilled, notes_extra, max_actives),
        "total": _total(ctx, picks),
        "market": ctx.market,
        "currency_note": ctx.currency_note,
    }


def _is_vitamin_c(p: dict[str, Any]) -> bool:
    return (clock_for(p) or {}).get("active") == "vitamin_c"


def _schedule(picks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items = [
        {
            "week": 0,
            "text": "Start the cleanser, moisturiser and sunscreen together. They are the base.",
        }
    ]
    for k in picks:
        if k["slot"] != "active":
            continue
        p = k["product"]
        word = _active_word(k["evidence"], p)
        thing = f"{word} {p['category']}".strip()
        when = "in the morning" if k["when"] == "am" else "at night"
        items.append(
            {
                "week": k["start_week"],
                "text": f"Add the {thing} {when}. One new active at a time, so its effect can "
                "be read alone.",
            }
        )
        if k["verdict_week"] is not None:
            items.append(
                {
                    "week": k["verdict_week"],
                    "text": f"Verdict on the {thing}: keep, stop or swap, from your check-ins.",
                }
            )
    return sorted(items, key=lambda i: i["week"])


def _notes(
    ctx: _Ctx,
    actives: list[dict[str, Any]],
    unfilled: list[str],
    extra: list[str],
    max_actives: int,
) -> list[str]:
    notes = ["Patch test each new product on the inner arm for a few days first."]
    if actives:
        notes.append("Sunscreen every morning while using actives.")
    notes += extra
    if max_actives and not ctx.req.goals:
        notes.append("Pick a goal to add an active.")
    elif unfilled:
        notes.append(
            "No active in the catalog fits your goals, budget and profile without a flag, so "
            "the plan keeps to the base."
            if not actives
            else "Only one active fits your goals, budget and profile without a flag."
        )
    if any(k.get("proof") and k["proof"]["simulated"] for k in actives):
        notes.append("Proof ratings come from a simulated cohort, not real users yet.")
    notes.append(
        "Stop any product that stings, burns or itches, and see a doctor or pharmacist if it "
        "doesn't settle in a few days."
    )
    notes.append(safety.LABELS_NOTE)
    return notes


def _total(ctx: _Ctx, picks: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not ctx.currency:
        return None
    amounts = [ctx.price(k["product"]) for k in picks]
    if any(a is None for a in amounts):
        return None
    return {"amount": round(sum(amounts), 2), "currency": ctx.currency}


# --- swaps ------------------------------------------------------------------------------------

SWAP_RANGE = 0.5  # the same active within ±50% of its strength


def _active_key(name: str) -> str:
    name = re.sub(r"\([^)]*\)", " ", name.lower()).replace("-", " ")
    return " ".join(name.split())


def swaps(
    product: dict[str, Any],
    market: str | None,
    profile: dict[str, Any] | None,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Products like this one for less or more: same category, the same main key active at a
    similar stated strength, a cosmetic where the person is. Prices are compared only in one
    currency (the market's, else this product's own), each side's lowest checked price in it,
    never converted; with no price on both sides the why says nothing about price. Cheapest
    first. Each item: product, why, price {currency, amount, base} or null, and `check` when the
    person has a profile."""
    actives = product.get("key_actives") or []
    if not actives:
        return []
    main = actives[0]
    key, pct = _active_key(main["name"]), main.get("pct")
    currency = DEFAULT_CURRENCY.get(market or "") or product["price"]["currency"]
    base = price_in(product, currency)
    found = []
    for p in catalog.products():
        if p["product_id"] == product["product_id"] or p["category"] != product["category"]:
            continue
        if not (sold_in(p, market) and regulatory.is_suggestible(p, market)):
            continue
        same = next((a for a in p["key_actives"] if _active_key(a["name"]) == key), None)
        if same is None:
            continue
        if pct is not None:
            other = same.get("pct")
            if other is None or not (1 - SWAP_RANGE) * pct <= other <= (1 + SWAP_RANGE) * pct:
                continue
        check = safety.check(p, profile, market) if profile else None
        if check and check["status"] in ("avoid", "not_sold"):
            continue
        amount = price_in(p, currency)
        strength = f" {_pct_words(same.get('pct'))}" if same.get("pct") is not None else ""
        why = f"Same active ({same['name'].lower()}{strength})"
        compared = None
        if amount is not None and base:
            diff = (amount - base) / base
            if diff <= -0.01:
                why += f", {round(-diff * 100)}% cheaper"
            elif diff >= 0.01:
                why += f", {round(diff * 100)}% more"
            else:
                why += ", same price"
            why += f" ({_money(amount, currency)} against {_money(base, currency)})"
            compared = {"currency": currency, "amount": amount, "base": base}
        item = {"product": p, "why": why, "price": compared}
        if check:
            item["check"] = check
        found.append((amount if amount is not None else math.inf, p["product_id"], item))
    found.sort(key=lambda f: (f[0], f[1]))
    return [f[2] for f in found[:limit]]


def _pct_words(pct: Any) -> str:
    return f"{int(pct) if float(pct).is_integer() else pct}%"
