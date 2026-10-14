"""Advisor chat (GEMINI_SPEC.md section 5).

Each turn gets the person's latest measurements and routine up front (small, and it saves a
round trip), then Gemini may call three tools that are the only source of product facts:
search_catalog, compare_products and check_routine. Function calling and response_schema cannot
share a request, so the tool loop runs first and one final call produces the structured reply.
The reply is validated: every number must come from the tool results or the person's own words,
every product id from a tool result. Up to 5 tool calls per turn.
"""

import json
import logging
import time
from typing import Any

from google.genai import types
from pydantic import BaseModel, Field

from app import catalog, gemini, numbers, routine_check
from app.explain import BANNED
from app.results import measured_result
from app.settings import get_settings
from app.store import Store, iso

log = logging.getLogger("willow.advisor")

MAX_TOOL_CALLS = 5
DAILY_LIMIT = 20

INSTRUCTIONS = """You are Willow's skincare advisor. You help one person understand their own
measurements, check their routine and find products from Willow's facts-only catalog.
- The person's measurements and routine are in CONTEXT. Quote numbers only as they appear there or
  in tool results; never estimate, compute or invent numbers, scores, skin tone or age.
- Only recommend products returned by search_catalog or compare_products, by product_id. The
  catalog has facts (ingredients, price, stores), not efficacy; never claim a product works.
  measured_outcomes in tool results are cohort outcome rates; write a rate as a whole percent
  (0.61 -> 61%), quote it only with its n and, when
  synthetic_cohort is true, say they come from a synthetic demo cohort.
- verdict real_change = changed beyond photo noise; within_noise = no clear change yet;
  no_baseline = first reading or no noise band yet; a metric marked indicative is a trend.
- Never imply lighter skin is better. Cosmetic language only; no diagnosis, no disease names.
  For a changing mole, bleeding, pain or a rash, suggest seeing a dermatologist.
- Be brief: 2 to 5 sentences."""

TOOLS = types.Tool(
    function_declarations=[
        types.FunctionDeclaration(
            name="search_catalog",
            description="Search the facts-only product catalog. Returns up to 6 products.",
            parameters_json_schema={
                "type": "object",
                "properties": {
                    "concern": {"type": "string", "enum": list(catalog.CONCERNS)},
                    "query": {"type": "string", "description": "brand, product or ingredient"},
                    "category": {"type": "string", "enum": list(catalog.CATEGORIES)},
                    "max_price": {"type": "number"},
                    "currency": {"type": "string", "enum": ["INR", "USD"]},
                    "exclude_ingredients": {"type": "array", "items": {"type": "string"}},
                },
            },
        ),
        types.FunctionDeclaration(
            name="compare_products",
            description="Side-by-side facts for 2 to 4 catalog products.",
            parameters_json_schema={
                "type": "object",
                "properties": {"product_ids": {"type": "array", "items": {"type": "string"}}},
                "required": ["product_ids"],
            },
        ),
        types.FunctionDeclaration(
            name="check_routine",
            description="Rule-based compatibility check of the person's current routine.",
            parameters_json_schema={"type": "object", "properties": {}},
        ),
    ]
)


class Reply(BaseModel):
    # The web sends replies back as history, which the api caps at 1000 characters per turn.
    message: str = Field(max_length=1000)
    product_ids: list[str] = Field(default_factory=list, max_length=4)
    follow_up_suggestions: list[str] = Field(default_factory=list, max_length=3)


def _compact(p: dict[str, Any]) -> dict[str, Any]:
    return {
        "product_id": p["product_id"],
        "brand": p["brand"],
        "name": p["name"],
        "category": p["category"],
        "concerns": p["concerns"],
        "key_actives": p["key_actives"],
        "price": p["price"],
        "size": p["size"],
        "stores": [s["store"] for s in p["stores"]],
    }


