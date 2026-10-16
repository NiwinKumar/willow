"""Proof-gated promotion (docs/RETAILER_INSIGHTS.md "Proof-gated promotion").

A brand or retailer can pay to show a product in the consumer app's Routine page, but only a
product whose measured outcomes clear Willow's evidence bar (Proof tier `proven`), only for goals
that evidence covers, and a brand workspace only for its own brand. Money buys reach (a labelled
"Sponsored" card), never rank or eligibility: organic suggestions never read campaign data.

Eligibility comes from `app.retail_intel` (always cohort=mixed, range=all: the evidence consumers
see). The import is lazy and goes through `eligibility_of` / `eligibility_all`, the seam the tests
replace; without retail_intel the retailer endpoints answer 503 and nobody sees a sponsored card.
"""

import hashlib
import math
import secrets
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import HTTPException

from app import catalog, cohort
from app.retailer import GOAL_LABEL, SKIN_LABEL
from app.store import Doc, Store, iso

MAX_ACTIVE = 3  # running (active, in date) campaigns per owner
# The holdout comparison (people with person-level outcomes, exposed vs holdout) waits for this many
# people in each group, as every other retail aggregate (retailer.MIN_GROUP). Delivery counts are
# ad events with no person attribute and no segment split: shown as counted.
MIN_GROUP = 10
COHORT_LABEL = "Willow cohort, includes simulated data"
DISCLOSURE = (
    "Brands pay to show a product here; only products that meet Willow's evidence bar can be "
    "shown, and payment never changes your recommendations. Ranking of your own recommendations "
    "is computed from measured outcomes only."
)
# Randomised holdout: this share of the people a campaign matches never see its card, so adoption
# among those who could see it (exposed) is compared with adoption among those who could not.
HOLDOUT_PCT = 0.2
INCREMENTALITY_NOTE = (
    "Adoption lift vs a randomised holdout. Skin-outcome lift for adopters appears once they "
    "reach week 8."
)


class Unavailable(Exception):
    """The evidence (retail_intel / BigQuery) cannot be read right now."""


def _intel():
    try:
        from app import retail_intel  # slice A; imported lazily so this module stands alone
    except ImportError as exc:
        raise Unavailable("retail_intel missing") from exc
    return retail_intel


def eligibility_of(product_id: str) -> dict[str, Any] | None:
    """{product_id, product, brand, tier, eligible, reasons, goals, skin_types, evidence}."""
    intel = _intel()
    try:
        return intel.product_eligibility(product_id)
    except Exception as exc:  # BigQuery unavailable
        raise Unavailable(str(exc)) from exc


def eligibility_all() -> list[dict[str, Any]]:
    intel = _intel()
    try:
        return list(intel.eligibility_all())
    except Exception as exc:
        raise Unavailable(str(exc)) from exc


def unavailable() -> HTTPException:
    return HTTPException(
        503, {"code": "insights_unavailable", "message": "Insights are unavailable right now."}
    )


def now() -> datetime:
    return datetime.now(UTC)


def today() -> date:
    return now().date()


def _aware(v: Any) -> datetime | None:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=UTC)
    if isinstance(v, str):
        return _aware(datetime.fromisoformat(v.replace("Z", "+00:00")))
    return None


def status_of(doc: Doc, at: datetime | None = None) -> str:
    """Stored active|paused; `ended` once ends_at has passed (or the owner ended it early, which
    moves ends_at to that moment), whatever was stored."""
    end = _aware(doc.get("ends_at"))
    if end is not None and (at or now()) >= end:
        return "ended"
    return doc.get("status") or "paused"


def running(doc: Doc, at: datetime | None = None) -> bool:
    at = at or now()
    start = _aware(doc.get("starts_at"))
    return status_of(doc, at) == "active" and (start is None or start <= at)


# -- retailer side -----------------------------------------------------------------------------


def workspaces() -> set[str]:
    return {"retailer", *(p["brand"] for p in catalog.products())}


