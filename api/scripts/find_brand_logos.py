"""Find each catalog brand's logo on the brand's own site (Proof by Willow, finals).

For every brand in seed/products.json: find the brand's own site (a store row named "Brand site",
else a product link whose host carries the brand's name, else a short list of guessed domains whose
page title names the brand), open its home page and read the logo the site itself declares:

1. `<link rel="apple-touch-icon">` (the largest, at least 120 px when sizes are given),
2. else `<link rel="icon">` (the largest PNG or SVG),
3. else `og:logo` or a JSON-LD Organization `logo`,
4. else the conventional `/apple-touch-icon.png`.

A candidate is kept only when it answers with an image (content-type image/*, at least 1 KB). The
logo stays on the brand's site (linked, never copied); `source` is the page it was read from.

    uv run python scripts/find_brand_logos.py                 # every brand, writes the seed
    uv run python scripts/find_brand_logos.py --missing-only  # retry brands not found yet
    uv run python scripts/find_brand_logos.py --dry-run       # report only
"""

import argparse
import asyncio
import contextlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

SEED = Path(__file__).resolve().parent.parent / "seed"
CATALOG = SEED / "products.json"
OUT = SEED / "brand_logos.json"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0 Safari/537.36"
)
TIMEOUT_S = 15
MIN_BYTES = 1024
MIN_TOUCH_PX = 120
# Shops, marketplaces and pharmacies: never a brand's own site.
RETAILERS = re.compile(
    r"amazon|nykaa|ulta|sephora|boots|target|walmart|cvs|walgreens|lookfantastic|cultbeauty|"
    r"yesstyle|stylevana|purplle|myntra|tirabeauty|flipkart|oliveyoung|mecca|jolse|1mg|watsons|"
    r"guardian|dermstore|credobeauty|stylekorean|kokorojapan|tokyofinemarket|lovelyskin|sokoglam|"
    r"beautybay|iherb|pureseoul|shop-apotheke|notino|chemistwarehouse|lifepharmacy|"
    r"skincareessentials|rakuten|shopee|lazada|tiktok|ebay|google|facebook|instagram",
    re.I,
)
# Parked or for-sale domains (a guessed domain the brand does not own).
PARKED = re.compile(
    r"for sale|is parked|parked free|buy this domain|domain name|sedoparking|godaddy|wsimg|"
    r"dan\.com|afternic|hugedomains|bodis",
    re.I,
)
BEAUTY = re.compile(
    r"skin|beauty|cosmetic|serum|cream|derma|face|sunscreen|makeup|make-up|lotion|cleanser|"
    r"moistur|glow|spa\b|care|soin|peau|parfum|kosmetik|コスメ|化粧|스킨|화장품",
    re.I,
)
GUESS_TLDS = ("com", "co", "in", "co.uk", "com.au", "co.kr", "jp", "us")


# Shop-listing prefixes some catalog brand names carry ("MOST POPULAR CHANDO").
PREFIX = re.compile(r"^(?:most popular|trending new|new|black friday)\s+", re.I)


