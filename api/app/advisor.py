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
import re
import secrets
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from google.genai import types
from pydantic import BaseModel, Field, model_validator

from app import advisor_blocks as blocks_mod
from app import (
    catalog,
    changes,
    explain,
    feel,
    gemini,
    numbers,
    plan,
    regions,
    regulatory,
    routine_check,
    routine_log,
    safety,
    translate,
)
from app.results import measured_result
from app.settings import get_settings
from app.store import Store, iso

# Progress for the streaming route: (event, data). Only real steps are reported, never a timer.
Stage = Callable[[str, dict[str, Any]], None]

log = logging.getLogger("willow.advisor")

MAX_TOOL_CALLS = 5
# Cloud Run ends a request at 300 s: no new tool round after TOOLS_BUDGET_S, no new reply
# attempt after TURN_BUDGET_S (a call in flight takes at most ~50 s), else the fixed fallback
TOOLS_BUDGET_S = 90.0
TURN_BUDGET_S = 150.0
DAILY_LIMIT = 20

INSTRUCTIONS = """You are Wisp, Willow's skincare assistant. You help one person understand their
own measurements, check their routine and find products from Willow's facts-only catalog.
- The person's measurements and routine are in CONTEXT. Quote numbers only as they appear there or
  in tool results; never estimate, compute or invent numbers, scores, skin tone or age.
- Only recommend products returned by search_catalog or compare_products, by product_id. The
  catalog has facts (ingredients, price, stores), not efficacy; never claim a product works.
  measured_outcomes in tool results are cohort outcome rates; write a rate as a whole percent
  (0.61 -> 61%), quote it only with its n and, when synthetic_cohort is true, always with the
  words "in Willow's simulated cohort" in the same sentence (never as if real shoppers saw it).
- price in a tool result is the one price to quote for that product, in the person's currency;
  price null means no price is checked in their currency: say so, never quote another currency
  and never convert. One currency per answer.
- verdict real_change = changed by more than the person's photos usually vary; within_noise =
  about the same as at their start; no_baseline = first reading, or the baseline needs more
  photos; a metric marked indicative is a trend.
- When the question is about a change, answer in everyday words the way a person would: "7 fewer
  blemishes than at your start, more than your photos usually vary", "a more even tone", using
  the metric's when_lower / when_higher words for the direction of its delta. Never write delta,
  noise band, mdc, threshold, variance, a* or ΔL*: delta is "moved by N" or "N fewer / more",
  mdc95 is "your photos usually vary by about N".
- Never imply lighter skin is better. Cosmetic language only; no diagnosis, no disease names.
  For a changing mole, bleeding, pain or a rash, suggest seeing a dermatologist.
- Asked what a condition is, or whether they have one: never repeat the condition's name and
  never write "diagnose"; say Willow follows how skin looks over time, not what a condition is,
  suggest a dermatologist, and offer what Willow does measure. Asked for a skin score or skin
  age: say Willow gives neither, only change against their own baseline.
- noted_since_last_check_in on a session = what the person said was different before it (stress,
  sleep, their period, travel, sun, diet, routine changes). Mention it as context when a reading
  moved, never as the cause. life_patterns are found by code across their check-ins ("higher on
  weeks you noted…"): repeat them only as written, never invent one.
- Routine products with in_use false were stopped: do not treat them as part of the routine.
- recent_use on a routine product = days_used, the days the person ticked it as used, out of
  of_days, the days it was in the routine recently (recent_window_days in CONTEXT); null = not
  tracked. Before judging whether a product changed anything, say how often it was used, quoting
  only days_used and of_days; a product used on few days has not had a fair test.
- feel on a routine product = the person's own verdict and how it feels to them, in week N of
  using it (null = not answered). It is their view, not a measurement: never present it as a
  result. Heavy: a lighter texture; working but readings unchanged: readings often trail what
  people feel, keep checking in. If it differs from the readings, say both plainly.
- A product that stings, burns, itches, reddens or dries the skin: never suggest using it
  differently or less often. Say to stop using it and rinse with water, and to see a doctor or
  pharmacist if it doesn't settle in a few days; swelling, blisters, hives, a reaction near the
  eyes or lips, or trouble breathing: get medical help now. They can log it with the product's
  reaction button, which keeps it out of their suggestions.
- CONTEXT.profile.safety is what the person told Willow (null = not set). life_stage pregnant,
  trying or breastfeeding: never suggest a retinoid or hydroquinone. reactive: prefer products
  with no fragrance, one new product at a time. avoid: ingredient groups they avoid.
  avoid_products: never suggest these. rx_treatment: they use a prescription skin treatment;
  never comment on it, and say to ask whoever prescribed it before adding a retinoid or an
  exfoliating acid. Products in tool results carry check {status, flags}: never recommend one
  whose status is avoid or not_sold; when you suggest one with status check, name its flag.
  Never call a product safe; say "no flags for your profile".
- CONTEXT.profile.safety.avoid_ingredients are ingredients the person says they reacted to
  before: never suggest a product that lists one (tool results already flag them). CONTEXT.
  profile.past_reactions_note is their own note about past reactions or breakouts: respect it
  when suggesting, but never diagnose from it, never name a condition it might suggest, and
  never repeat it back in full.
- search_catalog returns products sold where the person shops first (sold_here true); prefer
  those, and say so when you suggest one that is not sold there.
- search_catalog's not_checked (and any product with ingredient_list "not in Willow yet") are
  products Willow knows only by name, check status unknown: when the person names one, you may
  talk about it, but say plainly its ingredient list isn't in Willow yet, so it hasn't been
  checked for them; they can scan the label. Never suggest one and never call it fine for them.
- Never recommend, name or comment on the dose of a prescription medicine (tretinoin,
  hydroquinone, steroid creams, antibiotics, anything taken by mouth): say to ask a doctor or
  pharmacist. Never write acne, treat, cure or heal; say blemishes or breakouts.
- Quote measurements only when the question is about results; never pad an answer with them.
- British spelling (colour, moisturiser), but say "catalog"."""