def check(
    product: dict[str, Any], workspace: str, goals: list[str], skin_types: list[str]
) -> list[str]:
    """Why this product cannot be promoted with these goals and skin types from this workspace
    ([] = it can). Skin types must be among the eligible ones; [] means all of those."""
    elig = eligibility_of(product["product_id"])
    reasons: list[str] = []
    if not elig or not elig.get("eligible") or elig.get("tier") != "proven":
        reasons.append("Only products rated Proven can be promoted.")
        reasons += [r for r in (elig or {}).get("reasons") or [] if r not in reasons]
    else:
        outside = [g for g in goals if g not in set(elig.get("goals") or [])]
        if outside:
            labels = ", ".join(GOAL_LABEL.get(g, g) for g in outside)
            reasons.append(f"The evidence does not cover these goals: {labels}.")
        allowed = set(elig.get("skin_types") or [])
        if not allowed:
            reasons.append("No skin type has enough evidence for this product yet.")
        elif off := [t for t in skin_types if t not in allowed]:
            labels = ", ".join(SKIN_LABEL.get(t, t).lower() for t in off)
            reasons.append(f"The evidence does not cover these skin types: {labels}.")
    if workspace != "retailer" and workspace != product["brand"]:
        reasons.append("A brand workspace can only promote its own brand's products.")
    return reasons


def active_count(store: Store, uid: str, exclude: str | None = None) -> int:
    at = now()
    return sum(
        1 for cid, d in store.campaigns_of(uid) if cid != exclude and status_of(d, at) == "active"
    )


def too_many() -> HTTPException:
    return HTTPException(
        429,
        {
            "code": "too_many_active",
            "message": f"{MAX_ACTIVE} campaigns are already running. Pause or end one first.",
        },
    )


def create(
    store: Store,
    uid: str,
    product: dict[str, Any],
    workspace: str,
    goals: list[str],
    skin_types: list[str],
    days: int,
    holdout_pct: float | None = None,
) -> tuple[str, Doc]:
    at = now()
    doc: Doc = {
        "owner_uid": uid,
        "workspace": workspace,
        "product_id": product["product_id"],
        "goals": goals,
        "skin_types": skin_types,
        "placement": "routine",
        "status": "active",
        "days": days,
        "holdout_pct": HOLDOUT_PCT if holdout_pct is None else holdout_pct,
        "starts_at": at,
        "ends_at": at + timedelta(days=days),
        "created_at": at,
        "updated_at": at,
    }
    cid = f"c_{secrets.token_hex(6)}"
    store.campaign_set(cid, doc)
    return cid, doc


def stats(store: Store, cid: str, doc: Doc) -> dict[str, Any]:
    """Totals and one row per day from the start to today (or the end). Delivery counts (each
    person counts once a day for each kind) carry no person attribute and are never split by goal
    or skin type, so they are shown as counted, as standard ad reporting. `reach` is unique people:
    members whose first impression of this campaign was recorded (one per person, ever). Only the
    holdout comparison waits for 10 people per group."""
    rows = {day: d for day, d in store.campaign_days(cid)}
    start = (_aware(doc.get("starts_at")) or now()).date()
    end = (_aware(doc.get("ends_at")) or now()).date()
    last = min(today(), end - timedelta(days=1) if end > start else start)
    daily, totals = [], dict.fromkeys(("impressions", "clicks", "adds"), 0)
    day = start
    while day <= last:
        d = rows.get(day.isoformat(), {})
        row = {"day": day.isoformat()}
        for k in totals:
            n = int(d.get(k) or 0)
            totals[k] += n
            row[k] = n
        daily.append(row)
        day += timedelta(days=1)
    # days outside the window (clock edges) still count in the totals
    for key, d in rows.items():
        if not (start.isoformat() <= key <= last.isoformat()):
            for k in totals:
                totals[k] += int(d.get(k) or 0)
    imp = totals["impressions"]
    members = store.campaign_members(cid)
    return {
        "reach": sum(1 for m in members if m.get("seen")),
        "impressions": imp,
        "clicks": totals["clicks"],
        "adds": totals["adds"],
        "ctr": round(totals["clicks"] / imp, 3) if imp else None,
        "daily": daily,
        "incrementality": incrementality(members),
        "incrementality_note": INCREMENTALITY_NOTE,
    }


def _rate(added: int, n: int) -> float:
    return round(added / n, 2)


