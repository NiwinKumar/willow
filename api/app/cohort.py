"""Synthetic cohort for the retailer view (docs/RETAILER_INSIGHTS.md).

500 simulated people, every row `is_synthetic = true`, fixed seed. What is simulated, stated
plainly (the web's "About this data" panel repeats it):
- Goals: 1 to 3 concerns each; routine: 2 to 5 real catalog products that target those goals,
  plus a sunscreen for about 60% of people.
- Product effect: a per-product drift towards the desired direction on the metrics its concerns
  map to (CATALOG_SPEC), growing to full size by week 6, between 0.2 and 1.1 times the metric's
  MDC95; about 3 in 10 products have no effect. Effect sizes are invented: this demonstrates the
  dashboard, it is not evidence.
- Noise: each weekly reading adds noise with the per-metric spread from the contract fixture, and
  the verdict is real_change only when |delta| exceeds the metric's MDC95, as in the product.
- Skin-tone band has no effect on outcomes in the simulation; region neither.
- 15% drop out between weeks 2 and 7; about 25% stop a product between weeks 2 and 4.
"""

import hashlib
import math
import random
from datetime import UTC, datetime, timedelta
from typing import Any

from app import catalog, contract, routine_check

SEED = 7
USERS = 500
WEEKS = 8
REGIONS = [("IN", 0.35), ("US", 0.2), ("UK", 0.1), ("KR", 0.1), ("SEA", 0.15), ("GCC", 0.1)]
TONE_BANDS = ["very_light", "light", "intermediate", "tan", "brown", "dark"]
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
# Desired direction per metric (improvement): lower is better except where noted.
UP_IS_GOOD = {"glow", "dark_circles"}
# Price tiers in INR-equivalent (USD converted at a fixed 83 for tiering only).
TIERS = [("budget", 0, 700), ("mid", 700, 2000), ("premium", 2000, math.inf)]
START = datetime(2026, 8, 3, tzinfo=UTC)


def tier(price: dict[str, Any]) -> str:
    amount = price["amount"] * (83 if price["currency"] == "USD" else 1)
    return next(name for name, lo, hi in TIERS if lo <= amount < hi)


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


def generate() -> dict[str, list[dict[str, Any]]]:
    rng = random.Random(SEED)
    products = list(catalog.products())
    by_concern: dict[str, list[dict[str, Any]]] = {}
    for p in products:
        for c in p["concerns"]:
            by_concern.setdefault(c, []).append(p)
    sunscreens = [p for p in products if p["category"] == "sunscreen"]
    noise = _noise()
    effect: dict[str, float] = {}
    for p in products:  # weekly drift, in units of the metric's MDC95, at full size
        effect[p["product_id"]] = 0.0 if rng.random() < 0.3 else rng.uniform(0.2, 1.1)

    sessions, routine, conflicts = [], [], []
    concerns = [c for c in CONCERN_METRICS if c in by_concern]
    for i in range(USERS):
        uh = user_hash(i)
        region = rng.choices([r for r, _ in REGIONS], [w for _, w in REGIONS])[0]
        tone = rng.choice(TONE_BANDS)
        goals = rng.sample(concerns, rng.choice([1, 1, 2, 2, 3]))
        picks: dict[str, dict[str, Any]] = {}
        for g in goals:
            p = rng.choice(by_concern[g])
            picks[p["product_id"]] = p
        while len(picks) < rng.randint(2, 5):
            p = rng.choice(products)
            picks[p["product_id"]] = p
        if sunscreens and rng.random() < 0.6:
            s = rng.choice(sunscreens)
            picks[s["product_id"]] = s
        drop_week = rng.randint(2, 7) if rng.random() < 0.15 else None
        last_week = drop_week or WEEKS

        entries = []
        for p in picks.values():
            stopped = rng.randint(2, 4) if rng.random() < 0.25 else None
            slots = (
                ["am"]
                if p["category"] == "sunscreen"
                else rng.choice([["pm"], ["am"], ["am", "pm"]])
            )
            entries.append(
                {
                    "id": p["product_id"],
                    **p,
                    "custom_name": p["name"],
                    "slots": slots,
                    "ended_at": None,
                }
            )
            routine.append(
                {
                    "user_hash": uh,
                    "is_synthetic": True,
                    "product_id": p["product_id"],
                    "brand": p["brand"],
                    "category": p["category"],
                    "concerns": p["concerns"],
                    "tier": tier(p["price"]),
                    "started_week": 0,
                    "stopped_week": stopped,
                }
            )
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
        for k in sorted(kinds) or ["none"]:
            conflicts.append({"user_hash": uh, "is_synthetic": True, "kind": k})

        # Weekly face sessions: metric deltas = drift from the products targeting it + noise.
        for week in range(1, last_week + 1):
            ts = START + timedelta(weeks=week, hours=rng.randint(0, 48))
            for metric, (sd, mdc) in noise.items():
                drift = 0.0
                for p in picks.values():
                    stop = next(
                        r["stopped_week"]
                        for r in routine
                        if r["user_hash"] == uh and r["product_id"] == p["product_id"]
                    )
                    active_weeks = min(week, stop or week)
                    if any(metric in CONCERN_METRICS.get(c, []) for c in p["concerns"]):
                        drift += effect[p["product_id"]] * mdc * min(active_weeks, 6) / 6
                sign = 1 if metric in UP_IS_GOOD else -1
                delta = sign * drift + rng.gauss(0, sd * math.sqrt(2))
                sessions.append(
                    {
                        "user_hash": uh,
                        "is_synthetic": True,
                        "region": region,
                        "tone_band": tone,
                        "goals": goals,
                        "site": "face_full",
                        "session_ts": ts.isoformat(),
                        "weeks_since_baseline": week,
                        "metric_id": metric,
                        "delta": round(delta, 3),
                        "mdc95": round(mdc, 3),
                        "verdict": "real_change" if abs(delta) > mdc else "within_noise",
                        "improved": (delta > 0) == (metric in UP_IS_GOOD) and abs(delta) > mdc,
                    }
                )
    return {"sessions_flat": sessions, "routine_flat": routine, "routine_conflicts": conflicts}
