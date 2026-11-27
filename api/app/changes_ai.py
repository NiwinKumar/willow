"""Read "Anything else?" into tags (POST /v1/sessions/{id}/changes/read, Nov 28).

The person writes what was different in their own words ("Went to Bali for a week, lots of beach,
ate badly"). Gemini reads it into the fixed tags (app/changes.TAGS), the products it names, and
whether it sounds like a skin reaction. Nothing is saved here: the app shows the tags as chips the
person confirms before they are kept on the session.

Checks: tags only from the list (the schema), a product only when its words are in the text (never
one Gemini made up), and Gemini never writes a sentence the person sees. When Gemini is down, past
the daily cap, or its answer fails a check, a word list does the same job less well.
"""

import json
import logging
import re

from fastapi import HTTPException
from pydantic import BaseModel, Field

from app import catalog, changes, gemini, limits
from app.store import Store

log = logging.getLogger("willow.changes")


class ReadOut(BaseModel):
    tags: list[changes.Tag] = Field(default_factory=list, max_length=12)
    products: list[str] = Field(default_factory=list, max_length=3)
    reaction: bool = False


INSTRUCTIONS = f"""The person wrote what was different in their life since their last skin
check-in. Read it into:
- "tags": every tag from this list that the text clearly says, never a guess:
  {", ".join(changes.TAGS)}.
  period = had a period; stress_work / stress_study = work or study stress, exams, deadlines;
  sleep_poor = little or bad sleep; travel (+ travel_hot / travel_cold / travel_humid when the
  place was hotter, colder or more humid); sport_gym, sport_swim, sport_outdoor (outdoor sport also
  means sun); sun = beach, sunburn, long days outside; diet (+ diet_sugar, diet_dairy, diet_spicy,
  diet_alcohol, diet_less_water); routine_skipped = skipped skincare; routine_new = tried a new
  skincare product; makeup_new; clinic = a facial, peel, laser or other clinic visit; picked =
  picked or squeezed spots; unwell = ill, fever, a cold; new_medicine = started a medicine.
- "products": skincare or makeup products the text names (brand and product as written, at most
  3), copied from the text; none when it names none.
- "reaction": true only when the text describes the skin reacting to something (burning,
  stinging, a rash, itching, swelling, hives, peeling after a product).
Return only what the text says. No other text."""

# The word list (no Gemini): a tag when one of its words is in the text.
WORDS: dict[str, str] = {
    "period": r"\bperiods?\b|\bmenstrua\w*|\bpms\b|\bon my cycle\b",
    "stress_work": r"\bwork\w* (?:stress|pressure|deadline)|\bstress\w* (?:at|from|with) work|\bbusy (?:at )?work|\bdeadlines?\b",  # noqa: E501
    "stress_study": r"\bexams?\b|\bstud(?:y|ying)\b|\bassignments?\b|\bfinals\b|\bthesis\b",
    "sleep_poor": r"\b(?:no|little|bad|poor|less|not much|barely) sleep|\bslept (?:badly|little|poorly)|\blate nights?\b|\binsomnia\b|\ball[- ]nighters?\b",  # noqa: E501
    "travel": r"\btravel\w*|\btrip\b|\bflights?\b|\bflew\b|\bholiday\b|\bvacation\b",
    "travel_humid": r"\bhumid\w*|\bbali\b|\bthailand\b|\bsingapore\b|\bkerala\b|\bmumbai\b",
    "travel_cold": r"\bcold(?:er)? (?:place|weather|country)|\bwinter\b|\bsnow\b",
    "travel_hot": r"\bhot(?:ter)? (?:place|weather)|\bheat ?wave\b",
    "sport_gym": r"\bgym\b|\bwork(?:ed)? ?outs?\b|\bexercis\w*|\brunning\b|\bran\b|\byoga\b|\bsport\w*",  # noqa: E501
    "sport_swim": r"\bswim\w*|\bswam\b|\bpool\b",
    "sport_outdoor": r"\b(?:football|cricket|tennis|hiking|hike|cycling|marathon|badminton)\b",
    "sun": r"\bbeach\b|\bsun ?burn\w*|\blots of sun\b|\bsunny\b|\bin the sun\b|\btanned\b",
    "diet": r"\bate (?:badly|differently|out|junk)|\bdiet\b|\bjunk food\b|\bfast food\b",
    "diet_sugar": r"\bsugar\w*|\bsweets\b|\bdesserts?\b|\bchocolate\b|\bcake\b",
    "diet_dairy": r"\bdairy\b|\bmilk\b|\bcheese\b|\bice ?cream\b",
    "diet_spicy": r"\bspicy\b|\bchill(?:i|ies)\b",
    "diet_alcohol": r"\balcohol\b|\bdrinking\b|\bdrinks\b|\bwine\b|\bbeers?\b|\bparty\b",
    "diet_less_water": r"\b(?:less|not enough|little) water\b|\bdehydrat\w*",
    "routine_skipped": r"\bskipped\b|\bforgot (?:my|to)\b|\bdidn'?t (?:do|use) my\b",
    "routine_new": r"\b(?:tried|started|using|bought) (?:a |an |the |some )?new\b",
    "makeup_new": r"\bnew (?:makeup|foundation|concealer|primer)\b",
    "clinic": r"\bfacial\b|\bpeel\b|\blaser\b|\bclinic\b|\bmicroneedl\w*|\bextraction\w*",
    "picked": r"\bpick(?:ed|ing)\b|\bsqueez\w*|\bpopp(?:ed|ing)\b",
    "unwell": r"\b(?:was |got |been |felt |feeling )?(?:sick|ill|unwell)\b|\bfever\b|\bflu\b|\b(?:a|the) cold\b",  # noqa: E501
    "new_medicine": r"\bmedicines?\b|\bmedication\b|\bantibiotics?\b|\bpills?\b|\btablets?\b",
}
REACTION = re.compile(
    r"\b(burn(?:s|ed|ing)?|sting\w*|rash\w*|itch\w*|swell\w*|swollen|hives|peeling|reaction|"
    r"broke out from|allerg\w*)\b",
    re.I,
)