def context(store: Store, uid: str) -> dict[str, Any]:
    """Latest measured session per site and capture mode, plus the routine."""
    latest: dict[str, dict[str, Any]] = {}
    for sid, doc in sorted(store.sessions_list(uid), key=lambda r: str(r[1].get("created_at"))):
        result = measured_result(doc)
        if doc.get("status") != "done" or result is None:
            continue
        latest[f"{doc['site']} ({doc['capture_mode']})"] = {
            "session_id": sid,
            "date": iso(doc.get("created_at")),
            "is_baseline": bool(doc.get("is_baseline")),
            "photos": doc.get("n_frames"),
            "quality_passed": result["quality"]["passed"],
            "metrics": [
                {
                    k: m.get(k)
                    for k in (
                        "id",
                        "label",
                        "value",
                        "unit",
                        "delta",
                        "mdc95",
                        "verdict",
                        "confidence",
                    )
                }
                for m in result["metrics"]
            ],
        }
    routine = [
        {
            "id": eid,
            "product": f"{e.get('brand', '')} {e.get('custom_name', '')}".strip(),
            "product_id": e.get("product_id"),
            "slots": e.get("slots"),
            "started_at": e.get("started_at"),
            "ended_at": e.get("ended_at"),
            "key_actives": [a["name"] for a in e.get("key_actives") or []],
        }
        for eid, e in store.routine_list(uid)
    ]
    return {
        "latest_sessions": latest,
        "routine": routine,
        "note": "Face and forearm sites are measured; cheek and nose close-ups are not measured yet.",
    }


def _outcomes(ids: list[str]) -> dict[str, Any]:
    """Cohort outcomes for these products (retailer aggregates; groups under 10 never appear)."""
    try:
        from app import retailer

        data = retailer.insights()
    except Exception:
        return {"note": "outcome data unavailable right now"}
    found = {i: data["product_outcomes"][i] for i in ids if i in data.get("product_outcomes", {})}
    return {
        "synthetic_cohort": data["cohort"]["real"] == 0,
        "definition": "rate = share of people with this goal still improved beyond their own "
        "photo noise at week 8; n = people; weeks = median weeks to first real change",
        "by_product": found,
    }


def run_tool(name: str, args: dict[str, Any], store: Store, uid: str) -> dict[str, Any]:
    if name == "search_catalog":
        found = catalog.search(
            q=args.get("query"),
            concern=args.get("concern"),
            category=args.get("category"),
            max_price=args.get("max_price"),
            currency=args.get("currency"),
            exclude_ingredients=args.get("exclude_ingredients"),
            limit=6,
        )
        return {
            "products": [_compact(p) for p in found],
            "measured_outcomes": _outcomes([p["product_id"] for p in found]),
        }
    if name == "compare_products":
        found = [catalog.by_id(i) for i in (args.get("product_ids") or [])[:4]]
        return {
            "products": [_compact(p) for p in found if p],
            "measured_outcomes": _outcomes([p["product_id"] for p in found if p]),
        }
    if name == "check_routine":
        entries = [{"id": eid, **e} for eid, e in store.routine_list(uid)]
        return routine_check.rule_findings(entries)
    return {"error": f"unknown tool {name}"}


def _retrieval_line(name: str, args: dict[str, Any], out: dict[str, Any]) -> str:
    if name == "search_catalog":
        bits = [str(v) for k, v in args.items() if v and k != "exclude_ingredients"]
        return f"Searched the catalog ({', '.join(bits) or 'all'}): {len(out['products'])} found"
    if name == "compare_products":
        return f"Compared {len(out['products'])} products"
    return "Checked your routine against the rule table"


