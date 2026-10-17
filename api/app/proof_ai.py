"""Gemini where it helps a skincare brand act on Willow Proof (docs/RETAILER_INSIGHTS.md "AI in
Willow Proof"). Two jobs, both grounded in the product view the page already shows:

- **Claim drafts** (`claims`): marketing copy for one channel written only from the product's
  measured evidence statements (and, labelled as such, what users said). Every draft cites the
  statements it rests on; every number in it must be in those statements; claims a regulator
  would challenge ("clinically proven", "cures", condition names) are rejected. If no draft
  passes, the evidence statements themselves are returned: never unchecked copy.
- **Next steps** (`actions`): the possible actions are worked out here from the facts (promote
  where it works best, tell buyers when results show, answer a texture complaint, keep users past
  week 8, ...), each with its numbers and a link to the place in Proof that does it. Gemini only
  picks the three that matter most for this product and says why, quoting that action's numbers.
  Without Gemini, the same actions in a fixed priority with sentences written here.

Self-reported answers (app/feel.py) stay labelled: a perception claim must say people *said* it,
and it is never mixed into a measured claim.
"""

import json
import logging
import re
import threading
import time
from typing import Any, Literal

from pydantic import BaseModel, Field

from app import gemini, numbers, retail_intel
from app.explain import BANNED

log = logging.getLogger("willow.proof_ai")

Channel = Literal["pack", "pdp", "listing", "social"]
CHANNELS: dict[str, tuple[str, int]] = {
    "pack": ("the front or back of pack: one short line", 110),
    "pdp": ("the brand's own product page: one or two sentences", 320),
    "listing": ("a retailer's product listing (e.g. Nykaa, Sephora): one or two sentences", 240),
    "social": ("a social post caption: friendly, one or two sentences", 240),
}
# Claims a regulator or a platform would challenge without clinical substantiation (UK CAP 12 /
# ASA, FTC, EU 655/2013): never in a draft, whatever the evidence says.
OVERCLAIM = re.compile(
    r"\b(clinically|clinical|proven to|scientifically proven|guarantee\w*|cures?|cured|heals?|"
    r"treats?|treatment for|repairs? damage|dermatologist[- ](approved|recommended|tested)|"
    r"medical|miracle|instant\w*|permanent\w*|100 ?%|every(one| user)|all users|acne|"
    r"anti-?ageing|anti-?aging|reverses?)\b",
    re.I,
)
SAID = re.compile(r"\b(said|say|says|agreed|reported|self-reported|told us)\b", re.I)
CLAIMS_TIERS = ("proven", "promising")


def _allowed(texts: list[str]) -> set[str]:
    out: set[str] = set()
    for t in texts:
        out |= numbers.collect(t)
    return out


def sources(view: dict[str, Any]) -> list[dict[str, Any]]:
    """What a claim may rest on: the measured evidence statements, then one self-reported line."""
    out = [
        {"id": e["id"], "kind": e["kind"], "text": e["text"], "n": e["n"], "measured": True}
        for e in view.get("evidence") or []
    ]
    feel = view.get("feel")
    if feel and feel.get("working") is not None:
        out.append(
            {
                "id": "perception",
                "kind": "perception",
                "text": f"Asked how it works for them, {round(feel['working'] * 100)}% of "
                f"{feel['n']} Willow users said it is working (self-reported).",
                "n": feel["n"],
                "measured": False,
            }
        )
    return out


class Draft(BaseModel):
    text: str = Field(max_length=500)
    sources: list[str] = Field(default_factory=list, max_length=4)


class Drafts(BaseModel):
    drafts: list[Draft] = Field(default_factory=list, max_length=4)


CLAIMS_INSTRUCTIONS = """You write marketing claim drafts for a skincare brand from SOURCES: claim
statements measured by Willow (standardised phone photos against each person's own baseline, held
to week 8) and possibly one self-reported line. Write 3 drafts for CHANNEL, each a different angle
(overall result, a goal or skin type, timing, what users said).
- Each draft lists in sources the ids of the statements it rests on (1 to 3).
- Use only numbers that appear in those statements, exactly as written there. Keep each number
  with what it counts: a percent with its group ("78% of 46 Willow users"), never a bare percent.
- Measured wording: "had a visible change", "measured in N Willow users". The self-reported line
  may only be used as what people said ("said it is working for them"), never as a measurement,
  and never in the same sentence as a measured number.
- Never: clinically, clinically proven, proven to, cures, treats, heals, repairs, guaranteed,
  dermatologist-approved, miracle, instant, permanent, 100%, everyone, anti-ageing, any skin
  condition or disease name, or anything about skin tone or lightness.
- Cosmetic, observational, plain British English. Stay within the channel's length."""


