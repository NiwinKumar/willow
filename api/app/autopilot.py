"""AutoCampaign: standing rules that start and manage proof-gated campaigns (app/campaigns.py).

A brand (or the retailer) writes a rule once: a trigger (a product becomes Proven, gains a goal or
skin type with a positive lift, its goal's demand rises, or it works for an under-served skin type x
goal group), the campaign to start (length, holdout, how many at a time) and how much the agent may
do on its own (`level`):

- suggest: it drafts the campaign (an open proposal) and the owner approves it;
- auto: it starts the campaign and says so, with Undo;
- autopilot: it starts, adjusts and stops campaigns on its own, with a weekly summary.

`run(store, uid)` is the loop, run by Cloud Scheduler (`/v1/internal/autopilot`), by "Run check
now" and when the Campaigns page opens on a stale run: watch (the signals below), match each
enabled rule, decide within the caps, manage the campaigns rules started, explain each step in the
activity feed.

Guardrails are the campaign rules themselves, checked through `campaigns.check` on every start and
resume: Proven only, goals and skin types within the evidence (a skin type is only eligible with a
positive lift over non-users, so a rule never targets one where the product does worse), a brand
only its own products, at most `campaigns.MAX_ACTIVE` running per owner, always a holdout (10-50%),
always labelled Sponsored, never shown to someone who already uses the product
(campaigns.sponsored). On top of that a campaign a rule started is paused at once when its product
slips below Proven, whatever the level. Every number in the feed comes from the signals; nothing is
written by a model.

Signals come from `retail_intel.autopilot_signals()` (cohort=mixed, range=all, the evidence shoppers
see) through `signals()`, the seam the tests replace.
"""

import hashlib
import re
import secrets
from datetime import date, datetime, timedelta
from typing import Any

from app import campaigns, catalog
from app.retailer import CATEGORY_LABEL, GOAL_LABEL, SKIN_LABEL
from app.store import Doc, Store, iso

TRIGGERS = ("proven", "new_segment", "rising_demand", "unmet_need")
LEVELS = ("suggest", "auto", "autopilot")
EXTEND_WITHIN = timedelta(days=2)  # a campaign this close to its end may be extended
SUMMARY_EVERY = timedelta(days=7)
STALE = timedelta(minutes=30)  # the Campaigns page runs a check when the last one is older
UNMET_MIN = 0.5
FEED_LIMIT = 60

RULE_ID = re.compile(r"^r_[0-9a-f]{12}$")
ACTIVITY_ID = re.compile(r"^a_[0-9a-f]{20}$")


# -- signals -----------------------------------------------------------------------------------


def signals() -> dict[str, Any]:
    """{products: [eligibility entry + category, n, lift, lift_lo], rising: {goal: {from, to, n}},
    unmet: [{skin, goal, unmet, users}]}. Raises campaigns.Unavailable when it can't be read."""
    try:
        from app import retail_intel

        return retail_intel.autopilot_signals()
    except Exception as exc:
        raise campaigns.Unavailable(str(exc)) from exc


# -- words -------------------------------------------------------------------------------------


def _goals(ids: list[str]) -> str:
    words = [GOAL_LABEL.get(g, g).lower() for g in ids]
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]


def _skins(ids: list[str]) -> str:
    words = [SKIN_LABEL.get(s, s).lower() for s in ids]
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]


def _pts(x: float | None) -> str:
    return "–" if x is None else f"{'+' if x >= 0 else '−'}{abs(round(x * 100))} pts"


def _scope_words(rule: Doc) -> str:
    cat = rule["scope"].get("category")
    noun = CATEGORY_LABEL.get(cat, "products").lower() if cat else "products"
    return f"any of my {noun}" if rule["workspace"] != "retailer" else f"any of the {noun}"


LEVEL_WORDS = {
    "suggest": "Suggest it and ask me first.",
    "auto": "Start it automatically and tell me.",
    "autopilot": "Run it on autopilot.",
}