# How the reply is written (the final, structured call).
FORMAT_RULES = """
Write the reply as blocks, answer first:
- blocks[0] is type "answer": one direct sentence that answers the question. No preamble, no
  restating the question, no filler ("Great question", "I hope this helps").
- Then only if needed: one "bullets" block (2 to 4 short items, a few words each), a "widget",
  a "products" block, and at most one short "note" (a caveat or the next step).
- At most about 80 words of text in all, unless the person asks for detail. Never one long
  paragraph.
- Mark the key fact in each block with **bold**; use ==highlight== at most once, for the single
  most important thing. Name a catalog or routine product as [product:PRODUCT_ID] (the app shows
  its name and opens it); name a measurement as [metric:METRIC_ID] with ids from: tone_ita,
  pigment_spots, tone_evenness, redness, blemishes, pores, texture, lines, dark_circles, shine,
  glow.
- Prefer a widget to describing data in words; the app draws it from the person's own data, so
  never put numbers in it. Kinds: metric_trend {metric_id, site?} for how one measurement moved;
  session_summary {session_id from CONTEXT or "latest", site?} for what one check-in showed;
  routine {slot? am|pm} for their routine; product {product_id} for one product; product_test {}
  for the treated vs control forearm test. At most 2.
- products block: up to 4 product_ids you recommend or discuss (from tool results or the
  routine)."""

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


# Added to the instructions only when the person attached photos to the question.
PHOTO_RULES = """
- The person attached photos to their last message. Willow reads product and label photos only:
  identify the product (brand and name as printed), read the label (ingredients, claims), then
  use search_catalog to find it in the catalog and answer from the catalog's facts.
- Never describe, judge or estimate anything about skin, a face or a person in a photo. If a photo
  shows a face or skin rather than a product, set photos_show to face_or_skin.
- Do not quote numbers read from a photo (SPF, percentages, sizes) unless the same number is in a
  tool result; say what the label says in words instead."""


class Reply(BaseModel):
    """Gemini's structured reply (advisor_blocks): the api derives the plain `message`."""

    blocks: list[blocks_mod.Block] = Field(default_factory=list, max_length=8)
    product_ids: list[str] = Field(default_factory=list, max_length=4)
    follow_up_suggestions: list[str] = Field(default_factory=list, max_length=3)
    # What attached photos show ("none" without photos); face_or_skin is never answered.
    photos_show: Literal["none", "product_or_label", "face_or_skin", "other"] = "none"

    @model_validator(mode="before")
    @classmethod
    def _plain_message(cls, data: Any) -> Any:
        """A reply written as one plain `message` (the shape before blocks) is one answer block."""
        if isinstance(data, dict) and data.get("message") and not data.get("blocks"):
            data = {**data, "blocks": [{"type": "answer", "text": data["message"]}]}
        return data


NO_ANSWER = (
    "I could not put together an answer I can stand behind. Try asking in a different way, or "
    "ask about one product or one measurement at a time."
)
# The fallback when the question itself asks for a diagnosis or a condition (an honest refusal
# written that way would name the condition, which the validator always rejects).
SCOPE_REPLY = (
    "Willow follows how your skin looks over time; it can't tell you what a condition is. For a "
    "medical question, or a spot or mole that changes, please see a dermatologist. I can explain "
    "what your check-ins measured or check your routine."
)
# Asked about a prescription medicine: answered by this fixed reply, never by the model.
MEDICINE_REPLY = (
    "Willow doesn't give advice on medicines, including ones a doctor gave you; please ask your "
    "doctor or a pharmacist. If you use a skin medicine, turn that on in your profile so Willow "
    "flags products to check with them first. I can check the cosmetic products in your routine."
)
MEDICINE_ASK = re.compile(
    r"\b(prescri\w*|tretinoin|retin-?a|isotretinoin|accutane|roaccutane|adapalene|differin|"
    r"tazarotene|trifarotene|hydroquinone|clindamycin|doxycycline|minocycline|erythromycin|"
    r"spironolactone|clobetasol|betamethasone|hydrocortisone|mometasone|steroids?|"
    r"antibiotics?|metronidazole|ivermectin|minoxidil|birth control pills?)\b",
    re.I,
)
# Asked to state a medical or guarantee claim ("say it is clinically proven", "promise it will
# fix my skin", "95% guaranteed"): refused by this fixed reply before any model call, so it
# answers at once and says what Wisp will not claim and what it can show instead (Nov 28: the
# model's own refusal failed the wording check twice, 15 s, then a generic line).
CLAIM_REPLY = (
    "I won't say a product is proven by doctors, that it fixes a skin problem for good, or that "
    "a result is guaranteed, and I won't put a percentage on a promise. Willow makes no medical "
    "or guarantee claims. What I can do is show what your check-ins measured against your own "
    "baseline, and the facts on a product's label."
)
CLAIM_FOLLOW_UPS = ["What did my last check-in measure?", "Is my routine OK together?"]
_CLAIM_WORDS = (
    r"(?:clinically|medically|scientifically|dermatologist|doctor)[- ]?"
    r"(?:proven|tested|approved|recommended|backed)|\bproven to\b|\bcur(?:e|es|ed|ing)\b|"
    r"\bheal(?:s|ed|ing)?\b|(?<!back )(?<!back-)\bguarantee\w*|\bmiracle\b|"
    r"\bpermanent(?:ly)?\b|\b100\s?%|"
    r"\bfor good\b|\bforever\b"
)
# an instruction to say it ("say", "tell me", "write", "confirm", "promise"), or a demand for a
# guarantee or a "clinically proven" in any wording
CLAIM_ASK = re.compile(
    r"\b(?:say|state|claim|write|confirm|promise|admit|repeat|tell (?:me|us|them))\b"
    rf"[^.?!]{{0,160}}(?:{_CLAIM_WORDS})"
    # a guaranteed result ("95% guaranteed", "guarantee it works"), not a money-back guarantee
    r"|\b\d+(?:\.\d+)?\s?%\s*guarantee\w*|(?<!back )\bguarantee[sd]?\s+(?:to|that|it|this|"
    r"results?|you|me|us|my)\b|\bguaranteed\s+(?:to|results?|cure|fix)\b"
    r"|(?:clinically|medically|scientifically)[- ]proven",
    re.I,
)
PHOTO_REFUSAL = (
    "Willow reads product and label photos only, so I have not looked at this photo. To follow "
    "your skin, take a check-in: those photos are measured by Willow, not by Wisp."
)