def _draft_problem(d: Draft, src: dict[str, dict[str, Any]], limit: int) -> str | None:
    text = d.text.strip()
    cited = [src[s] for s in d.sources if s in src]
    if not text or not cited or len(cited) != len(d.sources):
        return "cites nothing or an unknown statement"
    if len(text) > limit:
        return "too long for the channel"
    if not numbers.only_known(text, _allowed([c["text"] for c in cited])):
        return "a number that is not in its statements"
    if OVERCLAIM.search(text) or BANNED.search(text):
        return "an overclaim or banned word"
    said = [c for c in cited if not c["measured"]]
    if said and not SAID.search(text):
        return "self-reported result written as a measurement"
    if said:
        # each sentence is either what people said or a measurement, never both
        heard = _allowed([c["text"] for c in said])
        seen = _allowed([c["text"] for c in cited if c["measured"]])
        for s in re.split(r"(?<=[.!?])\s+", text):
            if SAID.search(s) and not numbers.only_known(s, heard):
                return "mixes what people said with a measurement in one sentence"
            if not SAID.search(s) and not numbers.only_known(s, seen):
                return "a self-reported number written as a measurement"
    return None


def claims(view: dict[str, Any], channel: str) -> dict[str, Any]:
    """Checked drafts for one channel; the statements themselves when Gemini is unavailable or
    nothing passes. `blocked` (no drafts at all) when the evidence does not support a claim."""
    row = view["product"]
    label, limit = CHANNELS[channel]
    src = sources(view)
    base = {
        "product_id": row["product_id"],
        "channel": channel,
        "sources": src,
        "caveat": view.get("evidence_caveat"),
    }
    if row["tier"] not in CLAIMS_TIERS or not any(s["measured"] for s in src):
        return base | {
            "drafts": [],
            "source": "none",
            "blocked": "Claims need a Proven or Promising product: the evidence does not show a "
            "visible change above non-users yet.",
        }
    by_id = {s["id"]: s for s in src}
    payload = {
        "CHANNEL": label,
        "MAX_CHARACTERS": limit,
        "PRODUCT": f"{row['brand']} {row['product']}",
        "SOURCES": [{k: s[k] for k in ("id", "text", "measured")} for s in src],
    }
    parts = [json.dumps(payload)]
    kept: list[dict[str, Any]] = []
    for _ in range(2):
        try:
            out = gemini.generate_json(
                "proof_claims",
                parts,
                Drafts,
                instructions=CLAIMS_INSTRUCTIONS,
                temperature=0.4,
                max_output_tokens=1500,
            )
        except gemini.GeminiError:
            break
        rejected = []
        for d in out.drafts:
            why = _draft_problem(d, by_id, limit)
            if why:
                rejected.append((d.text[:80], why))
            elif d.text.strip() not in {k["text"] for k in kept}:
                kept.append({"text": d.text.strip(), "sources": list(d.sources)})
        if kept:
            break
        log.warning("proof_claims: drafts rejected %s", rejected[:3])
        parts = [*parts[:1], f"Rejected last time: {json.dumps(rejected[:4])}. Fix exactly that."]
    if kept:
        return base | {"drafts": kept[:3], "source": "gemini", "blocked": None}
    # the statements themselves: already claim-ready, checked wording
    fallback = [
        {"text": s["text"], "sources": [s["id"]]}
        for s in src
        if s["measured"] and len(s["text"]) <= max(limit, 320)
    ][:3]
    return base | {"drafts": fallback, "source": "statements", "blocked": None}


# ── next steps ─────────────────────────────────────────────────────────────────────────────

FIX_FOR_TAG = {
    "heavy": "position it for dry skin or night use, or offer a lighter texture",
    "stings": "say how to start on pack and in the listing (a patch test, then every other day)",
    "drying": "recommend pairing it with a moisturiser",
    "breakouts": "check who reports it by skin type before targeting more widely",
}


