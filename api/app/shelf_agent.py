"""Shelf vs results, the agent: Gemini reads the shares through tools and writes the flags
(app/shelf.py has the shares, the fixed flags it falls back to and the cache).

Read tools: the categories (shelf basis, how far an uploaded stock file agrees with share of use),
one category's products (share of use, of stock, of results, the gap, Proof status, lift, still
using at week 8), one product's switching (where people who stopped it went, where its users came
from), and goal demand trends. Act tools: `flag` (a product, one of four kinds, a short title and
reason, a priority) and `finish`. Gemini decides which mismatches matter, in what order, and why.

Gemini decides; code only says no: the product must be in the data and the numbers must point the
flag's way (shelf.kind_ok, at least 3 points apart; stock kinds only with an uploaded file);
titles and reasons may quote only numbers a tool returned and no overclaims or banned words; the
label is code's. A refusal goes back to Gemini as the tool's answer.
"""

import json
import logging
import time
from typing import Any

from google.genai import types

from app import gemini, numbers, retail_intel, shelf
from app.explain import BANNED
from app.proof_ai import OVERCLAIM
from app.settings import get_settings

log = logging.getLogger("willow.shelf_agent")

MAX_ROUNDS = 14
BUDGET_S = 75.0
MARGIN = 0.03
MAX_FLAGS = 8