# What Wisp is told about an index product (its ingredient list is not in Willow yet).
NOT_IN_WILLOW = "not in Willow yet: never suggest it; say its ingredient list isn't in Willow yet"


def currency_of(profile: dict[str, Any] | None) -> str | None:
    """The currency of where the person shops (None: no market set)."""
    return regions.MARKET_CURRENCY.get((profile or {}).get("market") or "")


def shown_price(p: dict[str, Any], currency: str | None) -> dict[str, Any] | None:
    """The one price of a product that an answer quotes and its card shows: the lowest checked
    price in the person's currency (the reference price or a store's; never converted), None
    when none is checked in it. No currency known: the catalog's reference price."""
    if not currency:
        return p.get("price")
    amount = plan.price_in(p, currency)
    return None if amount is None else {"amount": amount, "currency": currency}


def _common_currency(products: list[dict[str, Any]]) -> str | None:
    """The currency most of these products are priced in (their reference prices)."""
    seen = [p["price"]["currency"] for p in products if p.get("price")]
    return max(set(seen), key=seen.count) if seen else None


def _compact(
    p: dict[str, Any], profile: dict[str, Any] | None = None, currency: str | None = None
) -> dict[str, Any]:
    check = safety.check(p, profile)
    extra = {} if catalog.is_full(p) else {"ingredient_list": NOT_IN_WILLOW}
    price = shown_price(p, currency)
    if currency and price is None:
        extra["price_note"] = f"no price checked in {currency}"
    return {
        "product_id": p["product_id"],
        "brand": p["brand"],
        "name": p["name"],
        "category": p["category"],
        # words, not ids ("blemishes", never the id's condition word)
        "concerns": [_words(c) for c in p["concerns"]],
        "check": {"status": check["status"], "flags": [f["title"] for f in check["flags"]]},
        "key_actives": p["key_actives"],
        "price": price,
        "size": p["size"],
        "stores": [s["store"] for s in p["stores"]],
        **extra,
    }


def context(store: Store, uid: str) -> dict[str, Any]:
    """Latest measured session (quality passed) per site and capture mode, plus the routine."""
    latest: dict[str, dict[str, Any]] = {}
    sessions = store.sessions_list(uid)
    for sid, doc in sorted(sessions, key=lambda r: str(r[1].get("created_at"))):
        result = measured_result(doc)
        # A session that failed the quality check has no numbers: keep the last good reading.
        if doc.get("status") != "done" or result is None or not result["quality"]["passed"]:
            continue
        latest[f"{doc['site']} ({doc['capture_mode']})"] = {
            "session_id": sid,
            "date": iso(doc.get("created_at")),
            "is_baseline": bool(doc.get("is_baseline")),
            "photos": doc.get("n_frames"),
            "photos_used": result["frames_used"],
            "quality_passed": result["quality"]["passed"],
            # what the person said was different since their previous check-in (tags in words)
            "noted_since_last_check_in": (changes.view(doc) or {}).get("words") or None,
            # Rounded as the app shows them (explain.decimals), so the advisor never quotes
            # 2.5 blemishes for a screen that says 3.
            "metrics": [
                {
                    **{k: m.get(k) for k in ("id", "label", "verdict", "confidence")},
                    # The unit as the app writes it (° or a*), never the key ("deg", "a_star").
                    "unit": explain.plain_unit(m),
                    **explain.shown_numbers(m),
                    **(
                        dict(
                            zip(
                                ("when_lower", "when_higher"),
                                explain.DIRECTION_WORDS[m["id"]],
                                strict=True,
                            )
                        )
                        if m["id"] in explain.DIRECTION_WORDS
                        else {}
                    ),
                }
                for m in result["metrics"]
            ],
        }
    entries = store.routine_list(uid)
    # how often each product was actually ticked as used (Home's "used today"): the advisor must
    # not call a product ineffective when it was barely used
    now = routine_log.today()
    first = now - timedelta(days=routine_log.RECENT_DAYS)
    logs = store.routine_logs(uid, first.isoformat(), now.isoformat()) if entries else []
    since = (store.user_get(uid) or {}).get("routine_log_since") if entries else None
    routine = [
        {
            "id": eid,
            "product": f"{e.get('brand', '')} {e.get('custom_name', '')}".strip(),
            "product_id": e.get("product_id"),
            "slots": e.get("slots"),
            "started_at": e.get("started_at"),
            "ended_at": e.get("ended_at"),
            "in_use": not e.get("ended_at"),
            "key_actives": [a["name"] for a in e.get("key_actives") or []],
            # {days_used, of_days} over the last 2 weeks, or null if nothing was ticked
            "recent_use": routine_log.recent_use(e, eid, logs, now, since),
            # the person's own latest verdict and look-and-feel words (null = not asked yet)
            "feel": feel.words(e.get("feel")),
        }
        for eid, e in entries
    ]
    doc = store.user_get(uid) or {}
    saved = doc.get("profile") or {}
    return {
        "profile": {
            "skin_type": saved.get("skin_type"),
            "goals": list(saved.get("goals") or []),
            "safety": {k: v for k, v in (safety.profile_of(doc) or {}).items() if k != "note"}
            or None,
            # their own words about past reactions, trimmed (never a flag by itself)
            "past_reactions_note": _trimmed(((safety.profile_of(doc) or {}).get("note")) or ""),
        },
        "latest_sessions": latest,
        # what else lines up with their readings, found by code (app/changes.py)
        "life_patterns": [p["text"] for p in changes.patterns_in(sessions)["patterns"]],
        "routine": routine,
        "recent_window_days": routine_log.RECENT_DAYS,
        "note": "Every site is measured: the face, the cheek, forehead, chin and nose close-ups "
        "(pores and texture come only from close-ups) and the forearm squares. Lines, shine, "
        "glow and blemishes are always indicative (trends).",
    }


