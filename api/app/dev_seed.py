"""Sample campaigns: a simulated campaign portfolio the campaign pages read like real traffic.

Each organisation gets a portfolio on Proven products (retail_intel, cohort=mixed, range=all:
what the Products page shows), built deterministically from the products' measured outcomes. The
best known Proven products are chosen (cohort_products.json order), then sorted by measured lift
to take the slots (the clear results on the strongest, the unclear one on the weakest):
- A retailer org (and dev, no org): RETAILER_SLOTS (11 campaigns) on Proven products sold in
  Southeast Asia or everywhere (app/regions.py, a Singapore retailer), one per brand, at most two
  per category: 4 finished (two with a clear lift over the randomised holdout, one whose
  interval includes zero, one stopped early), 4 running with a lift so far, 2 still collecting
  (holdout under 10 people) and 1 paused.
- A brand org: 3 to 5 of its own brand's Proven products (fewer if it has fewer; none if it has
  none), BRAND_SLOTS in order. The willow instance's org per brand gets only that brand's.
Every campaign has its own reach (hundreds to a few thousand people), a click rate of 20-30%, a
holdout of 20% (HOLDOUT, as campaigns.HOLDOUT_PCT) and adoption among the people who could see
the card above the holdout's by an amount that grows with the product's measured lift
(adoption_uplift). Numbers depend only on the product and the slot, so every person sees the
same portfolio.

- Dev (DEV_STORE=memory with AUTH_MODE=dev): seeded at startup for the dev account (main.py).
- Proof demo: the first time a person joins a demo organisation ("Try as", proof_orgs.join), for
  that person and organisation.

Every one is `demo` (made under a demo membership) and `sample` (simulated: labelled so on the
pages; never served to shoppers, never counted against the running cap or the one live campaign
per product, never part of AutoCampaign). Their group sizes and adds are stored as a `tally` on
the campaign (campaigns.stats reads it) instead of one document per person: a portfolio is about
200 Firestore writes (daily rows + campaigns), not tens of thousands of members."""

import hashlib
import math
import random
from datetime import timedelta
from typing import Any

from app import campaigns, catalog, cohort, proof_orgs, regions, retail_intel

DEV_OWNER = "e2e_local"
RETAILER_MARKET = "SG"  # Northside is a Singapore retailer: products sold in SEA or GLOBAL
HOLDOUT = 0.2  # the samples' holdout share (campaigns.HOLDOUT_PCT in production)


class SamplesUnavailable(Exception):
    """The measured outcomes (BigQuery rows) are unavailable: nothing to build samples from."""


# One kind of campaign per slot: (days ago it started, planned days, days it ran before it was
# stopped or paused (None: ran until now or its end), people reached (exposed, seen the card)).
KINDS: dict[str, dict[str, Any]] = {
    "won": {"ago": (30, 52), "days": (21, 28), "ran": None, "reach": (1400, 3200)},
    "flat": {"ago": (24, 34), "days": (14, 21), "ran": None, "reach": (380, 520)},
    "stopped": {"ago": (12, 20), "days": (21, 21), "ran": (5, 7), "reach": (450, 900)},
    "running": {"ago": (7, 16), "days": (21, 28), "ran": None, "reach": (600, 1800)},
    "collecting": {"ago": (1, 2), "days": (14, 14), "ran": None, "reach": (24, 40)},
    "paused": {"ago": (9, 14), "days": (21, 21), "ran": (5, 8), "reach": (400, 800)},
}
# Products sorted by measured lift, strongest first, take these slots in this order: the clear
# results on the strongest products, the interval that includes zero on the weakest.
RETAILER_SLOTS = (
    "won",
    "running",
    "won",
    "running",
    "stopped",
    "running",
    "collecting",
    "running",
    "paused",
    "collecting",
    "flat",
)
BRAND_SLOTS = ("won", "running", "collecting", "flat", "paused")


def adoption_uplift(measured_lift: float | None) -> float:
    """Extra adoption among people shown the card over the holdout: 4-14 points, more for a
    product whose measured outcome lift is larger (an invented, stated assumption)."""
    return min(0.14, max(0.04, 0.03 + 0.25 * (measured_lift or 0.0)))


