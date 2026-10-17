"""Willow Proof views (docs/RETAILER_INSIGHTS.md "Willow Proof views"): products, one product,
skin profiles, brands, one brand and the brief, from the same rows and outcome definition as
/v1/retailer/insights (retailer.py).

`build_facts()` indexes one filter's rows once (people, outcomes, routines, conflicts, months);
the view functions are pure over those facts and tested; the cached wrappers at the bottom read
the rows through `retailer._rows()` + `retailer.select()` and cache each view per filter, data
version and day, like `retailer.insights`.

Definitions (shared with the web and the campaigns slice):
- eligible person: reached the week-8 reading. Outcome: the start week of an improved run that
  holds to week 8 on any of the metrics asked about (retailer.outcome_of).
- product users `n` = eligible people with a routine row for it; `users` = everyone with a row.
- base (non-users) = eligible people with an overlapping goal and no row for it (n >= 10).
- rate CI = Wilson; lift = rate - base_rate, CI = diff +- 1.96 * sqrt(p1 q1 / n1 + p2 q2 / n2).
- Proof tier: proven (n >= 30 and lift_lo > 0), promising (n >= 10 and lift > 0), unclear
  (n >= 10, lift <= 0 or no base), too_few (n < 10: outcome numbers null).
- switching A -> B: stopped A at week w, started B (same category, B != A) in weeks w-1..w+2.
Every group of people under 10 is suppressed here (null with `suppressed: true`, or left out).
Complementary suppression: in a breakdown whose total is shown elsewhere (a product's skin type
and tone band cells, a brand's skin cells, head counts per skin type), when exactly one cell
with people in it is suppressed, the smallest shown cell is suppressed too, so the hidden count
cannot be worked out as total minus the others. Suppressed cells carry `n: null`.
"""

import calendar
import json
import logging
import math
import threading
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from functools import cache
from typing import Any, Literal

from pydantic import BaseModel, Field

from app import catalog, cohort, feel, gemini, numbers, retailer
from app.explain import BANNED

log = logging.getLogger("willow.retail_intel")

MIN = retailer.MIN_GROUP
WEEKS = retailer.WEEKS
PROVEN_N = 30
Z = 1.96

TIER_LABEL = {
    "proven": "Proven",
    "promising": "Promising",
    "unclear": "No clear effect yet",
    "too_few": "Not enough data",
}
TIER_ORDER = {"proven": 0, "promising": 1, "unclear": 2, "too_few": 3}
TONE_LABEL = {
    "very_light": "Very light",
    "light": "Light",
    "intermediate": "Intermediate",
    "tan": "Tan",
    "brown": "Brown",
    "dark": "Dark",
}
METRIC_WORDS = {
    "blemishes": "blemishes",
    "dark_circles": "under-eye darkness",
    "glow": "glow",
    "lines": "lines",
    "pigment_spots": "dark spots",
    "pores": "pores",
    "redness": "redness",
    "shine": "shine",
    "texture": "texture",
    "tone_evenness": "tone evenness",
}
METHOD = (
    "Measured from standardised phone photos against each person's own baseline and noise band "
    "(MDC95); a change counts only if it holds to week 8."
)
WINDOW = "8 weeks"
CAVEAT = (
    "Observational real-world data, not a controlled trial. Do not present as clinical "
    "substantiation. Measured outcomes only; no self-reported results are included."
)
COMPARE_NOTE = (
    "Observational comparison under the same method; differences inside the confidence "
    "intervals are not meaningful."
)


# ── catalog lookups ────────────────────────────────────────────────────────────────────────


@cache
def _catalog() -> tuple[dict[str, dict[str, Any]], dict[str, list[str]], dict[str, list[str]]]:
    products = {p["product_id"]: p for p in catalog.products()}
    targets = {pid: retailer.product_targets(p) for pid, p in products.items()}
    goals = {pid: cohort.product_goals(p) for pid, p in products.items()}
    return products, targets, goals


def brands() -> list[str]:
    return sorted({p["brand"] for p in _catalog()[0].values()})


def _goal_metrics(goal: str, pid: str | None = None) -> list[str]:
    """A goal's metrics, narrowed to the ones the product targets when it targets any."""
    ms = cohort.GOAL_METRICS[goal]
    if pid is None:
        return ms
    mine = [m for m in ms if m in _catalog()[1][pid]]
    return mine or ms


def _pct(x: float | None) -> int | None:
    return None if x is None else round(100 * x)


def _r2(x: float) -> float:
    return round(x, 2)


# ── facts ──────────────────────────────────────────────────────────────────────────────────


@dataclass
class Facts:
    users: dict[str, dict[str, Any]]
    first: dict[str, dict[str, int]]
    rows_of: dict[tuple[str, str], dict[str, Any]]
    users_of: dict[str, list[str]]
    by_user: dict[str, list[dict[str, Any]]]
    kinds: dict[str, set[str]]  # user -> conflict kinds (only users whose routine was checked)
    months: list[dict[str, Any]]
    cohort: dict[str, Any]
    filters: dict[str, Any] = field(default_factory=dict)
    memo: dict[Any, Any] = field(default_factory=dict)

    def eligible(self, uh: str) -> bool:
        return self.users[uh]["last_week"] >= WEEKS

    def outcome(self, uh: str, metrics: list[str]) -> int | None:
        return retailer.outcome_of(self.first, uh, metrics)

    @property
    def eligible_users(self) -> list[str]:
        if "eligible" not in self.memo:
            self.memo["eligible"] = [uh for uh in self.users if self.eligible(uh)]
        return self.memo["eligible"]

    @property
    def category_users(self) -> dict[str, set[str]]:
        if "cat_users" not in self.memo:
            out: dict[str, set[str]] = defaultdict(set)
            for (uh, _), r in self.rows_of.items():
                out[r["category"]].add(uh)
            self.memo["cat_users"] = out
        return self.memo["cat_users"]

    @property
    def switches(self) -> list[tuple[str, str, str]]:
        """(user, from product, to product): stopped A at w, started B in the same category with
        started_week in [w-1, w+2]."""
        if "switches" not in self.memo:
            out = []
            for uh, rs in self.by_user.items():
                for a in rs:
                    w = a.get("stopped_week")
                    if w is None:
                        continue
                    for b in rs:
                        sb = b.get("started_week")
                        if (
                            b["product_id"] != a["product_id"]
                            and b["category"] == a["category"]
                            and sb is not None
                            and w - 1 <= sb <= w + 2
                        ):
                            out.append((uh, a["product_id"], b["product_id"]))
            self.memo["switches"] = sorted(set(out))
        return self.memo["switches"]


def cohort_label(counts: dict[str, Any]) -> str:
    if counts.get("real", 0) == 0:
        return "Simulated cohort"
    if counts.get("synthetic", 0) == 0:
        return "Consented users"
    return "Mixed"


def build_facts(
    raw: dict[str, list[dict[str, Any]]], filters: dict[str, Any] | None = None
) -> Facts:
    """Index one filter's rows (the output of retailer.select) once."""
    users = retailer.people(raw)
    rows_of: dict[tuple[str, str], dict[str, Any]] = {}
    users_of: dict[str, list[str]] = defaultdict(list)
    for r in sorted(raw["routine"], key=lambda r: (r["product_id"], r["user_hash"])):
        if r["user_hash"] not in users:
            continue
        key = (r["user_hash"], r["product_id"])
        if key not in rows_of:
            users_of[r["product_id"]].append(r["user_hash"])
        rows_of[key] = r
    by_user: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for (uh, _), r in sorted(rows_of.items()):
        by_user[uh].append(r)
    kinds: dict[str, set[str]] = defaultdict(set)
    for r in raw["conflicts"]:
        if r["user_hash"] in users:
            kinds[r["user_hash"]].add(r["kind"])
    return Facts(
        users=users,
        first=retailer.outcome_starts(raw["first"]),
        rows_of=rows_of,
        users_of=dict(users_of),
        by_user=dict(by_user),
        kinds=dict(kinds),
        months=[r for r in raw.get("months", []) if r["user_hash"] in users],
        cohort=retailer.cohort_counts_of(users),
        filters=filters or {},
    )


