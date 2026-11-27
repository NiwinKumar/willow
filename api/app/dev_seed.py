"""Sample campaigns: simulated history the campaign pages read like real traffic.

Three campaigns, one of each kind the pages show: running with a clear lift, running and still
collecting (a holdout under 10 people), and ended with an unclear result. Each has a daily
history with a weekly rhythm and per-person members, in the same store tables as real traffic.

- Dev (DEV_STORE=memory with AUTH_MODE=dev): seeded at startup for the dev account (main.py).
- Proof demo: the first time a person joins a demo organisation ("Try as", proof_orgs.join), for
  that person and organisation, with that organisation's products.

Every one is `demo` (made under a demo membership) and `sample` (simulated: labelled so on the
pages; never served to shoppers, never counted against the running cap or the one live campaign
per product, never part of AutoCampaign)."""

import hashlib
import math
import random
from datetime import timedelta
from typing import Any

from app import campaigns, catalog, cohort, proof_orgs

DEV_OWNER = "e2e_local"

# One entry per campaign: the product, days since it started, planned length, the people in each
# group with how many added the product, and the daily peak of people shown the card.
SPECS: list[dict[str, Any]] = [
    {
        "id": "c_demo0000niac",
        "product": "cosrx-the-niacinamide-15-serum",
        "goals": ["dark_spots", "oil_glow"],
        "ago": 11,
        "days": 14,
        "exposed": (420, 84),
        "holdout": (105, 15),
        "peak": 90,
    },
    {
        "id": "c_demo0000sun0",
        "product": "the-derma-co-1-hyaluronic-sunscreen-aqua-gel-spf-50",
        "goals": ["dark_spots", "lines"],
        "ago": 3,
        "days": 7,
        "exposed": (94, 17),
        "holdout": (7, 0),
        "peak": 46,
    },
    {
        "id": "c_demo0000glow",
        "product": "beauty-of-joseon-glow-deep-serum-rice-alpha-arbutin",
        "goals": ["dark_spots", "even_tone"],
        "ago": 19,
        "days": 14,
        "exposed": (560, 146),
        "holdout": (140, 17),
        "peak": 110,
    },
]
CLICK_RATE = 0.27
# A brand org whose brand has no SPECS product borrows its own catalog products for the specs, in
# this order: the finished result first, then the running one with a clear lift.
FILL_ORDER = ("c_demo0000glow", "c_demo0000niac", "c_demo0000sun0")


def _daily(rng: random.Random, n: int, peak: int) -> list[int]:
    """People shown the card each day: a ramp that levels off, a weekend dip, some noise."""
    out = []
    for i in range(n):
        ramp = 1 - math.exp(-(i + 1) / 3.2)
        weekend = 0.72 if (i % 7) in (5, 6) else 1.0
        out.append(max(4, round(peak * ramp * weekend * rng.uniform(0.82, 1.12))))
    return out


def sample_id(owner: str, org_id: str | None, spec_id: str) -> str:
    """The same id every time for one person, org and spec: seeding twice rewrites the same
    documents instead of adding campaigns (c_ + 12 hex, as campaign_routes.CAMPAIGN_ID)."""
    key = f"sample|{owner}|{org_id or ''}|{spec_id}".encode()
    return "c_" + hashlib.sha256(key).hexdigest()[:12]


def plan(org: dict[str, Any] | None, taken: set[str]) -> list[tuple[dict[str, Any], dict]]:
    """(spec, product) pairs to seed. No org (dev): every SPECS product. An org: the SPECS products
    of its brands; a brand org fills the specs left over with its own catalog products that map to
    a goal. A product in `taken` (the owner already has a campaign on it) is never used again."""
    brands = set(org["brands"]) if org else None
    used = set(taken)
    out: dict[str, tuple[dict[str, Any], dict]] = {}
    for spec in SPECS:
        p = catalog.by_id(spec["product"])
        if p and (brands is None or p["brand"] in brands) and p["product_id"] not in used:
            out[spec["id"]] = (spec, p)
            used.add(p["product_id"])
    if org and org["kind"] == "brand":
        spare = [
            p
            for p in catalog.products()
            if p["brand"] in brands
            and p["product_id"] not in used
            and cohort.goals_of(p.get("concerns"))
        ]
        by_id = {s["id"]: s for s in SPECS}
        for sid in FILL_ORDER:
            if sid not in out and spare:
                p = spare.pop(0)
                goals = cohort.goals_of(p.get("concerns"))[:2]
                out[sid] = ({**by_id[sid], "goals": goals}, p)
    return [out[s["id"]] for s in SPECS if s["id"] in out]


def seed_demo_campaigns(store: Any, owner: str = DEV_OWNER, org_id: str | None = None) -> list[str]:
    """Create the sample campaigns for this owner (under `org_id`, None in dev); returns their
    ids, [] when every product they would use already has a campaign of this owner (so a second
    call adds nothing). The workspace follows the org: a retailer org's is "retailer", a brand
    org's the product's brand (as campaign_routes.create_campaign)."""
    org = proof_orgs.org(org_id) if org_id else None
    taken = {d.get("product_id") for _, d in store.campaigns_of(owner)}
    at = campaigns.now()
    made = []
    for spec, product in plan(org, taken):
        rng = random.Random(spec["id"])
        start = at - timedelta(days=spec["ago"])
        end = start + timedelta(days=spec["days"])
        cid = sample_id(owner, org_id, spec["id"])
        doc = {
            "owner_uid": owner,
            "workspace": product["brand"] if org and org["kind"] == "brand" else "retailer",
            "org_id": org_id,
            "instance": org["instance"] if org else None,
            "demo": True,
            "sample": True,
            "product_id": product["product_id"],
            "goals": spec["goals"],
            "skin_types": [],
            "placement": "routine",
            # a finished one is stored ended: it never shows in campaigns_active() scans
            "status": "active" if end > at else "ended",
            "days": spec["days"],
            "holdout_pct": campaigns.HOLDOUT_PCT,
            "starts_at": start,
            "ends_at": end,
            "created_at": start,
            "updated_at": start,
        }
        (n_exposed, added_exposed), (n_holdout, added_holdout) = spec["exposed"], spec["holdout"]
        ran = min(spec["ago"] + 1, spec["days"])
        shown = _daily(rng, ran, spec["peak"])
        adds_left = added_exposed
        days = []
        for i, n in enumerate(shown):
            day = (start + timedelta(days=i)).date().isoformat()
            adds = min(adds_left, round(added_exposed * n / sum(shown)))
            adds_left -= adds
            clicks = round(n * CLICK_RATE * rng.uniform(0.85, 1.15))
            days.append({"day": day, "impressions": n, "clicks": clicks, "adds": adds})
        members = []
        for group, n, added in (
            ("exposed", n_exposed, added_exposed),
            ("holdout", n_holdout, added_holdout),
        ):
            winners = set(rng.sample(range(n), added))
            for k in range(n):
                first = (
                    start + timedelta(days=min(ran - 1, int(rng.random() ** 0.8 * ran)))
                ).date()
                member = {"group": group, "first_day": first.isoformat(), "added": k in winners}
                if group == "exposed":
                    member |= {"seen": True, "seen_day": first.isoformat()}
                mid = hashlib.sha256(f"{cid}-{group}-{k}".encode()).hexdigest()[:32]
                members.append((mid, member))
        store.campaign_seed(cid, doc, days, members)
        made.append(cid)
    return made