def describe(rule: Doc) -> str:
    """The rule in one sentence, as the template reads."""
    t, a, c = rule["trigger"], rule["action"], rule["conditions"]
    goals = t.get("goals") or []
    for_goal = f" for {_goals(goals)}" if goals else ""
    scope = _scope_words(rule)
    if t["kind"] == "proven":
        when = f"When {scope} becomes Proven{for_goal}"
        who = "the skin types it works for"
    elif t["kind"] == "new_segment":
        when = f"When {scope} gains a new goal or skin type with a positive lift{for_goal}"
        who = "that new group"
    elif t["kind"] == "rising_demand":
        when = f"When demand rises{for_goal or ' for a goal'} and {scope} is Proven for it"
        who = "the skin types it works for"
    else:
        share = round((t.get("unmet_min") or UNMET_MIN) * 100)
        when = (
            f"When {share}% or more of a skin type{for_goal} see no change yet and {scope} "
            "works for them"
        )
        who = "that skin type"
    extras = []
    if c.get("in_store"):
        extras.append("only products sold in a store")
    if c.get("start_on"):
        extras.append(f"from {c['start_on']}")
    if c.get("stop_after"):
        extras.append(f"until {c['stop_after']}")
    if c.get("monthly_cap"):
        extras.append(f"at most {c['monthly_cap']} new a month")
    tail = f" ({'; '.join(extras)})" if extras else ""
    holdout = round(a["holdout_pct"] * 100)
    return (
        f"{when}, promote it to {who}, for {a['days']} days, with a {holdout}% holdout, "
        f"max {a['max_running']} at a time{tail}. {LEVEL_WORDS[rule['level']]}"
    )


# -- rules -------------------------------------------------------------------------------------


def new_rule_id() -> str:
    return f"r_{secrets.token_hex(6)}"


def rule_doc(uid: str, body: dict[str, Any], at: datetime) -> Doc:
    return {
        "owner_uid": uid,
        **body,
        "seen": {},
        "created_at": at,
        "updated_at": at,
        "last_run_at": None,
        "last_summary_at": None,
    }


def rule_view(store: Store, rid: str, doc: Doc, feed: list[tuple[str, Doc]] | None = None) -> dict:
    mine = [(a, d) for a, d in (feed or []) if d.get("rule_id") == rid]
    mine.sort(key=lambda r: iso(r[1].get("at")) or "", reverse=True)
    rule_campaigns = [
        (cid, d) for cid, d in store.campaigns_of(doc["owner_uid"]) if d.get("rule_id") == rid
    ]
    return {
        "id": rid,
        "name": doc["name"],
        "workspace": doc["workspace"],
        "enabled": bool(doc.get("enabled")),
        "level": doc["level"],
        "scope": doc["scope"],
        "trigger": doc["trigger"],
        "conditions": doc["conditions"],
        "action": doc["action"],
        "sentence": describe(doc),
        "running": sum(1 for _, d in rule_campaigns if campaigns.status_of(d) == "active"),
        "started": len(rule_campaigns),
        "last_run_at": iso(doc.get("last_run_at")),
        "last_action": activity_view(*mine[0]) if mine else None,
        "created_at": iso(doc.get("created_at")),
    }


# -- activity ----------------------------------------------------------------------------------


def _aid(key: str) -> str:
    return "a_" + hashlib.sha256(key.encode()).hexdigest()[:20]


def _log(
    store: Store,
    uid: str,
    rule: tuple[str, Doc] | None,
    kind: str,
    text: str,
    at: datetime,
    key: str | None = None,
    **extra: Any,
) -> str | None:
    """One feed item. `key` makes it once-only (the same action is not logged twice); without it
    every call is a new item. Returns its id, or None when it was already there."""
    rid, rdoc = rule if rule else (None, {})
    aid = _aid(key or f"{uid}:{secrets.token_hex(8)}")
    doc = {
        "owner_uid": uid,
        "rule_id": rid,
        "rule_name": rdoc.get("name"),
        "level": rdoc.get("level"),
        "kind": kind,
        "text": text,
        "at": at,
        "status": extra.pop("status", "done"),
        **extra,
    }
    return aid if store.activity_add(aid, doc) else None


def activity_view(aid: str, doc: Doc) -> dict[str, Any]:
    product = catalog.by_id(doc["product_id"]) if doc.get("product_id") else None
    return {
        "id": aid,
        "at": iso(doc.get("at")),
        "kind": doc["kind"],
        "status": doc.get("status", "done"),
        "text": doc["text"],
        "rule_id": doc.get("rule_id"),
        "rule_name": doc.get("rule_name"),
        "level": doc.get("level"),
        "product_id": doc.get("product_id"),
        "product": product.get("name") if product else None,
        "brand": product.get("brand") if product else None,
        "image_url": product.get("image_url") if product else None,
        "campaign_id": doc.get("campaign_id"),
        "proposal": doc.get("proposal"),
        "numbers": doc.get("numbers") or {},
        "can_undo": doc["kind"] == "started" and doc.get("status") == "done",
    }


def feed(store: Store, uid: str, limit: int = FEED_LIMIT) -> list[dict[str, Any]]:
    rows = sorted(store.activities_of(uid), key=lambda r: iso(r[1].get("at")) or "", reverse=True)
    return [activity_view(a, d) for a, d in rows[:limit]]


# -- matching ----------------------------------------------------------------------------------