NOTE_IN_CONTEXT = 300


def _trimmed(note: str) -> str | None:
    note = " ".join(note.split())
    if len(note) <= NOTE_IN_CONTEXT:
        return note or None
    return note[:NOTE_IN_CONTEXT].rsplit(" ", 1)[0] + "…"


def _outcomes(ids: list[str]) -> dict[str, Any]:
    """Cohort outcomes for these products (retailer aggregates; groups under 10 never appear)."""
    try:
        from app import retailer

        data = retailer.insights()
    except Exception:
        return {"note": "outcome data unavailable right now"}
    found = {i: data["product_outcomes"][i] for i in ids if i in data.get("product_outcomes", {})}
    # Simulated whenever simulated people make up the cohort or most of it (Nov 28: 35,000
    # simulated and 8 real read as "not synthetic", so the figures went out unlabelled).
    cohort = data["cohort"]
    synthetic = cohort.get("real", 0) == 0 or cohort.get("synthetic", 0) >= cohort["real"]
    return {
        "synthetic_cohort": synthetic,
        **(
            {"say_it_as": f"{SIMULATED_COHORT} (simulated people, not real shoppers)"}
            if synthetic
            else {}
        ),
        "definition": "rate = share of people with this goal still improved beyond their own "
        "photo noise at week 8; n = people; weeks = median weeks to first real change",
        "by_product": found,
    }


SIMULATED_COHORT = "in Willow's simulated cohort"
# Appended when an answer quotes a cohort figure without saying it is simulated.
COHORT_NOTE = (
    "Cohort figures are from Willow's simulated cohort: simulated people, not real shoppers."
)
_COHORT_WORDS = re.compile(
    r"\bcohort\b|\boutcome rate\b|\bn\s*=\s*\d|\b\d+(?:\.\d+)?\s?% of (?:people|users|shoppers)\b"
    r"|\bpeople (?:with|who)\b[^.]{0,60}\d+(?:\.\d+)?\s?%",
    re.I,
)
_SAYS_SIMULATED = re.compile(r"\b(?:simulated|synthetic)\b", re.I)


def cohort_unlabelled(written: list[str], rates: set[str]) -> bool:
    """An answer text quotes a cohort figure (a rate from measured_outcomes as a percent, or a
    number beside cohort words) without saying in that text that the cohort is simulated. Cohort
    words with no figure ("there are no cohort rates for this") quote nothing."""
    for text in written:
        percents = {m.replace(",", ".") for m in re.findall(r"(\d+(?:[.,]\d+)?)\s?%", text)}
        figure = bool(_COHORT_WORDS.search(text) and re.search(r"\d", text)) or percents & rates
        if figure and not _SAYS_SIMULATED.search(text):
            return True
    return False


# Currency marks an answer may carry: the person's own, or one they wrote themselves.
_CURRENCY_MARKS = (
    ("INR", r"₹|\bRs\.?(?=\s?\d)|\bINR\b"),
    ("SGD", r"(?<![A-Za-z])S\$|\bSGD\b"),
    ("AUD", r"(?<![A-Za-z])A\$|\bAUD\b"),
    ("NZD", r"NZ\$|\bNZD\b"),
    ("HKD", r"HK\$|\bHKD\b"),
    ("TWD", r"NT\$|\bTWD\b"),
    ("USD", r"US\$|(?<![A-Za-z])\$|\bUSD\b"),
    ("GBP", r"£|\bGBP\b"),
    ("EUR", r"€|\bEUR\b"),
    ("JPY", r"(?<!CN)¥|\bJPY\b"),
    ("CNY", r"CN¥|\bCNY\b|\bRMB\b"),
    ("KRW", r"₩|\bKRW\b"),
    ("MYR", r"\bRM(?=\s?\d)|\bMYR\b"),
    ("THB", r"฿|\bTHB\b"),
    ("IDR", r"\bRp\.?(?=\s?\d)|\bIDR\b"),
    ("PHP", r"₱|\bPHP\b"),
    ("VND", r"₫|\bVND\b"),
    ("AED", r"\bAED\b"),
)


