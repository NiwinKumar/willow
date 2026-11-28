"""Synthetic cohort for the retailer view (docs/RETAILER_INSIGHTS.md).

USERS simulated people, every row `is_synthetic = true`, fixed seed. What is simulated, stated
plainly (the retailer page's "About this data" panel repeats it):
- People and products: USERS people (35,000) using the 1,500 best-known catalog products in
  api/seed/cohort_products.json (scripts/pick_cohort_products.py: the 48 products of the first
  cohort, every full product with a measured concern, then index products of famous brands by
  hero-product rank, balanced across categories and regions). Most products carry the
  concerns their own page claims (catalog `concerns_source`); the ~200 cohort products still
  without any are read from api/seed/cohort_concerns.json, inferred from the name and
  category (concerns_of). Tests run a small cohort (conftest: 2,000 people over the first 48
  products).
- Region: a mix for a Singapore-based retailer (REGIONS: a third in Southeast Asia, then India,
  Australia, Korea, Japan, Greater China, the US, UK, EU and the Gulf). Routines lean to products
  sold where the person lives: a product's pick weight is REGION_PULL by its distance from the
  person's region (app/regions.py: own region, then GLOBAL, then nearby regions), times a mild
  fame weight that falls from 1 for the best known product to about 0.6 for the 1,500th.
- Start: each person takes a baseline on a day in August, September or October 2026 (more in
  August), then a reading every week until today, unless they drop out. People whose first weekly
  reading is still in the future are not in the data yet.
- Goals: 1 to 3 of the app's 8 goals each. Which goals people pick shifts by month (an invented
  shift, there to demonstrate the month view: oil and blemishes lead in August, dark spots, even
  tone and redness grow into October). About 1 in 4 people with room for another goal add one
  between weeks 3 and 7, and a product for it.
- Routine: 2 to 5 real catalog products that target those goals, plus a sunscreen for about 60%
  of people. About 3 in 10 product uses stop at some week between 2 and 10.
- Switching: about half the time a product use stops, the person starts a different catalog
  product in the same category for the same goal (any product in the category when it has no
  other one for that goal) 0 to 2 weeks later (it has its own effect, and about 3 in 10 of these
  stop again 2 to 8 weeks after they start). Switchers lean strongly toward category products
  that work for others and are popular, and sold near them: the choice is weighted by
  ((1 + effect) * (1 + share of people already using it)) ** SWITCH_PULL * region weight.
- Product effect: a per-product drift towards the desired direction on the metrics its concerns
  map to (CATALOG_SPEC), growing to full size 6 weeks after the person starts it, between 0.2 and
  1.1 times the metric's MDC95; about 3 in 10 products have no effect. Effect sizes are invented:
  this demonstrates the dashboard, it is not evidence.
- Skin type changes the size of a product's effect (an invented assumption, there to demonstrate
  the skin-profile views): oil-control products (oil or blemish concerns, salicylic acid / BHA,
  zinc, clays, benzoyl peroxide) work better on oily and combination skin and less on dry;
  barrier and gentle hydrating products (dryness or redness concerns, ceramides, panthenol,
  centella, squalane) work better on dry and sensitive skin; strong retinoids and acids
  (retinol, retinal, glycolic acid, benzoyl peroxide, L-ascorbic acid, 1%+ salicylic acid) work
  less on sensitive skin; plus a small random spread per product and skin type (SKIN_EFFECT).
  Index products have no actives listed, so only their concerns count here.
- Noise: each weekly reading adds noise with the per-metric spread from the contract fixture, and
  the verdict is real_change only when |delta| exceeds the metric's MDC95, as in the product.
- Skin type (oily, combination, dry, normal, sensitive; a fixed mix), skin-tone band and region
  have no effect on which goals people pick; tone band and region have no effect on outcomes
  (region changes only which products people use).
- 15% drop out between weeks 2 and 7.
- Routine findings come from the app's own rule table (routine_check.rule_findings) on the
  products still in use: conflicts, a missing morning sunscreen, and duplicate actives.
"""

