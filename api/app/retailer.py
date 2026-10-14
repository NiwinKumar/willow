"""Retailer insights (docs/RETAILER_INSIGHTS.md): BigQuery tables -> the aggregates the web shows.

Four small queries pull per-person facts from `willow_insights`; `aggregate()` (pure, tested)
turns them into the dashboard. Any group under 10 people is suppressed.

Outcome: at the week-8 reading, a metric the product (or goal) targets is still improved beyond
its noise band (MDC95, desired direction). One lucky reading earlier does not count: with 8
weekly readings, noise alone would cross the band about a third of the time. "Weeks to change"
is the start of the improved run that lasts to week 8. People who stopped before week 8 count
as "too early".
"""

import logging
import math
import statistics
import threading
import time
from collections import Counter, defaultdict
from typing import Any

from app import catalog, cohort
from app.settings import get_settings

MIN_GROUP = 10
WEEKS = 8
log = logging.getLogger("willow.retailer")

CACHE_SECONDS = 600
GOAL_LABEL = {
    "acne_blemishes": "Clearer skin",
    "dark_spots_pigmentation": "Fewer dark spots",
    "uneven_tone": "More even tone",
    "redness_sensitivity": "Calmer skin",
    "texture_pores": "Smoother texture & pores",
    "oiliness_shine": "Less shine",
    "fine_lines": "Softer fine lines",
    "dark_circles": "Brighter under-eyes",
    "dullness": "More glow",
    "dryness_barrier": "Less dryness",
}
# The goal a person picks in the app (web/src/lib/metrics.ts GOALS) that each catalog concern
# belongs to. The retailer view is finer: "Fewer dark spots" and "More even tone" are both part
# of the app's "Even tone & fewer dark spots". None: the app has no such goal (dryness is not
# measured).
APP_GOAL = {
    "acne_blemishes": "Clearer skin",
    "dark_spots_pigmentation": "Even tone & fewer dark spots",
    "uneven_tone": "Even tone & fewer dark spots",
    "redness_sensitivity": "Calmer skin",
    "texture_pores": "Smoother texture & pores",
    "oiliness_shine": "Oil control & glow",
    "fine_lines": "Softer lines",
    "dark_circles": "Under-eye",
    "dullness": "Oil control & glow",
    "dryness_barrier": None,
}
CONCERN_SHORT = {
    "acne_blemishes": "blemishes",
    "dark_spots_pigmentation": "dark spots",
    "uneven_tone": "uneven tone",
    "redness_sensitivity": "redness",
    "texture_pores": "texture",
    "oiliness_shine": "shine",
    "fine_lines": "fine lines",
    "dark_circles": "under-eye",
    "dullness": "dullness",
    "dryness_barrier": "dryness",
}
CONFLICT_COPY = {
    "retinoid_acid": ("Retinoid + AHA/BHA, same routine", "Alternate nights"),
    "no_spf": ("No morning sunscreen with a retinoid or acid", "Add daily SPF"),
    "two_exfoliants": ("Two or more exfoliants", "Reduce frequency"),
    "bpo_retinoid": ("Benzoyl peroxide + retinoid", "BPO in the morning, retinoid at night"),
    "bpo_vitamin_c": ("Benzoyl peroxide + L-ascorbic acid", "Separate morning and night"),
}

QUERIES = {
    "users": """SELECT user_hash, ANY_VALUE(is_synthetic) AS synthetic, ANY_VALUE(region) AS region,
        ANY_VALUE(tone_band) AS tone, ANY_VALUE(goals) AS goals,
        MAX(weeks_since_baseline) AS last_week
        FROM `{ds}.sessions_flat` GROUP BY user_hash""",
    "first": """SELECT user_hash, metric_id,
        ARRAY_AGG(weeks_since_baseline ORDER BY weeks_since_baseline) AS improved_weeks
        FROM `{ds}.sessions_flat` WHERE improved AND weeks_since_baseline <= {weeks}
        GROUP BY user_hash, metric_id""",
    "routine": """SELECT user_hash, product_id, brand, stopped_week FROM `{ds}.routine_flat`""",
    "conflicts": """SELECT user_hash, kind FROM `{ds}.routine_conflicts`""",
}