def currencies_in(text: str) -> set[str]:
    """The currencies a text names by sign or code (S$ is not also $)."""
    found: set[str] = set()
    for code, pattern in _CURRENCY_MARKS:
        if re.search(pattern, text):
            found.add(code)
            text = re.sub(pattern, " ", text)
    return found


def mixed_currency(written: list[str], currency: str | None, asked: set[str]) -> bool:
    """The answer names a currency other than the person's (or one they wrote themselves); with
    no currency known, more than one."""
    used = set().union(*(currencies_in(t) for t in written)) if written else set()
    if currency:
        return bool(used - {currency} - asked)
    return len(used - asked) > 1


def pairings(
    shown_ids: list[str], entries: list[dict[str, Any]], profile: dict[str, Any] | None
) -> dict[str, dict[str, Any]]:
    """{product_id: {issue, suggestion, with}} for products of the answer that the routine check
    (the rule table, never the model) finds in conflict with each other in the person's routine:
    their cards then say "Check this" with this reason instead of "No flags"."""
    active = {e["id"]: e for e in entries if not e.get("ended_at") and e.get("product_id")}
    if sum(1 for e in active.values() if e["product_id"] in shown_ids) < 2:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for c in routine_check.findings_for(entries, profile).get("conflicts", []):
        both = [active[i] for i in c.get("products", []) if i in active]
        hit = [e for e in both if e["product_id"] in shown_ids]
        if len({e["product_id"] for e in hit}) < 2:
            continue
        for e in hit:
            others = [
                f"{o.get('brand', '')} {o.get('custom_name', '')}".strip()
                for o in both
                if o["product_id"] != e["product_id"]
            ]
            out.setdefault(
                e["product_id"],
                {"issue": c["issue"], "suggestion": c.get("suggestion") or "", "with": others},
            )
    return out


def suggestible(p: dict[str, Any], profile: dict[str, Any] | None) -> bool:
    """Wisp may suggest it: a full catalog product (its ingredient list is in Willow), a cosmetic
    (or sunscreen) where the person is, not a never-suggest ingredient, not "avoid" or "not sold"
    for their profile (app/regulatory.py, app/safety.py)."""
    market = (profile or {}).get("market")
    return (
        catalog.is_full(p)
        and regulatory.is_suggestible(p, market)
        and safety.check(p, profile)["status"] not in ("avoid", "not_sold")
    )


# Index products a name search also returns (to talk about, never to suggest).
MAX_NOT_CHECKED = 3


def run_tool(
    name: str, args: dict[str, Any], store: Store, uid: str, currency: str | None = None
) -> dict[str, Any]:
    """`currency`: the one currency this turn's prices are in (the person's market, or what an
    earlier tool call of the turn settled on); a product tool's answer says which it used."""
    profile = safety.profile_of(store.user_get(uid))
    currency = currency or currency_of(profile)
    if name == "search_catalog":
        # search is where suggestions come from: only products Willow may suggest to this person
        market = (profile or {}).get("market")
        every = catalog.search_all(
            q=args.get("query"),
            concern=args.get("concern"),
            category=args.get("category"),
            max_price=args.get("max_price"),
            currency=args.get("currency"),
            exclude_ingredients=args.get("exclude_ingredients"),
            market=market,
        )
        found = [p for p in every if suggestible(p, profile)]
        # nearest to where the person shops first (app/regions.py); the search's order within
        found = regions.nearest_first(found, market)[:6]
        # no market set: the currency the person asked in, else the one most results are priced in
        currency = currency or args.get("currency") or _common_currency(found)
        out: dict[str, Any] = {
            "products": [
                {**_compact(p, profile, currency), "sold_here": plan.sold_in(p, market)}
                for p in found
            ],
            "price_currency": currency,
            "measured_outcomes": _outcomes([p["product_id"] for p in found]),
        }
        # A product the person named may be one Willow knows only by name: Wisp may find it and
        # talk about it, saying its ingredient list isn't in Willow yet, but never suggest it.
        if args.get("query"):
            named = [p for p in every if not catalog.is_full(p)][:MAX_NOT_CHECKED]
            if named:
                out["not_checked"] = [_compact(p, profile, currency) for p in named]
        return out
    if name == "compare_products":
        # what the person asked about, flags and all (never a suggestion by itself)
        found = [p for i in (args.get("product_ids") or [])[:4] if (p := catalog.by_id(i))]
        currency = currency or _common_currency(found)
        return {
            "products": [_compact(p, profile, currency) for p in found],
            "price_currency": currency,
            "measured_outcomes": _outcomes([p["product_id"] for p in found]),
        }
    if name == "check_routine":
        entries = [{"id": eid, **e} for eid, e in store.routine_list(uid)]
        return routine_check.findings_for(entries, profile)
    return {"error": f"unknown tool {name}"}


CURRENCY_SIGN = {"INR": "₹", "USD": "$"}


def _words(key: str) -> str:
    """dark_spots_pigmentation -> dark spots, pigmentation; eye_care -> eye care."""
    return {"dark_spots_pigmentation": "dark spots", "acne_blemishes": "blemishes"}.get(
        key, key.replace("_", " ")
    )