def _in_scope(rule: Doc, p: dict[str, Any]) -> bool:
    if rule["workspace"] != "retailer" and p["brand"] != rule["workspace"]:
        return False
    s = rule["scope"]
    if s.get("category") and p.get("category") != s["category"]:
        return False
    if s.get("product_ids") and p["product_id"] not in s["product_ids"]:
        return False
    if rule["conditions"].get("in_store"):
        product = catalog.by_id(p["product_id"]) or {}
        if not product.get("stores"):
            return False
    return True


def _proven(p: dict[str, Any]) -> bool:
    return p.get("tier") == "proven" and bool(p.get("eligible"))


def _numbers(p: dict[str, Any]) -> dict[str, Any]:
    return {"lift": p.get("lift"), "lift_lo": p.get("lift_lo"), "n": p.get("n")}


def _evidence_words(p: dict[str, Any]) -> str:
    lo = f", at least {_pts(p.get('lift_lo'))}" if p.get("lift_lo") is not None else ""
    return f"lift {_pts(p.get('lift'))} over non-users{lo}, n={p.get('n')}"


def _match(rule: Doc, p: dict[str, Any], sig: dict[str, Any]) -> dict[str, Any] | None:
    """The campaign this rule wants for this Proven product, or None: {goals, skin_types, why}."""
    t = rule["trigger"]
    wanted = set(t.get("goals") or []) or set(GOAL_LABEL)
    goals = [g for g in p.get("goals") or [] if g in wanted]
    skins = list(p.get("skin_types") or [])
    if not goals:
        return None
    if t["kind"] == "proven":
        return {
            "goals": goals,
            "skin_types": [],
            "why": f"It is Proven for {_goals(goals)} ({_evidence_words(p)}).",
        }
    if t["kind"] == "new_segment":
        seen = rule.get("seen", {}).get(p["product_id"])
        if seen is None:
            return None  # first sight: remembered, nothing is new yet
        new_g = [g for g in goals if g not in seen.get("goals", [])]
        new_s = [s for s in skins if s not in seen.get("skin_types", [])]
        if new_s:
            return {
                "goals": goals,
                "skin_types": new_s,
                "why": f"It now has a positive lift for {_skins(new_s)} skin "
                f"({_evidence_words(p)}).",
            }
        if new_g:
            return {
                "goals": new_g,
                "skin_types": [],
                "why": f"It now has a positive lift for {_goals(new_g)} ({_evidence_words(p)}).",
            }
        return None
    if t["kind"] == "rising_demand":
        up = [g for g in goals if g in sig.get("rising", {})]
        if not up:
            return None
        g = max(up, key=lambda x: sig["rising"][x]["to"] - sig["rising"][x]["from"])
        r = sig["rising"][g]
        return {
            "goals": up,
            "skin_types": [],
            "why": f"{GOAL_LABEL[g]} demand is rising: {r['to']}% of people in the latest month, "
            f"up from {r['from']}% (n={r['n']}), and it is Proven for it "
            f"({_evidence_words(p)}).",
        }
    # unmet_need: under-served groups this product works for
    floor = t.get("unmet_min") or UNMET_MIN
    cells = [
        c
        for c in sig.get("unmet", [])
        if c["unmet"] is not None
        and c["unmet"] >= floor
        and c["goal"] in goals
        and c["skin"] in skins
        and (c.get("users") or 0) >= campaigns.MIN_GROUP
    ]
    if not cells:
        return None
    worst = max(cells, key=lambda c: c["unmet"])
    return {
        "goals": sorted({c["goal"] for c in cells}, key=goals.index),
        "skin_types": sorted({c["skin"] for c in cells}, key=skins.index),
        "why": f"{round(worst['unmet'] * 100)}% of people with {SKIN_LABEL[worst['skin']].lower()} "
        f"skin who want {GOAL_LABEL[worst['goal']].lower()} have no visible change by week 8, "
        f"and it works for that group ({_evidence_words(p)}).",
    }


def _window_open(rule: Doc, today: date) -> bool:
    c = rule["conditions"]
    if c.get("start_on") and today < date.fromisoformat(c["start_on"]):
        return False
    return not (c.get("stop_after") and today > date.fromisoformat(c["stop_after"]))


def _month_count(rule_campaigns: list[tuple[str, Doc]], at: datetime) -> int:
    return sum(
        1
        for _, d in rule_campaigns
        if (s := campaigns._aware(d.get("created_at"))) and (s.year, s.month) == (at.year, at.month)
    )