# ── statistics ─────────────────────────────────────────────────────────────────────────────


def lift_ci(k1: int, n1: int, k2: int, n2: int) -> tuple[float, float, float]:
    """(lift, lo, hi): difference of two proportions with a normal-approximation 95% CI."""
    p1, p2 = k1 / n1, k2 / n2
    se = math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)
    d = p1 - p2
    return _r2(d), _r2(d - Z * se), _r2(d + Z * se)


def tier_of(n: int, lift: float | None, lift_lo: float | None) -> str:
    if n < MIN:
        return "too_few"
    if n >= PROVEN_N and lift_lo is not None and lift_lo > 0:
        return "proven"
    if lift is not None and lift > 0:
        return "promising"
    return "unclear"


def to_proven(k1: int, n1: int, k2: int, n2: int) -> int | None:
    """People at week 8 still needed for the lift's lower bound to clear zero, if the rates
    hold ("what would it take"); None when the base group alone is too small to get there."""
    p1, p2 = k1 / n1, k2 / n2
    d = p1 - p2
    if d <= 0:
        return None
    room = (d / Z) ** 2 - p2 * (1 - p2) / n2
    if room <= 0:
        return None
    need = max(PROVEN_N, math.floor(p1 * (1 - p1) / room) + 1)
    return max(0, need - n1)


def suppress(ns: list[int]) -> set[int]:
    """Indexes of the cells to hide: under MIN, plus the smallest shown cell when exactly one
    cell with people in it would be hidden (complementary suppression)."""
    hidden = {i for i, n in enumerate(ns) if n < MIN}
    if sum(1 for i in hidden if ns[i] > 0) == 1:
        shown = [i for i in range(len(ns)) if i not in hidden]
        if shown:
            hidden.add(min(shown, key=lambda i: (ns[i], i)))
    return hidden


# ── products ───────────────────────────────────────────────────────────────────────────────


def _base(f: Facts, pid: str) -> list[str]:
    mine = set(f.users_of.get(pid, []))
    want = set(_catalog()[2][pid])
    return [uh for uh in f.eligible_users if uh not in mine and set(f.users[uh]["goals"]) & want]


def _stats(f: Facts, pid: str) -> dict[str, Any]:
    """A product's row plus what the detail view needs (eligible users, base), memoised."""
    key = ("stats", pid)
    if key in f.memo:
        return f.memo[key]
    products, targets, pgoals = _catalog()
    p = products[pid]
    metrics, members = targets[pid], f.users_of.get(pid, [])
    cat = f.category_users.get(p["category"], set())
    row: dict[str, Any] = {
        "product_id": pid,
        "product": p["name"],
        "brand": p["brand"],
        "category": p["category"],
        "category_label": retailer.CATEGORY_LABEL.get(p["category"], p["category"]),
        "goal_ids": pgoals[pid],
        "price_tier": cohort.tier(p["price"]),
        "image_url": p.get("image_url"),
        "users": retailer._count(len(members)),
        "n": None,
        "rate": None,
        "rate_lo": None,
        "rate_hi": None,
        "base_rate": None,
        "lift": None,
        "lift_lo": None,
        "lift_hi": None,
        "weeks": None,
        "cont8": None,
        "routine_share": _r2(len(members) / len(cat)) if len(members) >= MIN else None,
        "tier": "too_few",
        "tier_label": TIER_LABEL["too_few"],
        "reason": None,
        "to_proven": None,
        "felt": None,
        "felt_n": None,
    }
    said = _answers(f, pid, members)
    if len(said) >= MIN:
        row["felt"] = _r2(sum(1 for a in said if a["feel"] == "working") / len(said))
        row["felt_n"] = len(said)
    el = [uh for uh in members if f.eligible(uh)]
    out = {"row": row, "el": el, "base": [], "metrics": metrics, "members": members}
    if not metrics:
        row["reason"] = "not_measured"
    elif not members:
        row["reason"] = "unused"
    elif len(el) < MIN:
        row["reason"] = "few"
    else:
        wins = [uh for uh in el if f.outcome(uh, metrics) is not None]
        base = _base(f, pid)
        base_k = sum(1 for uh in base if f.outcome(uh, metrics) is not None)
        lo, hi = retailer._wilson(len(wins), len(el))
        lift = lift_lo = lift_hi = None
        if len(base) >= MIN:
            lift, lift_lo, lift_hi = lift_ci(len(wins), len(el), base_k, len(base))
            row["base_rate"] = _r2(base_k / len(base))
            out["base"] = base
        tier = tier_of(len(el), lift, lift_lo)
        row.update(
            n=len(el),
            rate=_r2(len(wins) / len(el)),
            rate_lo=lo,
            rate_hi=hi,
            lift=lift,
            lift_lo=lift_lo,
            lift_hi=lift_hi,
            weeks=retailer._median([f.outcome(uh, metrics) for uh in wins]),
            cont8=_r2(
                sum(1 for uh in el if retailer._using(f.rows_of[(uh, pid)], WEEKS)) / len(el)
            ),
            tier=tier,
            tier_label=TIER_LABEL[tier],
            to_proven=to_proven(len(wins), len(el), base_k, len(base))
            if tier == "promising" and len(base) >= MIN
            else None,
        )
    f.memo[key] = out
    return out


def _sort_key(r: dict[str, Any]) -> tuple:
    return (
        TIER_ORDER[r["tier"]],
        -(r["lift"] if r["lift"] is not None else -9),
        -(r["n"] or 0),
        r["brand"],
        r["product"],
    )


def rows(f: Facts) -> list[dict[str, Any]]:
    return sorted((_stats(f, pid)["row"] for pid in _catalog()[0]), key=_sort_key)


def products_view(f: Facts) -> dict[str, Any]:
    rs = rows(f)
    reasons = Counter(r["reason"] for r in rs if r["tier"] == "too_few")
    return {
        "filters": f.filters,
        "cohort": f.cohort,
        "products": rs,
        "counts": {
            "products": len(rs),
            "measured": sum(1 for r in rs if r["tier"] != "too_few"),
            "too_few": reasons["few"],
            "unused": reasons["unused"],
            "not_measured": reasons["not_measured"],
        },
    }


def _rate_cells(
    f: Facts,
    groups: list[tuple[str, str, list[str], list[str], list[str]]],
    hide_extra: bool = True,
) -> list[dict[str, Any]]:
    """Seg cells {id, label, n, rate, base_rate, suppressed} from (id, label, users, base,
    metrics) groups, with complementary suppression when `hide_extra`."""
    ns = [len(g[2]) for g in groups]
    hidden = suppress(ns) if hide_extra else {i for i, n in enumerate(ns) if n < MIN}
    out = []
    for i, (gid, label, us, base, metrics) in enumerate(groups):
        if i in hidden:
            out.append(
                {
                    "id": gid,
                    "label": label,
                    "n": None,
                    "rate": None,
                    "base_rate": None,
                    "suppressed": True,
                }
            )
            continue
        k = sum(1 for uh in us if f.outcome(uh, metrics) is not None)
        bk = sum(1 for uh in base if f.outcome(uh, metrics) is not None)
        out.append(
            {
                "id": gid,
                "label": label,
                "n": len(us),
                "rate": _r2(k / len(us)),
                "base_rate": _r2(bk / len(base)) if len(base) >= MIN else None,
                "suppressed": False,
            }
        )
    return out


def _segments(f: Facts, pid: str) -> dict[str, list[dict[str, Any]]]:
    key = ("segments", pid)
    if key in f.memo:
        return f.memo[key]
    s = _stats(f, pid)
    el, base, metrics = s["el"], s["base"], s["metrics"]
    if s["row"]["tier"] == "too_few":
        el, base = [], []

    def by(attr: str, values: list[str], labels: dict[str, str]):
        return [
            (
                v,
                labels[v],
                [uh for uh in el if f.users[uh].get(attr) == v],
                [uh for uh in base if f.users[uh].get(attr) == v],
                metrics,
            )
            for v in values
        ]

    goal_groups = [
        (
            g,
            retailer.GOAL_LABEL[g],
            [uh for uh in el if g in f.users[uh]["goals"]],
            [uh for uh in base if g in f.users[uh]["goals"]],
            _goal_metrics(g, pid),
        )
        for g in _catalog()[2][pid]
    ]
    out = {
        "skin": _rate_cells(f, by("skin_type", cohort.SKIN_TYPES, retailer.SKIN_LABEL)),
        "tone": _rate_cells(f, by("tone", cohort.TONE_BANDS, TONE_LABEL)),
        # people can hold several goals, so goal cells do not add up to the product's n
        "goal": _rate_cells(f, goal_groups, hide_extra=False),
    }
    f.memo[key] = out
    return out