def by_words(text: str) -> list[str]:
    low = text.lower()
    tags = [t for t, rx in WORDS.items() if re.search(rx, low)]
    if any(t.startswith("travel_") for t in tags) and "travel" not in tags:
        tags.insert(0, "travel")
    return [t for t in changes.TAGS if t in tags]


def _fold(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def _in_text(phrase: str, text: str) -> bool:
    p = _fold(phrase)
    return len(p) >= 3 and p in _fold(text)


GENERIC = {
    "a", "an", "the", "my", "new", "some", "face", "facial", "skin", "skincare", "product",
    "products", "serum", "cream", "moisturiser", "moisturizer", "cleanser", "wash", "face wash",
    "sunscreen", "spf", "toner", "mask", "oil", "gel", "lotion", "makeup", "foundation", "acid",
}  # fmt: skip


def _named(phrase: str) -> bool:
    """A product the person actually named ("Mixi Mandelic Serum"), not a kind ("the new serum")."""
    words = [w for w in _fold(phrase).split() if w not in GENERIC]
    return len(words) >= 1 and len(_fold(phrase).split()) >= 2


def _product(phrase: str) -> dict | None:
    """The catalog's best match for a product the person named, when its brand is in the phrase
    (a loose search could name a different product)."""
    try:
        hits = catalog.search(phrase, limit=1)
    except Exception:
        return None
    if not hits:
        return None
    p = hits[0]
    if _fold(p.get("brand") or "") and _fold(p["brand"]) in _fold(phrase):
        return {"product_id": p["product_id"], "brand": p["brand"], "name": p["name"]}
    return None


def _ask_gemini(text: str) -> ReadOut | None:
    try:
        out = gemini.generate_json(
            "changes_read",
            [json.dumps({"TEXT": text})],
            ReadOut,
            instructions=INSTRUCTIONS,
            temperature=0.0,
            max_output_tokens=400,
        )
    except gemini.GeminiError:
        return None
    out.products = [p.strip() for p in out.products if _in_text(p, text) and _named(p)]
    return out


def read(store: Store, uid: str, text: str) -> dict:
    text = text.strip()[: changes.OTHER_MAX]
    source = "words"
    out = None
    if text:
        try:
            limits.take(store, uid, "changes_read")
            out = _ask_gemini(text)
            if out is None:
                limits.refund(store, uid, "changes_read")
        except HTTPException:
            out = None  # past the cap: the word list
    if out is not None:
        source = "gemini"
        tags = list(dict.fromkeys(out.tags))
        if any(t.startswith("travel_") for t in tags) and "travel" not in tags:
            tags.insert(0, "travel")
        products = out.products
        reaction = out.reaction or bool(REACTION.search(text))
    else:
        tags, products, reaction = by_words(text), [], bool(REACTION.search(text))
    tags = [t for t in changes.TAGS if t in tags]
    return {
        "tags": tags,
        "words": [changes.TAGS[t][1] for t in tags],
        "products": [{"text": p, "match": _product(p)} for p in products],
        "reaction": reaction,
        "source": source,
    }
