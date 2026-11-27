"""Fill empty catalog `concerns` from the brand's own claims (catalog gap, Nov 28).

For every product in api/seed/products.json with `concerns: []`, open its `source_url` (then its
store pages) once and read the product text the page shows: title, meta description,
og:description, a JSON-LD Product description and the page's description block, about 3,000
characters. Gemini (the fallback flash-lite model, through app/gemini.py) reads that text and
names only the concerns it explicitly claims or clearly targets, from the fixed catalog enum, at
most 4; it returns [] when the text is unclear. That product gets `concerns_source: "brand_page"`.

When no page gives usable text (unreachable, blocked, or a page that does not name the product)
or Gemini fails, conservative keyword rules on the product name (plus the page's short
description when Gemini failed on it) give the concerns instead, with
`concerns_source: "name"`. Only explicit claim words count ("acne", "dark spot", "pore",
"wrinkle"); ingredients and vague words ("clear", "pure", "glow") do not. Nothing is invented: a
product with no text and no claim word in its name keeps `concerns: []` and no source.

    uv run python scripts/fill_catalog_concerns.py --limit 30          # dry run on 30, printed
    uv run python scripts/fill_catalog_concerns.py --write             # all, then write
    uv run python scripts/fill_catalog_concerns.py --write --cache F   # reuse fetched page text
    uv run python scripts/fill_catalog_concerns.py --write --cache F --retry-name  # Gemini again
                                                       # for products that fell back to the name

`--write` updates seed/products.json and rewrites seed/catalog.csv from it. Products whose
concerns were researched by hand (no `concerns_source`) are never touched.
"""

import argparse
import asyncio
import html as htmllib
import json
import logging
import os
import re
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from app.catalog import CATALOG_PATH, CONCERNS, fold  # noqa: E402

CSV_PATH = CATALOG_PATH.parent / "catalog.csv"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0 Safari/537.36"
)
TEXT_CAP = 3000
MIN_TEXT = 120  # shorter than this is a shell page, not the product's text
MAX_CONCERNS = 4
PROMPT_ID = "catalog_concerns"

Concern = Literal[CONCERNS]  # type: ignore[valid-type]


class Claim(BaseModel):
    concern: Concern
    quote: str = Field(max_length=200)  # the words of the text that claim it


class Claims(BaseModel):
    """Gemini's answer: each concern the text claims, with the words that claim it."""

    claims: list[Claim] = Field(default_factory=list, max_length=MAX_CONCERNS)


def grounded(claims: list[Claim], text: str) -> list[str]:
    """The claimed concerns whose quote is really in the text (case, accents and punctuation
    aside), once each, in order: a claim Gemini cannot point to is dropped."""
    hay = fold(text)
    out = [c.concern for c in claims if fold(c.quote) and fold(c.quote) in hay]
    return list(dict.fromkeys(out))[:MAX_CONCERNS]


INSTRUCTIONS = f"""You classify a skincare product by the skin concerns its own product text \
claims. Allowed concerns (use these ids only):
- acne_blemishes: acne, blemishes, breakouts, pimples, spots from acne
- dark_spots_pigmentation: dark spots, hyperpigmentation, sun spots, post-acne marks, melasma
- uneven_tone: uneven or patchy skin tone, tone correction, brightening of uneven tone
- redness_sensitivity: redness, sensitive or irritated skin, calming, soothing
- texture_pores: visible pores, blackheads, rough or bumpy texture, exfoliation, smoothing
- oiliness_shine: oily skin, excess sebum, shine, mattifying, oil control
- fine_lines: fine lines, wrinkles, firmness, elasticity, anti-ageing
- dark_circles: dark circles under the eyes
- dryness_barrier: dryness, dehydration, hydration, moisture barrier
- dullness: dull skin, lack of radiance or glow, brightening of dull skin
Rules: name a concern only when the text (product name included) explicitly claims it or \
clearly targets it as a main purpose. For each, give "quote": the exact words of the text \
(copied, 2 to 12 words) that make the claim. Do not infer from ingredients alone, from the \
category alone, from "suitable for all skin types" or from a passing mention. Prefer fewer: \
usually 1 to 3, never more than {MAX_CONCERNS}, the most explicit first. When the text says \
nothing clear about what the product is for, or is not about this product, return an empty \
list."""