def _daily_shape(n: int, rng: random.Random) -> list[float]:
    """Relative people shown the card each day: a ramp that levels off, a weekend dip, noise."""
    out = []
    for i in range(n):
        weekend = 0.72 if (i % 7) in (5, 6) else 1.0
        out.append((1 - math.exp(-(i + 1) / 3.2)) * weekend * rng.uniform(0.82, 1.12))
    return out


def numbers(kind: str, product_id: str, measured_lift: float | None) -> dict[str, Any]:
    """One campaign's simulated history, from the kind and the product only: timing, group sizes
    and adds (exposed vs holdout), and the daily impressions, clicks and adds."""
    spec = KINDS[kind]
    rng = random.Random(f"sample|{kind}|{product_id}")
    ago = rng.randint(*spec["ago"])
    days = rng.choice(range(spec["days"][0], spec["days"][1] + 1, 7))
    stop = rng.randint(*spec["ran"]) if spec["ran"] else None
    n1 = rng.randint(*spec["reach"])
    base = rng.uniform(0.03, 0.07)  # adds without the card (the holdout's organic adoption)
    if kind == "collecting":
        n2 = rng.randint(5, 9)
        uplift = adoption_uplift(measured_lift)
    else:
        n2 = round(n1 * HOLDOUT / (1 - HOLDOUT))
        uplift = (
            rng.uniform(0.004, 0.012)
            if kind == "flat"
            else adoption_uplift(measured_lift) * rng.uniform(0.85, 1.15)
        )
        if kind == "won":  # a finished clear result: its interval sits above zero
            uplift = max(uplift, 0.06)
    a1, a2 = round(n1 * (base + uplift)), round(n2 * base)
    ran = stop or min(ago + 1, days)
    shape = _daily_shape(ran, rng)
    impressions = n1 * rng.uniform(1.4, 1.9)  # people see the card on more than one day
    ctr = rng.uniform(0.2, 0.3)
    daily, adds_left = [], a1
    for i, w in enumerate(shape):
        shown = max(4, round(impressions * w / sum(shape)))
        adds = adds_left if i == ran - 1 else min(adds_left, round(a1 * w / sum(shape)))
        adds_left -= adds
        clicks = max(adds, round(shown * ctr * rng.uniform(0.85, 1.15)))
        daily.append({"offset": i, "impressions": shown, "clicks": clicks, "adds": adds})
    return {
        "ago": ago,
        "days": days,
        "stopped_after": stop,
        "tally": {
            "reach": n1,
            "exposed": {"n": n1, "added": a1},
            "holdout": {"n": n2, "added": a2},
        },
        "daily": daily,
    }


def sample_id(owner: str, org_id: str | None, product_id: str) -> str:
    """The same id every time for one person, org and product: seeding twice rewrites the same
    documents instead of adding campaigns (c_ + 12 hex, as campaign_routes.CAMPAIGN_ID)."""
    key = f"sample|{owner}|{org_id or ''}|{product_id}".encode()
    return "c_" + hashlib.sha256(key).hexdigest()[:12]


def _proven() -> list[dict[str, Any]]:
    """Proven products that can be promoted (a goal with its own positive lift), best known
    first, with their eligible goals."""
    try:
        rows = retail_intel.products("mixed", "all")["products"]
        elig = {e["product_id"]: e for e in retail_intel.eligibility_all()}
    except Exception as exc:  # BigQuery unavailable and nothing cached
        raise SamplesUnavailable(str(exc)) from exc
    out = [
        {**r, "goals": elig[r["product_id"]]["goals"]}
        for r in rows
        if r["tier"] == "proven" and elig.get(r["product_id"], {}).get("eligible")
    ]
    # best known first (the cohort's product order): what a retailer or brand would promote
    known = {pid: i for i, pid in enumerate(cohort.cohort_product_ids())}
    out.sort(key=lambda r: (known.get(r["product_id"], len(known)), r["product_id"]))
    return out


def _by_lift(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda r: (-(r["lift"] or 0), -(r["n"] or 0), r["product_id"]))