def _start(
    store: Store,
    uid: str,
    rule: tuple[str, Doc],
    p: dict[str, Any],
    goals: list[str],
    skins: list[str],
) -> tuple[str | None, list[str]]:
    """Start a campaign for a rule, through the same checks as a person's own (campaigns.check)
    and the running cap. Returns (campaign id, reasons it could not start)."""
    rid, rdoc = rule
    product = catalog.by_id(p["product_id"])
    if product is None:
        return None, ["This product is no longer in the catalog."]
    reasons = campaigns.check(product, rdoc["workspace"], goals, skins)
    if reasons:
        return None, reasons
    if campaigns.active_count(store, uid) >= campaigns.MAX_ACTIVE:
        return None, [f"{campaigns.MAX_ACTIVE} campaigns are already running."]
    a = rdoc["action"]
    cid, _ = campaigns.create(
        store, uid, product, rdoc["workspace"], goals, skins, a["days"], a["holdout_pct"]
    )
    store.campaign_update(cid, {"rule_id": rid, "rule_name": rdoc["name"], "auto": True})
    return cid, []


# -- the loop ----------------------------------------------------------------------------------


def run(store: Store, uid: str, at: datetime | None = None) -> dict[str, Any]:
    """One check of every enabled rule this person owns. Raises campaigns.Unavailable when the
    evidence can't be read (nothing is changed then)."""
    at = at or campaigns.now()
    sig = signals()
    by_id = {p["product_id"]: p for p in sig["products"]}
    totals = dict.fromkeys(
        ("started", "proposed", "paused", "resumed", "ended", "extended", "narrowed", "held"), 0
    )
    rules = sorted(store.rules_of(uid), key=lambda r: iso(r[1].get("created_at")) or "")
    for rid, rdoc in rules:
        if not rdoc.get("enabled"):
            continue
        _manage(store, uid, (rid, rdoc), by_id, at, totals)
        if _window_open(rdoc, at.date()):
            _decide(store, uid, (rid, rdoc), sig, at, totals)
        seen = {
            p["product_id"]: {
                "goals": p.get("goals") or [],
                "skin_types": p.get("skin_types") or [],
            }
            for p in sig["products"]
            if _proven(p) and _in_scope(rdoc, p)
        }
        fields: Doc = {"seen": seen, "last_run_at": at}
        if rdoc["level"] == "autopilot":
            fields |= _summary(store, uid, (rid, rdoc), at)
        store.rule_update(rid, fields)
    return {"ran_at": iso(at), "rules": len(rules), **totals}


def _decide(
    store: Store, uid: str, rule: tuple[str, Doc], sig: dict[str, Any], at: datetime, totals: dict
) -> None:
    rid, rdoc = rule
    a = rdoc["action"]
    mine = store.campaigns_of(uid)
    rule_campaigns = [(c, d) for c, d in mine if d.get("rule_id") == rid]
    busy = {d["product_id"] for _, d in mine if campaigns.status_of(d, at) in ("active", "paused")}
    no_lift = {d["product_id"] for _, d in rule_campaigns if d.get("ended_reason") == "no_lift"}
    props = [
        d
        for _, d in store.activities_of(uid)
        if d.get("rule_id") == rid and d["kind"] == "proposed" and d.get("status") == "open"
    ]
    open_props = {d.get("product_id") for d in props}
    # proposals still waiting to be approved hold their slot: approving them all stays in the
    # rule's limit
    waiting = sum(1 for d in props if (d.get("proposal") or {}).get("action") == "start")
    wants = []
    for p in sig["products"]:
        if not _proven(p) or not _in_scope(rdoc, p):
            continue
        pid = p["product_id"]
        if pid in busy or pid in no_lift or pid in open_props:
            continue
        m = _match(rdoc, p, sig)
        if m:
            wants.append((p, m))
    wants.sort(key=lambda w: -(w[0].get("lift_lo") or 0))

    running = sum(1 for _, d in rule_campaigns if campaigns.status_of(d, at) == "active")
    slots = a["max_running"] - running - waiting
    cap = rdoc["conditions"].get("monthly_cap")
    if cap:
        slots = min(slots, cap - _month_count(rule_campaigns, at) - waiting)
    day = at.date().isoformat()
    for i, (p, m) in enumerate(wants):
        pid, name = p["product_id"], f"{p['brand']} {p['product']}"
        who = f" for {_skins(m['skin_types'])} skin" if m["skin_types"] else ""
        if i >= max(slots, 0):
            left = len(wants) - i
            limit = (
                f"its limit of {a['max_running']} at a time"
                if running + waiting + i >= a["max_running"]
                else f"its limit of {cap} new a month"
            )
            if _log(
                store,
                uid,
                rule,
                "held",
                f"{left} more {'product matches' if left == 1 else 'products match'} this rule, "
                f"held back by {limit}. Next up: {name}.",
                at,
                key=f"{rid}:held:{day}",
                product_id=pid,
            ):
                totals["held"] += 1
            break
        draft = {
            "action": "start",
            "goals": m["goals"],
            "skin_types": m["skin_types"],
            "days": a["days"],
            "holdout_pct": a["holdout_pct"],
            "evidence": p.get("evidence") or "",
        }
        if rdoc["level"] == "suggest":
            if _log(
                store,
                uid,
                rule,
                "proposed",
                f"Proposed: promote {name}{who} for {a['days']} days. {m['why']}",
                at,
                key=f"{rid}:propose:{pid}:{day}",
                status="open",
                product_id=pid,
                proposal=draft,
                numbers=_numbers(p),
            ):
                totals["proposed"] += 1
            continue
        cid, reasons = _start(store, uid, rule, p, m["goals"], m["skin_types"])
        if cid is None:
            _log(
                store,
                uid,
                rule,
                "held",
                f"Couldn't start {name}: {' '.join(reasons)}",
                at,
                key=f"{rid}:blocked:{pid}:{day}",
                product_id=pid,
            )
            totals["held"] += 1
            continue
        _log(
            store,
            uid,
            rule,
            "started",
            f"Started {name}{who} for {a['days']} days. {m['why']}",
            at,
            product_id=pid,
            campaign_id=cid,
            numbers=_numbers(p),
        )
        totals["started"] += 1