def _metric_words(pid: str) -> str:
    words = [METRIC_WORDS.get(m, m) for m in _catalog()[1][pid]]
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " or " + words[-1]


def _evidence(f: Facts, pid: str) -> list[dict[str, Any]]:
    """Claim-ready statements: measured, cosmetic, observational; numbers only from the row."""
    row, segs = _stats(f, pid)["row"], _segments(f, pid)
    if row["tier"] == "too_few":
        return []
    label = cohort_label(f.cohort)

    def item(id_: str, kind: str, text: str, n: int) -> dict[str, Any]:
        return {
            "id": id_,
            "kind": kind,
            "text": text,
            "n": n,
            "method": METHOD,
            "window": WINDOW,
            "cohort_label": label,
            "caveat": CAVEAT,
        }

    out = []
    base = (
        f" (non-users with the same goals {_pct(row['base_rate'])}%)"
        if row["base_rate"] is not None
        else ""
    )
    out.append(
        item(
            "efficacy",
            "efficacy",
            f"Measured in {row['n']} Willow users: {_pct(row['rate'])}% had a visible change in "
            f"{_metric_words(pid)} held to week 8{base}. {label}.",
            row["n"],
        )
    )
    for g in sorted(
        (c for c in segs["goal"] if not c["suppressed"]), key=lambda c: (-c["n"], c["id"])
    )[:2]:
        vs = f" (non-users {_pct(g['base_rate'])}%)" if g["base_rate"] is not None else ""
        goal = g["label"].lower()
        article = "an" if goal[:1] in "aeiou" else "a"
        out.append(
            item(
                f"efficacy_{g['id']}",
                "efficacy",
                f"Measured in {g['n']} Willow users with {article} {goal} goal: "
                f"{_pct(g['rate'])}% had a visible change held to week 8{vs}. {label}.",
                g["n"],
            )
        )
    if row["weeks"] is not None:
        wins = round(row["rate"] * row["n"])
        out.append(
            item(
                "speed",
                "speed",
                f"Among the Willow users with a visible change, half saw it begin by week "
                f"{row['weeks']:g}. {label}.",
                wins,
            )
        )
    lifted = [
        c
        for c in segs["skin"]
        if not c["suppressed"] and c["base_rate"] is not None and c["rate"] > c["base_rate"]
    ]
    if lifted:
        c = max(lifted, key=lambda c: (c["rate"] - c["base_rate"], c["n"]))
        out.append(
            item(
                f"segment_{c['id']}",
                "segment",
                f"Measured in {c['n']} Willow users with {c['label'].lower()} skin: "
                f"{_pct(c['rate'])}% had a visible change held to week 8 (non-users with "
                f"{c['label'].lower()} skin {_pct(c['base_rate'])}%). {label}.",
                c["n"],
            )
        )
    out.append(
        item(
            "retention",
            "retention",
            f"Measured in {row['n']} Willow users: {_pct(row['cont8'])}% were still using it at "
            f"week 8. {label}.",
            row["n"],
        )
    )
    return out


def eligibility(f: Facts, pid: str) -> dict[str, Any]:
    """Promotion needs Proven; goals and skin types are the ones with their own positive lift
    (n >= 10 each)."""
    row, segs = _stats(f, pid)["row"], _segments(f, pid)

    def positive(cells: list[dict[str, Any]]) -> list[str]:
        return [
            c["id"]
            for c in cells
            if not c["suppressed"] and c["base_rate"] is not None and c["rate"] > c["base_rate"]
        ]

    goals, skins = positive(segs["goal"]), positive(segs["skin"])
    tier, reasons = row["tier"], []
    if tier == "proven":
        reasons.append(
            f"Proven: n={row['n']}, the lower end of the lift's 95% interval is above zero."
        )
        if not goals:
            reasons.append("No single goal has a positive lift with at least 10 people yet.")
    elif tier == "promising":
        reasons.append("Promising, not yet Proven: the lift's 95% interval still includes zero.")
        if row["to_proven"]:
            reasons.append(
                f"About {row['to_proven']} more people at week 8 would make it Proven if the "
                "effect holds."
            )
    elif tier == "unclear":
        reasons.append(
            "No clear effect yet: its rate is not above non-users with the same goals."
            if row["base_rate"] is not None
            else "No clear effect yet: fewer than 10 non-users with the same goals to compare."
        )
    else:
        reasons.append(
            {
                "not_measured": "Not measured: its concerns have no Willow metric.",
                "unused": "No Willow users have it in their routine yet.",
                "few": "Fewer than 10 people have reached week 8 with it.",
            }[row["reason"]]
        )
    return {
        "eligible": tier == "proven" and bool(goals),
        "tier": tier,
        "reasons": reasons,
        "goals": goals,
        "skin_types": skins,
    }


def _answers(f: Facts, pid: str, members: list[str]) -> list[dict[str, Any]]:
    """Each user's latest self-reported answer on the product, given two weeks or more into it."""
    rows = (f.rows_of[(uh, pid)] for uh in members)
    return [r for r in rows if r.get("feel") and (r.get("feel_week") or 0) >= feel.MIN_WEEK]


FEEL_NOTE = (
    "Self-reported by people using it. Shown next to the measurements, never part of the Proof "
    "tier or the measured evidence."
)


def _feel(f: Facts, pid: str) -> dict[str, Any] | None:
    """How it feels to the people using it (self-reported; app/feel.py), and how that lines up
    with what was measured. Groups under 10 are left out."""
    s = _stats(f, pid)
    said = _answers(f, pid, s["members"])
    n = len(said)
    if n < MIN:
        return None
    verdicts = Counter(a["feel"] for a in said)
    tags = Counter(t for a in said for t in a.get("feel_tags") or [] if t in feel.TAGS)
    agree = None
    if s["row"]["tier"] != "too_few":
        both = Counter()
        for uh in s["el"]:
            a = f.rows_of[(uh, pid)]
            if not a.get("feel") or (a.get("feel_week") or 0) < feel.MIN_WEEK:
                continue
            felt = a["feel"] == "working"
            measured = f.outcome(uh, s["metrics"]) is not None
            both[(felt, measured)] += 1
        k = sum(both.values())
        if k >= MIN:
            agree = {
                "n": k,
                "both": _r2(both[(True, True)] / k),
                "felt_only": _r2(both[(True, False)] / k),
                "measured_only": _r2(both[(False, True)] / k),
                "neither": _r2(both[(False, False)] / k),
            }
    return {
        "n": n,
        **{v: _r2(verdicts[v] / n) for v in feel.VERDICTS},
        "tags": [
            {
                "tag": t,
                "label": feel.TAGS[t][0],
                "good": feel.TAGS[t][1],
                "n": c,
                "share": _r2(c / n),
            }
            for t, c in sorted(tags.items(), key=lambda kv: (-kv[1], kv[0]))
            if c >= MIN
        ],
        "agree": agree,
        "note": FEEL_NOTE,
    }


