"""Retailer insights (docs/RETAILER_INSIGHTS.md): BigQuery tables -> the aggregates the web shows.

Five small queries pull per-person facts from `willow_insights`; `select()` keeps the people a
filter asks for (cohort: simulated / mixed / real; range: people with a reading in the last 30 or
90 days, or all) and `aggregate()` (pure, tested) turns them into the dashboard. Any group under
10 people is suppressed here, in the data layer: the web, exports and the Ask answers only ever
see what survives.

Outcome: at the week-8 reading, a metric the product (or goal) targets is still improved beyond
its noise band (MDC95, desired direction). One lucky reading earlier does not count: with 8
weekly readings, noise alone would cross the band about a third of the time. "Weeks to change"
is the start of the improved run that lasts to week 8. People who have not reached week 8 (they
started recently or stopped early) count as "too early".
"""

import logging
import math
import statistics
import threading
import time
from collections import Counter, defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from app import catalog, cohort
from app.settings import get_settings

MIN_GROUP = 10
WEEKS = 8
FLOW_WEEKS = [2, 4, 8]
log = logging.getLogger("willow.retailer")

CACHE_SECONDS = 600
Cohort = Literal["simulated", "mixed", "real"]
Range = Literal["30d", "90d", "all"]
RANGE_DAYS: dict[str, int | None] = {"30d": 30, "90d": 90, "all": None}

# The app's 8 goals (users/{uid}.profile.goals), labelled as in web/src/lib/metrics.ts GOALS.
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
CATEGORY_LABEL = {
    "serum": "Serums",
    "sunscreen": "Sunscreens",
    "treatment": "Treatments",
    "cleanser": "Cleansers",
    "moisturizer": "Moisturisers",
    "toner": "Toners",
    "exfoliant": "Exfoliants",
    "eye_care": "Eye care",
    "mask": "Masks",
}
SKIN_LABEL = {
    "oily": "Oily",
    "combination": "Combination",
    "dry": "Dry",
    "normal": "Normal",
    "sensitive": "Sensitive",
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
    "duplicate_active": ("Duplicate active", "Keep one product per active"),
    "two_exfoliants": ("Two or more exfoliants", "Reduce frequency"),
    "bpo_retinoid": ("Benzoyl peroxide + retinoid", "BPO in the morning, retinoid at night"),
    "bpo_vitamin_c": ("Benzoyl peroxide + L-ascorbic acid", "Separate morning and night"),
}

QUERIES = {
    "users": """SELECT user_hash, is_synthetic AS synthetic, region, tone_band AS tone,
        skin_type, goals, last_week, started_at, last_ts FROM `{ds}.users_flat`""",
    "months": """SELECT user_hash, month, last_ts, goals FROM `{ds}.goals_monthly`""",
    "first": """SELECT user_hash, metric_id,
        ARRAY_AGG(weeks_since_baseline ORDER BY weeks_since_baseline) AS improved_weeks
        FROM `{ds}.sessions_flat` WHERE improved AND weeks_since_baseline <= {weeks}
        GROUP BY user_hash, metric_id""",
    "routine": """SELECT user_hash, product_id, brand, category, started_week, stopped_week,
        feel, feel_week, feel_tags FROM `{ds}.routine_flat`""",
    "conflicts": """SELECT user_hash, kind FROM `{ds}.routine_conflicts`""",
}


def fetch() -> dict[str, list[dict[str, Any]]]:
    from google.cloud import bigquery

    s = get_settings()
    client = bigquery.Client(project=s.project_id, location="us-central1")
    ds = f"{s.project_id}.{s.bq_dataset}"
    return {
        name: [dict(r) for r in client.query(sql.format(ds=ds, weeks=WEEKS)).result(timeout=30)]
        for name, sql in QUERIES.items()
    }