def _retrieval_line(name: str, args: dict[str, Any], out: dict[str, Any]) -> str:
    if name == "search_catalog":
        bits = []
        if args.get("query"):
            bits.append(f"“{args['query']}”")
        for k in ("concern", "category"):
            if args.get(k):
                bits.append(_words(str(args[k])))
        if args.get("max_price"):
            sign = CURRENCY_SIGN.get(str(args.get("currency")), "")
            amount = f"{float(args['max_price']):,.0f}"
            bits.append(
                f"under {sign}{amount}"
                if sign
                else f"under {amount} {args.get('currency') or ''}".strip()
            )
        if args.get("exclude_ingredients"):
            bits.append("without " + ", ".join(map(str, args["exclude_ingredients"])))
        n = len(out["products"])
        found = f"{n} product{'s' if n != 1 else ''} found"
        return f"Searched the catalog ({', '.join(bits) or 'everything'}): {found}"
    if name == "compare_products":
        return f"Compared {len(out['products'])} products"
    return "Checked your routine against the rule table"


def _generate(contents: list[types.Content], config: types.GenerateContentConfig):
    """One tool-calling turn; a rate-limited, overloaded or deadline-hit Gemini gets one more try
    on the fallback model (gemini.with_retry)."""
    return gemini.with_retry(
        "advisor_tools",
        lambda model: gemini.client().models.generate_content(
            model=model, contents=contents, config=gemini.config_for(model, config)
        ),
    )


def _no_stage(event: str, data: dict[str, Any]) -> None:
    return None