def candidates(view: dict[str, Any]) -> list[dict[str, Any]]:
    """Every action the facts support, with its numbers and where in Proof it is done. The
    priority is the order without Gemini."""
    row = view["product"]
    pid = row["product_id"]
    out: list[dict[str, Any]] = []

    def add(id_, priority, title, why, facts, link):
        out.append(
            {
                "id": id_,
                "priority": priority,
                "title": title,
                "why": why,
                "facts": facts,
                "link": link,
            }
        )

    el = view.get("eligibility") or {}
    skin = [c for c in (view.get("segments") or {}).get("skin", []) if not c["suppressed"]]
    lifted = [c for c in skin if c["base_rate"] is not None and c["rate"] > c["base_rate"]]
    if el.get("eligible") and lifted:
        best = max(lifted, key=lambda c: (c["rate"] - c["base_rate"], c["n"]))
        add(
            "promote_segment",
            1,
            f"Promote to {best['label'].lower()} skin",
            f"{round(best['rate'] * 100)}% of {best['n']} users with {best['label'].lower()} "
            f"skin had a visible change, against {round(best['base_rate'] * 100)}% of non-users "
            "with that skin type.",
            {"rate": best["rate"], "n": best["n"], "base_rate": best["base_rate"]},
            {"section": "campaigns", "id": pid, "skin_types": [best["id"]]},
        )
    feel = view.get("feel") or {}
    agree = feel.get("agree")
    if agree and agree["measured_only"] >= 0.25 and agree["measured_only"] > agree["felt_only"]:
        weeks = row.get("weeks")
        add(
            "set_expectations",
            2,
            "Tell buyers when results show",
            f"{round(agree['measured_only'] * 100)}% of {agree['n']} users who answered at week 8 "
            "had a visible change but didn't say it was working: they may stop too early."
            + (f" Changes typically begin around week {weeks:g}." if weeks else ""),
            {"measured_only": agree["measured_only"], "n": agree["n"], "weeks": weeks},
            {"section": "claims", "id": pid, "channel": "pack"},
        )
    bad = [t for t in feel.get("tags") or [] if not t["good"] and t["share"] >= 0.15]
    if bad:
        t = bad[0]
        add(
            "answer_feedback",
            3,
            f"Answer “{t['label']}”",
            f"{round(t['share'] * 100)}% of {feel['n']} users who said how it feels chose "
            f"“{t['label']}”: {FIX_FOR_TAG.get(t['tag'], 'look at who reports it')}.",
            {"share": t["share"], "n": feel["n"]},
            {"section": "feel", "id": pid},
        )
    if row.get("cont8") is not None and row["cont8"] < 0.6 and row.get("n"):
        to = (view.get("switching") or {}).get("to_brands") or []
        where = f" Most who switch go to {to[0]['label']}." if to else ""
        add(
            "keep_users",
            4,
            "Keep users past week 8",
            f"Only {round(row['cont8'] * 100)}% of {row['n']} users were still using it at "
            f"week 8.{where}",
            {"cont8": row["cont8"], "n": row["n"]},
            {"section": "switching", "id": pid},
        )
    if row["tier"] == "promising" and row.get("to_proven"):
        add(
            "reach_proven",
            5,
            "Get it to Proven",
            f"About {row['to_proven']} more measured users at today's rate would make it Proven, "
            "which unlocks promotion.",
            {"to_proven": row["to_proven"]},
            {"section": "pipeline", "id": pid},
        )
    worse = [c for c in skin if c["base_rate"] is not None and c["rate"] < c["base_rate"]]
    if worse:
        w = min(worse, key=lambda c: (c["rate"] - c["base_rate"], -c["n"]))
        add(
            "avoid_segment",
            6,
            f"Don't target {w['label'].lower()} skin",
            f"{round(w['rate'] * 100)}% of {w['n']} users with {w['label'].lower()} skin had a "
            f"visible change, below non-users with that skin type "
            f"({round(w['base_rate'] * 100)}%).",
            {"rate": w["rate"], "n": w["n"], "base_rate": w["base_rate"]},
            {"section": "segments", "id": pid},
        )
    conflicts = view.get("conflicts") or []
    if conflicts and conflicts[0]["share"] >= 0.1:
        c = conflicts[0]
        add(
            "educate_routine",
            7,
            "Explain how to layer it",
            f"{round(c['share'] * 100)}% of its users' routines had “{c['label']}”: "
            f"{c['fix'].lower()}.",
            {"share": c["share"], "n": c["n"]},
            {"section": "conflicts", "id": pid},
        )
    co = view.get("co_used") or []
    if co and co[0]["share"] >= 0.2:
        c = co[0]
        add(
            "bundle",
            8,
            f"Bundle with {c['product']}",
            f"{round(c['share'] * 100)}% of its users also use {c['brand']} {c['product']}.",
            {"share": c["share"], "n": c["n"]},
            {"section": "co_used", "id": pid},
        )
    if row["tier"] in CLAIMS_TIERS and view.get("evidence"):
        add(
            "draft_claims",
            9,
            "Draft claims from the evidence",
            f"{len(view['evidence'])} claim-ready statements, measured in up to {row['n']} users.",
            {"statements": len(view["evidence"]), "n": row["n"]},
            {"section": "claims", "id": pid, "channel": "pdp"},
        )
    return sorted(out, key=lambda a: a["priority"])