import hashlib
import json
import math
import random
from bisect import bisect
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from itertools import accumulate
from pathlib import Path
from typing import Any

from app import catalog, contract, regions, routine_check

SEED = 7
USERS = 35000
# How many of cohort_products.json the cohort uses (None: all). Tests set 48 (conftest).
PRODUCT_LIMIT: int | None = None
WEEKS = 8
# Where people live: a mix for a Singapore-based retailer (app/regions.py region codes).
REGIONS = [
    ("SEA", 0.34),
    ("IN", 0.12),
    ("AU", 0.10),
    ("KR", 0.08),
    ("JP", 0.07),
    ("CN", 0.07),
    ("US", 0.07),
    ("GCC", 0.06),
    ("UK", 0.05),
    ("EU", 0.04),
]
# Pick weight of a product by its distance from the person's region (regions.RANK: 0 own
# region, 1 GLOBAL, then nearer to farther; FAR = no known region). Invented assumption.
REGION_PULL = {0: 3.0, 1: 2.2, 2: 1.4, 3: 1.2, 4: 1.0}
REGION_FAR = 0.8
TONE_BANDS = ["very_light", "light", "intermediate", "tan", "brown", "dark"]
# The profile's skin types (users/{uid}.profile.skin_type); a fixed mix. Skin type changes the
# size of a product's effect (skin_effect), nothing else.
SKIN_TYPES = ["oily", "combination", "dry", "normal", "sensitive"]
SKIN_MIX = [0.22, 0.32, 0.18, 0.16, 0.12]
# Invented demonstration assumption: effect multipliers per skin type for three product traits.
SKIN_EFFECT = {
    "oil_control": {"oily": 1.35, "combination": 1.2, "dry": 0.8, "sensitive": 0.9},
    "barrier": {"dry": 1.35, "sensitive": 1.3, "oily": 0.85},
    "strong": {"sensitive": 0.55, "dry": 0.85},
}
SKIN_SPREAD = (0.85, 1.15)  # random spread per product x skin type
# Weekly drift of an effective product at full size, in units of the metric's MDC95 (invented).
EFFECT_RANGE = (0.45, 1.2)
# How much of that a product's category can plausibly move skin (finals, Nov 28: a rinse-off
# cleanser showed +54 points over people not using it, which no reviewer believes). Leave-on
# actives keep the full size; a cleanser is on the skin for a minute; sunscreen protects more than
# it changes. Applied after the draw, so every random stream and person stays what it was.
CATEGORY_EFFECT = {
    "serum": 1.0,
    "treatment": 1.0,
    "exfoliant": 0.9,
    "eye_care": 0.7,
    "moisturizer": 0.55,
    "mask": 0.45,
    "toner": 0.4,
    "sunscreen": 0.35,
    "cleanser": 0.2,
}
SWITCH_SHARE = 0.5  # of stopped product uses, the share followed by another product
# How strongly switchers lean toward category products that work for others and are popular
# (an invented assumption): weight = ((1 + effect) * (1 + share already using it)) ** PULL.
# Strong on purpose: with about 15 switches per stopped product, a weaker pull spreads them
# below the 10-person threshold of the switching views.
SWITCH_PULL = 16
CONCERN_METRICS = {
    "acne_blemishes": ["blemishes", "redness"],
    "dark_spots_pigmentation": ["pigment_spots"],
    "uneven_tone": ["tone_evenness"],
    "redness_sensitivity": ["redness"],
    "texture_pores": ["pores", "texture"],
    "oiliness_shine": ["shine"],
    "fine_lines": ["lines"],
    "dark_circles": ["dark_circles"],
    "dryness_barrier": [],
    "dullness": ["glow"],
}
# The app's 8 goals (users/{uid}.profile.goals) and the metrics each one is measured by.
GOALS = [
    "dark_spots",
    "even_tone",
    "redness",
    "blemishes",
    "pores_texture",
    "lines",
    "under_eye",
    "oil_glow",
]
GOAL_METRICS = {
    "dark_spots": ["pigment_spots"],
    "even_tone": ["tone_evenness"],
    "redness": ["redness"],
    "blemishes": ["blemishes"],
    "pores_texture": ["pores", "texture"],
    "lines": ["lines"],
    "under_eye": ["dark_circles"],
    "oil_glow": ["shine", "glow"],
}
# Catalog concern -> goal; dryness_barrier has none (dryness is not measured).
CONCERN_GOAL = {
    "dark_spots_pigmentation": "dark_spots",
    "uneven_tone": "even_tone",
    "redness_sensitivity": "redness",
    "acne_blemishes": "blemishes",
    "texture_pores": "pores_texture",
    "fine_lines": "lines",
    "dark_circles": "under_eye",
    "oiliness_shine": "oil_glow",
    "dullness": "oil_glow",
    "dryness_barrier": None,
}
# Goal ids the web used before the 8 goals (still on some devices): old id -> new ids.
LEGACY_GOALS = {
    "even_tone": ["dark_spots", "even_tone"],
    "clearer": ["blemishes"],
    "calmer": ["redness"],
    "smoother": ["pores_texture"],
    "softer_lines": ["lines"],
    "under_eye": ["under_eye"],
    "oil_glow": ["oil_glow"],
}
# Invented demand shift by month (relative weights per goal, in GOALS order).
MONTH_WEIGHTS = {
    8: [0.6, 0.8, 0.55, 1.5, 1.1, 0.5, 0.6, 1.8],
    9: [1.3, 1.0, 0.9, 1.1, 1.0, 0.55, 0.65, 1.0],
    10: [2.4, 1.4, 1.4, 0.8, 0.9, 0.6, 0.7, 0.5],
}
START_MONTHS = [(8, 0.45), (9, 0.33), (10, 0.22)]
YEAR = 2026
# Desired direction per metric (improvement): lower is better except where noted.
UP_IS_GOOD = {"glow", "dark_circles"}
# Price tiers in INR-equivalent (USD converted at a fixed 83 for tiering only).
TIERS = [("budget", 0, 700), ("mid", 700, 2000), ("premium", 2000, math.inf)]