def chat(
    messages: list[dict[str, str]],
    store: Store,
    uid: str,
    images: list[tuple[bytes, str]] | None = None,
    on_stage: Stage | None = None,
) -> dict[str, Any]:
    """One advisor turn. `images`: (bytes, mime type) product or label photos attached to the
    last message (up to 3). `on_stage` hears each real step as it starts (streaming route)."""
    stage = on_stage or _no_stage
    images = images or []
    asked = next((m["text"] for m in reversed(messages) if m["role"] == "user"), "")
    if MEDICINE_ASK.search(asked):
        # a question about a prescription medicine gets the fixed reply, never the model's
        return _fixed(MEDICINE_REPLY, ["Not sent to the model: a question about a medicine"])
    if CLAIM_ASK.search(asked):
        # asked to state a medical or guarantee claim: refused at once, in code
        return _fixed(
            CLAIM_REPLY,
            ["Not sent to the model: a request to claim a medical result or a guarantee"],
            CLAIM_FOLLOW_UPS,
        )
    stage("reading_context", {})
    ctx = context(store, uid)
    instructions = INSTRUCTIONS + (PHOTO_RULES if images else "")
    photo_parts = [types.Part.from_bytes(data=data, mime_type=mime) for data, mime in images]
    contents: list[types.Content] = [
        types.Content(role="user", parts=[types.Part(text=f"CONTEXT (JSON):\n{json.dumps(ctx)}")]),
        types.Content(role="model", parts=[types.Part(text="Understood.")]),
    ]
    for i, m in enumerate(messages):
        parts = [types.Part(text=m["text"])]
        if photo_parts and i == len(messages) - 1:
            parts = [*photo_parts, *parts]
        contents.append(types.Content(role="user" if m["role"] == "user" else "model", parts=parts))

    config = types.GenerateContentConfig(
        system_instruction=f"{gemini.SYSTEM_RULES}\n\n{instructions}",
        temperature=0.3,
        max_output_tokens=4096,
        tools=[TOOLS],
        thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    tool_outputs: list[dict[str, Any]] = []
    retrieval: list[str] = []
    if images:
        n = len(images)
        retrieval.append(f"Read {n} product photo{'s' if n != 1 else ''} you attached")
    product_ids: set[str] = set()
    # one currency for the whole turn: the person's market, else what the first product tool used
    profile = (ctx.get("profile") or {}).get("safety") or None
    currency = currency_of(profile)
    started = time.monotonic()
    stage("asking_gemini", {"step": "tools", "photos": len(images)})
    for _ in range(MAX_TOOL_CALLS):
        if time.monotonic() - started > TOOLS_BUDGET_S:
            break  # answer with what the tools found so far: the turn must finish in time
        res = _generate(contents, config)
        calls = res.function_calls or []
        if not calls:
            break
        contents.append(res.candidates[0].content)
        parts = []
        for call in calls:
            args = dict(call.args or {})
            stage("asking_gemini", {"step": "tool", "tool": call.name})
            out = run_tool(call.name, args, store, uid, currency)
            currency = currency or out.get("price_currency")
            tool_outputs.append({"tool": call.name, "args": args, "result": out})
            retrieval.append(_retrieval_line(call.name, args, out))
            product_ids |= {
                p["product_id"] for p in [*out.get("products", []), *out.get("not_checked", [])]
            }
            parts.append(types.Part.from_function_response(name=call.name, response=out))
        contents.append(types.Content(role="user", parts=parts))
        # One round of tools (Gemini asks for several at once when it needs them): another
        # round would mostly write a prose answer that is thrown away for the checked JSON one.
        break
    log.info(
        json.dumps(
            {
                "prompt_id": "advisor_tools",
                "tools": len(tool_outputs),
                "photos": len(images),
                "latency_ms": round((time.monotonic() - started) * 1000),
            }
        )
    )

    transcript = "\n".join(f"{m['role'].upper()}: {m['text']}" for m in messages)
    final_prompt = (
        f"CONTEXT (JSON):\n{json.dumps(ctx)}\n\nTOOL RESULTS (JSON):\n"
        f"{json.dumps(tool_outputs)}\n\nCONVERSATION:\n{transcript}\n\n"
        "Write the reply to the last USER message as blocks, answer first. Product ids (in "
        "[product:ID], products blocks, product widgets and product_ids): only ids from TOOL "
        "RESULTS or the routine in CONTEXT that you actually recommend or discuss. "
        "follow_up_suggestions: 3 short follow-up questions (under 8 words each) that build on "
        "this reply: about a product, reading, finding or step you just named, or the next "
        "thing to check. Written as the person would ask them. Never generic questions."
        + (
            f"\nThe last USER message came with {len(images)} attached photo(s), above. "
            "photos_show: what they show."
            if images
            else ""
        )
    )
    # Products it may show: anything a tool returned, plus the person's own routine products.
    product_ids |= {r["product_id"] for r in ctx["routine"] if r.get("product_id")}
    # Outcome rates may be written as percents; measurements may not be rescaled.
    rates = [t["result"].get("measured_outcomes") for t in tool_outputs]
    allowed = numbers.collect(ctx) | numbers.collect(tool_outputs) | numbers.percents(rates)
    simulated = any((r or {}).get("synthetic_cohort") for r in rates)
    rate_percents = numbers.percents([(r or {}).get("by_product") for r in rates])
    # the changes and bands a comparison ("within the 0.25 your photos usually vary") must match
    compared = numbers.compared(ctx) + numbers.compared(tool_outputs)
    asked_currencies: set[str] = set()
    for m in messages:
        if m["role"] == "user":
            allowed |= numbers.in_text(m["text"])
            asked_currencies |= currencies_in(m["text"])
    # sessions a session_summary widget may name: the ones in CONTEXT
    session_ids = {s["session_id"] for s in ctx["latest_sessions"].values()}
    stage("asking_gemini", {"step": "reply", "retrieval": retrieval})
    for _ in range(2):
        if time.monotonic() - started > TURN_BUDGET_S:
            break  # the fixed fallback, well inside Cloud Run's 300 s
        try:
            reply = gemini.generate_json(
                "advisor_reply",
                [*photo_parts, final_prompt],
                Reply,
                instructions=instructions + FORMAT_RULES,
                temperature=0.3,
                max_output_tokens=4096,
                attempts=1,  # the loop is the retry
            )
        except gemini.GeminiError:
            break
        stage("checking_numbers", {})
        if images and reply.photos_show == "face_or_skin":
            # Never answered, whatever the model wrote: chat photos are for products only.
            return {
                "message": PHOTO_REFUSAL,
                "blocks": [{"type": "answer", "text": PHOTO_REFUSAL}],
                "product_ids": [],
                "products": [],
                "follow_up_suggestions": [],
                "retrieval": ["Photo not read: it shows skin or a face, not a product"],
                "photos_refused": True,
            }
        used_ids = set(reply.product_ids) | blocks_mod.product_refs(reply.blocks)
        bad_ids = {i for i in used_ids if i not in product_ids or not catalog.by_id(i)}
        bad_metrics = blocks_mod.bad_metric_refs(reply.blocks)
        written = [blocks_mod.strip(t) for t in blocks_mod.texts(reply.blocks)]
        unnamed = [_without_names(t, product_ids) for t in written]
        # the chips are tappable questions: same rules as the text, failing ones dropped
        follow_ups = [
            q
            for q in reply.follow_up_suggestions
            if numbers.only_known(q, allowed)
            and not explain.BANNED.search(q)
            and not numbers.false_comparison(q, compared)
        ]
        false_claims = [c for t in written if (c := numbers.false_comparison(t, compared))]
        has_answer = any(b.type == "answer" and (b.text or "").strip() for b in reply.blocks)
        if (
            has_answer
            and all(numbers.only_known(t, allowed) for t in written)
            and not any(explain.BANNED.search(t) for t in unnamed)
            and not bad_ids
            and not bad_metrics
            and not mixed_currency(unnamed, currency, asked_currencies)
            and not false_claims
        ):
            out_blocks = blocks_mod.normalize(reply.blocks, session_ids, product_ids)
            if simulated and cohort_unlabelled(written, rate_percents):
                # a cohort figure never reaches a shopper without saying the cohort is simulated
                out_blocks.append({"type": "note", "text": COHORT_NOTE})
            # every product the answer names, in the order it first names them
            shown_ids = list(
                dict.fromkeys([*blocks_mod.ordered_product_refs(reply.blocks), *reply.product_ids])
            )[:6]
            products = [p for i in shown_ids if (p := catalog.by_id(i))]
            names = {p["product_id"]: f"{p['brand']} {p['name']}" for p in products}
            # no market and no product tool: still one currency on the cards
            currency = currency or _common_currency(products)
            entries = [{"id": eid, **e} for eid, e in store.routine_list(uid)]
            paired = pairings(shown_ids, entries, profile)
            return {
                "message": blocks_mod.message_of(out_blocks, names, blocks_mod.METRIC_LABELS),
                "blocks": out_blocks,
                "product_ids": shown_ids,
                # each with the price the answer was given for it (the card shows the same one)
                "products": _priced(products, currency),
                "price_currency": currency,
                **({"pairings": paired} if paired else {}),
                "follow_up_suggestions": follow_ups,
                "retrieval": retrieval or ["Checked your results and routine"],
                # What the validator checked, shown in the answer's info popover.
                "checks": {
                    "model": get_settings().gemini_model,
                    "tool_calls": len(tool_outputs),
                    "numbers_checked": len({n for t in written for n in numbers.NUMBER.findall(t)}),
                    "products_from_tools": len(shown_ids),
                    "photos_read": len(images),
                },
            }
        log.warning(
            "advisor reply rejected (ids %s, metrics %s, answer %s, comparisons %s)",
            sorted(bad_ids),
            sorted(bad_metrics),
            has_answer,
            false_claims,
        )
    fixed = SCOPE_REPLY if explain.BANNED.search(asked) else NO_ANSWER
    return _fixed(fixed, retrieval)


def _fixed(text: str, retrieval: list[str], follow_ups: list[str] | None = None) -> dict[str, Any]:
    return {
        "message": text,
        "blocks": [{"type": "answer", "text": text}],
        "product_ids": [],
        "products": [],
        "follow_up_suggestions": list(follow_ups or []),
        "retrieval": retrieval,
    }


def _priced(products: list[dict[str, Any]], currency: str | None) -> list[dict[str, Any]]:
    """Catalog products as an answer carries them: with `shown_price`, the same figure the
    answer's tool results had (shown_price), for the card to show."""
    return [{**p, "shown_price": shown_price(p, currency)} for p in products]


def _without_names(text: str, ids: set[str]) -> str:
    """The text with these products' own names taken out: a brand's product name ("... Acne
    Foaming Cream Cleanser") is a catalog fact, not Wisp's wording, so the banned-word check
    reads around it."""
    for pid in ids:
        p = catalog.by_id(pid)
        if not p:
            continue
        for name in (f"{p['brand']} {p['name']}", p["name"]):
            text = re.sub(re.escape(name), " ", text, flags=re.I)
    return text


# --- History (users/{uid}/advisor_messages, newest HISTORY_KEEP kept) -------------------------

HISTORY_KEEP = 200
# Stored with a willow turn so it can be drawn again (products are looked up again on read).
REPLY_FIELDS = (
    "message",
    "blocks",
    "product_ids",
    "follow_up_suggestions",
    "retrieval",
    "checks",
    # drawn again as it was answered: its language, its one currency, its pairing reasons
    "lang",
    "price_currency",
    "pairings",
)


def _turn_id(at: datetime, role: str) -> str:
    # sortable by time, then user before willow within the same millisecond
    order = "0" if role == "user" else "1"
    return f"{int(at.timestamp() * 1000):013d}{order}{secrets.token_hex(4)}"


def remember(
    store: Store,
    uid: str,
    question: str,
    photos: int,
    reply: dict[str, Any],
    asked_at: datetime,
    answered_at: datetime | None = None,
) -> None:
    """Store one question and its answer. Photos are never stored, only how many there were."""
    answered_at = max(answered_at or datetime.now(UTC), asked_at + timedelta(milliseconds=1))
    user = {
        "id": _turn_id(asked_at, "user"),
        "role": "user",
        "text": question,
        "photos": photos,
        "created_at": asked_at,
    }
    willow = {
        "id": _turn_id(answered_at, "willow"),
        "role": "willow",
        "text": reply["message"],
        "created_at": answered_at,
        "reply": {k: reply.get(k) for k in REPLY_FIELDS if k in reply}
        | ({"photos_refused": True} if reply.get("photos_refused") else {}),
    }
    store.advisor_add(uid, [user, willow], HISTORY_KEEP)


def history(store: Store, uid: str) -> list[dict[str, Any]]:
    """Oldest first, as the chat draws it; a willow turn carries its reply with live products."""
    out = []
    for doc in store.advisor_list(uid):
        row: dict[str, Any] = {
            "id": doc["id"],
            "role": doc["role"],
            "text": doc.get("text", ""),
            "created_at": iso(doc.get("created_at")),
        }
        if doc["role"] == "user":
            row["photos"] = int(doc.get("photos") or 0)
        else:
            reply = dict(doc.get("reply") or {})
            ids = list(reply.get("product_ids") or [])
            reply.update(
                message=reply.get("message") or row["text"],
                # turns stored before blocks: the message is the answer
                blocks=list(reply.get("blocks") or [])
                or [{"type": "answer", "text": reply.get("message") or row["text"]}],
                product_ids=ids,
                products=_priced(
                    [p for i in ids if (p := catalog.by_id(i))], reply.get("price_currency")
                )
                if "price_currency" in reply
                else [p for i in ids if (p := catalog.by_id(i))],
                follow_up_suggestions=list(reply.get("follow_up_suggestions") or []),
                retrieval=list(reply.get("retrieval") or []),
            )
            own = translate.labels(reply.get("lang"))
            if own:
                reply["labels"] = own
            row["reply"] = reply
        out.append(row)
    return out


# --- "AI unavailable": the standard (template) explanation of the latest session --------------


def standard_explanation(store: Store, uid: str) -> dict[str, Any] | None:
    """The pre-written explanation of the latest measured session (the face first), the same
    template analysis falls back to. No Gemini, no new analysis: it is what Willow already
    measured, worded by code."""
    rows = []
    for sid, doc in store.sessions_list(uid):
        result = measured_result(doc)
        if doc.get("status") == "done" and result and result["quality"]["passed"]:
            rows.append((doc["site"] == "face_full", str(doc.get("created_at")), sid, doc, result))
    if not rows:
        return None
    _, _, sid, doc, result = max(rows, key=lambda r: (r[0], r[1]))
    stored = doc.get("explanation")
    if doc.get("explanation_source") == "template" and stored:
        explanation = stored
    else:
        from app import baselines

        # quote the band each verdict was judged against (the baseline's), as analysis does
        base = baselines.get(store, uid, doc["site"], doc.get("capture_mode", ""))
        own = not base or base.get("session_id") == sid
        bands = None if own else {k: m.get("mdc95") for k, m in (base.get("metrics") or {}).items()}
        explanation = explain.template(explain.with_bands(result, bands), own)
    return {
        "session_id": sid,
        "site": doc["site"],
        "capture_mode": doc.get("capture_mode"),
        "created_at": iso(doc.get("created_at")),
        "explanation": explanation,
    }