def product_view(f: Facts, pid: str) -> dict[str, Any] | None:
    products, _, pgoals = _catalog()
    if pid not in products:
        return None
    p, s = products[pid], _stats(f, pid)
    row, el, base, members = s["row"], s["el"], s["base"], s["members"]
    measured = row["tier"] != "too_few"

    def curve(us: list[str]) -> list[float | None]:
        if len(us) < MIN or not measured:
            return [None] * WEEKS
        got = [f.outcome(uh, s["metrics"]) for uh in us]
        return [_r2(sum(1 for w in got if w is not None and w <= k) / len(us)) for k in range(1, 9)]

    comp = [
        {**_stats(f, q)["row"], "is_self": q == pid}
        for q, qp in products.items()
        if qp["category"] == p["category"]
        and set(pgoals[q]) & set(pgoals[pid])
        and _stats(f, q)["row"]["tier"] != "too_few"
    ]
    if measured and all(not r["is_self"] for r in comp):
        comp.append({**row, "is_self": True})
    comp.sort(key=lambda r: (-r["rate"], -r["n"], r["brand"], r["product"]))
    rank = next((i + 1 for i, r in enumerate(comp) if r["is_self"]), None)

    co = Counter(r["product_id"] for uh in members for r in f.by_user[uh] if r["product_id"] != pid)
    co_used = [
        {
            "product_id": q,
            "product": products[q]["name"],
            "brand": products[q]["brand"],
            "category": products[q]["category"],
            "image_url": products[q].get("image_url"),
            "n": k,
            "share": _r2(k / len(members)),
        }
        for q, k in sorted(co.items(), key=lambda kv: (-kv[1], kv[0]))
        if k >= MIN and q in products
    ][:6]

    stopped = sum(1 for uh in members if f.rows_of[(uh, pid)].get("stopped_week") is not None)
    to = Counter(b for _, a, b in f.switches if a == pid)
    frm = Counter(a for _, a, b in f.switches if b == pid)

    def flow(c: Counter) -> list[dict[str, Any]]:
        return [
            {
                "product_id": q,
                "product": products[q]["name"],
                "brand": products[q]["brand"],
                "n": k,
            }
            for q, k in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))
            if k >= MIN and q in products
        ]

    # The same flows by brand (people, >= 10), which fill better than single products; the
    # product's own brand is "Same brand, other product".
    def brand_of(q: str) -> str:
        return products[q]["brand"] if q in products else "Other"

    to_b = Counter(b for _, b in {(uh, brand_of(b)) for uh, a, b in f.switches if a == pid})
    from_b = Counter(b for _, b in {(uh, brand_of(a)) for uh, a, b in f.switches if b == pid})

    def brand_flow(c: Counter) -> list[dict[str, Any]]:
        return [
            {
                "brand": b,
                "label": "Same brand, other product" if b == p["brand"] else b,
                "same_brand": b == p["brand"],
                "n": k,
            }
            for b, k in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))
            if k >= MIN
        ]

    checked = [uh for uh in members if uh in f.kinds]
    kinds = Counter(k for uh in checked for k in f.kinds[uh])
    conflicts = (
        [
            {
                "kind": k,
                "label": retailer.CONFLICT_COPY[k][0],
                "fix": retailer.CONFLICT_COPY[k][1],
                "n": n,
                "share": _r2(n / len(checked)),
            }
            for k, n in sorted(kinds.items(), key=lambda kv: (-kv[1], kv[0]))
            if k in retailer.CONFLICT_COPY and n >= MIN
        ]
        if len(checked) >= MIN
        else []
    )
    return {
        "filters": f.filters,
        "cohort": f.cohort,
        "product": {
            **row,
            "key_actives": p["key_actives"],
            "size": p.get("size"),
            "price": p["price"],
            "image_source": p.get("image_source"),
            "stores": len(p.get("stores") or []),
        },
        "curve": {"weeks": list(range(1, 9)), "users": curve(el), "base": curve(base)},
        "segments": _segments(f, pid),
        "competitors": {"rows": comp, "rank": rank, "of": len(comp), "note": COMPARE_NOTE},
        "co_used": co_used,
        "switching": {
            "stopped": retailer._count(stopped),
            "to": flow(to),
            "from": flow(frm),
            "to_brands": brand_flow(to_b),
            "from_brands": brand_flow(from_b),
        },
        "conflicts": conflicts,
        "evidence": _evidence(f, pid),
        "evidence_caveat": CAVEAT,
        "eligibility": eligibility(f, pid),
        "feel": _feel(f, pid),
    }


# ── skin profiles ──────────────────────────────────────────────────────────────────────────


def segments_view(f: Facts) -> dict[str, Any]:
    products, targets, pgoals = _catalog()
    skin_of = {
        s: [uh for uh, u in f.users.items() if u.get("skin_type") == s] for s in cohort.SKIN_TYPES
    }
    hidden = suppress([len(skin_of[s]) for s in cohort.SKIN_TYPES])
    skin_users = {
        s: (None if i in hidden else len(skin_of[s])) for i, s in enumerate(cohort.SKIN_TYPES)
    }

    def pick(s: str, g: str) -> list[dict[str, Any]]:
        found = []
        for pid in products:
            if g not in pgoals[pid]:
                continue
            # its users with this skin type (whatever their goals), on the goal's metrics
            us = [
                uh
                for uh in f.users_of.get(pid, [])
                if f.eligible(uh) and f.users[uh].get("skin_type") == s
            ]
            if len(us) < MIN:
                continue
            ms = _goal_metrics(g, pid)
            k = sum(1 for uh in us if f.outcome(uh, ms) is not None)
            found.append(
                {
                    "product_id": pid,
                    "product": products[pid]["name"],
                    "brand": products[pid]["brand"],
                    "rate": _r2(k / len(us)),
                    "n": len(us),
                }
            )
        found.sort(key=lambda r: (-r["rate"], -r["n"], r["product_id"]))
        return found

    cells = []
    for s in cohort.SKIN_TYPES:
        for g in cohort.GOALS:
            members = [uh for uh in skin_of[s] if g in f.users[uh]["goals"]]
            el = [uh for uh in members if f.eligible(uh)]
            none = sum(1 for uh in el if f.outcome(uh, cohort.GOAL_METRICS[g]) is None)
            best = pick(s, g)
            cells.append(
                {
                    "skin": s,
                    "goal": g,
                    "users": retailer._count(len(members)),
                    "unmet": _r2(none / len(el)) if len(el) >= MIN else None,
                    "best": best[0] if best else None,
                    "runner_up": best[1] if len(best) > 1 else None,
                }
            )

    by_skin = []
    for s in cohort.SKIN_TYPES:
        us = skin_of[s]
        goal_n = Counter(g for uh in us for g in f.users[uh]["goals"])
        top_goals = [
            {"goal_id": g, "label": retailer.GOAL_LABEL[g], "share": _r2(k / len(us))}
            for g, k in sorted(goal_n.items(), key=lambda kv: (-kv[1], kv[0]))
            if k >= MIN
        ][:3]
        tops = []
        for pid in products:
            s_ = _stats(f, pid)
            if s_["row"]["tier"] == "too_few":
                continue
            el = [uh for uh in s_["el"] if f.users[uh].get("skin_type") == s]
            if len(el) < MIN:
                continue
            base = [uh for uh in s_["base"] if f.users[uh].get("skin_type") == s]
            k = sum(1 for uh in el if f.outcome(uh, targets[pid]) is not None)
            bk = sum(1 for uh in base if f.outcome(uh, targets[pid]) is not None)
            tops.append(
                {
                    "product_id": pid,
                    "product": products[pid]["name"],
                    "brand": products[pid]["brand"],
                    "image_url": products[pid].get("image_url"),
                    "rate": _r2(k / len(el)),
                    "n": len(el),
                    "lift": _r2(k / len(el) - bk / len(base)) if len(base) >= MIN else None,
                }
            )
        tops.sort(key=lambda r: (r["lift"] is None, -(r["lift"] or 0), -r["rate"], r["product_id"]))
        checked = [uh for uh in us if uh in f.kinds]
        with_finding = sum(1 for uh in checked if f.kinds[uh] - {"none"})
        by_skin.append(
            {
                "skin": s,
                "label": retailer.SKIN_LABEL[s],
                "users": skin_users[s],
                "top_goals": top_goals if skin_users[s] is not None else [],
                "top_products": tops[:5],
                "conflict_share": _r2(with_finding / len(checked))
                if len(checked) >= MIN and skin_users[s] is not None
                else None,
            }
        )
    return {
        "filters": f.filters,
        "cohort": f.cohort,
        "skin_types": [
            {"id": s, "label": retailer.SKIN_LABEL[s], "users": skin_users[s]}
            for s in cohort.SKIN_TYPES
        ],
        "goals": [{"id": g, "label": retailer.GOAL_LABEL[g]} for g in cohort.GOALS],
        "cells": cells,
        "by_skin": by_skin,
    }