def tier(price: dict[str, Any] | None) -> str | None:
    """budget, mid or premium; None for a product with no checked price (an index product)."""
    if not price:
        return None
    amount = price["amount"] * (83 if price["currency"] == "USD" else 1)
    return next(name for name, lo, hi in TIERS if lo <= amount < hi)


def goals_of(ids: list[str] | None) -> list[str]:
    """Any goal list (8 goal ids, legacy app ids or catalog concerns) as the 8 goal ids."""
    out: list[str] = []
    for g in ids or []:
        # A current id wins ("even_tone", "under_eye", "oil_glow" are also old ids).
        new = (
            [g]
            if g in GOAL_METRICS
            else LEGACY_GOALS.get(g) or ([CONCERN_GOAL[g]] if CONCERN_GOAL.get(g) else [])
        )
        out += [x for x in new if x not in out]
    return out


COHORT_CONCERNS = Path(__file__).resolve().parent.parent / "seed" / "cohort_concerns.json"


@lru_cache
def _inferred() -> dict[str, list[str]]:
    return json.loads(COHORT_CONCERNS.read_text()) if COHORT_CONCERNS.exists() else {}


def concerns_of(p: dict[str, Any]) -> list[str]:
    """What Proof measures a product on: its catalog concerns, or for a product with none (an
    index product of the cohort) the concerns inferred from its name (cohort_concerns.json)."""
    return p["concerns"] or _inferred().get(p["product_id"], [])


def product_goals(p: dict[str, Any]) -> list[str]:
    return sorted({CONCERN_GOAL[c] for c in concerns_of(p) if CONCERN_GOAL.get(c)})


def product_metrics(p: dict[str, Any]) -> list[str]:
    """The metrics a product's concerns map to (empty: nothing Willow measures)."""
    return sorted({m for c in concerns_of(p) for m in CONCERN_METRICS.get(c, [])})


