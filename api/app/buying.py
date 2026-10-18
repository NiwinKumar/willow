"""Buying list (Willow Proof, retailer workspace): the assortment gaps worth acting on, as short
buying briefs, each with under-used products already in the catalog to look at first.

Gemini writes it as an agent (app/buying_agent.py): it reads the aggregates through tools, decides
which gaps matter and in what order, writes the briefs, picks the shelf products and says why; code
checks every number, word and product. It runs in the background once per filter and data version;
until it is ready (and whenever Gemini can't be reached) this module's fixed logic gives the list:
- gaps per goal and price tier (cohort.TIERS, INR-equivalent) from retailer.insights `gaps` and
  `needs`: `missing`, `weak` (well behind the goal's best tier, or under 20% visible change),
  `low_everywhere`, `unmeasured`, `thin`; ranked by people x severity;
- one template brief per gap, every number from the aggregates;
- candidates from the catalog only (there is no wider catalog yet): sold for the goal with too few
  users to measure, or not sold for it with an ingredient a fixed table links to the goal.

Nothing implies a candidate is proven: candidates carry `label` "Not measured for <goal> yet" or
"Too few users to measure yet" (set by code), and the list carries `caveat`.
"""

import logging
import re
import threading
import time
from typing import Any

from app import catalog, cohort, retail_intel, retailer

log = logging.getLogger("willow.buying")

MIN = retailer.MIN_GROUP
LOW_RATE = 0.2  # under this share with a visible change by week 8, a tier is weak
BEHIND = 0.15  # this far below the goal's best tier, a tier is weak
MAX_ITEMS = 5
MAX_CANDIDATES = 3
TIER_LABEL = {"budget": "budget", "mid": "mid-price", "premium": "premium"}


def _rupees(x: float) -> str:
    return f"₹{x:,.0f}"


def price_text(tier: str) -> str:
    lo, hi = next((lo, hi) for name, lo, hi in cohort.TIERS if name == tier)
    if lo == 0:
        return f"under {_rupees(hi)}"
    if hi == float("inf"):
        return f"{_rupees(lo)} or more"
    return f"{_rupees(lo)}–{_rupees(hi)}"


# Ingredients a product of this goal is often built around (cosmetic use, lower-case INCI
# fragments). A match is a reason to look at a product, never evidence that it works.
ACTIVE_GOALS: dict[str, tuple[str, ...]] = {
    "niacinamide": ("even_tone", "redness", "oil_glow", "pores_texture", "dark_spots"),
    "azelaic acid": ("redness", "even_tone", "blemishes", "dark_spots"),
    "arbutin": ("dark_spots", "even_tone"),
    "tranexamic acid": ("dark_spots", "even_tone"),
    "ascorbic acid": ("dark_spots", "even_tone", "oil_glow"),
    "ascorbyl": ("dark_spots", "even_tone", "oil_glow"),
    "4-butylresorcinol": ("dark_spots", "even_tone"),
    "acetyl glucosamine": ("dark_spots", "even_tone"),
    "glycyrrh": ("redness", "dark_spots"),
    "licorice": ("redness", "dark_spots"),
    "retinol": ("lines", "pores_texture", "even_tone"),
    "retinal": ("lines", "pores_texture", "even_tone"),
    "glycolic acid": ("even_tone", "pores_texture", "dark_spots"),
    "lactic acid": ("even_tone", "pores_texture"),
    "mandelic acid": ("even_tone", "blemishes"),
    "salicylic acid": ("blemishes", "pores_texture", "oil_glow"),
    "betaine salicylate": ("blemishes", "pores_texture"),
    "benzoyl peroxide": ("blemishes",),
    "zinc pca": ("oil_glow", "blemishes"),
    "kaolin": ("oil_glow", "pores_texture"),
    "bentonite": ("oil_glow", "pores_texture"),
    "centella": ("redness",),
    "madecassoside": ("redness",),
    "panthenol": ("redness",),
    "allantoin": ("redness",),
    "camellia sinensis": ("redness",),
    "caffeine": ("under_eye",),
    "peptide": ("under_eye", "lines"),
    "ceramide": ("redness",),
}