# ── brands ─────────────────────────────────────────────────────────────────────────────────


def _brand_outcomes(f: Facts, brand: str | None, us: list[str] | None = None) -> tuple[int, int]:
    """(wins, n): eligible people using a measured product of `brand` (None: any brand),
    a win being a lasting change in any of those products' target metrics."""
    products, targets, _ = _catalog()
    pool = us if us is not None else f.eligible_users
    k = n = 0
    for uh in pool:
        if not f.eligible(uh):
            continue
        mine = [
            r["product_id"]
            for r in f.by_user.get(uh, [])
            if r["product_id"] in products
            and targets[r["product_id"]]
            and (brand is None or products[r["product_id"]]["brand"] == brand)
        ]
        if not mine:
            continue
        n += 1
        if any(f.outcome(uh, targets[q]) is not None for q in mine):
            k += 1
    return k, n


def _brand_users(f: Facts, brand: str) -> list[str]:
    products = _catalog()[0]
    return sorted(
        uh
        for uh, rs in f.by_user.items()
        if any(products.get(r["product_id"], {}).get("brand") == brand for r in rs)
    )


def _brand_row(f: Facts, brand: str) -> dict[str, Any]:
    key = ("brand", brand)
    if key in f.memo:
        return f.memo[key]
    products = _catalog()[0]
    us = _brand_users(f, brand)
    k, n = _brand_outcomes(f, brand, us)
    with_any = sum(1 for rs in f.by_user.values() if rs)
    shown = n >= MIN
    lo, hi = retailer._wilson(k, n) if shown else (None, None)
    el = [uh for uh in us if f.eligible(uh)]
    kept = sum(
        1
        for uh in el
        if any(
            products.get(r["product_id"], {}).get("brand") == brand and retailer._using(r, WEEKS)
            for r in f.by_user[uh]
        )
    )
    out = {
        "brand": brand,
        "products": sum(1 for p in products.values() if p["brand"] == brand),
        "users": retailer._count(len(us)),
        "n": n if shown else None,
        "rate": _r2(k / n) if shown else None,
        "lo": lo,
        "hi": hi,
        "cont8": _r2(kept / len(el)) if len(el) >= MIN and shown else None,
        "routine_share": _r2(len(us) / with_any) if len(us) >= MIN else None,
    }
    f.memo[key] = out
    return out


def brands_view(f: Facts) -> dict[str, Any]:
    rs = [_brand_row(f, b) for b in brands()]
    rs.sort(key=lambda r: (r["rate"] is None, -(r["rate"] or 0), r["brand"]))
    return {"filters": f.filters, "cohort": f.cohort, "brands": rs, "note": COMPARE_NOTE}


def find_brand(name: str) -> str | None:
    for b in brands():
        if b == name or b.lower() == name.strip().lower():
            return b
    return None


def _goal_by_brand(f: Facts, goal: str) -> dict[str | None, tuple[int, int]]:
    """Per brand (None = market): (wins, n) among eligible people with the goal using a product
    for it, a win being a lasting change in the goal's metrics."""
    key = ("goal_brand", goal)
    if key in f.memo:
        return f.memo[key]
    products, _, pgoals = _catalog()
    ms = cohort.GOAL_METRICS[goal]
    users_by: dict[str | None, set[str]] = defaultdict(set)
    for uh in f.eligible_users:
        if goal not in f.users[uh]["goals"]:
            continue
        for r in f.by_user.get(uh, []):
            q = r["product_id"]
            if q in products and goal in pgoals[q]:
                users_by[products[q]["brand"]].add(uh)
                users_by[None].add(uh)
    out = {
        b: (sum(1 for uh in us if f.outcome(uh, ms) is not None), len(us))
        for b, us in users_by.items()
    }
    f.memo[key] = out
    return out


def brand_view(f: Facts, brand_name: str) -> dict[str, Any] | None:
    brand = find_brand(brand_name)
    if brand is None:
        return None
    products, _, pgoals = _catalog()
    mine = [pid for pid, p in products.items() if p["brand"] == brand]

    goals = []
    for g in cohort.GOALS:
        if not any(g in pgoals[pid] for pid in mine):
            continue
        stats = _goal_by_brand(f, g)
        ranked = sorted(
            ((b, k / n, n) for b, (k, n) in stats.items() if b is not None and n >= MIN),
            key=lambda t: (-t[1], -t[2], t[0]),
        )
        k, n = stats.get(brand, (0, 0))
        lo, hi = retailer._wilson(k, n)
        mk, mn = stats.get(None, (0, 0))
        rival = next((t for t in ranked if t[0] != brand), None)
        rank = next((i + 1 for i, t in enumerate(ranked) if t[0] == brand), None)
        goals.append(
            {
                "goal_id": g,
                "label": retailer.GOAL_LABEL[g],
                "brand": {"rate": _r2(k / n), "n": n, "lo": lo, "hi": hi} if n >= MIN else None,
                "market": {"rate": _r2(mk / mn), "n": mn} if mn >= MIN else None,
                "best_competitor": {"brand": rival[0], "rate": _r2(rival[1]), "n": rival[2]}
                if rival
                else None,
                "rank": rank,
                "of": len(ranked),
            }
        )

    share = []
    for cat in sorted({products[pid]["category"] for pid in mine}):
        cat_users = f.category_users.get(cat, set())
        b_users = {
            uh
            for uh in cat_users
            for r in f.by_user[uh]
            if r["category"] == cat and products.get(r["product_id"], {}).get("brand") == brand
        }
        share.append(
            {
                "category": cat,
                "label": retailer.CATEGORY_LABEL.get(cat, cat),
                "brand_share": _r2(len(b_users) / len(cat_users)) if len(b_users) >= MIN else None,
                "users": retailer._count(len(b_users)),
            }
        )

    def brand_of(pid: str) -> str | None:
        return products.get(pid, {}).get("brand")

    cross = [(uh, a, b) for uh, a, b in f.switches if brand_of(a) != brand_of(b)]
    won = Counter(brand_of(a) for _, a, b in cross if brand_of(b) == brand)
    lost = Counter(brand_of(b) for _, a, b in cross if brand_of(a) == brand)
    won_n, lost_n = sum(won.values()), sum(lost.values())

    def flows(c: Counter) -> list[dict[str, Any]]:
        return [
            {"brand": b, "n": k}
            for b, k in sorted(c.items(), key=lambda kv: (-kv[1], str(kv[0])))
            if k >= MIN and b
        ]

    positioning = [
        {
            "brand": r["brand"],
            "rate": r["rate"],
            "cont8": r["cont8"],
            "users": r["users"],
            "is_self": r["brand"] == brand,
        }
        for r in (_brand_row(f, b) for b in brands())
        if r["n"] is not None
    ]

    b_users = _brand_users(f, brand)
    skin_groups = {
        s: [uh for uh in b_users if f.users[uh].get("skin_type") == s] for s in cohort.SKIN_TYPES
    }
    skin_n = {s: _brand_outcomes(f, brand, us) for s, us in skin_groups.items()}
    hidden = suppress([skin_n[s][1] for s in cohort.SKIN_TYPES])
    skin = []
    for i, s in enumerate(cohort.SKIN_TYPES):
        k, n = skin_n[s]
        mk, mn = _brand_outcomes(
            f, None, [uh for uh in f.eligible_users if f.users[uh].get("skin_type") == s]
        )
        skin.append(
            {
                "skin": s,
                "label": retailer.SKIN_LABEL[s],
                "brand_rate": None if i in hidden else _r2(k / n),
                "market_rate": _r2(mk / mn) if mn >= MIN else None,
                "n": None if i in hidden else n,
            }
        )
    return {
        "filters": f.filters,
        "cohort": f.cohort,
        "brand": brand,
        "products": sorted((_stats(f, pid)["row"] for pid in mine), key=_sort_key),
        "goals": goals,
        "share": share,
        "switching": {
            "won": flows(won),
            "lost": flows(lost),
            "net": won_n - lost_n if won_n >= MIN and lost_n >= MIN else None,
        },
        "positioning": positioning,
        "skin": skin,
        "note": COMPARE_NOTE,
    }