INSTRUCTIONS = """You are the shelf agent inside Willow Proof, a retail analytics product for
skincare. Compare each category's shelf with its results and flag what a retailer should act on.

The numbers: share of use = a product's share of the category's Willow users (Willow knows what
people use, not what a store stocks); share of stock = the retailer's own facings or stock, when
they uploaded a file; shelf = stock where uploaded, else use; share of results = its share of the
category's people with a visible change held to week 8 (measured from photos, not sales).

How to work:
- list_categories, then get_category for the ones worth a look; get_switching and get_trends when
  they change the advice.
- flag the products that matter most, most important first (priority 1 = first), at most 8:
  taking_space: much more shelf than results (more so if it is not Proven, people stop using it,
  or switchers leave it for a stronger product);
  under_shelved: much more results than shelf, and Proven or Promising;
  stocked_unused (only with an uploaded file): far more of the stock than of use;
  used_understocked (only with an uploaded file): far more of use than of the stock.
- If a tool refuses, read why and adjust. Then finish with a one-sentence summary.

Writing: title is an action of at most 8 words ("Give Serum X more facings"). reason is one or two
plain sentences for a store manager, quoting numbers only from the tools: write every share as a
whole percent (0.18 -> "18%"), never as a decimal; a lift is a difference in points (0.36 -> "+36
pts over non-users"); name the shelf as the tool's basis says ("share of use" when basis is use,
"share of your stock" when it is stock), never "shelf share" for share of use. No new numbers.
Observational, cosmetic wording: never "clinically", "proven to", cures, condition names, or skin
tone or lightness; results are visible changes, never sales or revenue.
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


TOOLS = types.Tool(
    function_declarations=[
        _decl(
            "list_categories",
            "Each category: users, visible changes, shelf basis (stock or "
            "use), products, and how far an uploaded stock file agrees with share of use.",
        ),
        _decl(
            "get_category",
            "One category's products with their shares, gap, Proof status, "
            "lift and share still using at week 8.",
            {"category": {"type": "string"}},
            ["category"],
        ),
        _decl(
            "get_switching",
            "Where people who stopped a product went, and where its users came "
            "from (groups of 10+ people).",
            {"product_id": {"type": "string"}},
            ["product_id"],
        ),
        _decl("get_trends", "Goals whose share of people rose from last month to this month."),
        _decl(
            "flag",
            "Flag a product for the retailer.",
            {
                "product_id": {"type": "string"},
                "kind": {"type": "string", "enum": list(shelf.KIND_LABEL)},
                "title": {"type": "string"},
                "reason": {"type": "string"},
                "priority": {"type": "integer", "description": "1 = most important"},
            },
            ["product_id", "kind", "title", "reason", "priority"],
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
                "prompt_id": "shelf_agent",
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
    def __init__(self, cats: list[dict[str, Any]], cohort_: str, range_: str, has_stock: bool):
        self.cats = {c["category"]: c for c in cats}
        self.cohort_, self.range_, self.has_stock = cohort_, range_, has_stock
        self.by_id = {p["product_id"]: (p, c) for c in cats for p in c["products"]}
        self.seen: list[Any] = []
        self.flags: list[tuple[int, int, dict[str, Any]]] = []
        self.summary: str | None = None

    # -- read tools ---------------------------------------------------------------------------

    def list_categories(self) -> dict:
        return {
            "has_stock_file": self.has_stock,
            "categories": [
                {
                    k: c[k]
                    for k in (
                        "category",
                        "label",
                        "users",
                        "changed",
                        "basis",
                        "stocked",
                        "agreement",
                    )
                }
                | {"products": len(c["products"])}
                for c in self.cats.values()
            ],
        }

    def get_category(self, category: str) -> dict:
        c = self.cats.get(category)
        if c is None:
            return {"error": f"Unknown category; one of {list(self.cats)}."}
        keep = (
            "product_id",
            "brand",
            "product",
            "users",
            "n",
            "changed",
            "tier",
            "lift",
            "lift_lo",
            "cont8",
            "use_share",
            "stock_share",
            "results_share",
            "shelf_share",
            "basis",
            "gap",
        )
        return {
            "category": category,
            "label": c["label"],
            "basis": c["basis"],
            "agreement": c["agreement"],
            "products": [{k: p[k] for k in keep} for p in c["products"]],
        }

    def get_switching(self, product_id: str) -> dict:
        if product_id not in self.by_id:
            return {"error": "Not a product in the shelf data."}
        try:
            v = retail_intel.product(product_id, self.cohort_, self.range_) or {}
        except Exception:
            return {"error": "Switching is unavailable right now."}
        s = v.get("switching") or {}
        return {
            "product_id": product_id,
            "stopped": s.get("stopped"),
            "went_to": (s.get("to") or [])[:3],
            "came_from": (s.get("from") or [])[:3],
        }

    def get_trends(self) -> dict:
        try:
            f, _, _ = retail_intel.facts(self.cohort_, self.range_)
            return {"rising": retail_intel.rising_goals(f)}
        except Exception:
            return {"rising": {}}

    # -- checks and acts ----------------------------------------------------------------------

    def _text_problem(self, text: str, names: list[str]) -> str | None:
        t = (text or "").strip()
        if len(t) < 6:
            return "Too short."
        if len(t) > 360:
            return "Keep it under 360 characters."
        allowed = numbers.collect(self.seen) | numbers.percents(self.seen)
        plain = t
        for n in names:
            plain = plain.replace(n, "")
        if not numbers.only_known(plain, allowed):
            return "It quotes a number no tool returned. Use only the tools' numbers."
        if OVERCLAIM.search(t) or BANNED.search(t):
            return "It uses an overclaim or a banned word. Rewrite it in cosmetic words."
        return None

    def flag(self, product_id: str, kind: str, title: str, reason: str, priority: int) -> dict:
        hit = self.by_id.get(product_id)
        if hit is None:
            return {"ok": False, "error": "Not a product in the shelf data."}
        p, c = hit
        if kind not in shelf.KIND_LABEL:
            return {"ok": False, "error": f"kind must be one of {list(shelf.KIND_LABEL)}."}
        if kind in ("stocked_unused", "used_understocked") and p.get("stock_share") is None:
            return {"ok": False, "error": "No uploaded stock for this product: use share of use."}
        if not shelf.kind_ok(p, kind, MARGIN):
            return {"ok": False, "error": "The numbers don't point that way for this product."}
        if len(self.flags) >= MAX_FLAGS:
            return {"ok": False, "error": f"At most {MAX_FLAGS} flags."}
        if any(f["product_id"] == product_id and f["kind"] == kind for _, _, f in self.flags):
            return {"ok": False, "error": "Already flagged."}
        names = [p["product"], p["brand"], c["label"]]
        for label, text in (("title", title), ("reason", reason)):
            problem = self._text_problem(text, names)
            if problem:
                return {"ok": False, "error": f"The {label}: {problem}"}
        if len(title.split()) > 10:
            return {"ok": False, "error": "Keep the title to 8 words."}
        f = shelf.flag(p, c, kind, title.strip(), reason.strip())
        self.flags.append((int(priority), len(self.flags), f))
        return {"ok": True}

    def finish(self, summary: str) -> dict:
        problem = self._text_problem(summary, [])
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
        if name.startswith(("get_", "list_")):
            self.seen.append(out)
        return out

    def run(self) -> None:
        contents = [types.Content(role="user", parts=[types.Part(text="Run the check now.")])]
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
                if not self.flags:
                    raise gemini.GeminiError(str(exc)) from exc
                log.warning("shelf agent stopped after round %d: %s", i, str(exc)[:200])
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
        if not self.flags:
            raise gemini.GeminiError("the agent flagged nothing")


def run(
    cats: list[dict[str, Any]], cohort_: str, range_: str, has_stock: bool
) -> tuple[list[dict[str, Any]], str | None]:
    """Gemini's flags, ordered by its priority, and its summary. Raises gemini.GeminiError when
    Gemini can't be reached or flags nothing (the caller keeps the fixed flags)."""
    ep = Episode(cats, cohort_, range_, has_stock)
    ep.run()
    return [f for _, _, f in sorted(ep.flags, key=lambda x: (x[0], x[1]))], ep.summary