_OIL_ACTIVES = ("salicyl", "zinc", "kaolin", "bentonite", "benzoyl peroxide")
_BARRIER_ACTIVES = ("ceramide", "panthenol", "madecassoside", "centella", "cica", "squalane")
_STRONG_ACTIVES = ("retinol", "retinal", "glycolic acid", "benzoyl peroxide")


def product_traits(p: dict[str, Any]) -> list[str]:
    """Which SKIN_EFFECT traits a catalog product has, from its concerns and key actives."""
    actives = [(a["name"].lower(), a.get("pct")) for a in p["key_actives"]]
    concerns = set(concerns_of(p))

    def has(words: tuple[str, ...]) -> bool:
        return any(w in name for name, _ in actives for w in words)

    strong = has(_STRONG_ACTIVES) or any(
        (name == "ascorbic acid" and (pct or 0) >= 10)  # L-ascorbic acid, not its derivatives
        or (name.startswith("salicylic acid") and (pct or 0) >= 1)
        for name, pct in actives
    )
    out = []
    if concerns & {"oiliness_shine", "acne_blemishes"} or has(_OIL_ACTIVES):
        out.append("oil_control")
    if concerns & {"dryness_barrier", "redness_sensitivity"} or has(_BARRIER_ACTIVES):
        out.append("barrier")
    if strong:
        out.append("strong")
    return out


def skin_effect(p: dict[str, Any]) -> dict[str, float]:
    """The product's effect multiplier per skin type before the random spread."""
    out = dict.fromkeys(SKIN_TYPES, 1.0)
    for t in product_traits(p):
        for skin, k in SKIN_EFFECT[t].items():
            out[skin] *= k
    return out


def _noise() -> dict[str, tuple[float, float]]:
    """(reading SD, MDC95) per metric from the contract fixture, plus pores and texture."""
    fixture = {m["id"]: m for m in contract.load("analysis_result.sample.json")["metrics"]}
    out = {}
    for mid, m in fixture.items():
        sd = m.get("within_session_sd") or 0.1
        out[mid] = (sd, m.get("mdc95") or 2.77 * sd)
    out.setdefault("pores", (1.1, 3.05))
    out.setdefault("texture", (0.02, 0.06))
    return out


def user_hash(i: int) -> str:
    return "syn_" + hashlib.sha256(f"willow-synthetic-{SEED}-{i}".encode()).hexdigest()[:12]


def _days_in(month: int) -> int:
    nxt = date(YEAR + (month == 12), month % 12 + 1, 1)
    return (nxt - date(YEAR, month, 1)).days


def _month_key(ts: datetime) -> str:
    return f"{ts.year:04d}-{ts.month:02d}"


def finding_kinds(entries: list[dict[str, Any]]) -> list[str]:
    """A routine's rule-table findings (routine_check.rule_findings) as the kinds the retailer
    view counts; ["none"] when the routine is clear."""
    found = routine_check.rule_findings(entries)
    kinds = set()
    for c in found["conflicts"]:
        issue = c["issue"].lower()
        kinds.add(
            "retinoid_acid"
            if "retinoid and an exfoliating" in issue
            else "bpo_retinoid"
            if "benzoyl peroxide and a retinoid" in issue
            else "bpo_vitamin_c"
            if "oxidise" in issue
            else "two_exfoliants"
            if "exfoliating products" in issue
            else "other"
        )
    if found["gaps"]:
        kinds.add("no_spf")
    if found["duplicates"]:
        kinds.add("duplicate_active")
    return sorted(kinds) or ["none"]


# Self-reported feel (app/feel.py): about 6 in 10 answer once a product has had two weeks. A
# visible change by then makes "working" likelier, but people also feel products that photos do
# not show, and miss changes that photos do. Drawn from each person's own stream, so no other
# synthetic number moves.
FEEL_ANSWER = 0.6
FEEL_WORKING = {"measured": 0.68, "later": 0.42, "none": 0.24}
_TINGLE = ("acid", "ascorb", "retin", "peroxide")  # actives people often feel tingle
_GOOD_TAGS = {
    "moisturizer": ["softer", "absorbs", "feels_nice"],
    "sunscreen": ["absorbs", "feels_nice"],
    "serum": ["looks_better", "absorbs", "feels_nice"],
    "treatment": ["looks_better", "feels_nice"],
    "cleanser": ["feels_nice", "softer"],
}