# ── brief ──────────────────────────────────────────────────────────────────────────────────

CardKind = Literal["win", "risk", "opportunity", "trend", "gap"]


def _card(
    id_: str,
    kind: CardKind,
    title: str,
    body: str,
    value: float | int | None,
    unit: str,
    n: int | None,
    section: str,
    target: str | None = None,
) -> dict[str, Any]:
    link: dict[str, Any] = {"section": section}
    if target:
        link["id"] = target
    return {
        "id": id_,
        "kind": kind,
        "title": title,
        "body": body,
        "value": value,
        "unit": unit,
        "n": n,
        "link": link,
    }


def _name(r: dict[str, Any]) -> str:
    return f"{r['brand']} {r['product']}"


def _feel_gap_card(f: Facts, brand: str | None = None) -> dict[str, Any] | None:
    """The product whose users most often had a visible change without feeling it working
    (self-reported): the people most likely to stop too early."""
    best = None
    for pid, p in _catalog()[0].items():
        if brand and p["brand"] != brand:
            continue
        a = (_feel(f, pid) or {}).get("agree")
        if (
            a
            and a["measured_only"] >= 0.15
            and (best is None or a["measured_only"] > best[1]["measured_only"])
        ):
            best = (pid, a)
    if best is None:
        return None
    pid, a = best
    r = _stats(f, pid)["row"]
    when = (
        f" Changes typically show around week {r['weeks']}: say so on pack." if r["weeks"] else ""
    )
    return _card(
        "feel_gap",
        "risk",
        f"People don't feel {r['product']} working yet",
        f"{_pct(a['measured_only'])}% of users asked had a visible change but didn't say it was "
        f"working (self-reported, n={a['n']}).{when}",
        _pct(a["measured_only"]),
        "percent",
        a["n"],
        "products",
        pid,
    )


def _retailer_cards(f: Facts) -> list[dict[str, Any]]:
    rs = [r for r in rows(f) if r["tier"] != "too_few"]
    cards = []
    proven = [r for r in rs if r["tier"] == "proven"]
    promising = [r for r in rs if r["tier"] == "promising" and r["to_proven"]]
    if proven:
        r = max(proven, key=lambda r: (r["lift_lo"], r["n"]))
        cards.append(
            _card(
                "top_proven",
                "win",
                f"{_name(r)} is Proven",
                f"{_pct(r['rate'])}% of its users had a visible change held to week 8, against "
                f"{_pct(r['base_rate'])}% of non-users with the same goals (n={r['n']}).",
                _pct(r["lift"]),
                "points",
                r["n"],
                "products",
                r["product_id"],
            )
        )
    elif promising:
        r = min(promising, key=lambda r: (r["to_proven"], -r["n"]))
        cards.append(
            _card(
                "closest_to_proven",
                "opportunity",
                f"{_name(r)} is close to Proven",
                f"About {r['to_proven']} more people at week 8 would make it Proven if its "
                f"{_pct(r['rate'])}% rate holds (n={r['n']}).",
                r["to_proven"],
                "people",
                r["n"],
                "products",
                r["product_id"],
            )
        )
    best = None
    for r in rs:
        for c in _segments(f, r["product_id"])["skin"]:
            if c["suppressed"] or c["base_rate"] is None:
                continue
            d = c["rate"] - c["base_rate"]
            if best is None or d > best[0]:
                best = (d, r, c)
    if best and best[0] > 0:
        _, r, c = best
        cards.append(
            _card(
                "segment_lift",
                "opportunity",
                f"{_name(r)} works best on {c['label'].lower()} skin",
                f"{_pct(c['rate'])}% of its users with {c['label'].lower()} skin had a visible "
                f"change (n={c['n']}), against {_pct(c['base_rate'])}% of non-users with "
                f"{c['label'].lower()} skin.",
                _pct(c["rate"] - c["base_rate"]),
                "points",
                c["n"],
                "segments",
                c["id"],
            )
        )
    steady = [r for r in rs if r["cont8"] is not None and r["n"] >= PROVEN_N]
    if steady:
        r = min(steady, key=lambda r: (r["cont8"], -r["n"]))
        cards.append(
            _card(
                "low_continuation",
                "risk",
                f"People stop {_name(r)}",
                f"Only {_pct(r['cont8'])}% of its users were still using it at week 8 "
                f"(n={r['n']}).",
                _pct(r["cont8"]),
                "percent",
                r["n"],
                "products",
                r["product_id"],
            )
        )
    trend = _rising_goal(f)
    if trend:
        cards.append(trend)
    gap = _gap_card(f)
    if gap:
        cards.append(gap)
    kinds = Counter(k for ks in f.kinds.values() for k in ks)
    checked = len(f.kinds)
    common = [(k, n) for k, n in kinds.most_common() if k in retailer.CONFLICT_COPY and n >= MIN]
    if checked >= MIN and common:
        k, n = common[0]
        cards.append(
            _card(
                "top_conflict",
                "opportunity",
                retailer.CONFLICT_COPY[k][0],
                f"{_pct(n / checked)}% of routines checked ({n} people). "
                f"Education and cross-sell: {retailer.CONFLICT_COPY[k][1].lower()}.",
                _pct(n / checked),
                "percent",
                n,
                "demand",
            )
        )
    gap = _feel_gap_card(f)
    if gap:
        cards.insert(min(len(cards), 3), gap)
    return cards[:6]


def _rising_goal(f: Facts) -> dict[str, Any] | None:
    people: dict[str, set[str]] = defaultdict(set)
    goal_month: dict[tuple[str, str], set[str]] = defaultdict(set)
    for r in f.months:
        people[r["month"]].add(r["user_hash"])
        for g in cohort.goals_of(r["goals"]):
            goal_month[(g, r["month"])].add(r["user_hash"])
    months = [m for m in sorted(people) if len(people[m]) >= MIN]
    if len(months) < 2:
        return None
    a, b = months[-2], months[-1]
    best = None
    for g in cohort.GOALS:
        ka, kb = len(goal_month[(g, a)]), len(goal_month[(g, b)])
        if ka < MIN or kb < MIN:
            continue
        sa, sb = _pct(ka / len(people[a])), _pct(kb / len(people[b]))
        if sb > sa and (best is None or sb - sa > best[0]):
            best = (sb - sa, g, sa, sb, len(people[b]))
    if not best:
        return None
    _, g, sa, sb, n = best

    def month(key: str) -> str:
        return calendar.month_name[int(key.split("-")[1])]

    return _card(
        "rising_goal",
        "trend",
        f"{retailer.GOAL_LABEL[g]} demand is rising",
        f"{sb}% of people with a reading in {month(b)} had this goal, up from {sa}% in "
        f"{month(a)} (n={n}).",
        sb,
        "percent",
        n,
        "demand",
        g,
    )


def _gap_card(f: Facts) -> dict[str, Any] | None:
    products, _, pgoals = _catalog()
    demand = Counter(g for u in f.users.values() for g in u["goals"])
    for g, n in sorted(demand.items(), key=lambda kv: (-kv[1], kv[0])):
        if n < MIN:
            break
        have = {cohort.tier(products[pid]["price"]) for pid in products if g in pgoals[pid]}
        missing = [t for t, _, _ in cohort.TIERS if t not in have]
        if missing:
            label = retailer.GOAL_LABEL[g]
            return _card(
                "assortment_gap",
                "gap",
                f"No {missing[0]} option for {label.lower()}",
                f"{n} people have this goal; the catalog has no {missing[0]}-tier product for it.",
                n,
                "people",
                n,
                "demand",
                g,
            )
    # Every goal has an option in every price tier: the biggest unmet need instead.
    worst = None
    for g in cohort.GOALS:
        el = [uh for uh in f.eligible_users if g in f.users[uh]["goals"]]
        if len(el) < MIN:
            continue
        none = sum(1 for uh in el if f.outcome(uh, cohort.GOAL_METRICS[g]) is None)
        if worst is None or none / len(el) > worst[0]:
            worst = (none / len(el), g, len(el))
    if worst is None:
        return None
    share, g, n = worst
    return _card(
        "unmet_need",
        "gap",
        f"{retailer.GOAL_LABEL[g]}: the biggest unmet need",
        f"{_pct(share)}% of people with this goal had no visible change by week 8 (n={n}).",
        _pct(share),
        "percent",
        n,
        "demand",
        g,
    )


