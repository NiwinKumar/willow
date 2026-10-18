"""The buying list's agent: Gemini writes the retailer's buying list with tools (app/buying.py has
the fixed-logic list it falls back to, the shared helpers and the cache).

One episode per filter and data version: Gemini reads the aggregates through read tools (every goal
x price tier's options, visible-change rate and people, demand per goal and its month-on-month
trend, under-served skin type x goal groups, the products on the shelf in a tier with their Proof
status, a product's ingredient list), decides which gaps are worth a buyer's attention and in what
order, writes each brief, picks the under-used shelf products to look at first and says why, then
finishes.

Gemini decides; code only says no: briefs and reasons may quote only numbers a tool returned, never
efficacy or skin-lightness wording; a candidate must be in the brief's price tier, not already
measured for the goal (it would be part of the gap's own numbers), never a strong active for
redness or the under-eye area, and its ingredient must be on that product's own INCI list. The
labels ("Not measured for <goal> yet", "Too few users to measure yet") and the caveat are set by
code, never written by the model. A refusal goes back to Gemini as the tool's answer.
"""

import json
import logging
import re
import time
from typing import Any

from google.genai import types

from app import buying, catalog, cohort, gemini, numbers, retail_intel, retailer
from app.explain import BANNED
from app.proof_ai import OVERCLAIM
from app.settings import get_settings

log = logging.getLogger("willow.buying_agent")

MAX_ROUNDS = 18
BUDGET_S = 75.0
TIERS = [t for t, _, _ in cohort.TIERS]
# Bases and solvents: never "the ingredient" a product is suggested for.
BASES = re.compile(
    r"^(aqua|water|.*\bwater\b|glycerin|butylene glycol|propanediol|pentylene glycol|"
    r"dimethicone|phenoxyethanol|ethylhexylglycerin|xanthan gum|carbomer|.*alcohol\b|"
    r"fragrance|parfum|sodium chloride|citric acid|sodium hydroxide)$",
    re.I,
)

INSTRUCTIONS = """You are the buying agent inside Willow Proof, a retail analytics product for
skincare. Write the retailer's buying list: the assortment gaps worth acting on, each as a short
brief a buyer can paste, with products already on the shelf to look at first.

How to work:
- Read get_gaps first. A gap is a goal people want help with where a price tier (budget, mid,
  premium) has no option, options far behind the goal's best tier, low visible change everywhere,
  options too few people use to measure, or a single option. Weigh how many people want the goal,
  its trend (get_trends) and under-served groups (get_underserved).
- Choose the 3 to 5 gaps that matter most and add them with add_brief, most important first
  (priority 1 = first). tier is null for a gap across every tier.
- Right after adding a brief, add its candidates (finish one brief before the next): look for
  under-used products already in the catalog with list_products (that tier) and get_ingredients,
  and add up to 3 with add_candidate. You may call several tools in one turn. Candidates: a product sold for the goal that
  too few people use to measure, or a product not sold for the goal whose ingredient list has an
  active ingredient commonly used for it. Prefer leave-on products over cleansers and masks.
- If a tool refuses, read why and adjust. Then finish with a one-sentence summary.

Writing:
- title: an imperative of at most 8 words ("Add a budget redness product").
- brief: one or two plain sentences with the evidence, quoting numbers only as the tools gave them;
  a rate such as 0.45 may be written 45% (visible change by week 8), people as counts, prices as
  the tools wrote them. No new numbers. Visible change is measured from photos: never say people
  "report" or "say" it.
- A candidate's why: one plain sentence on why it is worth a look. An ingredient match is a reason
  to look, never evidence: never say it works, is effective, proven or best, never "clinically",
  cures or condition names, and never skin colour or lightness (brighten, lighten, radiance, glow).
"""


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


_GOAL = {"type": "string", "enum": list(retailer.GOAL_LABEL)}
_TIER = {"type": "string", "enum": TIERS}

