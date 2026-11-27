"""Fill in missing product images from each product's own source page (catalog growth, Nov 2026).

For every catalog product without `image_url`, open its `source_url` (then its store pages) once
and read the image the page itself declares for sharing: `og:image`, `twitter:image`, a JSON-LD
Product `image`, or `link rel=image_src`. The image stays on that site (linked, never copied), and
`image_source` names the page it came from, as every other catalog image does. A page that does not
answer is recorded, so dead links show up in the report.

    uv run python scripts/enrich_catalog_images.py            # dry run: report only
    uv run python scripts/enrich_catalog_images.py --write    # update seed/products.json
"""

import argparse
import asyncio
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx

CATALOG = Path(__file__).resolve().parent.parent / "seed" / "products.json"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0 Safari/537.36"
)
META = re.compile(
    r"""<meta[^>]+(?:property|name)\s*=\s*["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*>""",
    re.I,
)
CONTENT = re.compile(r"""content\s*=\s*["']([^"']+)["']""", re.I)
LINK = re.compile(
    r"""<link[^>]+rel\s*=\s*["']image_src["'][^>]*href\s*=\s*["']([^"']+)["']""", re.I
)
LDJSON = re.compile(r"""<script[^>]+application/ld\+json[^>]*>(.*?)</script>""", re.I | re.S)
BAD = re.compile(r"logo|favicon|placeholder|default|sprite|icon[-_.]", re.I)


def _ld_image(blob: str) -> str | None:
    try:
        data = json.loads(blob.strip())
    except json.JSONDecodeError:
        return None
    stack: list[Any] = [data]
    while stack:
        x = stack.pop()
        if isinstance(x, list):
            stack.extend(x)
        elif isinstance(x, dict):
            if str(x.get("@type", "")).lower() == "product" and x.get("image"):
                img = x["image"]
                img = img[0] if isinstance(img, list) and img else img
                img = img.get("url") if isinstance(img, dict) else img
                if isinstance(img, str):
                    return img
            stack.extend(v for v in x.values() if isinstance(v, (list, dict)))
    return None


def find_image(html: str, base: str) -> str | None:
    """The page's own product image: JSON-LD Product first, then og/twitter, then image_src."""
    for blob in LDJSON.findall(html):
        if (img := _ld_image(blob)) and not BAD.search(img):
            return urljoin(base, img)
    for tag in META.findall(html):
        m = CONTENT.search(tag)
        if m and not BAD.search(m.group(1)):
            return urljoin(base, m.group(1).replace("&amp;", "&"))
    m = LINK.search(html)
    if m and not BAD.search(m.group(1)):
        return urljoin(base, m.group(1))
    return None


async def fetch(client: httpx.AsyncClient, url: str) -> tuple[int, str, str]:
    try:
        r = await client.get(url)
        return r.status_code, str(r.url), r.text if r.status_code == 200 else ""
    except (httpx.HTTPError, UnicodeDecodeError):
        return 0, url, ""


async def enrich(products: list[dict[str, Any]], workers: int) -> Counter:
    todo = [p for p in products if not p.get("image_url")]
    stats: Counter = Counter(todo=len(todo))
    sem = asyncio.Semaphore(workers)
    limits = httpx.Limits(max_connections=workers, max_keepalive_connections=workers)
    headers = {"User-Agent": UA, "Accept-Language": "en"}
    async with httpx.AsyncClient(
        follow_redirects=True, timeout=15, headers=headers, limits=limits
    ) as client:

        async def one(p: dict[str, Any]) -> None:
            pages = [p.get("source_url")] + [s.get("url") for s in p.get("stores") or []]
            async with sem:
                for i, url in enumerate(u for u in pages if u):
                    status, final, html = await fetch(client, url)
                    if i == 0:
                        p["_source_status"] = status
                        stats[f"source {status // 100}xx" if status else "source error"] += 1
                    if html and (img := find_image(html, final)):
                        p["image_url"], p["image_source"] = img, url
                        stats["image found"] += 1
                        return
            stats["no image"] += 1

        await asyncio.gather(*(one(p) for p in todo))
    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true", help="update seed/products.json")
    ap.add_argument("--workers", type=int, default=24)
    args = ap.parse_args()
    products = json.loads(CATALOG.read_text())
    stats = asyncio.run(enrich(products, args.workers))
    dead = [p["product_id"] for p in products if p.get("_source_status") not in (None, 200)]
    for p in products:
        p.pop("_source_status", None)
    for k, v in sorted(stats.items()):
        print(f"{k}: {v}")
    print(f"source pages not answering 200: {len(dead)}")
    if args.write:
        CATALOG.write_text(json.dumps(products, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {CATALOG}")
    else:
        print("dry run: nothing written (add --write)")


if __name__ == "__main__":
    main()