# Strong actives that sit badly with these goals (irritation-prone skin, the thin under-eye area):
# a product containing one is never a candidate for them.
AVOID: dict[str, tuple[str, ...]] = {
    "redness": ("retin", "glycolic acid", "lactic acid", "salicylic acid", "benzoyl peroxide"),
    "under_eye": ("glycolic acid", "salicylic acid", "benzoyl peroxide"),
}
# Rinse-off products show least of a leave-on ingredient: suggested last.
RINSE_OFF = {"cleanser", "mask"}


def _inci(p: dict[str, Any]) -> list[str]:
    return [str(x) for x in p.get("inci") or []]


def table_fit(p: dict[str, Any], goal: str) -> list[str]:
    """The product's INCI names that the fixed table links to this goal (as written on the pack)."""
    out = []
    for name in _inci(p):
        low = name.lower()
        if any(frag in low and goal in goals for frag, goals in ACTIVE_GOALS.items()):
            out.append(name)
    return out


def in_inci(p: dict[str, Any], ingredient: str) -> str | None:
    """The INCI name on this product's list that this ingredient names, else None."""
    want = ingredient.strip().lower()
    if len(want) < 4:
        return None
    for name in _inci(p):
        if want in name.lower() or name.lower() in want:
            return name
    return None


# -- gaps --------------------------------------------------------------------------------------


def find_gaps(ins: dict[str, Any]) -> list[dict[str, Any]]:
    """The gaps worth a brief, ranked by people with the goal x severity (at most MAX_ITEMS)."""
    demand = {r["goal_id"]: r["n"] for r in ins.get("needs") or []}
    found = []
    for g in ins.get("gaps") or []:
        goal, n = g["goal_id"], demand.get(g["goal_id"]) or 0
        if n < MIN:
            continue
        tiers = {t: g[t] for t, _, _ in cohort.TIERS}
        rates = {t: v["rate"] for t, v in tiers.items() if v["rate"] is not None}
        best_t = max(rates, key=rates.get) if rates else None
        best = rates.get(best_t) if best_t else None
        if rates and max(rates.values()) < LOW_RATE:
            found.append(_gap(goal, n, None, "low_everywhere", 0.9, tiers, best_t))
            continue
        for t, v in tiers.items():
            if v["options"] == 0:
                found.append(_gap(goal, n, t, "missing", 1.0, tiers, best_t))
            elif v["rate"] is None:
                found.append(_gap(goal, n, t, "unmeasured", 0.5, tiers, best_t))
            elif (
                best is not None
                and t != best_t
                and (best - v["rate"] >= BEHIND or v["rate"] < LOW_RATE)
            ):
                found.append(
                    _gap(goal, n, t, "weak", min(1.0, 0.4 + best - v["rate"]), tiers, best_t)
                )
            elif v["options"] == 1:
                found.append(_gap(goal, n, t, "thin", 0.3, tiers, best_t))
    found.sort(key=lambda x: (-x["score"], x["goal_id"], x["tier"] or ""))
    return found[:MAX_ITEMS]


def _gap(goal, n, tier, kind, severity, tiers, best_t) -> dict[str, Any]:
    return {
        "id": f"{goal}:{tier or 'all'}:{kind}",
        "goal_id": goal,
        "goal": retailer.GOAL_LABEL[goal],
        "tier": tier,
        "kind": kind,
        "demand": n,
        "score": round(n * severity, 1),
        "options": tiers,
        "best_tier": best_t,
    }


def _pct(x: float) -> str:
    return f"{round(x * 100)}%"