def raw_from_tables(tables: dict[str, list[dict[str, Any]]]) -> dict[str, list[dict[str, Any]]]:
    """The same five results computed in Python from the exported tables (tests, local checks)."""
    improved: dict[tuple[str, str], list[int]] = defaultdict(list)
    for r in tables["sessions_flat"]:
        if r["improved"] and r["weeks_since_baseline"] <= WEEKS:
            improved[(r["user_hash"], r["metric_id"])].append(r["weeks_since_baseline"])
    return {
        "users": [
            {
                "user_hash": u["user_hash"],
                "synthetic": u["is_synthetic"],
                "region": u["region"],
                "tone": u["tone_band"],
                "skin_type": u.get("skin_type"),
                "goals": u["goals"],
                "last_week": u["last_week"],
                "started_at": u.get("started_at"),
                "last_ts": u.get("last_ts"),
            }
            for u in tables["users_flat"]
        ],
        "months": [
            {k: r[k] for k in ("user_hash", "month", "last_ts", "goals")}
            for r in tables.get("goals_monthly", [])
        ],
        "first": [
            {"user_hash": u, "metric_id": m, "improved_weeks": sorted(w)}
            for (u, m), w in improved.items()
        ],
        "routine": [
            {
                k: r.get(k)
                for k in (
                    "user_hash",
                    "product_id",
                    "brand",
                    "category",
                    "started_week",
                    "stopped_week",
                    "feel",
                    "feel_week",
                    "feel_tags",
                )
            }
            for r in tables["routine_flat"]
        ],
        "conflicts": [
            {"user_hash": r["user_hash"], "kind": r["kind"]} for r in tables["routine_conflicts"]
        ],
    }


def _ts(v: Any) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=UTC)
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


def since_of(range_: str, today: date) -> datetime | None:
    days = RANGE_DAYS[range_]
    if days is None:
        return None
    return datetime(today.year, today.month, today.day, tzinfo=UTC) - timedelta(days=days - 1)