TOOLS = types.Tool(
    function_declarations=[
        _decl(
            "get_gaps",
            "Every goal: people who want it, and per price tier the number of catalog options, the "
            "share of their users with a visible change by week 8 (null under 10 people) and n.",
        ),
        _decl("get_trends", "Goals whose share of people rose from last month to this month."),
        _decl(
            "get_underserved",
            "Skin type x goal groups and the share with no visible change by week 8.",
            {"goal": _GOAL},
        ),
        _decl(
            "list_products",
            "Catalog products in a price tier: category, goals it is sold for, key actives, its "
            "Proof status (proven, promising, unclear, too_few), users and n.",
            {"tier": _TIER, "goal": _GOAL},
            ["tier"],
        ),
        _decl(
            "get_ingredients",
            "A product's full ingredient (INCI) list.",
            {"product_id": {"type": "string"}},
            ["product_id"],
        ),
        _decl(
            "add_brief",
            "Add a gap to the buying list. Returns its brief_id.",
            {
                "goal": _GOAL,
                "tier": {**_TIER, "nullable": True},
                "title": {"type": "string"},
                "brief": {"type": "string"},
                "priority": {"type": "integer", "description": "1 = most important"},
            },
            ["goal", "title", "brief", "priority"],
        ),
        _decl(
            "add_candidate",
            "Add an under-used catalog product to a brief, to look at first.",
            {
                "brief_id": {"type": "string"},
                "product_id": {"type": "string"},
                "ingredient": {
                    "type": "string",
                    "description": "from its INCI list; empty for a "
                    "product already sold for the goal",
                },
                "why": {"type": "string"},
            },
            ["brief_id", "product_id", "why"],
        ),
        _decl(
            "finish",
            "End with a one-sentence summary.",
            {"summary": {"type": "string"}},
            ["summary"],
        ),
    ]
)
_TOOL_NAMES = {d.name for d in TOOLS.function_declarations}


