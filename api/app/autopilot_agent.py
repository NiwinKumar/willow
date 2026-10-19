"""AutoCampaign's agent: Gemini runs each rule's check with tools (app/autopilot.py has the rules,
the feed and the deterministic fallback).

For every enabled rule, one episode: Gemini reads the evidence through read tools (the rule, the
products in its scope, rising demand, under-served groups, the owner's campaigns, the limits),
decides what to do, and acts through act tools: start (or propose, at the Suggest level) a
campaign, hold a product back, pause, resume, extend, narrow or end a campaign the rule started,
then finishes with a short summary. It may call tools over several rounds and correct itself when
a tool says no.

Gemini decides; code only says no. Every act tool checks, before anything changes: the product is
in the rule's scope, Proven, and its trigger is met; goals and skin types are within the evidence
(campaigns.check); the brand owns it; the rule's own limit (waiting proposals hold their slot), the
monthly cap and the 3-running cap; the level (Suggest turns every action into a proposal, Auto
turns managing actions into proposals). Every reason Gemini writes is checked too: only numbers a
tool returned (or the rule's own), no efficacy overclaims or banned words; a failed reason goes
back to Gemini to rewrite. A refused action is returned to Gemini as the tool's answer.

Before the agent runs, code pauses any campaign the rule started whose product is no longer Proven
(a guardrail, never left to the model). Without Gemini, the rule runs on the fixed logic in
autopilot.py and the feed says so.
"""

import json
import logging
import time
from datetime import datetime
from typing import Any

from google.genai import types

from app import autopilot, campaigns, catalog, gemini, numbers
from app.explain import BANNED
from app.proof_ai import OVERCLAIM
from app.retailer import GOAL_LABEL, SKIN_LABEL
from app.settings import get_settings
from app.store import Doc, Store

log = logging.getLogger("willow.autopilot_agent")

MAX_ROUNDS = 8
BUDGET_S = 45.0
DAYS = (7, 14, 30)

INSTRUCTIONS = """You are AutoCampaign, the campaign agent inside Willow Proof, a retail analytics
product for skincare. A brand or retailer wrote one standing RULE. Run its check now: look at the
evidence with the read tools, decide, act with the act tools, then call finish.

How to work:
- Start with get_rule, list_products and list_campaigns; use get_demand or get_underserved when the
  trigger is about demand or under-served groups, and get_limits before starting anything.
- Start or propose a campaign only for a product whose `trigger_met` is true. Choose which ones and
  in what order with judgment: the strength and certainty of the lift (lift_lo, n), how many people
  it can help, the rule's limit. Pick the audience (goals, skin types) within the product's evidence
  and the trigger; an empty skin_types list means every skin type the evidence covers.
- Look after the campaigns this rule started: extend one that is working (positive lift over the
  holdout) near its end, narrow one whose audience the evidence no longer covers, end one early
  when the holdout shows no lift, resume one that was paused when it is Proven again.
- Hold a product back (hold) when it matches but the limit is reached or it is not the best use of
  a slot, and say why.
- If a tool refuses, read why and adjust; never retry the same refused action unchanged.
- Every `reason` is shown to the brand after the action itself (product, audience and length are
  already said): say why, in one or two plain sentences. Numbers only as the tools gave them: a
  rate (the share of users with a visible change by week 8; never call it "success") such as 0.35
  may be written 35%; a lift is a difference in points, so write lift 0.35 as
  "+35 pts", never "35%". No new numbers. Observational, cosmetic wording (never "clinically",
  "proven to", "cures", condition names, or skin tone or lightness).
- finish with a summary of what you did and why, in at most two sentences."""


def _decl(name: str, desc: str, props: dict | None = None, required: list[str] | None = None):
    return types.FunctionDeclaration(
        name=name,
        description=desc,
        parameters_json_schema={
            "type": "object",
            "properties": props or {},
            **({"required": required} if required else {}),
        },
    )


_REASON = {"reason": {"type": "string", "description": "shown to the brand, 1-2 sentences"}}
_GOALS = {"type": "array", "items": {"type": "string", "enum": list(GOAL_LABEL)}}
_SKINS = {"type": "array", "items": {"type": "string", "enum": list(SKIN_LABEL)}}
_CID = {"campaign_id": {"type": "string"}}