def plan(org: dict[str, Any] | None, taken: set[str]) -> list[tuple[str, dict[str, Any]]]:
    """(kind, product row) pairs to seed. No org (dev) or a retailer org: RETAILER_SLOTS on
    Proven products sold near the retailer, one per brand and at most two per category. A brand
    org: 3-5 of its brand's Proven products (BRAND_SLOTS). A product in `taken` (the owner already
    has a campaign on it) is never used again."""
    proven = [r for r in _proven() if r["product_id"] not in taken]
    if org and org["kind"] == "brand":
        brands = set(org["brands"])
        mine = [r for r in proven if r["brand"] in brands]
        # 3, 4 or 5, fixed per brand
        want = 3 + int(hashlib.sha256(org["id"].encode()).hexdigest(), 16) % 3
        return list(zip(BRAND_SLOTS, _by_lift(mine[:want]), strict=False))
    picked: list[dict[str, Any]] = []
    brands_used: set[str] = set()
    per_cat: dict[str, int] = {}
    for r in proven:
        p = catalog.by_id(r["product_id"])
        if not p or regions.distance(p, RETAILER_MARKET) > 1 or r["brand"] in brands_used:
            continue
        if per_cat.get(r["category"], 0) >= 2:
            continue
        picked.append(r)
        brands_used.add(r["brand"])
        per_cat[r["category"]] = per_cat.get(r["category"], 0) + 1
        if len(picked) == len(RETAILER_SLOTS):
            break
    return list(zip(RETAILER_SLOTS, _by_lift(picked), strict=False))


def seed_demo_campaigns(store: Any, owner: str = DEV_OWNER, org_id: str | None = None) -> list[str]:
    """Create the sample campaigns for this owner (under `org_id`, None in dev); returns the ids
    written, [] when every one already exists (so a second call adds nothing). The workspace
    follows the org: a retailer org's is "retailer", a brand org's the product's brand (as
    campaign_routes.create_campaign). Raises SamplesUnavailable when the outcomes cannot be read.
    """
    org = proof_orgs.org(org_id) if org_id else None
    mine = store.campaigns_of(owner)
    have = {cid for cid, _ in mine}
    # products this owner already promotes elsewhere (this org's own samples do not count, so a
    # retry plans the same portfolio and writes only what is missing)
    taken = {
        d.get("product_id")
        for _, d in mine
        if not (campaigns.is_sample(d) and d.get("org_id") == org_id)
    }
    at = campaigns.now()
    made = []
    for kind, row in plan(org, taken):
        cid = sample_id(owner, org_id, row["product_id"])
        if cid in have:
            continue
        sim = numbers(kind, row["product_id"], row["lift"])
        start = at - timedelta(days=sim["ago"])
        end = start + timedelta(days=sim["days"])
        doc: dict[str, Any] = {
            "owner_uid": owner,
            "workspace": row["brand"] if org and org["kind"] == "brand" else "retailer",
            "org_id": org_id,
            "instance": org["instance"] if org else None,
            "demo": True,
            "sample": True,
            "product_id": row["product_id"],
            "goals": row["goals"][:2],
            "skin_types": [],
            "placement": "routine",
            # a finished one is stored ended: it never shows in campaigns_active() scans
            "status": "paused" if kind == "paused" else "active" if end > at else "ended",
            "days": sim["days"],
            "holdout_pct": HOLDOUT,
            "starts_at": start,
            "ends_at": end,
            "created_at": start,
            "updated_at": start,
            "tally": sim["tally"],
        }
        if kind == "stopped":  # ended early by its owner (campaigns.end)
            stopped = start + timedelta(days=sim["stopped_after"])
            doc |= {"status": "ended", "ends_at": stopped, "ended_early": True}
            doc["updated_at"] = stopped
        if kind == "paused":
            doc["updated_at"] = start + timedelta(days=sim["stopped_after"])
        days = [
            {
                "day": (start + timedelta(days=d["offset"])).date().isoformat(),
                "impressions": d["impressions"],
                "clicks": d["clicks"],
                "adds": d["adds"],
            }
            for d in sim["daily"]
        ]
        store.campaign_seed(cid, doc, days, [])
        made.append(cid)
    return made