def _apply(store: Store, cid: str, doc: Doc, action: str, change: dict, at: datetime) -> Doc:
    """Carry out a managing action on a campaign a rule started; returns its new fields."""
    if action == "pause":
        fields = {"status": "paused", "paused_by_agent": True, "updated_at": at}
    elif action == "resume":
        fields = {"status": "active", "paused_by_agent": False, "updated_at": at}
    elif action == "end":
        campaigns.end(store, cid, doc)
        fields = {"ended_reason": change.get("reason", "agent")}
    elif action == "extend":
        end = campaigns._aware(doc.get("ends_at")) or at
        fields = {
            "ends_at": end + timedelta(days=change["days"]),
            "days": int(doc.get("days") or 0) + change["days"],
            "updated_at": at,
        }
    else:  # narrow
        fields = {"goals": change["goals"], "skin_types": change["skin_types"], "updated_at": at}
    store.campaign_update(cid, fields)
    return fields


def _manage(
    store: Store,
    uid: str,
    rule: tuple[str, Doc],
    by_id: dict[str, dict],
    at: datetime,
    totals: dict,
) -> None:
    rid, rdoc = rule
    auto = rdoc["level"] == "autopilot"
    for cid, doc in store.campaigns_of(uid):
        if doc.get("rule_id") != rid:
            continue
        status = campaigns.status_of(doc, at)
        if status == "ended":
            continue
        p = by_id.get(doc["product_id"]) or {}
        name = f"{p.get('brand', '')} {p.get('product', doc['product_id'])}".strip()
        ok = _proven(p)

        def act(
            action: str,
            text: str,
            change: dict | None = None,
            force: bool = False,
            _c=(cid, doc, p),
        ) -> None:
            """Apply now (autopilot, or a guardrail with force) or propose it once."""
            c_id, c_doc, c_p = _c
            change = change or {}
            if auto or force:
                _apply(store, c_id, c_doc, action, change, at)
                _log(
                    store,
                    uid,
                    rule,
                    _PAST[action],
                    text,
                    at,
                    product_id=c_doc["product_id"],
                    campaign_id=c_id,
                    numbers=_numbers(c_p),
                )
                totals[_PAST[action]] += 1
            elif _log(
                store,
                uid,
                rule,
                "proposed",
                f"Proposed: {text[0].lower()}{text[1:]}",
                at,
                key=f"{rid}:{c_id}:{action}",
                status="open",
                product_id=c_doc["product_id"],
                campaign_id=c_id,
                proposal={"action": action, **change},
                numbers=_numbers(c_p),
            ):
                totals["proposed"] += 1

        if status == "active" and not ok:
            act(
                "pause",
                f"Paused {name}: it is no longer rated Proven, so no shopper sees its card.",
                force=True,
            )
            continue
        if status == "paused":
            if (
                doc.get("paused_by_agent")
                and ok
                and campaigns.active_count(store, uid) < campaigns.MAX_ACTIVE
            ):
                act(
                    "resume",
                    f"Resumed {name}: it is rated Proven again ({_evidence_words(p)}).",
                )
            continue
        # running and still Proven
        goals = [g for g in doc.get("goals") or [] if g in (p.get("goals") or [])]
        skins = [s for s in doc.get("skin_types") or [] if s in (p.get("skin_types") or [])]
        lost_g = len(goals) < len(doc.get("goals") or [])
        lost_s = len(skins) < len(doc.get("skin_types") or [])
        if lost_g or lost_s:
            if not goals or (doc.get("skin_types") and not skins):
                act(
                    "pause",
                    f"Paused {name}: the evidence no longer covers its audience.",
                    force=True,
                )
                continue
            dropped = [s for s in doc.get("skin_types") or [] if s not in skins]
            dropped_g = [g for g in doc.get("goals") or [] if g not in goals]
            what = (f"{_skins(dropped)} skin" if dropped else "") + (
                (" and " if dropped and dropped_g else "")
                + (_goals(dropped_g) if dropped_g else "")
            )
            act(
                "narrow",
                f"Narrowed {name}: dropped {what}, where it no longer has a positive lift.",
                {"goals": goals, "skin_types": skins},
            )
            continue
        inc = campaigns.incrementality(store.campaign_members(cid))
        if inc and inc["lift_hi"] <= 0:
            act(
                "end",
                f"Ended {name} early: adoption is no higher than the randomised holdout "
                f"({_pts(inc['lift'])}, up to {_pts(inc['lift_hi'])}; "
                f"n={inc['exposed']['n']} and {inc['holdout']['n']}).",
                {"reason": "no_lift"},
            )
            continue
        end = campaigns._aware(doc.get("ends_at"))
        if inc and inc["lift_lo"] > 0 and end and end - at <= EXTEND_WITHIN:
            days = rdoc["action"]["days"]
            act(
                "extend",
                f"Extended {name} by {days} days: adoption is {_pts(inc['lift'])} over "
                f"the randomised holdout (at least {_pts(inc['lift_lo'])}) and it is still Proven.",
                {"days": days},
            )