def chat(messages: list[dict[str, str]], store: Store, uid: str) -> dict[str, Any]:
    ctx = context(store, uid)
    contents: list[types.Content] = [
        types.Content(role="user", parts=[types.Part(text=f"CONTEXT (JSON):\n{json.dumps(ctx)}")]),
        types.Content(role="model", parts=[types.Part(text="Understood.")]),
    ]
    for m in messages:
        contents.append(
            types.Content(
                role="user" if m["role"] == "user" else "model", parts=[types.Part(text=m["text"])]
            )
        )

    config = types.GenerateContentConfig(
        system_instruction=f"{gemini.SYSTEM_RULES}\n\n{INSTRUCTIONS}",
        temperature=0.3,
        max_output_tokens=4096,
        tools=[TOOLS],
        thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    tool_outputs: list[dict[str, Any]] = []
    retrieval: list[str] = []
    product_ids: set[str] = set()
    started = time.monotonic()
    for _ in range(MAX_TOOL_CALLS):
        res = gemini.client().models.generate_content(
            model=get_settings().gemini_model, contents=contents, config=config
        )
        calls = res.function_calls or []
        if not calls:
            break
        contents.append(res.candidates[0].content)
        parts = []
        for call in calls:
            args = dict(call.args or {})
            out = run_tool(call.name, args, store, uid)
            tool_outputs.append({"tool": call.name, "args": args, "result": out})
            retrieval.append(_retrieval_line(call.name, args, out))
            product_ids |= {p["product_id"] for p in out.get("products", [])}
            parts.append(types.Part.from_function_response(name=call.name, response=out))
        contents.append(types.Content(role="user", parts=parts))
    log.info(
        json.dumps(
            {
                "prompt_id": "advisor_tools",
                "tools": len(tool_outputs),
                "latency_ms": round((time.monotonic() - started) * 1000),
            }
        )
    )

    transcript = "\n".join(f"{m['role'].upper()}: {m['text']}" for m in messages)
    final_prompt = (
        f"CONTEXT (JSON):\n{json.dumps(ctx)}\n\nTOOL RESULTS (JSON):\n"
        f"{json.dumps(tool_outputs)}\n\nCONVERSATION:\n{transcript}\n\n"
        "Write the reply to the last USER message. product_ids: only ids from TOOL RESULTS or "
        "the routine in CONTEXT that you actually recommend or discuss. "
        "follow_up_suggestions: up to 3 short questions the person might ask next."
    )
    # Products it may show: anything a tool returned, plus the person's own routine products.
    product_ids |= {r["product_id"] for r in ctx["routine"] if r.get("product_id")}
    # Outcome rates may be written as percents; measurements may not be rescaled.
    rates = [t["result"].get("measured_outcomes") for t in tool_outputs]
    allowed = numbers.collect(ctx) | numbers.collect(tool_outputs) | numbers.percents(rates)
    for m in messages:
        if m["role"] == "user":
            allowed |= numbers.in_text(m["text"])
    for _ in range(2):
        try:
            reply = gemini.generate_json(
                "advisor_reply",
                [final_prompt],
                Reply,
                instructions=INSTRUCTIONS,
                temperature=0.3,
                max_output_tokens=4096,
            )
        except gemini.GeminiError:
            break
        bad_ids = set(reply.product_ids) - product_ids
        if (
            numbers.only_known(reply.message, allowed)
            and not BANNED.search(reply.message)
            and not bad_ids
        ):
            return {
                "message": reply.message,
                "product_ids": reply.product_ids,
                "products": [catalog.by_id(i) for i in reply.product_ids if catalog.by_id(i)],
                "follow_up_suggestions": reply.follow_up_suggestions,
                "retrieval": retrieval or ["Checked your results and routine"],
                # What the validator checked, shown under the answer.
                "checks": {
                    "model": get_settings().gemini_model,
                    "tool_calls": len(tool_outputs),
                    "numbers_checked": len(set(numbers.NUMBER.findall(reply.message))),
                    "products_from_tools": len(reply.product_ids),
                },
            }
        log.warning("advisor reply rejected (ids %s)", sorted(bad_ids))
    return {
        "message": "I could not put together an answer I can stand behind. Try asking in a "
        "different way, or ask about one product or one measurement at a time.",
        "product_ids": [],
        "products": [],
        "follow_up_suggestions": [],
        "retrieval": retrieval,
    }