def synthetic_feel(
    uh: str,
    p: dict[str, Any],
    started: int,
    stopped: int | None,
    last_week: int,
    improved_at: dict[str, int],
) -> dict[str, Any]:
    """One synthetic person's latest answer on one product: {feel, feel_week, feel_tags}."""
    none: dict[str, Any] = {"feel": None, "feel_week": None, "feel_tags": []}
    r = random.Random(f"{SEED}:feel:{uh}:{p['product_id']}")
    end = stopped if stopped is not None else last_week
    if end - started < 2 or r.random() >= FEEL_ANSWER:
        return none
    week = min(end, started + r.randint(2, 8))
    targets = set(product_metrics(p))
    seen = [w for m, w in improved_at.items() if m in targets and w > started]
    state = "measured" if any(w <= week for w in seen) else "later" if seen else "none"
    traits = product_traits(p)
    if r.random() < FEEL_WORKING[state] * (0.6 if stopped is not None else 1.0):
        verdict = "working"
        pool = _GOOD_TAGS.get(p["category"], ["feels_nice", "looks_better"])
        tags = r.sample(pool, k=min(len(pool), r.choice([0, 1, 1, 2])))
    else:
        early = week - started < 4 and stopped is None
        verdict = "unsure" if r.random() < (0.7 if early else 0.4) else "not_for_me"
        acids = any(w in a["name"].lower() for a in p["key_actives"] for w in _TINGLE)
        bad = (
            (["stings"] if "strong" in traits or acids else [])
            + (["drying"] if "oil_control" in traits else [])
            + (["heavy"] if p["category"] in ("moisturizer", "sunscreen") else [])
        )
        k = r.choice([0, 1, 1, 2]) if verdict == "not_for_me" else r.choice([0, 0, 1])
        tags = r.sample(bad, k=min(len(bad), k))
        if verdict == "not_for_me" and r.random() < 0.12:
            tags.append("breakouts")
    return {"feel": verdict, "feel_week": week - started, "feel_tags": tags}


# The products the synthetic cohort uses (scripts/pick_cohort_products.py), best known first; the
# first 48 are the cohort's products of Oct 15. Other catalog products get no synthetic people: the
# same simulated people, routines and readings on every run, and those products show only real
# data.
COHORT_PRODUCTS = Path(__file__).resolve().parent.parent / "seed" / "cohort_products.json"


def cohort_product_ids() -> list[str]:
    return json.loads(COHORT_PRODUCTS.read_text())[:PRODUCT_LIMIT]


def cohort_products() -> list[dict[str, Any]]:
    by_id = {p["product_id"]: p for p in catalog.products()}
    return [by_id[i] for i in cohort_product_ids() if i in by_id]


def _region_weight(p: dict[str, Any], region: str) -> float:
    rank = regions.RANK[region]
    near = min((rank[r] for r in regions.regions(p) if r in rank), default=regions.FAR)
    return REGION_PULL.get(near, REGION_FAR)


def _fame(i: int) -> float:
    """A mild pick weight by position in cohort_products.json (best known first)."""
    return 0.7 + 0.3 * math.exp(-i / 700)