# Name keyword fallback: explicit claim words only (a stricter subset of the cohort overlay's
# rules in scripts/pick_cohort_products.py). Matched on the folded text; every match adds.
STRONG_RULES: list[tuple[str, str]] = [
    (r"\bacne|blemish|breakout|pimple|\bspot (patch|patches|gel|treatment)", "acne_blemishes"),
    (r"oil[ -]?control|\bmatt(e|ify|ifying)\b|sebum|shine control|\boily skin", "oiliness_shine"),
    (r"\bpores?\b|blackhead|resurfac|exfoliat|\btexture", "texture_pores"),
    (r"dark spot|pigment|melasma|spot correct|anti[ -]?dark", "dark_spots_pigmentation"),
    (r"\beven(ing)? (skin )?tone|uneven|tone[ -]?up\b", "uneven_tone"),
    (r"wrinkle|fine line|anti[ -]?(ag(e|ing)|wrinkle)|firming", "fine_lines"),
    (r"\bcalm|sooth|redness|sensitive skin|anti[ -]?redness", "redness_sensitivity"),
    (r"dark circle", "dark_circles"),
    (r"\bbarrier|dry skin|dryness|dehydrat", "dryness_barrier"),
    (r"\bdull|radiance|brighten", "dullness"),
]


def name_rules(text: str) -> list[str]:
    folded = fold(text)
    out = [c for pattern, c in STRONG_RULES if re.search(pattern, folded)]
    return list(dict.fromkeys(out))[:MAX_CONCERNS]


# --- page text --------------------------------------------------------------------------------

LDJSON = re.compile(r"""<script[^>]+application/ld\+json[^>]*>(.*?)</script>""", re.I | re.S)
TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
META = re.compile(r"<meta\b[^>]*>", re.I)
ATTR = re.compile(r"""([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)')""")
DROP = re.compile(r"<(script|style|noscript|svg|template)\b.*?</\1>", re.I | re.S)
TAG = re.compile(r"<[^>]+>")
# The page's own description block: an element whose id or class names a product description.
BLOCK = re.compile(
    r"""<(div|section|article)\b[^>]*(?:id|class)\s*=\s*["'][^"']*(?:product[-_ ]?description"""
    r"""|description[-_ ]?(?:content|body|text|wrapper)|product__description|pdp[-_ ]description"""
    r"""|product-details?|product-info__description|rte\b)[^"']*["'][^>]*>""",
    re.I,
)


def _attrs(tag: str) -> dict[str, str]:
    return {m.group(1).lower(): m.group(3) or m.group(4) or "" for m in ATTR.finditer(tag)}


def _clean(text: str) -> str:
    text = htmllib.unescape(TAG.sub(" ", text))
    return re.sub(r"\s+", " ", text).strip()


def _ld_descriptions(blob: str) -> list[str]:
    try:
        data = json.loads(blob.strip())
    except json.JSONDecodeError:
        return []
    out, stack = [], [data]
    while stack:
        x = stack.pop()
        if isinstance(x, list):
            stack.extend(x)
        elif isinstance(x, dict):
            kind = x.get("@type")
            kinds = kind if isinstance(kind, list) else [kind]
            if any(str(k).lower() == "product" for k in kinds) and isinstance(
                x.get("description"), str
            ):
                out.append(_clean(x["description"]))
            stack.extend(v for v in x.values() if isinstance(v, (list, dict)))
    return out


def page_text(html: str) -> tuple[str, str]:
    """(product text up to TEXT_CAP, the short description alone) from a product page."""
    parts: list[str] = []
    if m := TITLE.search(html):
        parts.append(_clean(m.group(1)))
    short = ""
    for tag in META.findall(html):
        a = _attrs(tag)
        key = (a.get("name") or a.get("property") or "").lower()
        if key in ("description", "og:description", "twitter:description") and a.get("content"):
            text = _clean(a["content"])
            short = short or text
            parts.append(text)
    for blob in LDJSON.findall(html):
        parts += _ld_descriptions(blob)
    body = DROP.sub(" ", html)
    if m := BLOCK.search(body):
        parts.append(_clean(body[m.end() : m.end() + 12_000])[:1500])
    seen: list[str] = []
    for p in parts:
        if p and not any(p in s for s in seen):
            seen.append(p)
    return " | ".join(seen)[:TEXT_CAP], short[:400]