TOOLS = types.Tool(
    function_declarations=[
        _decl("get_rule", "The rule: its sentence, trigger, campaign settings, level, scope."),
        _decl(
            "list_products",
            "Products in the rule's scope with their evidence (tier, n, lift, lift_lo, goals and "
            "skin types with a positive lift, the claim-ready statement), whether the rule's "
            "trigger is met for each, and whether it is busy (already running or proposed).",
        ),
        _decl("get_demand", "Goals whose share of people rose from last month to this month."),
        _decl(
            "get_underserved",
            "Skin type x goal groups and the share with no visible change by week 8.",
            {"goal": {"type": "string", "enum": list(GOAL_LABEL)}},
        ),
        _decl(
            "list_campaigns",
            "This owner's campaigns: status, days left, audience, reach, adds and the lift over "
            "the randomised holdout (null until 10 people per group); `this_rule` marks the ones "
            "this rule started.",
        ),
        _decl("get_limits", "Slots left: this rule's limit, the monthly cap, the 3-running cap."),
        _decl(
            "start_campaign",
            "Start a campaign (or, at the Suggest level, propose it for approval).",
            {
                "product_id": {"type": "string"},
                "goals": _GOALS,
                "skin_types": _SKINS,
                "days": {"type": "integer", "enum": list(DAYS)},
                **_REASON,
            },
            ["product_id", "goals", "reason"],
        ),
        _decl(
            "hold",
            "Hold a matching product back this time, with the reason.",
            {"product_id": {"type": "string"}, **_REASON},
            ["product_id", "reason"],
        ),
        _decl(
            "pause_campaign",
            "Pause a campaign this rule started.",
            {**_CID, **_REASON},
            ["campaign_id", "reason"],
        ),
        _decl(
            "resume_campaign",
            "Resume a paused campaign this rule started.",
            {**_CID, **_REASON},
            ["campaign_id", "reason"],
        ),
        _decl(
            "end_campaign",
            "End a campaign this rule started early (final).",
            {**_CID, **_REASON},
            ["campaign_id", "reason"],
        ),
        _decl(
            "extend_campaign",
            "Add days to a running campaign this rule started.",
            {**_CID, "days": {"type": "integer", "enum": list(DAYS)}, **_REASON},
            ["campaign_id", "days", "reason"],
        ),
        _decl(
            "narrow_campaign",
            "Narrow a running campaign's audience to fewer goals or skin types.",
            {**_CID, "goals": _GOALS, "skin_types": _SKINS, **_REASON},
            ["campaign_id", "goals", "skin_types", "reason"],
        ),
        _decl(
            "finish",
            "End the check with a short summary.",
            {"summary": {"type": "string"}},
            ["summary"],
        ),
    ]
)


def model_round(contents: list[types.Content], config: types.GenerateContentConfig):
    """One Gemini turn: (function calls as [(name, args)], text, the model's content). The seam
    the tests replace."""
    started = time.monotonic()
    res = gemini.with_retry(
        "autopilot_agent",
        lambda: gemini.client().models.generate_content(
            model=get_settings().gemini_model, contents=contents, config=config
        ),
    )
    usage = res.usage_metadata
    log.info(
        json.dumps(
            {
                "prompt_id": "autopilot_agent",
                "latency_ms": round((time.monotonic() - started) * 1000),
                "input_tokens": getattr(usage, "prompt_token_count", None),
                "output_tokens": getattr(usage, "candidates_token_count", None),
            }
        )
    )
    calls = [(c.name, dict(c.args or {})) for c in (res.function_calls or [])]
    content = res.candidates[0].content if res.candidates else None
    return calls, (res.text if not calls else None), content