def fetch() -> dict[str, list[dict[str, Any]]]:
    from google.cloud import bigquery

    s = get_settings()
    client = bigquery.Client(project=s.project_id, location="us-central1")
    ds = f"{s.project_id}.{s.bq_dataset}"
    return {
        name: [dict(r) for r in client.query(sql.format(ds=ds, weeks=WEEKS)).result()]
        for name, sql in QUERIES.items()
    }


def raw_from_tables(tables: dict[str, list[dict[str, Any]]]) -> dict[str, list[dict[str, Any]]]:
    """The same four results computed in Python from cohort rows (tests, local checks)."""
    users: dict[str, dict[str, Any]] = {}
    improved: dict[tuple[str, str], list[int]] = defaultdict(list)
    for r in tables["sessions_flat"]:
        u = users.setdefault(
            r["user_hash"],
            {
                "user_hash": r["user_hash"],
                "synthetic": r["is_synthetic"],
                "region": r["region"],
                "tone": r["tone_band"],
                "goals": r["goals"],
                "last_week": 0,
            },
        )
        u["last_week"] = max(u["last_week"], r["weeks_since_baseline"])
        if r["improved"] and r["weeks_since_baseline"] <= WEEKS:
            improved[(r["user_hash"], r["metric_id"])].append(r["weeks_since_baseline"])
    return {
        "users": list(users.values()),
        "first": [
            {"user_hash": u, "metric_id": m, "improved_weeks": sorted(w)}
            for (u, m), w in improved.items()
        ],
        "routine": [
            {k: r[k] for k in ("user_hash", "product_id", "brand", "stopped_week")}
            for r in tables["routine_flat"]
        ],
        "conflicts": [
            {"user_hash": r["user_hash"], "kind": r["kind"]} for r in tables["routine_conflicts"]
        ],
    }


def _cell(rate: float | None, n: int) -> dict[str, Any]:
    if n < MIN_GROUP or rate is None:
        return {"value": None, "n": n, "suppressed": True}
    return {"value": round(rate, 2), "n": n, "suppressed": False}


def _wilson(k: int, n: int) -> tuple[float, float]:
    if n == 0:
        return 0.0, 0.0
    z, p = 1.96, k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return round(max(0.0, centre - half), 2), round(min(1.0, centre + half), 2)