def generate(
    today: date | datetime | None = None,
    *,
    switching: bool = True,
    skin_effects: bool = True,
) -> dict[str, list[dict[str, Any]]]:
    """Every table for `today` (default: now). The random draws do not depend on `today`: the
    same people exist on every run, and a later `today` only reveals more of their weeks.
    `switching=False, skin_effects=False` gives the cohort without those two assumptions, draw
    for draw (a test holds the rest to that)."""
    now = (
        datetime.now(UTC)
        if today is None
        else today
        if isinstance(today, datetime)
        else datetime(today.year, today.month, today.day, 23, 59, tzinfo=UTC)
    )
    rng = random.Random(SEED)
    products = cohort_products()
    pid_of = [p["product_id"] for p in products]
    targets = {p["product_id"]: set(product_metrics(p)) for p in products}
    pgoals = {p["product_id"]: product_goals(p) for p in products}
    fame = {p["product_id"]: _fame(i) for i, p in enumerate(products)}
    region_w = {
        r: {p["product_id"]: _region_weight(p, r) * fame[p["product_id"]] for p in products}
        for r, _ in REGIONS
    }
    by_goal: dict[str, list[dict[str, Any]]] = {}
    for p in products:
        for g in pgoals[p["product_id"]]:
            by_goal.setdefault(g, []).append(p)
    sunscreens = [p for p in products if p["category"] == "sunscreen"]
    by_cat: dict[str, list[dict[str, Any]]] = {}
    for p in products:
        by_cat.setdefault(p["category"], []).append(p)

    # One cumulative weight list per (region, pool): a weighted draw is one rng.random() and a
    # bisect, whatever the pool size.
    def cum(pool: list[dict[str, Any]], region: str) -> list[float]:
        return list(accumulate(region_w[region][q["product_id"]] for q in pool))

    pools = {"*": products, "sun": sunscreens, **by_goal}
    cums = {(r, k): cum(pool, r) for r, _ in REGIONS for k, pool in pools.items()}

    def draw(key: str, region: str) -> dict[str, Any]:
        cw = cums[(region, key)]
        return pools[key][bisect(cw, rng.random() * cw[-1])]

    noise = _noise()
    effect: dict[str, float] = {}
    for p in products:  # weekly drift, in units of the metric's MDC95, at full size
        drawn = 0.0 if rng.random() < 0.3 else rng.uniform(*EFFECT_RANGE)
        effect[p["product_id"]] = drawn * CATEGORY_EFFECT.get(p["category"], 0.6)
    goals_pool = [g for g in GOALS if g in by_goal]
    # New draws come from their own streams (SEED + n), so every draw above and in the loop below
    # stays what it is without switching and skin effects: the same people, goals, routines,
    # stops and noise.
    skin_rng = random.Random(SEED + 1)
    skin_mod = {
        (p["product_id"], s): (k * skin_rng.uniform(*SKIN_SPREAD)) if skin_effects else 1.0
        for p in products
        for s, k in skin_effect(p).items()
    }
    switch_rng = random.Random(SEED + 2)
    using: dict[str, int] = dict.fromkeys(effect, 0)  # people so far with it in their routine
    seen = 0
    pull = {pid: (1 + effect[pid]) ** SWITCH_PULL for pid in pid_of}

    def pick_goal(month: int, taken: list[str]) -> str:
        weights = MONTH_WEIGHTS[min(max(month, 8), 10)]
        free = [g for g in goals_pool if g not in taken]
        return rng.choices(free, [weights[GOALS.index(g)] for g in free])[0]

    sessions, routine, conflicts, users, monthly = [], [], [], [], []
    for i in range(USERS):
        uh = user_hash(i)
        mine = len(routine)  # this person's routine rows start here
        month = rng.choices([m for m, _ in START_MONTHS], [w for _, w in START_MONTHS])[0]
        start = datetime(YEAR, month, rng.randint(1, _days_in(month)), 8, tzinfo=UTC)
        region = rng.choices([r for r, _ in REGIONS], [w for _, w in REGIONS])[0]
        tone = rng.choice(TONE_BANDS)
        skin = rng.choices(SKIN_TYPES, SKIN_MIX)[0]
        goals: list[str] = []
        for _ in range(rng.choice([1, 1, 2, 2, 3])):
            goals.append(pick_goal(month, goals))
        # One product per goal, then extras, then sunscreen; product_id -> (product, started_week)
        picks: dict[str, tuple[dict[str, Any], int]] = {}
        for g in goals:
            p = draw(g, region)
            picks[p["product_id"]] = (p, 0)
        while len(picks) < rng.randint(2, 5):
            p = draw("*", region)
            picks.setdefault(p["product_id"], (p, 0))
        if sunscreens and rng.random() < 0.6:
            s = draw("sun", region)
            picks.setdefault(s["product_id"], (s, 0))
        # Goal adoption: one more goal (and a product for it) between weeks 3 and 7.
        added_week, added_goal = None, None
        if len(goals) < 3 and rng.random() < 0.25:
            added_week = rng.randint(3, 7)
            added_goal = pick_goal((start + timedelta(weeks=added_week)).month, goals)
            p = draw(added_goal, region)
            picks.setdefault(p["product_id"], (p, added_week))
        drop_week = rng.randint(2, 7) if rng.random() < 0.15 else None
        stop_draw = {pid: (rng.randint(2, 10) if rng.random() < 0.3 else None) for pid in picks}
        hours = [rng.randint(0, 48) for _ in range(20)]
        slot_draw = {pid: rng.choice([["pm"], ["am"], ["am", "pm"]]) for pid in picks}
        deltas = {
            (w, m): rng.gauss(0, sd * math.sqrt(2))
            for w in range(1, 21)
            for m, (sd, _) in noise.items()
        }
        # Switching: for every stop draw (whether or not it has happened by `today`), the same
        # six draws; about half the time another product in the same category, for the same
        # goal, starts 0-2 weeks after the stop. product_id -> (product, started, stop, slots)
        all_goals = goals + ([added_goal] if added_goal else [])
        swaps: dict[str, tuple[dict[str, Any], int, int | None, list[str]]] = {}
        for pid, w in stop_draw.items():
            if w is None:
                continue
            go = switch_rng.random() < SWITCH_SHARE
            lag = switch_rng.randint(0, 2)
            which = switch_rng.random()
            stops_too = switch_rng.random() < 0.3
            stop_after = switch_rng.randint(2, 8)
            slots_q = switch_rng.choice([["pm"], ["am"], ["am", "pm"]])
            p, started = picks[pid]
            if not switching or not go or w <= started:
                continue
            want = set(pgoals[pid]) & set(all_goals) or set(pgoals[pid])
            free = [
                q
                for q in by_cat[p["category"]]
                if q["product_id"] not in picks and q["product_id"] not in swaps
            ]
            # same goal; when the category has no other product for it, any
            options = [q for q in free if want & set(pgoals[q["product_id"]])] or free
            if options:
                # Switchers lean toward category products that work for others, are popular and
                # sold near them: weight = ((1 + effect) * (1 + share of people already using
                # it)) ** SWITCH_PULL * region weight, picked with the `which` draw (so the
                # number of draws stays fixed).
                share = 1 / max(seen, 1)
                weights = [
                    pull[o["product_id"]]
                    * (1 + using[o["product_id"]] * share) ** SWITCH_PULL
                    * region_w[region][o["product_id"]]
                    for o in options
                ]
                mark, q = which * sum(weights), options[-1]
                for o, wt in zip(options, weights, strict=True):
                    if mark < wt:
                        q = o
                        break
                    mark -= wt
                begin = w + lag
                stop = begin + stop_after if stops_too else None
                swaps[q["product_id"]] = (q, begin, stop, slots_q)
        # Popularity for later switchers: everyone generated so far, whatever `today` is.
        seen += 1
        for pid in picks:
            using[pid] += 1

        # Everything above is drawn whatever `today` is; below, only what has happened by now.
        weeks = [
            w
            for w in range(1, 21)
            if start + timedelta(weeks=w, hours=hours[w - 1]) <= now
            and (drop_week is None or w <= drop_week)
        ]
        if not weeks:
            continue  # first weekly reading not taken yet: not in the data
        last_week = weeks[-1]

        def happened(week: int | None, last_week: int = last_week) -> bool:
            return week is not None and week <= last_week

        stopped = {
            pid: (w if happened(w) and w > picks[pid][1] else None) for pid, w in stop_draw.items()
        }
        live = {pid: v for pid, v in picks.items() if v[1] <= last_week}
        for qid, (q, begin, stop, slots_q) in swaps.items():
            if begin <= last_week:
                live[qid] = (q, begin)
                stopped[qid] = stop if happened(stop) else None
                slot_draw[qid] = slots_q
        entries = []
        for pid, (p, started) in live.items():
            slots = ["am"] if p["category"] == "sunscreen" else slot_draw[pid]
            entries.append(
                {
                    "id": pid,
                    **p,
                    "custom_name": p["name"],
                    "slots": slots,
                    "ended_at": "stopped" if stopped[pid] else None,
                }
            )
            routine.append(
                {
                    "user_hash": uh,
                    "is_synthetic": True,
                    "product_id": pid,
                    "brand": p["brand"],
                    "category": p["category"],
                    "concerns": concerns_of(p),
                    "tier": tier(p["price"]),
                    "started_week": started,
                    "stopped_week": stopped[pid],
                }
            )
        for k in finding_kinds(entries):
            conflicts.append({"user_hash": uh, "is_synthetic": True, "kind": k})

        # Per product: (started, stopped or None, effect size at full size, metrics it targets)
        drivers = [
            (started, stopped[pid], effect[pid] * skin_mod[(pid, skin)], targets[pid])
            for pid, (_, started) in live.items()
        ]
        # Weekly face sessions: metric deltas = drift from the products targeting it + noise.
        months: dict[str, dict[str, Any]] = {}
        first_ts = last_ts = None
        improved_at: dict[str, int] = {}  # metric -> first week it improved
        for week in weeks:
            ts = start + timedelta(weeks=week, hours=hours[week - 1])
            now_goals = goals + ([added_goal] if added_week and week >= added_week else [])
            stamp = ts.isoformat()
            for metric, (_, mdc) in noise.items():
                drift = 0.0
                for started, stop, size, aims in drivers:
                    if week <= started or metric not in aims:
                        continue
                    active_weeks = max(0, min(week, stop or week) - started)
                    drift += size * mdc * min(active_weeks, 6) / 6
                sign = 1 if metric in UP_IS_GOOD else -1
                delta = sign * drift + deltas[(week, metric)]
                improved = (delta > 0) == (metric in UP_IS_GOOD) and abs(delta) > mdc
                if improved:
                    improved_at.setdefault(metric, week)
                sessions.append(
                    {
                        "user_hash": uh,
                        "is_synthetic": True,
                        "region": region,
                        "tone_band": tone,
                        "skin_type": skin,
                        "goals": now_goals,
                        "site": "face_full",
                        "session_ts": stamp,
                        "weeks_since_baseline": week,
                        "metric_id": metric,
                        "delta": round(delta, 3),
                        "mdc95": round(mdc, 3),
                        "verdict": "real_change" if abs(delta) > mdc else "within_noise",
                        "improved": improved,
                    }
                )
            m = months.setdefault(_month_key(ts), {"goals": [], "last_ts": ts})
            m["goals"] = sorted(set(m["goals"]) | set(now_goals))
            m["last_ts"] = ts
            first_ts = first_ts or ts
            last_ts = ts
        for row in routine[mine:]:
            row.update(
                synthetic_feel(
                    uh,
                    live[row["product_id"]][0],
                    row["started_week"],
                    row["stopped_week"],
                    last_week,
                    improved_at,
                )
            )
        users.append(
            {
                "user_hash": uh,
                "is_synthetic": True,
                "region": region,
                "tone_band": tone,
                "skin_type": skin,
                "goals": goals + ([added_goal] if added_week and last_week >= added_week else []),
                "started_at": start.isoformat(),
                "first_ts": first_ts.isoformat(),
                "last_ts": last_ts.isoformat(),
                "last_week": last_week,
            }
        )
        for key, m in sorted(months.items()):
            monthly.append(
                {
                    "user_hash": uh,
                    "is_synthetic": True,
                    "month": key,
                    "last_ts": m["last_ts"].isoformat(),
                    "goals": m["goals"],
                }
            )
    return {
        "sessions_flat": sessions,
        "routine_flat": routine,
        "routine_conflicts": conflicts,
        "users_flat": users,
        "goals_monthly": monthly,
    }