class Episode:
    """One rule's check by the agent: the tools and their guardrails."""

    def __init__(
        self,
        store: Store,
        uid: str,
        rule: tuple[str, Doc],
        sig: dict,
        at: datetime,
        totals: dict[str, int],
    ):
        self.store, self.uid, self.rule, self.sig, self.at, self.totals = (
            store,
            uid,
            rule,
            sig,
            at,
            totals,
        )
        self.rid, self.rdoc = rule
        self.by_id = {p["product_id"]: p for p in sig["products"]}
        self.seen_outputs: list[Any] = [autopilot.describe(self.rdoc), self.rdoc["action"]]
        self.acted = 0
        self.done: dict[str, int] = {}
        self.summary: str | None = None

    # -- state --------------------------------------------------------------------------------

    def _mine(self) -> list[tuple[str, Doc]]:
        return self.store.campaigns_of(self.uid)

    def _rule_campaigns(self) -> list[tuple[str, Doc]]:
        return [(c, d) for c, d in self._mine() if d.get("rule_id") == self.rid]

    def _open_props(self) -> list[Doc]:
        return [
            d
            for _, d in self.store.activities_of(self.uid)
            if d.get("rule_id") == self.rid
            and d["kind"] == "proposed"
            and d.get("status") == "open"
        ]

    def _limits(self) -> dict[str, Any]:
        a, c = self.rdoc["action"], self.rdoc["conditions"]
        rc = self._rule_campaigns()
        running = sum(1 for _, d in rc if campaigns.status_of(d, self.at) == "active")
        waiting = sum(
            1 for d in self._open_props() if (d.get("proposal") or {}).get("action") == "start"
        )
        left = a["max_running"] - running - waiting
        month = None
        if c.get("monthly_cap"):
            month = c["monthly_cap"] - autopilot._month_count(rc, self.at) - waiting
            left = min(left, month)
        owner = campaigns.active_count(self.store, self.uid)
        return {
            "rule_max_at_a_time": a["max_running"],
            "rule_running": running,
            "rule_waiting_for_approval": waiting,
            "monthly_left": month,
            "account_running": owner,
            "account_max": campaigns.MAX_ACTIVE,
            "slots_left": max(0, min(left, campaigns.MAX_ACTIVE - owner)),
            "window_open": autopilot._window_open(self.rdoc, self.at.date()),
        }

    # -- read tools ---------------------------------------------------------------------------

    def get_rule(self) -> dict:
        r = self.rdoc
        return {
            "name": r["name"],
            "sentence": autopilot.describe(r),
            "level": r["level"],
            "trigger": r["trigger"],
            "action": r["action"],
            "conditions": r["conditions"],
            "scope": r["scope"],
            "workspace": r["workspace"],
        }

    def list_products(self) -> dict:
        mine = self._mine()
        busy = {
            d["product_id"]
            for _, d in mine
            if campaigns.status_of(d, self.at) in ("active", "paused")
        }
        waiting = {d.get("product_id") for d in self._open_props()}
        out = []
        for p in self.sig["products"]:
            if not autopilot._in_scope(self.rdoc, p):
                continue
            m = autopilot._match(self.rdoc, p, self.sig) if autopilot._proven(p) else None
            out.append(
                {
                    "product_id": p["product_id"],
                    "name": f"{p['brand']} {p['product']}",
                    "category": p.get("category"),
                    "tier": p.get("tier"),
                    "eligible": bool(p.get("eligible")),
                    "n": p.get("n"),
                    "lift": p.get("lift"),
                    "lift_lo": p.get("lift_lo"),
                    "rate": p.get("rate"),
                    "non_user_rate": p.get("base_rate"),
                    "goals": p.get("goals") or [],
                    "skin_types": p.get("skin_types") or [],
                    "statement": p.get("evidence") or "",
                    "trigger_met": m is not None,
                    "trigger_audience": {"goals": m["goals"], "skin_types": m["skin_types"]}
                    if m
                    else None,
                    "busy": p["product_id"] in busy or p["product_id"] in waiting,
                }
            )
        return {"products": out}

    def get_demand(self) -> dict:
        return {"rising": self.sig.get("rising") or {}}

    def get_underserved(self, goal: str | None = None) -> dict:
        cells = [
            c
            for c in self.sig.get("unmet") or []
            if (c.get("users") or 0) >= campaigns.MIN_GROUP and (not goal or c["goal"] == goal)
        ]
        return {"groups": cells}

    def list_campaigns(self) -> dict:
        out = []
        for cid, d in self._mine():
            st = campaigns.stats(self.store, cid, d)
            end = campaigns._aware(d.get("ends_at"))
            out.append(
                {
                    "campaign_id": cid,
                    "product_id": d["product_id"],
                    "this_rule": d.get("rule_id") == self.rid,
                    "status": campaigns.status_of(d, self.at),
                    "days_left": max(0, (end - self.at).days) if end else None,
                    "goals": d.get("goals") or [],
                    "skin_types": d.get("skin_types") or [],
                    "reach": st["reach"],
                    "adds": st["adds"],
                    "holdout_lift": st["incrementality"],
                }
            )
        return {"campaigns": out}

    def get_limits(self) -> dict:
        return self._limits()

    # -- guardrails ---------------------------------------------------------------------------

    def _reason_problem(self, reason: str) -> str | None:
        text = (reason or "").strip()
        if len(text) < 8:
            return "Write a reason for the brand (one or two sentences)."
        if len(text) > 400:
            return "Keep the reason under 400 characters."
        allowed = numbers.collect(self.seen_outputs) | numbers.percents(self.seen_outputs)
        for p in self.sig["products"]:  # names may carry digits ("Niacinamide 10%")
            allowed |= numbers.in_text(f"{p['brand']} {p['product']}")
        if not numbers.only_known(text, allowed):
            return "The reason quotes a number no tool returned. Use only the tools' numbers."
        if OVERCLAIM.search(text) or BANNED.search(text):
            return "The reason uses an overclaim or a banned word. Rewrite it in cosmetic words."
        return None

    def _owned_campaign(self, cid: str) -> tuple[Doc | None, str | None]:
        d = self.store.campaign_get(cid) if isinstance(cid, str) else None
        if d is None or d.get("owner_uid") != self.uid or d.get("rule_id") != self.rid:
            return None, "That is not a campaign this rule started."
        if campaigns.status_of(d, self.at) == "ended":
            return None, "That campaign has ended."
        return d, None

    def _name(self, pid: str) -> str:
        p = catalog.by_id(pid) or {}
        return f"{p.get('brand', '')} {p.get('name', pid)}".strip()

    def _log(self, kind: str, text: str, **extra: Any) -> str | None:
        return autopilot._log(
            self.store, self.uid, self.rule, kind, text, self.at, by="gemini", **extra
        )

    # -- act tools ----------------------------------------------------------------------------

    def start_campaign(
        self,
        product_id: str,
        goals: list[str],
        reason: str,
        skin_types: list[str] | None = None,
        days: int | None = None,
    ) -> dict:
        p = self.by_id.get(product_id)
        if p is None or not autopilot._in_scope(self.rdoc, p):
            return {"ok": False, "error": "That product is not in this rule's scope."}
        if not autopilot._proven(p):
            return {"ok": False, "error": "Only products rated Proven can be promoted."}
        m = autopilot._match(self.rdoc, p, self.sig)
        if m is None:
            return {"ok": False, "error": "This rule's trigger is not met for that product."}
        lim = self._limits()
        if not lim["window_open"]:
            return {"ok": False, "error": "The rule's date window is closed today."}
        if lim["slots_left"] <= 0:
            return {"ok": False, "error": "No slot left: hold it instead.", "limits": lim}
        listing = {x["product_id"]: x for x in self.list_products()["products"]}
        if listing[product_id]["busy"]:
            return {"ok": False, "error": "That product is already running or proposed."}
        skins = list(dict.fromkeys(skin_types or []))
        goals = list(dict.fromkeys(goals or []))
        tg = set(self.rdoc["trigger"].get("goals") or [])
        if not goals or any(g not in (p.get("goals") or []) or (tg and g not in tg) for g in goals):
            return {
                "ok": False,
                "error": "Goals must be among the product's evidence goals and "
                f"the rule's goals: {m['goals']}.",
            }
        if m["skin_types"] and (not skins or any(s not in m["skin_types"] for s in skins)):
            return {
                "ok": False,
                "error": f"This trigger targets these skin types: {m['skin_types']}.",
            }
        product = catalog.by_id(product_id)
        why = (
            campaigns.check(product, self.rdoc["workspace"], goals, skins)
            if product
            else ["This product is no longer in the catalog."]
        )
        if why:
            return {"ok": False, "error": " ".join(why)}
        problem = self._reason_problem(reason)
        if problem:
            return {"ok": False, "error": problem}
        a = self.rdoc["action"]
        days = days if days in DAYS else a["days"]
        who = f" for {autopilot._skins(skins)} skin" if skins else ""
        name = self._name(product_id)
        if self.rdoc["level"] == "suggest":
            self._log(
                "proposed",
                f"Proposed: promote {name}{who} for {days} days. {reason.strip()}",
                status="open",
                product_id=product_id,
                proposal={
                    "action": "start",
                    "goals": goals,
                    "skin_types": skins,
                    "days": days,
                    "holdout_pct": a["holdout_pct"],
                    "evidence": p.get("evidence") or "",
                },
                numbers=autopilot._numbers(p),
            )
            self.totals["proposed"] += 1
            self.acted += 1
            return {"ok": True, "did": "proposed for approval (Suggest level)"}
        rule = (self.rid, self.rdoc | {"action": a | {"days": days}})
        cid, why = autopilot._start(self.store, self.uid, rule, p, goals, skins)
        if cid is None:
            return {"ok": False, "error": " ".join(why)}
        self._log(
            "started",
            f"Started {name}{who} for {days} days. {reason.strip()}",
            product_id=product_id,
            campaign_id=cid,
            numbers=autopilot._numbers(p),
        )
        self.totals["started"] += 1
        self.acted += 1
        return {"ok": True, "did": "started", "campaign_id": cid}

    def hold(self, product_id: str, reason: str) -> dict:
        p = self.by_id.get(product_id)
        if p is None or not autopilot._in_scope(self.rdoc, p):
            return {"ok": False, "error": "That product is not in this rule's scope."}
        problem = self._reason_problem(reason)
        if problem:
            return {"ok": False, "error": problem}
        if self._log(
            "held",
            f"Held {self._name(product_id)}. {reason.strip()}",
            key=f"{self.rid}:held:{product_id}:{self.at.date().isoformat()}",
            product_id=product_id,
        ):
            self.totals["held"] += 1
        return {"ok": True, "did": "held"}

    def _manage(self, action: str, campaign_id: str, reason: str, change: dict) -> dict:
        d, err = self._owned_campaign(campaign_id)
        if err:
            return {"ok": False, "error": err}
        p = self.by_id.get(d["product_id"]) or {}
        status = campaigns.status_of(d, self.at)
        if action in ("extend", "narrow", "pause") and status != "active":
            return {"ok": False, "error": "That campaign is not running."}
        if action == "resume":
            if status != "paused":
                return {"ok": False, "error": "That campaign is not paused."}
            if not autopilot._proven(p):
                return {"ok": False, "error": "Its product is not rated Proven, so it can't run."}
            if campaigns.active_count(self.store, self.uid) >= campaigns.MAX_ACTIVE:
                return {"ok": False, "error": "3 campaigns are already running."}
        if action == "extend":
            if change.get("days") not in DAYS:
                return {"ok": False, "error": "Extend by 7, 14 or 30 days."}
            if not autopilot._proven(p):
                return {"ok": False, "error": "Its product is no longer Proven: don't extend it."}
        if action == "narrow":
            goals = [g for g in change.get("goals") or [] if g in (d.get("goals") or [])]
            skins = list(change.get("skin_types") or [])
            had = d.get("skin_types") or []
            if not goals or (had and any(s not in had for s in skins)) or (had and not skins):
                return {
                    "ok": False,
                    "error": "Narrowing keeps a subset of the current goals and skin types.",
                }
            if any(s not in (p.get("skin_types") or []) for s in skins):
                return {"ok": False, "error": "Keep only skin types the evidence still covers."}
            change = {"goals": goals, "skin_types": skins}
        problem = self._reason_problem(reason)
        if problem:
            return {"ok": False, "error": problem}
        name = self._name(d["product_id"])
        verb = {
            "pause": "Paused",
            "resume": "Resumed",
            "end": "Ended",
            "extend": "Extended",
            "narrow": "Narrowed",
        }[action]
        extra = f" by {change['days']} days" if action == "extend" else ""
        text = f"{verb} {name}{extra}. {reason.strip()}"
        # pausing is always safe; the rest needs Full autopilot, else it is proposed
        if action != "pause" and self.rdoc["level"] != "autopilot":
            if self._log(
                "proposed",
                f"Proposed: {text[0].lower()}{text[1:]}",
                status="open",
                key=f"{self.rid}:{campaign_id}:{action}",
                product_id=d["product_id"],
                campaign_id=campaign_id,
                proposal={"action": action, **change},
                numbers=autopilot._numbers(p),
            ):
                self.totals["proposed"] += 1
                self.acted += 1
            return {"ok": True, "did": "proposed for approval (this level can't do it alone)"}
        if action == "end":
            change = {"reason": "agent"}
        autopilot._apply(self.store, campaign_id, d, action, change, self.at)
        self._log(
            autopilot._PAST[action],
            text,
            product_id=d["product_id"],
            campaign_id=campaign_id,
            numbers=autopilot._numbers(p),
        )
        self.totals[autopilot._PAST[action]] += 1
        self.acted += 1
        return {"ok": True, "did": autopilot._PAST[action]}

    def pause_campaign(self, campaign_id: str, reason: str) -> dict:
        return self._manage("pause", campaign_id, reason, {})

    def resume_campaign(self, campaign_id: str, reason: str) -> dict:
        return self._manage("resume", campaign_id, reason, {})

    def end_campaign(self, campaign_id: str, reason: str) -> dict:
        return self._manage("end", campaign_id, reason, {})

    def extend_campaign(self, campaign_id: str, days: int, reason: str) -> dict:
        return self._manage("extend", campaign_id, reason, {"days": days})

    def narrow_campaign(
        self, campaign_id: str, goals: list[str], skin_types: list[str], reason: str
    ) -> dict:
        return self._manage(
            "narrow", campaign_id, reason, {"goals": goals, "skin_types": skin_types}
        )

    def finish(self, summary: str) -> dict:
        problem = self._reason_problem(summary)
        if problem:
            return {"ok": False, "error": problem}
        self.summary = summary.strip()
        return {"ok": True}

    # -- the loop -----------------------------------------------------------------------------

    def _what_it_did(self) -> str:
        if not self.done:
            return "Nothing to change this time."
        parts = [f"{n} {k}" for k, n in self.done.items()]
        return f"{', '.join(parts).capitalize()}."

    def call(self, name: str, args: dict) -> dict:
        fn = getattr(self, name, None) if name in _TOOL_NAMES else None
        if fn is None:
            return {"ok": False, "error": f"No tool named {name}."}
        try:
            out = fn(**args)
        except TypeError as exc:
            return {"ok": False, "error": f"Bad arguments: {exc}"}
        if out.get("ok") and out.get("did"):
            did = out["did"].split(" ")[0]
            self.done[did] = self.done.get(did, 0) + 1
        self.seen_outputs.append(out)
        return out

    def run(self) -> None:
        contents = [
            types.Content(
                role="user",
                parts=[
                    types.Part(
                        text=(
                            f"Run the check for rule {self.rdoc['name']!r} now. Today is "
                            f"{self.at.date().isoformat()}."
                        )
                    )
                ],
            )
        ]
        config = types.GenerateContentConfig(
            system_instruction=f"{gemini.SYSTEM_RULES}\n\n{INSTRUCTIONS}",
            temperature=0.2,
            max_output_tokens=4096,
            tools=[TOOLS],
            thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        started = time.monotonic()
        for i in range(MAX_ROUNDS):
            if time.monotonic() - started > BUDGET_S:
                break
            try:
                calls, text, content = model_round(contents, config)
            except Exception as exc:
                if i == 0:
                    raise gemini.GeminiError(
                        str(exc)
                    ) from exc  # nothing done: the caller falls back
                log.warning("autopilot agent stopped after round %d: %s", i, str(exc)[:200])
                break  # keep what it did; no fallback, so nothing happens twice
            if not calls:
                if text and not self.summary and not self._reason_problem(text):
                    self.summary = text.strip()
                break
            if content is not None:
                contents.append(content)
            parts = []
            for name, args in calls:
                out = self.call(name, args)
                parts.append(types.Part.from_function_response(name=name, response=out))
            contents.append(types.Content(role="user", parts=parts))
            if self.summary is not None:
                break
        reviewed = len(self.list_products()["products"])
        self._log(
            "reviewed",
            f"Reviewed {reviewed} {'product' if reviewed == 1 else 'products'} and the rule's "
            f"campaigns. {self.summary or self._what_it_did()}",
            key=f"{self.rid}:reviewed:{self.at.isoformat(timespec='minutes')}",
        )


_TOOL_NAMES = {d.name for d in TOOLS.function_declarations}


def run_rule(
    store: Store, uid: str, rule: tuple[str, Doc], sig: dict, at: datetime, totals: dict[str, int]
) -> None:
    """One rule's check by the agent. Raises gemini.GeminiError (or anything the model call
    raises) before acting when Gemini can't be reached; the caller then uses the fixed logic."""
    Episode(store, uid, rule, sig, at, totals).run()


# -- typed rules ---------------------------------------------------------------------------

PARSE_INSTRUCTIONS = """Turn a skincare brand's or retailer's rule, written in plain words, into
the AutoCampaign form. Fill only what the words say; leave the rest at the defaults given. Use
only the allowed values. `missed`: short notes in plain words on what the words did not say and
was kept as the default (for example "how long: kept at 14 days", "holdout: kept at 20%"), never
field names; nothing when the words covered it."""


def parse(text: str, workspace: str, defaults: dict[str, Any], schema) -> dict[str, Any]:
    """Gemini reads a typed rule into the form (`schema`: the routes' RuleDraft). Raises
    gemini.GeminiError when it can't."""
    out = gemini.generate_json(
        "autopilot_parse",
        [json.dumps({"TEXT": text, "DEFAULTS": defaults, "WORKSPACE": workspace})],
        schema,
        instructions=PARSE_INSTRUCTIONS,
        temperature=0.0,
        max_output_tokens=1500,
    )
    return out.model_dump()