_PAST = {
    "pause": "paused",
    "resume": "resumed",
    "end": "ended",
    "extend": "extended",
    "narrow": "narrowed",
}


def _summary(store: Store, uid: str, rule: tuple[str, Doc], at: datetime) -> Doc:
    """Autopilot: a weekly summary of what the rule did, once it has run for a week."""
    rid, rdoc = rule
    since = campaigns._aware(rdoc.get("last_summary_at")) or campaigns._aware(
        rdoc.get("created_at")
    )
    if since is None or at - since < SUMMARY_EVERY:
        return {}
    done = [
        d["kind"]
        for _, d in store.activities_of(uid)
        if d.get("rule_id") == rid
        and d["kind"] in {*_PAST.values(), "started"}
        and (t := campaigns._aware(d.get("at")))
        and t >= since
    ]
    counts = {
        k: done.count(k) for k in ("started", "paused", "resumed", "ended", "extended", "narrowed")
    }
    parts = [f"{n} {k}" for k, n in counts.items() if n]
    running = sum(
        1
        for _, d in store.campaigns_of(uid)
        if d.get("rule_id") == rid and campaigns.status_of(d, at) == "active"
    )
    _log(
        store,
        uid,
        rule,
        "summary",
        f"This week: {', '.join(parts) if parts else 'no changes'}. {running} running now.",
        at,
        key=f"{rid}:summary:{at.date().isoformat()}",
    )
    return {"last_summary_at": at}


def run_if_stale(store: Store, uid: str) -> dict[str, Any] | None:
    """The Campaigns page's check: runs when the last one is over STALE old (None otherwise)."""
    rules = store.rules_of(uid)
    if not any(d.get("enabled") for _, d in rules):
        return None
    last = max(
        (campaigns._aware(d.get("last_run_at")) for _, d in rules if d.get("last_run_at")),
        default=None,
    )
    if last and campaigns.now() - last < STALE:
        return None
    return run(store, uid)


def run_all(store: Store) -> dict[str, Any]:
    """Cloud Scheduler: every owner with an enabled rule."""
    owners = sorted({d["owner_uid"] for _, d in store.rules_all()})
    totals: dict[str, int] = {}
    for uid in owners:
        for k, v in run(store, uid).items():
            if isinstance(v, int):
                totals[k] = totals.get(k, 0) + v
    return {"owners": len(owners), **totals}


# -- proposals and undo ------------------------------------------------------------------------


class Refused(Exception):
    """A proposal or undo that can't be carried out; the message says why."""