def _brand_cards(f: Facts, brand: str) -> list[dict[str, Any]]:
    view = brand_view(f, brand)
    assert view is not None
    cards = []
    diffs = [
        (g["brand"]["rate"] - g["market"]["rate"], g)
        for g in view["goals"]
        if g["brand"] and g["market"]
    ]
    if diffs:
        d, g = max(diffs, key=lambda t: (t[0], t[1]["brand"]["n"]))
        if d > 0:
            cards.append(
                _card(
                    "brand_best_goal",
                    "win",
                    f"{brand} leads the market for {g['label'].lower()}",
                    f"{_pct(g['brand']['rate'])}% of {brand} users with this goal had a visible "
                    f"change held to week 8 (n={g['brand']['n']}), market "
                    f"{_pct(g['market']['rate'])}%.",
                    _pct(g["brand"]["rate"]),
                    "percent",
                    g["brand"]["n"],
                    "competitors",
                    g["goal_id"],
                )
            )
        d2, g2 = min(diffs, key=lambda t: (t[0], -t[1]["brand"]["n"]))
        if d2 < 0 and g2 is not g:
            cards.append(
                _card(
                    "brand_weakest_goal",
                    "risk",
                    f"{brand} trails the market for {g2['label'].lower()}",
                    f"{_pct(g2['brand']['rate'])}% of {brand} users with this goal had a "
                    f"visible change held to week 8 (n={g2['brand']['n']}), market "
                    f"{_pct(g2['market']['rate'])}%.",
                    _pct(g2["brand"]["rate"]),
                    "percent",
                    g2["brand"]["n"],
                    "competitors",
                    g2["goal_id"],
                )
            )
    net = view["switching"]["net"]
    if net is not None:
        cards.append(
            _card(
                "switching_net",
                "win" if net > 0 else "risk",
                f"{brand} is {'winning' if net > 0 else 'losing'} switchers",
                f"{abs(net)} more people switched {'to' if net > 0 else 'away from'} {brand} "
                f"than {'away from' if net > 0 else 'to'} it, within the same category.",
                net,
                "people",
                None,
                "competitors",
            )
        )
    measured = [r for r in view["products"] if r["tier"] != "too_few"]
    if measured:
        r = measured[0]
        cards.append(
            _card(
                "brand_top_product",
                "win" if r["tier"] in ("proven", "promising") else "risk",
                f"{r['product']}: {r['tier_label']}",
                f"{_pct(r['rate'])}% of its users had a visible change held to week 8 "
                f"(n={r['n']})"
                + (
                    f", non-users with the same goals {_pct(r['base_rate'])}%."
                    if r["base_rate"] is not None
                    else "."
                ),
                _pct(r["rate"]),
                "percent",
                r["n"],
                "products",
                r["product_id"],
            )
        )
    proven = [r for r in measured if r["tier"] == "proven"]
    promising = [r for r in measured if r["tier"] == "promising" and r["to_proven"]]
    if proven:
        cards.append(
            _card(
                "promotable",
                "opportunity",
                f"{len(proven)} {brand} product{'s' if len(proven) > 1 else ''} can be promoted",
                "Proven products can be shown to Willow users with a matching goal.",
                len(proven),
                "products",
                None,
                "promote",
            )
        )
    elif promising:
        r = min(promising, key=lambda r: r["to_proven"])
        cards.append(
            _card(
                "closest_to_proven",
                "opportunity",
                f"{r['product']} is close to Proven",
                f"About {r['to_proven']} more people at week 8 would make it Proven if its "
                f"{_pct(r['rate'])}% rate holds (n={r['n']}).",
                r["to_proven"],
                "people",
                r["n"],
                "products",
                r["product_id"],
            )
        )
    steady = [r for r in measured if r["cont8"] is not None]
    if steady:
        r = min(steady, key=lambda r: (r["cont8"], -r["n"]))
        if r is not measured[0]:
            cards.append(
                _card(
                    "brand_low_continuation",
                    "risk",
                    f"People stop {r['product']}",
                    f"{_pct(r['cont8'])}% of its users were still using it at week 8 (n={r['n']}).",
                    _pct(r["cont8"]),
                    "percent",
                    r["n"],
                    "products",
                    r["product_id"],
                )
            )
    gap = _feel_gap_card(f, brand)
    if gap:
        cards.insert(min(len(cards), 3), gap)
    return cards[:6]


def brief_cards(f: Facts, brand: str | None = None) -> list[dict[str, Any]]:
    if len(f.users) < MIN:
        return []
    return _brand_cards(f, brand) if brand else _retailer_cards(f)


SUMMARY_INSTRUCTIONS = """You write the opening summary of a retail intelligence brief for a
skincare {audience}. CARDS (JSON) are insights computed from measured skin outcomes of people
tracking their skin with Willow: a "visible change" is a measured change beyond the person's own
photo noise that holds to week 8. Write at most 50 words, 2 or 3 short sentences, plain British
English, for a business reader: the most important win, the main risk and one next step.
- Use only numbers that appear in CARDS, exactly as written there. Never compute new numbers.
- Observational, cosmetic language. Never say "clinically proven", "proven to treat", "cures"
  or name a skin condition. Never rank or compare people by skin tone.
- A card that says "self-reported" is what people said, not a measurement: call it that.
- If the cohort label says simulated, end with "(simulated cohort)"."""


class Summary(BaseModel):
    text: str = Field(max_length=600)


def summary_problems(text: str, cards: list[dict[str, Any]]) -> list[str]:
    """A summary passes only when every number in it is in the cards (values and text)."""
    found = []
    if len(text.split()) > 60:
        found.append("longer than 60 words")
    if not numbers.only_known(text, numbers.collect(cards)):
        found.append("quotes a number that is not in the cards")
    if BANNED.search(text) or "clinically" in text.lower():
        found.append("banned wording")
    return found


_summaries: dict[tuple, tuple[float, dict[str, Any] | None]] = {}
SUMMARY_RETRY_SECONDS = 60
SUMMARY_DRAFTS = 2


def summarise(
    cards: list[dict[str, Any]], key: tuple, cohort_label_: str, brand: str | None
) -> dict[str, Any] | None:
    """Gemini's <= 60-word summary of the cards, validated; None when it is unavailable or
    fails the checks. Cached per key; a Gemini outage is retried after a minute."""
    hit = _summaries.get(key)  # (valid until, summary or None)
    if hit and time.time() < hit[0]:
        return hit[1]
    if not cards:
        return None
    payload = {"cohort": cohort_label_, "brand": brand, "cards": cards}
    parts = [f"CARDS (JSON):\n{json.dumps(payload, separators=(',', ':'))}"]
    out = None
    for draft in range(SUMMARY_DRAFTS):  # a rejected draft gets one rewrite, told what failed
        try:
            reply = gemini.generate_json(
                "retailer_brief",
                parts,
                Summary,
                instructions=SUMMARY_INSTRUCTIONS.format(audience="brand" if brand else "retailer"),
                temperature=0.2,
                max_output_tokens=2048,
                attempts=1,
                timeout_ms=20_000,
            )
        except Exception as exc:  # Gemini down, timeout, bad JSON: the brief still loads
            log.warning(
                "brief summary unavailable: %s",
                exc,
                exc_info=not isinstance(exc, gemini.GeminiError),
            )
            _summaries[key] = (time.time() + SUMMARY_RETRY_SECONDS, None)
            return None
        found = summary_problems(reply.text, cards)
        if not found:
            out = {"text": reply.text.strip(), "validated": True}
            break
        log.warning("brief summary draft %d rejected: %s", draft + 1, found)
        parts = [
            *parts[:1],
            f"Your previous draft was rejected ({'; '.join(found)}):\n{reply.text}\n"
            "Rewrite it to fix exactly that, keeping every other rule.",
        ]
    # Kept for this data version and day (a rejected draft too); only an outage is retried.
    _summaries[key] = (math.inf, out)
    return out