def aggregate(raw: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    users = {u["user_hash"]: u for u in sorted(raw["users"], key=lambda u: u["user_hash"])}
    first: dict[str, dict[str, int]] = defaultdict(dict)
    for r in raw["first"]:
        weeks = set(r["improved_weeks"])
        if WEEKS in weeks:  # still improved at week 8; the run started at `start`
            start = WEEKS
            while start - 1 in weeks:
                start -= 1
            first[r["user_hash"]][r["metric_id"]] = start
    products = {p["product_id"]: p for p in catalog.products()}
    targets = {
        pid: sorted({m for c in p["concerns"] for m in cohort.CONCERN_METRICS.get(c, [])})
        for pid, p in products.items()
    }

    def outcome(uh: str, metrics: list[str]) -> int | None:
        weeks = [first[uh][m] for m in metrics if m in first[uh]]
        return min(weeks) if weeks else None

    def eligible(uh: str, metrics: list[str]) -> bool:  # reached the week-8 reading
        return users[uh]["last_week"] >= WEEKS

    synthetic = sum(1 for u in users.values() if u["synthetic"])
    active = sum(1 for u in users.values() if u["last_week"] >= WEEKS)
    goal_counts = Counter(sorted(g for u in users.values() for g in u["goals"]))

    # Needs by goal.
    needs, unmet_users, first_weeks = [], set(), []
    for goal, n in sorted(goal_counts.items(), key=lambda kv: (-kv[1], kv[0])):
        metrics = cohort.CONCERN_METRICS.get(goal, [])
        if not metrics or n < MIN_GROUP:
            continue
        members = [uh for uh, u in users.items() if goal in u["goals"]]
        real = [uh for uh in members if outcome(uh, metrics) is not None]
        none = [uh for uh in members if uh not in real and users[uh]["last_week"] >= WEEKS]
        unmet_users |= set(none)
        first_weeks += [outcome(uh, metrics) for uh in real]
        needs.append(
            {
                "goal": GOAL_LABEL[goal],
                "app_goal": APP_GOAL.get(goal),
                "n": n,
                "real": round(100 * len(real) / n),
                "none": round(100 * len(none) / n),
                "early": 100 - round(100 * len(real) / n) - round(100 * len(none) / n),
            }
        )

    # Products: per tone band, lift against people with the same goal not using it.
    users_of: dict[str, list[str]] = defaultdict(list)
    stopped: dict[tuple[str, str], int | None] = {}
    for r in sorted(raw["routine"], key=lambda r: (r["product_id"], r["user_hash"])):
        users_of[r["product_id"]].append(r["user_hash"])  # routine rows are sorted below
        stopped[(r["user_hash"], r["product_id"])] = r["stopped_week"]
    rows = []
    for pid, members in users_of.items():
        p, metrics = products.get(pid), targets.get(pid, [])
        if not p or not metrics:
            continue
        el = [uh for uh in members if eligible(uh, metrics)]
        if len(el) < MIN_GROUP:
            continue
        wins = [uh for uh in el if outcome(uh, metrics) is not None]
        same_goal = [
            uh
            for uh, u in users.items()
            if uh not in members and set(u["goals"]) & set(p["concerns"]) and eligible(uh, metrics)
        ]
        base = (
            sum(1 for uh in same_goal if outcome(uh, metrics) is not None) / len(same_goal)
            if len(same_goal) >= MIN_GROUP
            else None
        )
        cells = []
        for band in cohort.TONE_BANDS:
            in_band = [uh for uh in el if users[uh]["tone"] == band]
            k = sum(1 for uh in in_band if outcome(uh, metrics) is not None)
            cells.append(_cell(k / len(in_band) if in_band else None, len(in_band)))
        weeks = [outcome(uh, metrics) for uh in wins]
        kept = [uh for uh in members if (stopped[(uh, pid)] or 99) > 4]
        rows.append(
            {
                "product_id": pid,
                "product": p["name"],
                "brand": p["brand"],
                "concern": CONCERN_SHORT[p["concerns"][0]],
                "n": len(el),
                "cells": cells,
                "rate": round(len(wins) / len(el), 2),
                "lift": None if base is None else round(len(wins) / len(el) - base, 2),
                "weeks": statistics.median(weeks) if weeks else None,
                "cont": round(len(kept) / len(members), 2),
            }
        )
    rows.sort(key=lambda r: (-r["n"], r["brand"], r["product"]))

    # Brands.
    brand_users: dict[str, set[str]] = defaultdict(set)
    brand_wins: dict[str, set[str]] = defaultdict(set)
    brand_kept: dict[str, list[bool]] = defaultdict(list)
    for r in raw["routine"]:
        metrics = targets.get(r["product_id"], [])
        uh = r["user_hash"]
        if not metrics or not eligible(uh, metrics):
            continue
        brand_users[r["brand"]].add(uh)
        brand_kept[r["brand"]].append((r["stopped_week"] or 99) > 4)
        if outcome(uh, metrics) is not None:
            brand_wins[r["brand"]].add(uh)
    brands = []
    for b, us in brand_users.items():
        if len(us) < MIN_GROUP:
            continue
        lo, hi = _wilson(len(brand_wins[b]), len(us))
        brands.append(
            {
                "brand": b,
                "n": len(us),
                "rate": round(len(brand_wins[b]) / len(us), 2),
                "lo": lo,
                "hi": hi,
                "cont": round(sum(brand_kept[b]) / len(brand_kept[b]), 2),
            }
        )
    brands.sort(key=lambda b: (-b["rate"], b["brand"]))

    # Assortment gaps: options per price tier and their outcome rate.
    gaps = []
    for concern, metrics in cohort.CONCERN_METRICS.items():
        if not metrics:
            continue
        tiers: dict[str, dict[str, Any]] = {}
        for tier_name, _, _ in cohort.TIERS:
            ids = [
                pid
                for pid, p in products.items()
                if concern in p["concerns"] and cohort.tier(p["price"]) == tier_name
            ]
            el = {uh for pid in ids for uh in users_of.get(pid, []) if eligible(uh, metrics)}
            k = sum(1 for uh in el if outcome(uh, metrics) is not None)
            tiers[tier_name] = {
                "options": len(ids),
                "rate": round(k / len(el), 2) if len(el) >= MIN_GROUP else None,
            }
        missing = [t for t, v in tiers.items() if v["options"] == 0]
        rates = [v["rate"] for v in tiers.values() if v["rate"] is not None]
        thin = [t for t, v in tiers.items() if v["options"] == 1]
        action = (
            f"Add a {missing[0]} option for {CONCERN_SHORT[concern]}."
            if missing
            else "Outcome rates are low in every tier: an education opportunity."
            if rates and max(rates) < 0.35
            else f"Add a second {thin[0]} option for {CONCERN_SHORT[concern]}."
            if thin
            else "Covered in every tier."
        )
        gaps.append(
            {
                "goal": GOAL_LABEL[concern],
                "app_goal": APP_GOAL.get(concern),
                **tiers,
                "action": action,
            }
        )

    # Routine conflicts.
    kinds = Counter(r["kind"] for r in raw["conflicts"])
    n_users = len({r["user_hash"] for r in raw["conflicts"]}) or 1
    sunscreens = sorted(
        (p for p in products.values() if p["category"] == "sunscreen"),
        key=lambda p: p["price"]["amount"] * (83 if p["price"]["currency"] == "USD" else 1),
    )
    conflicts = [
        {
            "pair": CONFLICT_COPY[k][0],
            "share": round(kinds[k] / n_users, 2),
            "fix": CONFLICT_COPY[k][1],
            "resolves": [f"{p['brand']} {p['name']}" for p in sunscreens[:2]]
            if k == "no_spf"
            else [],
        }
        for k, _ in sorted(kinds.items(), key=lambda kv: (-kv[1], kv[0]))
        if k in CONFLICT_COPY and kinds[k] >= MIN_GROUP
    ]

    top_goal, top_n = (
        min(goal_counts.items(), key=lambda kv: (-kv[1], kv[0])) if goal_counts else ("", 0)
    )
    completed = [uh for uh, u in users.items() if u["last_week"] >= WEEKS]
    return {
        "cohort": {
            "synthetic": synthetic,
            "real": len(users) - synthetic,
            "weeks": WEEKS,
            "dropout": round(1 - active / len(users), 2) if users else 0,
            "seed": cohort.SEED,
        },
        "tiles": [
            {
                "label": "Active users",
                "value": str(active),
                "n": active,
                "sub": f"week {WEEKS}, after dropout",
            },
            {
                "label": "Top goal",
                "value": GOAL_LABEL.get(top_goal, top_goal),
                "n": top_n,
                "sub": f"{round(100 * top_n / len(users))}% of users" if users else "",
            },
            {
                "label": f"Unmet by week {WEEKS}",
                "value": f"{round(100 * len(unmet_users) / len(completed))}%" if completed else "–",
                "n": len(completed),
                "sub": "no real change in a goal metric",
            },
            {
                "label": "Median weeks to first real change",
                "value": f"{statistics.median(first_weeks):g}" if first_weeks else "–",
                "n": len(first_weeks),
                "sub": "among goals that got one",
            },
        ],
        "needs": needs[:6],
        "products": rows[:8],
        # Every product with enough people, for product cards and the advisor (labelled synthetic).
        "product_outcomes": {
            r["product_id"]: {
                "n": r["n"],
                "rate": r["rate"],
                "weeks": r["weeks"],
                "product": r["product"],
                "brand": r["brand"],
                "concern": r["concern"],
                "cont": r["cont"],
            }
            for r in rows
        },
        "tone_bands": ["very light", "light", "intermediate", "tan", "brown", "dark"],
        "brands": brands[:8],
        "gaps": gaps,
        "conflicts": conflicts,
    }


_cache: dict[str, Any] = {"at": 0.0, "data": None}
_cache_lock = threading.Lock()


def insights() -> dict[str, Any]:
    """Cached for CACHE_SECONDS; one query at a time; if BigQuery fails after expiry, the last
    good answer is served (and retried a minute later) instead of an error."""
    if _cache["data"] is not None and time.time() - _cache["at"] <= CACHE_SECONDS:
        return _cache["data"]
    with _cache_lock:
        if _cache["data"] is not None and time.time() - _cache["at"] <= CACHE_SECONDS:
            return _cache["data"]  # another request refreshed it while this one waited
        try:
            _cache["data"] = aggregate(fetch())
            _cache["at"] = time.time()
        except Exception:
            if _cache["data"] is None:
                raise
            log.warning("retailer insights refresh failed; serving the cached answer")
            _cache["at"] = time.time() - CACHE_SECONDS + 60
        return _cache["data"]