def approve(store: Store, uid: str, aid: str) -> dict[str, Any]:
    doc = store.activity_get(aid)
    if doc is None or doc["owner_uid"] != uid or doc["kind"] != "proposed":
        raise LookupError(aid)
    if doc.get("status") != "open":
        raise Refused("This proposal has already been handled.")
    rule = (doc["rule_id"], store.rule_get(doc["rule_id"]) or {}) if doc.get("rule_id") else None
    if not rule or not rule[1]:
        raise Refused("The rule behind this proposal was deleted.")
    at = campaigns.now()
    prop = doc["proposal"]
    product = catalog.by_id(doc["product_id"]) or {}
    name = f"{product.get('brand', '')} {product.get('name', doc['product_id'])}".strip()
    if prop["action"] == "start":
        limit = rule[1]["action"]["max_running"]
        live = sum(
            1
            for _, d in store.campaigns_of(uid)
            if d.get("rule_id") == rule[0] and campaigns.status_of(d, at) == "active"
        )
        if live >= limit:
            raise Refused(
                f"This rule already runs {live} of its {limit} at a time. Pause or end one first."
            )
        sig_p = {"product_id": doc["product_id"]}
        cid, reasons = _start(store, uid, rule, sig_p, prop["goals"], prop["skin_types"])
        if cid is None:
            raise Refused(" ".join(reasons))
        store.activity_update(aid, {"status": "approved", "campaign_id": cid})
        who = f" for {_skins(prop['skin_types'])} skin" if prop["skin_types"] else ""
        _log(
            store,
            uid,
            rule,
            "started",
            f"Started {name}{who} for {prop['days']} days, as you approved.",
            at,
            product_id=doc["product_id"],
            campaign_id=cid,
            numbers=doc.get("numbers"),
        )
        return {"campaign_id": cid}
    cid = doc.get("campaign_id")
    cdoc = store.campaign_get(cid) if cid else None
    if cdoc is None or campaigns.status_of(cdoc, at) == "ended":
        raise Refused("That campaign has ended.")
    if prop["action"] == "resume":
        reasons = campaigns.check(
            product,
            cdoc["workspace"],
            list(cdoc.get("goals") or []),
            list(cdoc.get("skin_types") or []),
        )
        if reasons:
            raise Refused(" ".join(reasons))
        if campaigns.active_count(store, uid, exclude=cid) >= campaigns.MAX_ACTIVE:
            raise Refused(f"{campaigns.MAX_ACTIVE} campaigns are already running.")
    _apply(store, cid, cdoc, prop["action"], prop, at)
    store.activity_update(aid, {"status": "approved"})
    _log(
        store,
        uid,
        rule,
        _PAST[prop["action"]],
        f"{doc['text'].removeprefix('Proposed: ')} (approved).",
        at,
        product_id=doc["product_id"],
        campaign_id=cid,
        numbers=doc.get("numbers"),
    )
    return {"campaign_id": cid}


def dismiss(store: Store, uid: str, aid: str) -> None:
    doc = store.activity_get(aid)
    if doc is None or doc["owner_uid"] != uid or doc["kind"] != "proposed":
        raise LookupError(aid)
    if doc.get("status") != "open":
        raise Refused("This proposal has already been handled.")
    store.activity_update(aid, {"status": "dismissed"})


def undo(store: Store, uid: str, aid: str) -> dict[str, Any]:
    """Undo a campaign a rule started: deleted when no shopper has seen it yet, else ended (its
    results stay)."""
    doc = store.activity_get(aid)
    if doc is None or doc["owner_uid"] != uid or doc["kind"] != "started":
        raise LookupError(aid)
    if doc.get("status") != "done":
        raise Refused("This has already been undone.")
    cid = doc.get("campaign_id")
    cdoc = store.campaign_get(cid) if cid else None
    at = campaigns.now()
    if cdoc is None:
        outcome = "gone"
    elif campaigns.status_of(cdoc, at) == "ended":
        raise Refused("That campaign has already ended.")
    elif campaigns.stats(store, cid, cdoc)["impressions"] == 0:
        store.campaign_delete(cid)
        outcome = "deleted"
    else:
        campaigns.end(store, cid, cdoc)
        store.campaign_update(cid, {"ended_reason": "undone"})
        outcome = "ended"
    store.activity_update(aid, {"status": "undone"})
    rule = (doc["rule_id"], store.rule_get(doc["rule_id"]) or {}) if doc.get("rule_id") else None
    product = catalog.by_id(doc.get("product_id") or "") or {}
    name = f"{product.get('brand', '')} {product.get('name', '')}".strip() or "the campaign"
    _log(
        store,
        uid,
        rule,
        "undone",
        f"Undid {name}: "
        + (
            "deleted before any shopper saw it."
            if outcome == "deleted"
            else "ended; its results so far stay."
            if outcome == "ended"
            else "it had already been removed."
        ),
        at,
        product_id=doc.get("product_id"),
    )
    return {"outcome": outcome}


# -- typed rules -------------------------------------------------------------------------------