def incrementality(members: list[Doc]) -> dict[str, Any] | None:
    """Adoption among people the campaign matched who could see its card (exposed) vs the
    randomised holdout who could not; null until both groups have 10 people. Within groups of 10 or
    more, the count and rate are shown as every retail rate is (a rate of n >= 10). Lift CI: the
    difference of two proportions +- 1.96 * sqrt(p1(1-p1)/n1 + p2(1-p2)/n2), to 2 dp."""
    groups = {g: [m for m in members if m.get("group") == g] for g in ("exposed", "holdout")}
    if any(len(ms) < MIN_GROUP for ms in groups.values()):
        return None
    out: dict[str, Any] = {}
    p: dict[str, float] = {}
    for g, ms in groups.items():
        added = sum(1 for m in ms if m.get("added"))
        p[g] = added / len(ms)
        out[g] = {"n": len(ms), "added": added, "rate": _rate(added, len(ms))}
    n1, n2 = len(groups["exposed"]), len(groups["holdout"])
    diff = p["exposed"] - p["holdout"]
    half = 1.96 * math.sqrt(
        p["exposed"] * (1 - p["exposed"]) / n1 + p["holdout"] * (1 - p["holdout"]) / n2
    )
    return out | {
        "lift": round(diff, 2),
        "lift_lo": round(diff - half, 2),
        "lift_hi": round(diff + half, 2),
    }


def view(store: Store, cid: str, doc: Doc) -> dict[str, Any]:
    product = catalog.by_id(doc["product_id"]) or {}
    return {
        "id": cid,
        "workspace": doc["workspace"],
        "product_id": doc["product_id"],
        "goals": list(doc.get("goals") or []),
        "skin_types": list(doc.get("skin_types") or []),
        "placement": doc.get("placement", "routine"),
        "holdout_pct": doc.get("holdout_pct", HOLDOUT_PCT),
        "status": status_of(doc),
        "days": doc.get("days"),
        "starts_at": iso(doc.get("starts_at")),
        "ends_at": iso(doc.get("ends_at")),
        "created_at": iso(doc.get("created_at")),
        "product": product.get("name"),
        "brand": product.get("brand"),
        "category": product.get("category"),
        "image_url": product.get("image_url"),
        "stats": stats(store, cid, doc),
    }


def end(store: Store, cid: str, doc: Doc) -> Doc:
    """End a campaign early: it stops at once and for good (it cannot be resumed). ends_at moves
    to now, so its stats and holdout comparison cover exactly the days it ran."""
    at = now()
    fields = {"status": "ended", "ends_at": at, "ended_early": True, "updated_at": at}
    store.campaign_update(cid, fields)
    return doc | fields


def delete_owned(store: Store, uid: str) -> None:
    """DELETE /v1/me: the person's campaigns go with the account."""
    for cid, _ in store.campaigns_of(uid):
        store.campaign_delete(cid)


# -- consumer side -----------------------------------------------------------------------------


def seen_id(uid: str, day: str) -> str:
    """The per-person, per-day dedupe key: a one-way hash, never the uid itself."""
    return hashlib.sha256(f"{uid}:{day}".encode()).hexdigest()[:32]


def rotation(uid: str, day: str, candidates: list[tuple[str, Doc]]) -> list[tuple[str, Doc]]:
    """Deterministic rotation: the candidates in id order, starting at hash(uid + day), so the
    same person sees the same campaign all day and the next day may see another."""
    if not candidates:
        return []
    ordered = sorted(candidates, key=lambda c: c[0])
    h = int(hashlib.sha256(f"{uid}{day}".encode()).hexdigest(), 16) % len(ordered)
    return ordered[h:] + ordered[:h]


def pick(uid: str, day: str, candidates: list[tuple[str, Doc]]) -> tuple[str, Doc] | None:
    return next(iter(rotation(uid, day, candidates)), None)


def member_id(uid: str) -> str:
    """Membership key: a one-way hash of the uid (the member doc never holds the uid)."""
    return hashlib.sha256(uid.encode()).hexdigest()[:32]


def group_of(cid: str, uid: str, holdout_pct: float) -> str:
    """Stable random assignment: hash(campaign_id + uid) as a fraction of 1 below the holdout
    share -> holdout. The same person is in the same group of a campaign forever."""
    u = int(hashlib.sha256(f"{cid}{uid}".encode()).hexdigest()[:13], 16) / 16**13
    return "holdout" if u < holdout_pct else "exposed"