def brief(gap: dict[str, Any]) -> tuple[str, str]:
    """(title, one-paragraph brief) from the gap's own numbers."""
    goal = gap["goal"].lower()
    n, t, o, best_t = gap["demand"], gap["tier"], gap["options"], gap["best_tier"]
    want = f"{n:,} people want help with {goal}"

    def tier_words(x: str, price: bool = False) -> str:
        v = o[x]
        k = "option" if v["options"] == 1 else "options"
        at = f" ({price_text(x)})" if price else ""
        if v["rate"] is None:
            return f"{v['options']} {TIER_LABEL[x]} {k}{at}, too few users to measure"
        return f"{TIER_LABEL[x]} {k}{at}: {_pct(v['rate'])} visible change (n={v['n']})"

    if gap["kind"] == "missing":
        others = [x for x in o if x != t and o[x]["rate"] is not None]
        tail = f"; {tier_words(others[0])}" if others else ""
        return (
            f"Add a {TIER_LABEL[t]} {goal} product",
            f"{want}; no option {price_text(t)}{tail}.",
        )
    if gap["kind"] == "low_everywhere":
        parts = "; ".join(tier_words(x) for x in o if o[x]["options"])
        return (
            f"Find a stronger {goal} option",
            f"{want}; every price tier is under {_pct(LOW_RATE)} visible change by week 8: "
            f"{parts}.",
        )
    if gap["kind"] == "weak":
        return (
            f"Strengthen the {TIER_LABEL[t]} {goal} range",
            f"{want}; {tier_words(t, True)}, against {tier_words(best_t)}.",
        )
    if gap["kind"] == "unmeasured":
        return (
            f"Get the {TIER_LABEL[t]} {goal} range used",
            f"{want}; {tier_words(t, True)}.",
        )
    return (
        f"Add a second {TIER_LABEL[t]} {goal} option",
        f"{want}; only one {TIER_LABEL[t]} option ({price_text(t)}): "
        f"{_pct(o[t]['rate'])} visible change (n={o[t]['n']}).",
    )


# -- candidates --------------------------------------------------------------------------------


def pools(gap: dict[str, Any], rows: dict[str, dict[str, Any]]) -> dict[str, list[dict]]:
    """Under-used catalog products for this gap: `few` (sold for the goal in the tier, too few
    users to measure) and `fit` (in the tier, not sold for the goal, an ingredient fits it)."""
    goal, tier = gap["goal_id"], gap["tier"]
    few, fit = [], []
    for p in catalog.products():
        r = rows.get(p["product_id"]) or {}
        if tier and cohort.tier(p["price"]) != tier:
            continue
        sold_for = goal in (r.get("goal_ids") or [])
        if sold_for and r.get("tier") == "too_few":
            few.append(p)
        elif not sold_for and table_fit(p, goal) and not _avoid(p, goal):
            fit.append(p)
    fit.sort(key=lambda p: (p["category"] in RINSE_OFF, -len(table_fit(p, goal)), p["product_id"]))
    return {"few": few, "fit": fit}


def _avoid(p: dict[str, Any], goal: str) -> bool:
    return any(frag in name.lower() for name in _inci(p) for frag in AVOID.get(goal, ()))


def _candidate(
    p: dict[str, Any], gap: dict[str, Any], kind: str, ingredient: str | None, why: str
) -> dict[str, Any]:
    r_tier = cohort.tier(p["price"])
    goal = gap["goal"].lower()
    return {
        "product_id": p["product_id"],
        "product": p["name"],
        "brand": p["brand"],
        "image_url": p.get("image_url"),
        "category": p["category"],
        "tier": r_tier,
        "price": p["price"],
        "kind": kind,
        "ingredient": ingredient,
        "label": "Too few users to measure yet"
        if kind == "few"
        else f"Not measured for {goal} yet",
        "why": why,
    }


def _template_why(gap: dict[str, Any], kind: str, ingredient: str | None) -> str:
    goal = gap["goal"].lower()
    if kind == "few":
        return f"Already sold for {goal}, but too few people use it for Willow to measure it."
    return (
        f"Contains {ingredient}, an ingredient often used in {goal} products. It isn't sold "
        f"for {goal} here, and Willow hasn't measured it for {goal}."
    )


# Skin colour or lightness wording (docs/DESIGN.md principle 3): never in a reason.
LIGHTNESS = re.compile(r"\b(bright\w*|lighten\w*|whiten\w*|fair\w*|radian\w*|glow\w*)\b", re.I)
NOT_PROVEN = re.compile(
    r"\b(works?|working|effective|efficacy|proven|results?|guarantee\w*|will (help|improve|fade|"
    r"reduce)|reduces?|fades?|eliminat\w*|best)\b",
    re.I,
)


CAVEAT = (
    "Candidates are products already in the catalog that Willow hasn't measured for this goal. An "
    "ingredient match is a reason to look, not evidence that a product works; only measured "
    "outcomes become Proof."
)

