"""Local demo data for DEV_STORE=memory (AUTH_MODE=dev only, never in production).

Three campaigns for the dev web app's account (X-Dev-Uid e2e_local), one of each kind the page
reads: running with a clear lift, running and still collecting (a holdout under 10 people), and
ended with an unclear result. Each has a daily history with a weekly rhythm. They fill the same
store tables as real traffic, so the campaign page reads them as it would real ones."""

import hashlib
import math
import random
from datetime import timedelta
from typing import Any

from app import campaigns

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
        "exposed": (640, 168),
        "holdout": (160, 19),
        "peak": 120,
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
        "exposed": (260, 44),
        "holdout": (66, 9),
        "peak": 58,
    },
]
CLICK_RATE = 0.27


def _daily(rng: random.Random, n: int, peak: int) -> list[int]:
    """People shown the card each day: a ramp that levels off, a weekend dip, some noise."""
    out = []
    for i in range(n):
        ramp = 1 - math.exp(-(i + 1) / 3.2)
        weekend = 0.72 if (i % 7) in (5, 6) else 1.0
        out.append(max(4, round(peak * ramp * weekend * rng.uniform(0.82, 1.12))))
    return out


def seed_demo_campaigns(store: Any) -> list[str]:
    """Create the demo campaigns once in the MemoryStore; returns their ids ([] if seeded)."""
    if store.campaigns_of(DEV_OWNER):
        return []
    at = campaigns.now()
    made = []
    for spec in SPECS:
        rng = random.Random(spec["id"])
        start = at - timedelta(days=spec["ago"])
        cid = spec["id"]
        store.campaign_set(
            cid,
            {
                "owner_uid": DEV_OWNER,
                "workspace": "retailer",
                "product_id": spec["product"],
                "goals": spec["goals"],
                "skin_types": [],
                "placement": "routine",
                "status": "active",
                "days": spec["days"],
                "holdout_pct": campaigns.HOLDOUT_PCT,
                "starts_at": start,
                "ends_at": start + timedelta(days=spec["days"]),
                "created_at": start,
                "updated_at": start,
            },
        )
        (n_exposed, added_exposed), (n_holdout, added_holdout) = spec["exposed"], spec["holdout"]
        ran = min(spec["ago"] + 1, spec["days"])
        shown = _daily(rng, ran, spec["peak"])
        adds_left = added_exposed
        for i, n in enumerate(shown):
            day = (start + timedelta(days=i)).date().isoformat()
            adds = min(adds_left, round(added_exposed * n / sum(shown)))
            adds_left -= adds
            clicks = round(n * CLICK_RATE * rng.uniform(0.85, 1.15))
            store.campaign_daily[(cid, day)] = {
                "day": day,
                "impressions": n,
                "clicks": clicks,
                "adds": adds,
            }
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
                store.campaign_member_join(cid, mid, member)
        made.append(cid)
    return made