def model_round(contents: list[types.Content], config: types.GenerateContentConfig):
    """One Gemini turn: ([(tool, args)], text, the model's content). The seam the tests replace."""
    started = time.monotonic()
    res = gemini.client().models.generate_content(
        model=get_settings().gemini_model, contents=contents, config=config
    )
    usage = res.usage_metadata
    log.info(
        json.dumps(
            {
                "prompt_id": "buying_agent",
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
    def __init__(self, ins: dict[str, Any], rows: dict[str, dict], cohort_: str, range_: str):
        self.ins, self.rows, self.cohort_, self.range_ = ins, rows, cohort_, range_
        self.demand = {r["goal_id"]: r["n"] for r in ins.get("needs") or []}
        self.gaps = {g["goal_id"]: g for g in ins.get("gaps") or []}
        self.seen: list[Any] = []
        self.briefs: dict[str, dict[str, Any]] = {}
        self.summary: str | None = None

    # -- read tools ---------------------------------------------------------------------------

    def get_gaps(self) -> dict:
        out = []
        for goal, g in self.gaps.items():
            out.append(
                {
                    "goal": goal,
                    "label": retailer.GOAL_LABEL[goal],
                    "people": self.demand.get(goal),
                    "tiers": {t: {**g[t], "price": buying.price_text(t)} for t in TIERS},
                }
            )
        return {"goals": out, "low_rate_note": "under 0.2 visible change is low"}

    def get_trends(self) -> dict:
        try:
            f, _, _ = retail_intel.facts(self.cohort_, self.range_)
            return {"rising": retail_intel.rising_goals(f)}
        except Exception:
            return {"rising": {}}

    def get_underserved(self, goal: str | None = None) -> dict:
        try:
            cells = retail_intel.segments(self.cohort_, self.range_)["cells"]
        except Exception:
            cells = []
        return {
            "groups": [
                {
                    "skin": c["skin"],
                    "goal": c["goal"],
                    "no_change_share": c["unmet"],
                    "people": c["users"],
                }
                for c in cells
                if c["unmet"] is not None and (not goal or c["goal"] == goal)
            ]
        }

    def list_products(self, tier: str, goal: str | None = None) -> dict:
        if tier not in TIERS:
            return {"error": f"tier must be one of {TIERS}"}
        out = []
        for p in catalog.products():
            if cohort.tier(p["price"]) != tier:
                continue
            r = self.rows.get(p["product_id"]) or {}
            sold = r.get("goal_ids") or []
            out.append(
                {
                    "product_id": p["product_id"],
                    "name": f"{p['brand']} {p['name']}",
                    "category": p["category"],
                    "sold_for_goals": sold,
                    "key_actives": [
                        a["name"] if isinstance(a, dict) else a for a in p.get("key_actives") or []
                    ][:4],
                    "proof_status": r.get("tier"),
                    "users": r.get("users"),
                    "n": r.get("n"),
                    **({"sold_for_this_goal": goal in sold} if goal else {}),
                }
            )
        return {"tier": tier, "price": buying.price_text(tier), "products": out}

    def get_ingredients(self, product_id: str) -> dict:
        p = catalog.by_id(product_id)
        if p is None:
            return {"error": "No such product."}
        return {"product_id": product_id, "inci": buying._inci(p)}

    # -- checks -------------------------------------------------------------------------------

    def _text_problem(self, text: str, extra_names: list[str] = ()) -> str | None:
        t = (text or "").strip()
        if len(t) < 6:
            return "Too short."
        if len(t) > 360:
            return "Keep it under 360 characters."
        allowed = numbers.collect(self.seen) | numbers.percents(self.seen)
        plain = t
        for n in extra_names:
            plain = plain.replace(n, "")
        for p in catalog.products():  # names may carry digits ("Niacinamide 10%")
            plain = plain.replace(p["name"], "")
        # prices as the tools wrote them ("under ₹700", "₹700–₹2,000")
        plain = re.sub(r"₹[\d,]+", "", plain)
        if not numbers.only_known(plain, allowed):
            return "It quotes a number no tool returned. Use only the tools' numbers."
        if OVERCLAIM.search(t) or BANNED.search(t) or buying.LIGHTNESS.search(t):
            return "It uses an overclaim, a banned word or skin-lightness wording. Rewrite it."
        return None

    # -- act tools ----------------------------------------------------------------------------

    def add_brief(
        self, goal: str, title: str, brief: str, priority: int, tier: str | None = None
    ) -> dict:
        if goal not in self.gaps:
            return {"ok": False, "error": "Unknown goal."}
        if tier is not None and tier not in TIERS:
            return {"ok": False, "error": f"tier must be null or one of {TIERS}."}
        if (self.demand.get(goal) or 0) < retailer.MIN_GROUP:
            return {"ok": False, "error": "Fewer than 10 people want this goal."}
        if len(self.briefs) >= buying.MAX_ITEMS:
            return {"ok": False, "error": f"The list holds at most {buying.MAX_ITEMS} briefs."}
        if any(b["goal_id"] == goal and b["tier"] == tier for b in self.briefs.values()):
            return {"ok": False, "error": "That gap is already on the list."}
        for label, text in (("title", title), ("brief", brief)):
            problem = self._text_problem(text)
            if problem:
                return {"ok": False, "error": f"The {label}: {problem}"}
        if len(title.split()) > 10:
            return {"ok": False, "error": "Keep the title to 8 words."}
        bid = f"b{len(self.briefs) + 1}"
        self.briefs[bid] = {
            "goal_id": goal,
            "tier": tier,
            "title": title.strip(),
            "brief": brief.strip(),
            "priority": int(priority),
            "candidates": [],
        }
        return {"ok": True, "brief_id": bid}

    def add_candidate(
        self, brief_id: str, product_id: str, why: str, ingredient: str | None = None
    ) -> dict:
        b = self.briefs.get(brief_id)
        if b is None:
            return {"ok": False, "error": "Unknown brief_id."}
        if len(b["candidates"]) >= buying.MAX_CANDIDATES:
            return {"ok": False, "error": "A brief holds at most 3 candidates."}
        p = catalog.by_id(product_id)
        if p is None:
            return {"ok": False, "error": "No such product."}
        if any(c["product_id"] == product_id for c in b["candidates"]):
            return {"ok": False, "error": "Already on this brief."}
        goal = b["goal_id"]
        if b["tier"] and cohort.tier(p["price"]) != b["tier"]:
            return {"ok": False, "error": f"Not in the {b['tier']} tier."}
        r = self.rows.get(product_id) or {}
        sold = goal in (r.get("goal_ids") or [])
        if sold and r.get("tier") != "too_few":
            return {
                "ok": False,
                "error": "It is already measured for this goal, so it is part "
                "of the gap's own numbers. Pick an under-used product.",
            }
        if buying._avoid(p, goal):
            return {
                "ok": False,
                "error": "It contains a strong active that isn't suggested for this goal.",
            }
        name = None
        if not sold:
            name = buying.in_inci(p, ingredient or "")
            if not name:
                return {
                    "ok": False,
                    "error": "Name an ingredient from its INCI list (get_ingredients).",
                }
            if BASES.match(name.strip()):
                return {"ok": False, "error": "That is a base, not an active ingredient."}
        problem = self._text_problem(why, [p["brand"], name or "", ingredient or ""])
        if problem:
            return {"ok": False, "error": problem}
        if buying.NOT_PROVEN.search(why):
            return {
                "ok": False,
                "error": "It reads as evidence. An ingredient match is only a "
                "reason to look: rewrite it.",
            }
        gap = {"goal": retailer.GOAL_LABEL[goal]}
        b["candidates"].append(
            buying._candidate(p, gap, "few" if sold else "fit", name, why.strip())
        )
        return {"ok": True}

    def finish(self, summary: str) -> dict:
        problem = self._text_problem(summary)
        if problem:
            return {"ok": False, "error": problem}
        self.summary = summary.strip()
        return {"ok": True}

    # -- loop ---------------------------------------------------------------------------------

    def call(self, name: str, args: dict) -> dict:
        fn = getattr(self, name, None) if name in _TOOL_NAMES else None
        if fn is None:
            return {"ok": False, "error": f"No tool named {name}."}
        try:
            out = fn(**args)
        except TypeError as exc:
            return {"ok": False, "error": f"Bad arguments: {exc}"}
        if name.startswith("get_") or name == "list_products":
            self.seen.append(out)
        return out

    def run(self) -> None:
        contents = [
            types.Content(role="user", parts=[types.Part(text="Write the buying list now.")])
        ]
        config = types.GenerateContentConfig(
            # tool results build up over the rounds: a longer deadline than the 25 s default
            http_options=types.HttpOptions(timeout=60_000),
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
                calls, _text, content = model_round(contents, config)
            except Exception as exc:
                if not self.briefs:
                    raise gemini.GeminiError(str(exc)) from exc
                log.warning("buying agent stopped after round %d: %s", i, str(exc)[:200])
                break
            if not calls:
                break
            if content is not None:
                contents.append(content)
            parts = [
                types.Part.from_function_response(name=n, response=self.call(n, a))
                for n, a in calls
            ]
            contents.append(types.Content(role="user", parts=parts))
            if self.summary is not None:
                break
        if not self.briefs:
            raise gemini.GeminiError("the agent added no brief")

    def items(self) -> list[dict[str, Any]]:
        out = []
        ordered = sorted(self.briefs.items(), key=lambda kv: (kv[1]["priority"], kv[0]))
        for bid, b in ordered:
            g = self.gaps[b["goal_id"]]
            t = b["tier"]
            out.append(
                {
                    "id": f"{b['goal_id']}:{t or 'all'}:{bid}",
                    "goal_id": b["goal_id"],
                    "goal": retailer.GOAL_LABEL[b["goal_id"]],
                    "tier": t,
                    "kind": buying.kind_of(g, t),
                    "demand": self.demand.get(b["goal_id"]) or 0,
                    "options": {x: g[x] for x in TIERS},
                    "tier_label": buying.TIER_LABEL[t] if t else "every tier",
                    "price": buying.price_text(t) if t else None,
                    "title": b["title"],
                    "brief": b["brief"],
                    "candidates": b["candidates"],
                }
            )
        return out


def run(
    ins: dict[str, Any], rows: dict[str, dict], cohort_: str, range_: str
) -> tuple[list[dict[str, Any]], str | None]:
    """The agent's buying list: (items, summary). Raises gemini.GeminiError when Gemini can't be
    reached or adds no brief (the caller keeps the fixed-logic list)."""
    ep = Episode(ins, rows, cohort_, range_)
    ep.run()
    return ep.items(), ep.summary