def join(store: Store, cid: str, doc: Doc, uid: str, day: str) -> str:
    """Record this person's group once (create-if-absent); returns the group on record."""
    pct = doc.get("holdout_pct", HOLDOUT_PCT)
    member = {"group": group_of(cid, uid, pct), "first_day": day, "added": False}
    return store.campaign_member_join(cid, member_id(uid), member)["group"]


def attribute_add(store: Store, uid: str, product_id: str) -> None:
    """A product went into this person's routine by any path: every running campaign for it
    where they are a member (exposed or holdout) records the adoption once."""
    mid = member_id(uid)
    at = now()
    for cid, d in store.campaigns_active():
        if d.get("product_id") != product_id or not running(d, at):
            continue
        m = store.campaign_member_get(cid, mid)
        if m is not None and not m.get("added"):
            store.campaign_member_update(
                cid, mid, {"added": True, "added_day": at.date().isoformat()}
            )


def sponsored(store: Store, uid: str) -> dict[str, Any] | None:
    """The one sponsored card for this person today, or None (hidden, no goals, nothing that
    matches, or the evidence unavailable: no card rather than an unproven one)."""
    profile = (store.user_get(uid) or {}).get("profile") or {}
    if profile.get("hide_sponsored"):
        return None
    goals = set(cohort.goals_of(profile.get("goals")))
    if not goals:
        return None
    skin = profile.get("skin_type")
    owned = {d.get("product_id") for _, d in store.routine_list(uid) if d.get("product_id")}
    at = now()
    matches = [
        (cid, d)
        for cid, d in store.campaigns_active()
        if running(d, at)
        and d.get("placement", "routine") == "routine"
        and d.get("product_id") not in owned
        and goals & set(d.get("goals") or [])
    ]
    evidence: dict[str, dict[str, Any]] = {}
    eligible = []
    for cid, d in matches:
        pid = d["product_id"]
        if pid not in evidence:
            try:
                evidence[pid] = eligibility_of(pid) or {}
            except Unavailable:
                return None
        e = evidence[pid]
        # skin types: the campaign's, or every skin type the evidence covers ([]); never "all"
        targets = d.get("skin_types") or e.get("skin_types") or []
        if (
            e.get("eligible")
            and e.get("tier") == "proven"
            and skin in targets
            and catalog.by_id(pid)
        ):
            eligible.append((cid, d))
    day = at.date().isoformat()
    # The first campaign in today's rotation whose randomised group for this person is
    # `exposed`; a holdout member gets no card for that campaign (the next one is tried).
    chosen = next(
        (c for c in rotation(uid, day, eligible) if join(store, *c, uid, day) == "exposed"), None
    )
    if chosen is None:
        return None
    cid, d = chosen
    product = catalog.by_id(d["product_id"]) or {}
    return {
        "campaign_id": cid,
        "product_id": d["product_id"],
        "product": product.get("name"),
        "brand": product.get("brand"),
        "image_url": product.get("image_url"),
        "category": product.get("category"),
        "evidence": evidence[d["product_id"]].get("evidence") or "",
        "cohort_label": COHORT_LABEL,
        "label": "Sponsored",
        # "Why am I seeing this?": what matched, from the person's own profile
        "matched": {
            "goals": sorted(goals & set(d.get("goals") or [])),
            "skin_type": skin,
        },
        "disclosure": DISCLOSURE,
    }


def record(store: Store, uid: str, cid: str, kind: str) -> bool:
    """Count one event. Each person counts once per day for each kind, and a click or an add only
    after that person was shown the card that day; an add only once the product is in their
    routine. Returns whether it counted."""
    doc = store.campaign_get(cid)
    if doc is None:
        raise HTTPException(404, {"code": "not_found", "message": "campaign not found"})
    if kind == "add":
        owned = {d.get("product_id") for _, d in store.routine_list(uid)}
        if doc["product_id"] not in owned:
            return False
    day = today().isoformat()
    counted = store.campaign_event(cid, day, seen_id(uid, day), kind)
    if counted and kind == "impression":
        # reach: the person's first impression of this campaign marks their membership once
        # (joined here if the card reached them without GET /v1/sponsored, so reach <= people)
        join(store, cid, doc, uid, day)
        mid = member_id(uid)
        member = store.campaign_member_get(cid, mid) or {}
        if not member.get("seen"):
            store.campaign_member_update(cid, mid, {"seen": True, "seen_day": day})
    return counted