def names_product(text: str, p: dict[str, Any]) -> bool:
    """The text is about this product: it has one of the name's distinctive words."""
    words = [w for w in fold(p["name"]).split() if len(w) >= 4 and not w.isdigit()]
    words = words or fold(p["name"]).split()
    hay = fold(text)
    return any(w in hay for w in words)


async def fetch(client: httpx.AsyncClient, url: str) -> tuple[int, str]:
    try:
        r = await client.get(url)
        return r.status_code, r.text if r.status_code == 200 else ""
    except (httpx.HTTPError, UnicodeDecodeError):
        return 0, ""


async def read_pages(
    todo: list[dict[str, Any]], workers: int, cache: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    """product_id -> {"text", "short", "url", "status"}: the first page that names the product."""
    sem = asyncio.Semaphore(workers)
    limits = httpx.Limits(max_connections=workers, max_keepalive_connections=workers)
    headers = {"User-Agent": UA, "Accept-Language": "en"}
    out: dict[str, dict[str, Any]] = {}
    async with httpx.AsyncClient(
        follow_redirects=True, timeout=15, headers=headers, limits=limits
    ) as client:

        async def one(p: dict[str, Any]) -> None:
            pid = p["product_id"]
            if pid in cache and cache[pid].get("status") != 429:  # rate-limited: ask again
                out[pid] = cache[pid]
                return
            pages = [p.get("source_url")] + [s.get("url") for s in p.get("stores") or []]
            first_status = None
            async with sem:
                for url in dict.fromkeys(u for u in pages if u):
                    status, html = await fetch(client, url)
                    first_status = status if first_status is None else first_status
                    if not html:
                        continue
                    text, short = page_text(html)
                    if len(text) >= MIN_TEXT and names_product(text, p):
                        out[pid] = {"text": text, "short": short, "url": url, "status": status}
                        return
            out[pid] = {"text": "", "short": "", "url": None, "status": first_status}

        await asyncio.gather(*(one(p) for p in todo))
    return out


# --- Gemini -----------------------------------------------------------------------------------


class TokenTally(logging.Handler):
    """Counts calls and tokens from app/gemini.py's per-call log line."""

    def __init__(self) -> None:
        super().__init__(logging.INFO)
        self.n = Counter()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            data = json.loads(record.getMessage())
        except (json.JSONDecodeError, TypeError):
            return
        if data.get("prompt_id") != PROMPT_ID or "latency_ms" not in data:
            return
        self.n["calls"] += 1
        for k in ("input_tokens", "output_tokens", "thinking_tokens"):
            self.n[k] += data.get(k) or 0


def classify(p: dict[str, Any], text: str) -> list[str]:
    from google.genai import types

    from app import gemini

    prompt = (
        f"Product: {p['brand']} {p['name']} (category: {p['category']})\nProduct page text:\n{text}"
    )
    out = gemini.generate_json(
        PROMPT_ID,
        [prompt],
        Claims,
        instructions=INSTRUCTIONS,
        max_output_tokens=512,
        thinking=types.ThinkingLevel.MINIMAL,
        hedge_after_s=None,
    )
    return grounded(out.claims, f"{p['name']} {text}")


FAILED: Counter = Counter()  # Gemini failures by kind (the product falls back to its name)


async def classify_all(
    todo: list[dict[str, Any]], pages: dict[str, dict[str, Any]], workers: int
) -> dict[str, tuple[list[str], str] | None]:
    """product_id -> (concerns, source), or None when nothing could be said."""
    from app.gemini import GeminiError

    sem = asyncio.Semaphore(workers)
    out: dict[str, tuple[list[str], str] | None] = {}

    async def one(p: dict[str, Any]) -> None:
        pid, page = p["product_id"], pages[p["product_id"]]
        if page["text"]:
            try:
                async with sem:
                    concerns = await asyncio.to_thread(classify, p, page["text"])
                out[pid] = (concerns, "brand_page") if concerns else ([], "brand_page")
                return
            except GeminiError as exc:
                FAILED[type(exc.__cause__ or exc).__name__] += 1
        fallback = name_rules(f"{p['name']} {page.get('short') or ''}")
        out[pid] = (fallback, "name") if fallback else None

    await asyncio.gather(*(one(p) for p in todo))
    return out


def apply(products: list[dict[str, Any]], results: dict[str, Any]) -> Counter:
    """Write concerns and concerns_source into the products that were looked at: the concerns
    found, or [] and no source when nothing was claimed."""
    stats: Counter = Counter()
    for p in products:
        if p["product_id"] not in results:
            continue
        res = results[p["product_id"]]
        if not res or not res[0]:
            p["concerns"] = []
            p.pop("concerns_source", None)
            stats["still empty"] += 1
            continue
        p["concerns"], p["concerns_source"] = res
        stats[res[1]] += 1
    return stats


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true", help="update products.json and catalog.csv")
    ap.add_argument("--limit", type=int, help="only the first N empty products (spread by host)")
    ap.add_argument("--workers", type=int, default=16, help="pages fetched at once")
    ap.add_argument("--gemini-workers", type=int, default=8)
    ap.add_argument("--cache", type=Path, help="JSON file of fetched page text (read and kept)")
    ap.add_argument(
        "--retry-name",
        action="store_true",
        help="also look again at products filled from their name (after a Gemini failure)",
    )
    args = ap.parse_args(argv)

    # The flash-lite model for cost and speed: the only model, so no hedge and no second model.
    from app.settings import Settings

    os.environ["GEMINI_MODEL"] = Settings().gemini_fallback_model
    tally = TokenTally()
    logging.getLogger("willow.gemini").addHandler(tally)
    logging.getLogger("willow.gemini").setLevel(logging.INFO)

    products = json.loads(CATALOG_PATH.read_text())
    todo = [
        p
        for p in products
        if not p["concerns"] or (args.retry_name and p.get("concerns_source") == "name")
    ]
    if args.limit:
        # Spread the sample across source hosts (the catalog is grouped by shard).
        todo = todo[:: max(1, len(todo) // args.limit)][: args.limit]
    cache = json.loads(args.cache.read_text()) if args.cache and args.cache.exists() else {}

    t0 = time.monotonic()
    pages = asyncio.run(read_pages(todo, args.workers, cache))
    if args.cache:
        args.cache.write_text(json.dumps({**cache, **pages}, ensure_ascii=False))
    got = sum(1 for v in pages.values() if v["text"])
    print(f"{len(todo)} products to look at; page text for {got} ({time.monotonic() - t0:.0f} s)")

    t1 = time.monotonic()
    results = asyncio.run(classify_all(todo, pages, args.gemini_workers))
    stats = apply(products, results)
    print(f"classified in {time.monotonic() - t1:.0f} s")

    if args.limit:
        for p in todo:
            res = results.get(p["product_id"])
            page = pages[p["product_id"]]
            src = res[1] if res else "-"
            print(f"- {p['brand']} | {p['name']} [{p['category']}]")
            print(f"    {src}: {res[0] if res else []}  (page: {page['url'] or page['status']})")
    print("by source:", dict(stats), "| gemini failed:", dict(FAILED))
    print(
        f"gemini: {tally.n['calls']} calls, {tally.n['input_tokens']} input tokens, "
        f"{tally.n['output_tokens']} output tokens, {tally.n['thinking_tokens']} thinking tokens"
    )
    if not args.write:
        print("dry run: nothing written (add --write)")
        return 0
    from merge_catalog_shards import write_csv

    CATALOG_PATH.write_text(json.dumps(products, indent=2, ensure_ascii=False) + "\n")
    write_csv(products, CSV_PATH)
    print(f"wrote {CATALOG_PATH} and {CSV_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