_cache: dict[tuple, tuple[float, dict[str, Any]]] = {}
_lock = threading.Lock()
_inflight: dict[tuple, threading.Thread] = {}
CACHE_S = 6 * 3600
RETRY_S = 60
WAIT_S = 1.5  # how long a request waits for the agent before answering with the fixed list


KIND_WORDS = ("missing", "weak", "low_everywhere", "unmeasured", "thin")


def kind_of(g: dict[str, Any], tier: str | None) -> str:
    """The kind of gap a goal x tier is (`low_everywhere` for a whole goal), for the badge."""
    tiers = {t: g[t] for t, _, _ in cohort.TIERS}
    rates = {t: v["rate"] for t, v in tiers.items() if v["rate"] is not None}
    if tier is None:
        return "low_everywhere"
    v, best = tiers[tier], max(rates.values()) if rates else None
    if v["options"] == 0:
        return "missing"
    if v["rate"] is None:
        return "unmeasured"
    if best is not None and (best - v["rate"] >= BEHIND or v["rate"] < LOW_RATE):
        return "weak"
    return "thin" if v["options"] == 1 else "weak"


def rules_list(ins: dict[str, Any], rows: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """The fixed-logic list: ranked gaps, template briefs, table-matched candidates. Shown while the
    agent works and whenever Gemini can't be reached."""
    gaps = [] if ins.get("empty") else find_gaps(ins)
    items = []
    for g in gaps:
        title, text = brief(g)
        pool = pools(g, rows)
        cands = [_candidate(p, g, "few", None, _template_why(g, "few", None)) for p in pool["few"]]
        for p in pool["fit"]:
            ing = table_fit(p, g["goal_id"])[0]
            cands.append(_candidate(p, g, "fit", ing, _template_why(g, "fit", ing)))
        items.append(
            {
                **{k: g[k] for k in ("id", "goal_id", "goal", "tier", "kind", "demand", "options")},
                "tier_label": TIER_LABEL[g["tier"]] if g["tier"] else "every tier",
                "price": price_text(g["tier"]) if g["tier"] else None,
                "title": title,
                "brief": text,
                "candidates": cands[:MAX_CANDIDATES],
            }
        )
    return items


def _agent(key: tuple, ins: dict[str, Any], rows: dict, cohort_: str, range_: str) -> None:
    from app import buying_agent

    try:
        items, summary = buying_agent.run(ins, rows, cohort_, range_)
        out, ttl = {"items": items, "summary": summary, "source": "gemini"}, CACHE_S
    except Exception as exc:  # Gemini unreachable, or it added nothing usable
        log.info("buying list without Gemini: %s", exc)
        out, ttl = {"items": rules_list(ins, rows), "summary": None, "source": "rules"}, RETRY_S
    with _lock:
        _cache[key] = (time.time() + ttl, out)


def buying_list(cohort_: str = "mixed", range_: str = "all") -> dict[str, Any]:
    """The buying list. Gemini writes it as an agent (app/buying_agent.py) in the background,
    once per filter and data version; until it is ready the fixed-logic list is returned with
    `pending: true` and the page asks again. Raises when the rows are unavailable."""
    ins = retailer.insights(cohort_, range_)
    _, version = retailer._rows()
    key = (cohort_, range_, version)
    head = {"filters": ins.get("filters"), "cohort": ins.get("cohort"), "caveat": CAVEAT}
    with _lock:
        hit = _cache.get(key)
    if hit and time.time() < hit[0]:
        return head | hit[1] | {"pending": False}
    rows = {r["product_id"]: r for r in retail_intel.products(cohort_, range_)["products"]}
    if ins.get("empty"):
        return head | {"items": [], "summary": None, "source": "rules", "pending": False}
    with _lock:
        t = _inflight.get(key)
        if t is None or not t.is_alive():
            t = threading.Thread(target=_agent, args=(key, ins, rows, cohort_, range_), daemon=True)
            _inflight[key] = t
            t.start()
    t.join(WAIT_S)
    with _lock:
        hit = _cache.get(key)
    if hit and time.time() < hit[0]:
        return head | hit[1] | {"pending": False}
    return head | {
        "items": rules_list(ins, rows),
        "summary": None,
        "source": "rules",
        "pending": True,
    }