GOAL_WORDS = {
    "dark_spots": ("dark spot", "pigment", "hyperpigment"),
    "even_tone": ("even tone", "tone evenness", "uneven tone", "evenness"),
    "redness": ("redness", "red skin", "calm"),
    "blemishes": ("blemish", "acne", "breakout", "pimple"),
    "pores_texture": ("pore", "texture"),
    "lines": ("line", "wrinkle"),
    "under_eye": ("under-eye", "under eye", "dark circle"),
    "oil_glow": ("shine", "glow", "oil"),
}
CATEGORY_WORDS = {
    "serum": "serum",
    "sunscreen": "sunscreen",
    "treatment": "treatment",
    "cleanser": "cleanser",
    "moisturizer": "moisturi",
    "toner": "toner",
    "exfoliant": "exfoliant",
    "eye_care": "eye cream",
    "mask": "mask",
}
NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "seven": 7, "fourteen": 14, "thirty": 30}


def _num(s: str) -> int:
    return int(s) if s.isdigit() else NUMBER_WORDS[s]


def parse(text: str, workspace: str) -> dict[str, Any]:
    """A rule typed in plain words, read by fixed patterns (no model): the form's fields, and what
    could not be read (the form then keeps its defaults there)."""
    t = " " + re.sub(r"\s+", " ", text.lower()) + " "
    missed: list[str] = []
    if re.search(r"new (skin type|goal|group)|gains?|now works", t):
        kind = "new_segment"
    elif re.search(r"demand|rising|trending|more people want", t):
        kind = "rising_demand"
    elif re.search(r"unmet|under-?served|not getting results|no (visible )?change|struggl", t):
        kind = "unmet_need"
    elif "proven" in t:
        kind = "proven"
    else:
        kind = "proven"
        missed.append("when it starts (read as: becomes Proven)")
    goals = [g for g, words in GOAL_WORDS.items() if any(w in t for w in words)]
    # "shine/glow/oil" also appears in "oil-control": only count it with no other goal named
    if "oil_glow" in goals and len(goals) > 1 and not re.search(r"shine|glow", t):
        goals.remove("oil_glow")
    category = next((c for c, w in CATEGORY_WORDS.items() if w in t), None)
    days = 14
    if m := re.search(r"(\d+|seven|fourteen|thirty) ?-?days?", t):
        n = _num(m.group(1))
        days = n if n in (7, 14, 30) else min((7, 14, 30), key=lambda d: abs(d - n))
    elif m := re.search(r"(one|two|four|\d) weeks?", t):
        days = {1: 7, 2: 14, 4: 30}.get(_num(m.group(1)), 14)
    elif re.search(r"a month|one month|30", t):
        days = 30
    else:
        missed.append("how long (kept at 14 days)")
    holdout = 0.2
    if m := re.search(r"(\d+) ?% ?hold ?-?out", t) or re.search(r"hold ?-?out (?:of )?(\d+) ?%", t):
        holdout = min(max(int(m.group(1)) / 100, 0.1), 0.5)
    max_running = 2
    if m := re.search(
        r"(?:max|maximum|at most|up to) (\d|one|two|three)(?: at a time| running)?", t
    ):
        max_running = min(max(_num(m.group(1)), 1), campaigns.MAX_ACTIVE)
    if re.search(r"autopilot|fully|on its own|without asking", t):
        level = "autopilot"
    elif re.search(r"automatic|auto-?start|start it|tell me|notify", t):
        level = "auto"
    else:
        level = "suggest"
    unmet_min = UNMET_MIN
    if kind == "unmet_need" and (m := re.search(r"(\d+) ?%", t)):
        unmet_min = min(max(int(m.group(1)) / 100, 0.3), 0.9)
    elif kind == "unmet_need" and re.search(r"half|most", t):
        unmet_min = 0.5
    monthly = None
    if m := re.search(r"(\d+|one|two|three) (?:new )?(?:campaigns? )?(?:a|per) month", t):
        monthly = min(max(_num(m.group(1)), 1), 20)
    words = [GOAL_LABEL[g] for g in goals[:2]]
    noun = CATEGORY_LABEL.get(category, "").lower() if category else "products"
    name = f"{' and '.join(words)} {noun}" if words else f"Proven {noun}"
    return {
        "rule": {
            "name": name[:60],
            "workspace": workspace,
            "enabled": True,
            "level": level,
            "scope": {"category": category, "product_ids": []},
            "trigger": {"kind": kind, "goals": goals, "unmet_min": unmet_min},
            "conditions": {
                "in_store": bool(re.search(r"in stock|in store|sold in", t)),
                "start_on": None,
                "stop_after": None,
                "monthly_cap": monthly,
            },
            "action": {"days": days, "holdout_pct": round(holdout, 2), "max_running": max_running},
        },
        "missed": missed,
    }