def compact(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower().replace("&", "and")
    return re.sub(r"[^a-z0-9]", "", s)


class Head(HTMLParser):
    """The link, meta and JSON-LD tags of a page (enough of the head to find a logo)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[dict[str, str]] = []
        self.metas: list[dict[str, str]] = []
        self.ld: list[str] = []
        self.title = ""
        self._in: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "link":
            self.links.append(a)
        elif tag == "meta":
            self.metas.append(a)
        elif tag == "title":
            self._in = "title"
        elif tag == "script" and "ld+json" in a.get("type", "").lower():
            self._in = "ld"
            self.ld.append("")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("title", "script"):
            self._in = None

    def handle_data(self, data: str) -> None:
        if self._in == "title":
            self.title += data
        elif self._in == "ld":
            self.ld[-1] += data


def _size(s: str) -> int:
    """Largest edge in a `sizes` attribute ("180x180", "any" -> large)."""
    if "any" in s.lower():
        return 512
    found = [int(x) for x in re.findall(r"(\d+)x\d+", s.lower())]
    return max(found, default=0)


def _org_logos(blobs: list[str]) -> list[str]:
    out: list[str] = []

    def walk(x: Any) -> None:
        if isinstance(x, list):
            for v in x:
                walk(v)
        elif isinstance(x, dict):
            kinds = x.get("@type")
            kinds = kinds if isinstance(kinds, list) else [kinds]
            if any(k in ("Organization", "Brand", "Corporation", "OnlineStore") for k in kinds):
                logo = x.get("logo")
                if isinstance(logo, dict):
                    logo = logo.get("url") or logo.get("contentUrl")
                if isinstance(logo, str) and logo:
                    out.append(logo)
            for v in x.values():
                if isinstance(v, (dict, list)):
                    walk(v)

    for b in blobs:
        try:
            walk(json.loads(b))
        except (json.JSONDecodeError, ValueError):
            continue
    return out


def candidates(head: Head, base: str) -> list[tuple[str, str]]:
    """(url, kind) in the order to try them."""
    touch: list[tuple[int, str]] = []
    icons: list[tuple[int, str]] = []
    for link in head.links:
        rel, href = link.get("rel", "").lower(), link.get("href", "").strip()
        if not href or href.startswith("data:"):
            continue
        url = urljoin(base, href)
        if "apple-touch-icon" in rel:
            size = _size(link.get("sizes", "")) or 180  # Apple's default when none is given
            if size >= MIN_TOUCH_PX:
                touch.append((size, url))
        elif "icon" in rel.split():
            path = urlparse(url).path.lower()
            kind = link.get("type", "").lower()
            if path.endswith(".svg") or "svg" in kind:
                icons.append((1000, url))  # scalable: best of the icons
            elif path.endswith(".png") or "png" in kind:
                icons.append((_size(link.get("sizes", "")), url))
    out = [(u, "touch-icon") for _, u in sorted(touch, reverse=True)]
    out += [(u, "icon") for _, u in sorted(icons, reverse=True)]
    og = [m.get("content", "") for m in head.metas if m.get("property", "").lower() == "og:logo"]
    out += [(urljoin(base, u), "org-logo") for u in og + _org_logos(head.ld) if u]
    out.append((urljoin(base, "/apple-touch-icon.png"), "touch-icon"))
    seen: set[str] = set()
    return [(u, k) for u, k in out if not (u in seen or seen.add(u))]


def brand_sites(products: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Per brand, its likely own hosts, best first (seen on "Brand site" rows, then hosts that
    carry the brand's name)."""
    stated: dict[str, Counter[str]] = defaultdict(Counter)
    named: dict[str, Counter[str]] = defaultdict(Counter)
    for p in products:
        key = compact(PREFIX.sub("", p["brand"]))
        urls = [(s.get("store", ""), s.get("url") or "") for s in p.get("stores") or []]
        urls += [("", p.get(k) or "") for k in ("source_url", "image_source")]
        for store, url in urls:
            host = (urlparse(url).hostname or "").lower()
            if not host or RETAILERS.search(host):
                continue
            if store.lower() in ("brand site", "official site", p["brand"].lower()):
                stated[p["brand"]][host] += 1
            elif key and len(key) >= 3 and key in compact(host):
                named[p["brand"]][host] += 1
    brands = sorted({p["brand"] for p in products})
    return {
        b: list(dict.fromkeys([h for h, _ in stated[b].most_common()] + list(named[b])))
        for b in brands
    }


def guesses(brand: str) -> list[str]:
    key = compact(PREFIX.sub("", brand))
    if len(key) < 3:
        return []
    names = [key, f"{key}skincare", f"{key}beauty"]
    return [f"{n}.{t}" for n in names for t in GUESS_TLDS[: 8 if n == key else 1]]


def names_brand(head: Head, brand: str, base: str) -> bool:
    """A guessed domain counts only when it is still the brand's (not redirected to another site,
    not parked), its page names the brand (title, site or app name) and it is about skin or
    beauty (title or description)."""
    key = compact(PREFIX.sub("", brand))
    if key not in compact(urlparse(base).hostname or "") or PARKED.search(base + head.title):
        return False
    text = head.title + " ".join(
        m.get("content", "")
        for m in head.metas
        if m.get("property", "").lower() == "og:site_name"
        or m.get("name", "").lower() == "application-name"
    )
    if key not in compact(text):
        return False
    # a guessed domain must also be about skin or beauty: "duo.com" or "simply.com" is another
    # company with the same name
    about = head.title + " ".join(
        m.get("content", "")
        for m in head.metas
        if m.get("name", "").lower() == "description"
        or m.get("property", "").lower() in ("og:description", "og:title")
    )
    return bool(BEAUTY.search(about))


SHOPIFY_SIZE = re.compile(r"([?&])(width|height)=\d+")


def shopify_size(url: str) -> str:
    """Shopify themes often declare a 32-48 px crop as the touch icon; its CDN resizes on request,
    so ask for 180 px."""
    if "/cdn/shop/" not in url:
        return url
    return SHOPIFY_SIZE.sub(lambda m: f"{m.group(1)}{m.group(2)}=180", url)


async def page(client: httpx.AsyncClient, host: str) -> tuple[str, Head] | None:
    try:
        r = await client.get(f"https://{host}/")
    except (httpx.HTTPError, UnicodeDecodeError, ValueError):
        return None
    if r.status_code >= 400 or "html" not in r.headers.get("content-type", "").lower():
        return None
    head = Head()
    with contextlib.suppress(Exception):  # broken markup: whatever was parsed so far
        head.feed(r.text[:400_000])
    return str(r.url), head


async def is_image(client: httpx.AsyncClient, url: str) -> bool:
    try:
        r = await client.get(url)
    except (httpx.HTTPError, ValueError):
        return False
    kind = r.headers.get("content-type", "").lower()
    return r.status_code < 400 and kind.startswith("image/") and len(r.content) >= MIN_BYTES


async def find(
    client: httpx.AsyncClient, sem: asyncio.Semaphore, brand: str, hosts: list[str]
) -> dict[str, str] | None:
    async with sem:
        tries = [(h, False) for h in hosts] + [(h, True) for h in guesses(brand) if h not in hosts]
        for host, guessed in tries:
            got = await page(client, host)
            if got is None:
                continue
            base, head = got
            if guessed and not names_brand(head, brand, base):
                continue
            for url, kind in candidates(head, base):
                url = shopify_size(url)
                if not PARKED.search(url) and await is_image(client, url):
                    return {"logo_url": url, "source": base, "kind": kind}
        return None


async def run(brands: dict[str, list[str]], workers: int) -> dict[str, dict[str, str] | None]:
    sem = asyncio.Semaphore(workers)
    limits = httpx.Limits(max_connections=workers * 2, max_keepalive_connections=workers)
    headers = {"User-Agent": UA, "Accept-Language": "en", "Accept": "text/html,image/*,*/*"}
    async with httpx.AsyncClient(
        headers=headers, timeout=TIMEOUT_S, follow_redirects=True, limits=limits
    ) as client:
        names = list(brands)
        found = await asyncio.gather(*(find(client, sem, b, brands[b]) for b in names))
    return dict(zip(names, found, strict=True))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--missing-only", action="store_true", help="only brands not found yet")
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--brand", action="append", help="only this brand (repeatable)")
    args = ap.parse_args()

    products = json.loads(CATALOG.read_text())
    sites = brand_sites(products)
    have: dict[str, dict[str, str]] = json.loads(OUT.read_text()) if OUT.exists() else {}
    todo = {
        b: h
        for b, h in sites.items()
        if (not args.brand or b in args.brand) and not (args.missing_only and b in have)
    }
    print(
        f"{len(sites)} brands; looking up {len(todo)} ({sum(1 for h in todo.values() if h)} "
        "with a known site)"
    )
    results = asyncio.run(run(todo, args.workers))
    out = {b: v for b, v in have.items() if b in sites}
    for b, v in results.items():
        if v:
            out[b] = v
        elif not args.missing_only:
            out.pop(b, None)
    kinds = Counter(v["kind"] for v in out.values())
    missing = sorted(set(sites) - set(out))
    print(f"found {len(out)} / {len(sites)}  ({dict(kinds)}); missing {len(missing)}")
    print("missing:", ", ".join(missing))
    if args.brand:
        print(json.dumps(results, indent=1))
    if not args.dry_run:
        OUT.write_text(json.dumps(dict(sorted(out.items())), indent=1, ensure_ascii=False) + "\n")
        print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