SUMMARY_WAIT_SECONDS = 1.5
_inflight: dict[tuple, threading.Thread] = {}
_inflight_lock = threading.Lock()


def summary_for(
    cards: list[dict[str, Any]], key: tuple, cohort_label_: str, brand: str | None
) -> tuple[dict[str, Any] | None, bool]:
    """(summary, pending). The cards never wait on Gemini: the summary is written in the
    background and the request waits at most SUMMARY_WAIT_SECONDS for it; when it isn't ready
    the brief says `summary_pending` and the page asks again a few seconds later."""
    hit = _summaries.get(key)
    if hit and time.time() < hit[0]:
        return hit[1], False
    if not cards:
        return None, False
    with _inflight_lock:
        t = _inflight.get(key)
        if t is None or not t.is_alive():
            t = threading.Thread(
                target=summarise, args=(cards, key, cohort_label_, brand), daemon=True
            )
            _inflight[key] = t
            t.start()
    t.join(SUMMARY_WAIT_SECONDS)
    hit = _summaries.get(key)
    if hit and time.time() < hit[0]:
        return hit[1], False
    return None, True


# ── cached wrappers (what the routes call) ─────────────────────────────────────────────────

_facts: dict[tuple[str, str], tuple[int, date, Facts]] = {}
_lock = threading.Lock()


def facts(cohort_: str = "mixed", range_: str = "all") -> tuple[Facts, int, date]:
    """One filter's facts, built once per data version and day (raises when BigQuery is
    unavailable and nothing is cached, like retailer.insights)."""
    if cohort_ not in ("simulated", "mixed", "real") or range_ not in retailer.RANGE_DAYS:
        raise ValueError(f"unknown filter {cohort_}/{range_}")
    raw, version = retailer._rows()
    today = datetime.now(UTC).date()
    hit = _facts.get((cohort_, range_))
    if hit and hit[0] == version and hit[1] == today:
        return hit[2], version, today
    with _lock:
        hit = _facts.get((cohort_, range_))
        if hit and hit[0] == version and hit[1] == today:
            return hit[2], version, today
        since = retailer.since_of(range_, today)
        f = build_facts(
            retailer.select(raw, cohort_, range_, today),
            {
                "cohort": cohort_,
                "range": range_,
                "since": since.date().isoformat() if since else None,
                "today": today.isoformat(),
            },
        )
        _facts[(cohort_, range_)] = (version, today, f)
        return f, version, today


def _cached(name: str, cohort_: str, range_: str, build, *extra: Any) -> Any:
    f, _, _ = facts(cohort_, range_)
    key = ("view", name, *extra)
    if key not in f.memo:
        f.memo[key] = build(f, *extra)
    return f.memo[key]


def products(cohort_: str = "mixed", range_: str = "all") -> dict[str, Any]:
    return _cached("products", cohort_, range_, products_view)


def product(product_id: str, cohort_: str = "mixed", range_: str = "all") -> dict[str, Any] | None:
    return _cached("product", cohort_, range_, product_view, product_id)


def segments(cohort_: str = "mixed", range_: str = "all") -> dict[str, Any]:
    return _cached("segments", cohort_, range_, segments_view)


def brands_list(cohort_: str = "mixed", range_: str = "all") -> dict[str, Any]:
    return _cached("brands", cohort_, range_, brands_view)


def brand(name: str, cohort_: str = "mixed", range_: str = "all") -> dict[str, Any] | None:
    return _cached("brand", cohort_, range_, brand_view, name)


def brief(
    cohort_: str = "mixed", range_: str = "all", brand_name: str | None = None
) -> dict[str, Any] | None:
    """Deterministic cards plus a validated Gemini summary (None if unavailable; `summary_pending`
    while it is being written). None when the brand is unknown."""
    f, version, today = facts(cohort_, range_)
    b = None
    if brand_name:
        b = find_brand(brand_name)
        if b is None:
            return None
    cards = _cached("brief", cohort_, range_, brief_cards, b)
    summary, pending = summary_for(
        cards, (cohort_, range_, b, version, today), cohort_label(f.cohort), b
    )
    return {
        "filters": f.filters,
        "cohort": f.cohort,
        "cards": cards,
        "summary": summary,
        "summary_pending": pending,
    }


def _eligibility_entry(f: Facts, pid: str) -> dict[str, Any]:
    row, el = _stats(f, pid)["row"], eligibility(f, pid)
    ev = _evidence(f, pid)
    return {
        "product_id": pid,
        "product": row["product"],
        "brand": row["brand"],
        **el,
        "evidence": ev[0]["text"] if ev else "",
    }


def eligibility_all() -> list[dict[str, Any]]:
    """Every product's promotion eligibility on cohort=mixed, range=all (the evidence shoppers
    see): {product_id, product, brand, tier, eligible, reasons, goals, skin_types, evidence}.
    Raises when the rows are unavailable."""
    f, _, _ = facts("mixed", "all")
    return [_eligibility_entry(f, pid) for pid in sorted(_catalog()[0])]


def product_eligibility(product_id: str) -> dict[str, Any] | None:
    """One product's entry from eligibility_all(), or None for an unknown product."""
    if product_id not in _catalog()[0]:
        return None
    f, _, _ = facts("mixed", "all")
    return _eligibility_entry(f, product_id)


# ── AutoCampaign signals (app/autopilot.py) ───────────────────────────────────────────────


def rising_goals(f: Facts) -> dict[str, dict[str, Any]]:
    """Every goal whose share of people with a reading rose from the second-last to the last
    month (both months 10+ people, the goal 10+ people in each): {goal: {from, to, n}}, whole
    percents, as the brief's `rising_goal` card."""
    people: dict[str, set[str]] = defaultdict(set)
    goal_month: dict[tuple[str, str], set[str]] = defaultdict(set)
    for r in f.months:
        people[r["month"]].add(r["user_hash"])
        for g in cohort.goals_of(r["goals"]):
            goal_month[(g, r["month"])].add(r["user_hash"])
    months = [m for m in sorted(people) if len(people[m]) >= MIN]
    if len(months) < 2:
        return {}
    a, b = months[-2], months[-1]
    out = {}
    for g in cohort.GOALS:
        ka, kb = len(goal_month[(g, a)]), len(goal_month[(g, b)])
        if ka < MIN or kb < MIN:
            continue
        sa, sb = _pct(ka / len(people[a])), _pct(kb / len(people[b]))
        if sb > sa:
            out[g] = {"from": sa, "to": sb, "n": len(people[b])}
    return out


def autopilot_signals() -> dict[str, Any]:
    """What AutoCampaign rules watch, on cohort=mixed, range=all (the evidence shoppers see, as
    campaign eligibility): per product its eligibility with tier, n and lift; the goals rising
    month on month; and every skin type x goal group's unmet share. Raises when the rows are
    unavailable."""
    f, version, _ = facts("mixed", "all")
    products = []
    for pid in sorted(_catalog()[0]):
        row = _stats(f, pid)["row"]
        entry = _eligibility_entry(f, pid)
        products.append(
            entry
            | {
                "category": row["category"],
                "n": row.get("n"),
                "lift": row.get("lift"),
                "lift_lo": row.get("lift_lo"),
                "rate": row.get("rate"),
                "base_rate": row.get("base_rate"),
            }
        )
    cells = segments_view(f)["cells"]
    return {
        "version": version,
        "cohort": cohort_label(f.cohort),
        "products": products,
        "rising": rising_goals(f),
        "unmet": [
            {"skin": c["skin"], "goal": c["goal"], "unmet": c["unmet"], "users": c["users"]}
            for c in cells
            if c["unmet"] is not None
        ],
    }