def select(
    raw: dict[str, list[dict[str, Any]]],
    cohort_: str = "mixed",
    range_: str = "all",
    today: date | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """The people a filter asks for, and only their rows. Range: a person is in when they took a
    reading in the window (their whole history then counts: an outcome needs the week-8 reading);
    month buckets keep only the months with a reading in the window."""
    since = since_of(range_, today or datetime.now(UTC).date())

    def keep(u: dict[str, Any]) -> bool:
        if cohort_ == "simulated" and not u["synthetic"]:
            return False
        if cohort_ == "real" and u["synthetic"]:
            return False
        last = _ts(u.get("last_ts"))
        return since is None or (last is not None and last >= since)

    users = [u for u in raw["users"] if keep(u)]
    ids = {u["user_hash"] for u in users}
    return {
        "users": users,
        "months": [
            r
            for r in raw.get("months", [])
            if r["user_hash"] in ids and (since is None or (_ts(r["last_ts"]) or since) >= since)
        ],
        "first": [r for r in raw["first"] if r["user_hash"] in ids],
        "routine": [r for r in raw["routine"] if r["user_hash"] in ids],
        "conflicts": [r for r in raw["conflicts"] if r["user_hash"] in ids],
    }


def _cell(rate: float | None, n: int) -> dict[str, Any]:
    if n < MIN_GROUP or rate is None:
        return {"value": None, "n": n, "suppressed": True}
    return {"value": round(rate, 2), "n": n, "suppressed": False}


def _count(n: int) -> int | None:
    """A group of people: its size, or None when it is under MIN_GROUP."""
    return n if n >= MIN_GROUP else None


def _wilson(k: int, n: int) -> tuple[float, float]:
    if n == 0:
        return 0.0, 0.0
    z, p = 1.96, k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return round(max(0.0, centre - half), 2), round(min(1.0, centre + half), 2)


def _median(weeks: list[int]) -> float | None:
    return statistics.median(weeks) if len(weeks) >= MIN_GROUP else None


def _using(r: dict[str, Any], week: int) -> bool:
    """Still using this product at `week` (started by then, not stopped by then)."""
    started = r.get("started_week") or 0
    return started <= week and (r.get("stopped_week") is None or r["stopped_week"] > week)


def _empty(cohort_counts: dict[str, Any]) -> dict[str, Any]:
    """Fewer than MIN_GROUP people in the filter: nothing but the head count is shown."""
    return {
        "cohort": cohort_counts,
        "empty": True,
        "tiles": [],
        "needs": [],
        "needs_by_month": {"months": [], "people": [], "goals": []},
        "kpis": {"catalog": None, "continuation_wk8": None},
        "products": [],
        "product_outcomes": {},
        "tone_bands": ["very light", "light", "intermediate", "tan", "brown", "dark"],
        "skin_types": [SKIN_LABEL[s] for s in cohort.SKIN_TYPES],
        "brands": [],
        "brands_hidden": 0,
        "categories": [],
        "gaps": [],
        "conflicts": [],
        "routines_checked": 0,
    }


def people(raw: dict[str, list[dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    """user_hash -> the person, goals as the app's 8 ids, in user_hash order."""
    return {
        u["user_hash"]: {**u, "goals": cohort.goals_of(u.get("goals"))}
        for u in sorted(raw["users"], key=lambda u: u["user_hash"])
    }


def cohort_counts_of(users: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Head counts for the "About this data" panel. Stopped early: no week-8 reading and no
    reading in the 14 days before the newest reading in the data (people who started recently
    are "not there yet", not dropouts)."""
    synthetic = sum(1 for u in users.values() if u["synthetic"])
    stamps = [t for t in (_ts(u.get("last_ts")) for u in users.values()) if t]
    end = max(stamps) if stamps else None
    dropped = sum(
        1
        for u in users.values()
        if u["last_week"] < WEEKS
        and end is not None
        and (_ts(u.get("last_ts")) or end) < end - timedelta(days=14)
    )
    return {
        "synthetic": synthetic,
        "real": len(users) - synthetic,
        "weeks": WEEKS,
        "dropout": round(dropped / len(users), 2) if users else 0,
        "seed": cohort.SEED,
    }


def outcome_starts(first_rows: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    """user_hash -> metric -> the week the improved run that holds to week 8 started (metrics
    not still improved at week 8 are absent)."""
    first: dict[str, dict[str, int]] = defaultdict(dict)
    for r in first_rows:
        weeks = set(r["improved_weeks"])
        if WEEKS in weeks:  # still improved at week 8; the run started at `start`
            start = WEEKS
            while start - 1 in weeks:
                start -= 1
            first[r["user_hash"]][r["metric_id"]] = start
    return first


def outcome_of(first: dict[str, dict[str, int]], uh: str, metrics: list[str]) -> int | None:
    """The outcome: the earliest start of a lasting change in any of `metrics`, or None."""
    mine = first.get(uh, {})
    weeks = [mine[m] for m in metrics if m in mine]
    return min(weeks) if weeks else None


def product_targets(p: dict[str, Any]) -> list[str]:
    """The metrics a product's concerns map to (empty: nothing Willow measures)."""
    return sorted({m for c in p["concerns"] for m in cohort.CONCERN_METRICS.get(c, [])})


def aggregate(raw: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    users = people(raw)
    active = sum(1 for u in users.values() if u["last_week"] >= WEEKS)
    cohort_counts = cohort_counts_of(users)
    if len(users) < MIN_GROUP:
        return _empty(cohort_counts)

    first = outcome_starts(raw["first"])
    products = {p["product_id"]: p for p in catalog.products()}
    targets = {pid: product_targets(p) for pid, p in products.items()}
    pgoals = {pid: cohort.product_goals(p) for pid, p in products.items()}

    def outcome(uh: str, metrics: list[str]) -> int | None:
        return outcome_of(first, uh, metrics)

    def eligible(uh: str) -> bool:  # reached the week-8 reading
        return users[uh]["last_week"] >= WEEKS

    routine = [r for r in raw["routine"] if r["user_hash"] in users]
    goal_counts = Counter(sorted(g for u in users.values() for g in u["goals"]))

    # Needs by goal (the app's 8 goals), with each goal's median weeks to a real change.
    needs, unmet_users, first_weeks = [], set(), []
    for goal, n in sorted(goal_counts.items(), key=lambda kv: (-kv[1], kv[0])):
        if n < MIN_GROUP:
            continue
        metrics = cohort.GOAL_METRICS[goal]
        members = [uh for uh, u in users.items() if goal in u["goals"]]
        real = [uh for uh in members if outcome(uh, metrics) is not None]
        none = [uh for uh in members if uh not in real and eligible(uh)]
        unmet_users |= set(none)
        weeks = [outcome(uh, metrics) for uh in real]
        first_weeks += weeks
        needs.append(
            {
                "goal": GOAL_LABEL[goal],
                "goal_id": goal,
                "n": n,
                "real": round(100 * len(real) / n),
                "none": round(100 * len(none) / n),
                "early": 100 - round(100 * len(real) / n) - round(100 * len(none) / n),
                "weeks": _median(weeks),
                "weeks_n": _count(len(weeks)),
            }
        )

    # Goal demand by month: people with a reading in the month, and the goals they had then.
    in_month: dict[str, set[str]] = defaultdict(set)
    goal_month: dict[tuple[str, str], set[str]] = defaultdict(set)
    for r in raw.get("months", []):
        if r["user_hash"] not in users:
            continue
        in_month[r["month"]].add(r["user_hash"])
        for g in cohort.goals_of(r["goals"]):
            goal_month[(g, r["month"])].add(r["user_hash"])
    months = sorted(in_month)
    order = [n["goal_id"] for n in needs] + [g for g in cohort.GOALS if g not in goal_counts]
    counts = {g: [_count(len(goal_month[(g, m)])) for m in months] for g in order}
    peaks = [max((counts[g][i] or 0) for g in order) if order else 0 for i in range(len(months))]
    needs_by_month = {
        "months": months,
        "people": [_count(len(in_month[m])) for m in months],
        "goals": [
            {
                "goal": GOAL_LABEL[g],
                "goal_id": g,
                "counts": counts[g],
                "share_of_peak": [
                    round(c / peaks[i], 2) if c is not None and peaks[i] else None
                    for i, c in enumerate(counts[g])
                ],
            }
            for g in order
            if any(c is not None for c in counts[g])
        ],
    }

    # Products: per tone band and skin type, lift against people with the same goal not using it.
    users_of: dict[str, list[str]] = defaultdict(list)
    rows_of: dict[tuple[str, str], dict[str, Any]] = {}
    for r in sorted(routine, key=lambda r: (r["product_id"], r["user_hash"])):
        if (r["user_hash"], r["product_id"]) not in rows_of:
            users_of[r["product_id"]].append(r["user_hash"])
        rows_of[(r["user_hash"], r["product_id"])] = r
    rows, below_min, unused, not_measured = [], 0, 0, 0
    for pid, p in sorted(products.items()):
        metrics, members = targets[pid], users_of.get(pid, [])
        if not metrics:
            not_measured += 1
            continue
        if not members:
            unused += 1
            continue
        el = [uh for uh in members if eligible(uh)]
        if len(el) < MIN_GROUP:
            below_min += 1
            continue
        wins = [uh for uh in el if outcome(uh, metrics) is not None]
        same_goal = [
            uh
            for uh, u in users.items()
            if (uh, pid) not in rows_of and set(u["goals"]) & set(pgoals[pid]) and eligible(uh)
        ]
        base_k = sum(1 for uh in same_goal if outcome(uh, metrics) is not None)
        base = (
            {"k": base_k, "n": len(same_goal), "rate": round(base_k / len(same_goal), 2)}
            if len(same_goal) >= MIN_GROUP
            else None
        )

        def cells(key: str, values: list[str], el: list[str] = el, m: list[str] = metrics):
            out = []
            for v in values:
                group = [uh for uh in el if users[uh].get(key) == v]
                k = sum(1 for uh in group if outcome(uh, m) is not None)
                out.append(_cell(k / len(group) if group else None, len(group)))
            return out

        kept = [uh for uh in members if (rows_of[(uh, pid)]["stopped_week"] or 99) > 4]
        kept8 = [uh for uh in el if _using(rows_of[(uh, pid)], WEEKS)]
        rate = len(wins) / len(el)
        rows.append(
            {
                "product_id": pid,
                "product": p["name"],
                "brand": p["brand"],
                "category": p["category"],
                "concern": CONCERN_SHORT[p["concerns"][0]],
                "goal_ids": pgoals[pid],
                "n": len(el),
                "cells": cells("tone", cohort.TONE_BANDS),
                "cells_skin": cells("skin_type", cohort.SKIN_TYPES),
                "rate": round(rate, 2),
                "lift": None if base is None else round(rate - base_k / len(same_goal), 2),
                "base": base,
                "weeks": statistics.median([outcome(uh, metrics) for uh in wins]) if wins else None,
                "cont": round(len(kept) / len(members), 2),
                "cont8": round(len(kept8) / len(el), 2),
            }
        )
    rows.sort(key=lambda r: (-r["n"], r["brand"], r["product"]))

    def brand_stats(subset: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
        b_users: dict[str, set[str]] = defaultdict(set)
        b_wins: dict[str, set[str]] = defaultdict(set)
        b_kept: dict[str, list[bool]] = defaultdict(list)
        for r in subset:
            metrics, uh = targets.get(r["product_id"], []), r["user_hash"]
            if not metrics or not eligible(uh):
                continue
            b_users[r["brand"]].add(uh)
            b_kept[r["brand"]].append((r["stopped_week"] or 99) > 4)
            if outcome(uh, metrics) is not None:
                b_wins[r["brand"]].add(uh)
        out = []
        for b, us in b_users.items():
            if len(us) < MIN_GROUP:
                continue
            lo, hi = _wilson(len(b_wins[b]), len(us))
            out.append(
                {
                    "brand": b,
                    "n": len(us),
                    "rate": round(len(b_wins[b]) / len(us), 2),
                    "lo": lo,
                    "hi": hi,
                    "cont": round(sum(b_kept[b]) / len(b_kept[b]), 2),
                }
            )
        out.sort(key=lambda b: (-b["rate"], b["brand"]))
        return out, sum(1 for us in b_users.values() if len(us) < MIN_GROUP)

    brands, brands_hidden = brand_stats(routine)

    # Category x goal flow: users of the category's products for a goal, with a real change by
    # week 2/4/8 (the improved run that holds to week 8 had started by then), still using one of
    # those products at each week, and people with the same goal using none of them.
    categories = []
    for cat in sorted({p["category"] for p in products.values()}):
        cat_ids = {pid for pid, p in products.items() if p["category"] == cat}
        c_brands, c_hidden = brand_stats([r for r in routine if r["product_id"] in cat_ids])
        flows = []
        for goal in cohort.GOALS:
            ids = {pid for pid in cat_ids if goal in pgoals[pid]}
            if not ids:
                continue
            metrics = cohort.GOAL_METRICS[goal]
            use: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for r in routine:
                if r["product_id"] in ids:
                    use[r["user_hash"]].append(r)
            members = [uh for uh in sorted(use) if goal in users[uh]["goals"] and eligible(uh)]
            if len(members) < MIN_GROUP:
                continue
            got = {uh: outcome(uh, metrics) for uh in members}
            changed = [sum(1 for w in got.values() if w is not None and w <= k) for k in FLOW_WEEKS]
            others = [
                uh
                for uh, u in users.items()
                if goal in u["goals"] and eligible(uh) and uh not in use
            ]
            base_k = sum(1 for uh in others if outcome(uh, metrics) is not None)
            flows.append(
                {
                    "goal": GOAL_LABEL[goal],
                    "goal_id": goal,
                    "n": len(members),
                    "weeks": FLOW_WEEKS,
                    "changed": changed,
                    "using": [
                        sum(1 for uh in members if any(_using(r, k) for r in use[uh]))
                        for k in FLOW_WEEKS
                    ],
                    "rate": round(changed[-1] / len(members), 2),
                    "median_weeks": _median([w for w in got.values() if w is not None]),
                    "base": {
                        "k": base_k,
                        "n": len(others),
                        "rate": round(base_k / len(others), 2),
                    }
                    if len(others) >= MIN_GROUP
                    else None,
                }
            )
        if flows or c_brands:
            flows.sort(key=lambda f: (-f["n"], f["goal_id"]))
            categories.append(
                {
                    "category": cat,
                    "label": CATEGORY_LABEL.get(cat, cat.replace("_", " ").capitalize()),
                    "flows": flows,
                    "brands": c_brands[:8],
                    "brands_hidden": c_hidden,
                }
            )

    # Assortment gaps: options per price tier for each goal, their outcome rate and users.
    gaps = []
    for goal in cohort.GOALS:
        metrics = cohort.GOAL_METRICS[goal]
        tiers: dict[str, dict[str, Any]] = {}
        for tier_name, _, _ in cohort.TIERS:
            ids = [
                pid
                for pid, p in products.items()
                if goal in pgoals[pid] and cohort.tier(p["price"]) == tier_name
            ]
            el = {uh for pid in ids for uh in users_of.get(pid, []) if eligible(uh)}
            k = sum(1 for uh in el if outcome(uh, metrics) is not None)
            tiers[tier_name] = {
                "options": len(ids),
                "rate": round(k / len(el), 2) if len(el) >= MIN_GROUP else None,
                "n": _count(len(el)),
            }
        missing = [t for t, v in tiers.items() if v["options"] == 0]
        rates = [v["rate"] for v in tiers.values() if v["rate"] is not None]
        thin = [t for t, v in tiers.items() if v["options"] == 1]
        short = GOAL_LABEL[goal].lower()
        action = (
            f"Add a {missing[0]} option for {short}."
            if missing
            else "Outcome rates are low in every tier: an education opportunity."
            if rates and max(rates) < 0.35
            else f"Add a second {thin[0]} option for {short}."
            if thin
            else "Covered in every tier."
        )
        gaps.append({"goal": GOAL_LABEL[goal], "goal_id": goal, **tiers, "action": action})

    # Routine findings (the app's rule table), as a share of the routines checked.
    conflict_rows = [r for r in raw["conflicts"] if r["user_hash"] in users]
    kinds = Counter(r["kind"] for r in conflict_rows)
    checked = len({r["user_hash"] for r in conflict_rows})
    sunscreens = sorted(
        (p for p in products.values() if p["category"] == "sunscreen"),
        key=lambda p: p["price"]["amount"] * (83 if p["price"]["currency"] == "USD" else 1),
    )
    conflicts = (
        [
            {
                "kind": k,
                "pair": CONFLICT_COPY[k][0],
                "n": kinds[k],
                "share": round(kinds[k] / checked, 2),
                "fix": CONFLICT_COPY[k][1],
                "resolves": [f"{p['brand']} {p['name']}" for p in sunscreens[:2]]
                if k == "no_spf"
                else [],
            }
            for k, _ in sorted(kinds.items(), key=lambda kv: (-kv[1], kv[0]))
            if k in CONFLICT_COPY and kinds[k] >= MIN_GROUP
        ]
        if checked >= MIN_GROUP
        else []
    )

    # Continuation at week 8: people at week 8 using a product for one of their goals, still
    # using one of those at week 8.
    by_user: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows_of.values():
        by_user[r["user_hash"]].append(r)
    goal_rows = {
        uh: [r for r in by_user[uh] if set(pgoals.get(r["product_id"], [])) & set(u["goals"])]
        for uh, u in users.items()
        if eligible(uh)
    }
    goal_users = [uh for uh, rs in goal_rows.items() if rs]
    still = [uh for uh in goal_users if any(_using(r, WEEKS) for r in goal_rows[uh])]
    continuation = (
        {"k": len(still), "n": len(goal_users), "rate": round(len(still) / len(goal_users), 2)}
        if len(goal_users) >= MIN_GROUP
        else None
    )

    top_goal, top_n = (
        min(goal_counts.items(), key=lambda kv: (-kv[1], kv[0])) if goal_counts else ("", 0)
    )
    completed = [uh for uh, u in users.items() if u["last_week"] >= WEEKS]
    tiles = [
        {
            "label": "Active users",
            "value": str(active) if active >= MIN_GROUP else "–",
            "n": active,
            "sub": f"week {WEEKS}, after dropout",
        },
        {
            "label": "Top goal",
            "value": GOAL_LABEL.get(top_goal, top_goal) if top_n >= MIN_GROUP else "–",
            "n": top_n,
            "sub": f"{round(100 * top_n / len(users))}% of users" if top_n >= MIN_GROUP else "",
        },
        {
            "label": f"Unmet by week {WEEKS}",
            "value": f"{round(100 * len(unmet_users) / len(completed))}%"
            if len(completed) >= MIN_GROUP
            else "–",
            "n": len(completed),
            "sub": "no visible change in a goal metric",
        },
        {
            "label": "Median weeks to first visible change",
            "value": f"{statistics.median(first_weeks):g}"
            if len(first_weeks) >= MIN_GROUP
            else "–",
            "n": len(first_weeks),
            "sub": "among goals that got one",
        },
    ]
    return {
        "cohort": cohort_counts,
        "empty": False,
        "tiles": tiles,
        "needs": needs,
        "needs_by_month": needs_by_month,
        "kpis": {
            "catalog": {
                "products": len(products),
                "with_outcomes": len(rows),
                "below_min": below_min,
                "unused": unused,
                "not_measured": not_measured,
            },
            "continuation_wk8": continuation,
        },
        "products": rows[:8],
        # Every product with enough people, for product cards, the advisor and the retailer's
        # full list (labelled synthetic while the cohort is synthetic).
        "product_outcomes": {
            r["product_id"]: {
                "n": r["n"],
                "rate": r["rate"],
                "weeks": r["weeks"],
                "product": r["product"],
                "brand": r["brand"],
                "category": r["category"],
                "concern": r["concern"],
                "cont": r["cont"],
                "cont8": r["cont8"],
                "lift": r["lift"],
            }
            for r in rows
        },
        "tone_bands": ["very light", "light", "intermediate", "tan", "brown", "dark"],
        "skin_types": [SKIN_LABEL[s] for s in cohort.SKIN_TYPES],
        "brands": brands[:8],
        "brands_hidden": brands_hidden,
        "categories": categories,
        "gaps": gaps,
        "conflicts": conflicts,
        "routines_checked": checked,
    }


_raw: dict[str, Any] = {"at": 0.0, "data": None, "version": 0}
_views: dict[tuple[str, str], tuple[int, date, dict[str, Any]]] = {}
_lock = threading.Lock()


def _rows() -> tuple[dict[str, list[dict[str, Any]]], int]:
    """BigQuery rows, cached for CACHE_SECONDS; one query at a time; if BigQuery fails after
    expiry, the last good rows are served (and retried a minute later) instead of an error."""
    if _raw["data"] is not None and time.time() - _raw["at"] <= CACHE_SECONDS:
        return _raw["data"], _raw["version"]
    with _lock:
        if _raw["data"] is not None and time.time() - _raw["at"] <= CACHE_SECONDS:
            return _raw["data"], _raw["version"]  # another request refreshed it meanwhile
        try:
            _raw["data"] = fetch()
            _raw["at"] = time.time()
            _raw["version"] += 1
        except Exception:
            if _raw["data"] is None:
                raise
            log.warning("retailer insights refresh failed; serving the cached rows")
            _raw["at"] = time.time() - CACHE_SECONDS + 60
        return _raw["data"], _raw["version"]


def insights(cohort_: str = "mixed", range_: str = "all") -> dict[str, Any]:
    """The aggregates for one filter (default: every row, all time), cached per filter."""
    if cohort_ not in ("simulated", "mixed", "real") or range_ not in RANGE_DAYS:
        raise ValueError(f"unknown filter {cohort_}/{range_}")
    raw, version = _rows()
    today = datetime.now(UTC).date()
    hit = _views.get((cohort_, range_))
    if hit and hit[0] == version and hit[1] == today:
        return hit[2]
    since = since_of(range_, today)
    data = {
        **aggregate(select(raw, cohort_, range_, today)),
        "filters": {
            "cohort": cohort_,
            "range": range_,
            "since": since.date().isoformat() if since else None,
            "today": today.isoformat(),
        },
    }
    _views[(cohort_, range_)] = (version, today, data)
    return data