class Pick(BaseModel):
    id: str = Field(max_length=40)
    why: str = Field(max_length=300)


class Picks(BaseModel):
    picks: list[Pick] = Field(default_factory=list, max_length=3)


ACTIONS_INSTRUCTIONS = """You advise a skincare brand's team on one product in Willow Proof.
ACTIONS are things the data supports, each with its facts. Pick the 3 that would create the most
value for this product now (revenue, retention or trust), most valuable first, and for each write
why in one or two plain sentences for a busy brand manager.
- Use only ids from ACTIONS. Quote only numbers in that action's why or facts (a share may be
  written as a whole percent). Never compute new numbers.
- Observational, cosmetic wording: never "clinically", "proven to", "cures", condition names, or
  anything about skin tone or lightness. What users "said" is self-reported, not measured."""


_cache: dict[tuple, tuple[float, dict[str, Any], dict[str, Any]]] = {}
_lock = threading.Lock()
CACHE_S = 600
RETRY_S = 60


def _pick_problem(p: Pick, by_id: dict[str, dict[str, Any]]) -> str | None:
    a = by_id.get(p.id)
    if a is None:
        return "unknown action"
    allowed = numbers.collect(a["why"]) | numbers.collect(a["facts"]) | numbers.percents(a["facts"])
    if not numbers.only_known(p.why, allowed):
        return "a number that is not in the action"
    if OVERCLAIM.search(p.why) or BANNED.search(p.why):
        return "an overclaim or banned word"
    return None


def actions(view: dict[str, Any], key: tuple) -> dict[str, Any]:
    """The three next steps for this product: Gemini's pick and words, checked, or the fixed
    priority. Cached per product and filter (a failed Gemini call is retried after a minute)."""
    with _lock:
        hit = _cache.get(key)
        # the same view object: the Proof rows have not been rebuilt since
        if hit and hit[1] is view and time.time() < hit[0]:
            return hit[2]
    cands = candidates(view)
    by_id = {a["id"]: a for a in cands}
    chosen: list[dict[str, Any]] = []
    source = "rules"
    if len(cands) > 1:
        row = view["product"]
        payload = {
            "PRODUCT": f"{row['brand']} {row['product']} ({row['tier_label']})",
            "ACTIONS": [{k: a[k] for k in ("id", "title", "why", "facts")} for a in cands],
        }
        try:
            out = gemini.generate_json(
                "proof_actions",
                [json.dumps(payload, default=str)],
                Picks,
                instructions=ACTIONS_INSTRUCTIONS,
                temperature=0.2,
                max_output_tokens=1200,
            )
            seen = set()
            for p in out.picks:
                if p.id in seen or _pick_problem(p, by_id):
                    continue
                seen.add(p.id)
                chosen.append(by_id[p.id] | {"why": p.why.strip()})
            if chosen:
                source = "gemini"
        except gemini.GeminiError:
            chosen = []
    if not chosen:
        chosen = cands[:3]
    result = {
        "product_id": view["product"]["product_id"],
        "actions": [{k: a[k] for k in ("id", "title", "why", "link")} for a in chosen],
        "source": source,
        "considered": len(cands),
    }
    with _lock:
        _cache[key] = (time.time() + (CACHE_S if source == "gemini" else RETRY_S), view, result)
    return result


def perception_rows(cohort_: str, range_: str) -> list[dict[str, Any]]:
    """Self-reported shares for Ask: product, brand, felt (share saying it is working), n. Ask
    still answers without them when the Proof rows are unavailable."""
    try:
        rows = retail_intel.products(cohort_, range_)["products"]
    except Exception:  # BigQuery unavailable: Ask's own aggregates still stand
        log.warning("proof_ai: perception rows unavailable", exc_info=True)
        return []
    return [
        {"product": r["product"], "brand": r["brand"], "felt": r["felt"], "n": r["felt_n"]}
        for r in rows
        if r.get("felt") is not None
    ]
