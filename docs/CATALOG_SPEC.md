# Catalog spec (owner: Niwin)

Facts only: names, ingredients (INCI), concerns, prices, store links. No marketing copy, no review text, no scraped ratings. Efficacy comes only from Willow measurements (team data + labeled synthetic cohort).

## Size and mix
Oct 18: about 150 products, Asia-Pacific first (K-beauty, J-beauty, India, SEA/ANZ, and global brands sold there); grows after submission, and with product requests (below). The synthetic retailer cohort stays drawn over the Oct 15 catalog (`api/seed/cohort_products.json`, 48 products): products added later have real data only. Originally 40-60 real SKUs, global + regional brands, 3 price tiers (budget / mid / premium), across categories and concerns. Suggested brands (pick what you can verify quickly): The Ordinary, CeraVe, La Roche-Posay, Paula's Choice, COSRX, Beauty of Joseon, Neutrogena, Bioderma, Minimalist, The Derma Co, Dot & Key, Plum, Some By Mi, Round Lab, Kiehl's, Clinique. At least 2 options per concern per tier where possible.

## Enums
`category`: cleanser, toner, serum, treatment, exfoliant, moisturizer, sunscreen, eye_care, mask.
`concerns` (same taxonomy as goals): acne_blemishes, dark_spots_pigmentation, uneven_tone, redness_sensitivity, texture_pores, oiliness_shine, fine_lines, dark_circles, dryness_barrier, dullness.
`region` tags: IN, US, UK, EU, KR, SEA, GCC, GLOBAL.

## Concern -> metric mapping (used by advisor and retailer insights)
| concern | metrics |
|---|---|
| acne_blemishes | blemishes, redness |
| dark_spots_pigmentation | pigment_spots |
| uneven_tone | tone_evenness |
| redness_sensitivity | redness |
| texture_pores | pores, texture |
| oiliness_shine | shine |
| fine_lines | lines |
| dark_circles | dark_circles |
| dryness_barrier | (self-report only; texture as a proxy, indicative) |
| dullness | glow |

## Record (`api/seed/products.json`)
```json
{
  "product_id": "the-ordinary-niacinamide-10-zinc-1",
  "brand": "The Ordinary",
  "name": "Niacinamide 10% + Zinc 1%",
  "category": "serum",
  "concerns": ["acne_blemishes", "oiliness_shine", "texture_pores"],
  "key_actives": [{"name": "niacinamide", "pct": 10}, {"name": "zinc pca", "pct": 1}],
  "inci": ["Aqua (Water)", "Niacinamide", "Pentylene Glycol", "Zinc PCA", "..."],
  "price": {"amount": 590, "currency": "INR"},
  "size": "30 ml",
  "region": ["IN", "GLOBAL"],
  "stores": [
    {"store": "Nykaa", "url": "https://...", "region": "IN", "price": null},
    {"store": "Ulta", "url": "https://...", "region": "US",
     "price": {"amount": 6, "currency": "USD", "checked": "2026-10-15"}},
    {"store": "Brand site", "url": "https://...", "region": "GLOBAL",
     "price": {"amount": 6, "currency": "USD", "checked": "2026-10-15"}}
  ],
  "source_url": "https://<official product page>",
  "last_verified": "2026-10-14"
}
```
Rules: copy INCI from the official page or pack; record the price you saw with currency and date; store URLs must be real product pages.

## Full and index products (Nov 27)
Every record has `detail`: `"full"` (the record above: full INCI, key actives and a price, checked by hand) or `"index"` (the product as it is sold: brand, name, category, concerns, size, region, stores, image, source, with `"inci": []`, `"key_actives": []` and `"price"` possibly `null`). Missing `detail` means `"full"` (every product from before Nov 27). Records may carry `"notes"`: what was checked and any caveat (for shard-added products this replaces VERIFY.md).

| | full | index |
|---|---|---|
| Found by search, added to a routine | yes | yes (full ranks first for the same match) |
| Check (`POST /v1/safety/check`) | clear / check / avoid / not_sold | `unknown` ("Not checked yet"), or avoid (own avoid list) / not_sold (its name says medicine); never clear |
| Plan, swaps, similar, Wisp suggestions, sponsored | yes | never |
| Wisp | suggests and discusses | discusses only when named, saying its ingredient list isn't in Willow yet |
| Product sheet | facts, price, stores | "Full facts coming", Scan the label, a facts request queued once (`product_requests`, `kind: facts`) |
| Price | always | may be null: the app shows nothing or "Price not checked" |

An index product becomes full by replacing its record (INCI, actives, price, `detail: "full"`) in `products.json`, then deploying; pending facts requests are answered with `scripts/product_requests.py added <key> <product_id>`.

## Merging catalog shards
Research jobs write shards: JSON arrays of records in the shape above. `uv run python scripts/merge_catalog_shards.py <folder>` (from `api/`) validates every record (pydantic: category, concern and region enums, ISO currencies, http(s) links, a slug `product_id`, real dates, no unknown fields; a full record needs INCI and a price), normalises region codes (SG, MY, TH, VN, PH, ID → SEA), drops duplicates of existing products and of each other (by `product_id`, and by brand + name with case, accents, punctuation and spaces aside), never overwrites an existing product, and prints accepted and rejected records per shard with reasons. It is a dry run by default; `--write` appends to `seed/products.json` and rewrites `seed/catalog.csv` from it (the sheet columns gain `detail` and `notes`; an index row leaves price, INCI and actives empty). New full products have no similar-formula vector until `scripts/embed_catalog.py` is run again.

Per-store prices (owner decision, Oct 15): `stores[].price` is `{amount, currency, checked}` or `null`. `amount` is the price that store's own product page showed for **this exact product and size** (sale price if that is what the page charges), `currency` is the page's ISO 4217 code, `checked` is the day it was read (YYYY-MM-DD). `null` when the page did not load, blocked automated access, showed no price, was out of stock without a price, or listed a different size or variant. Never estimate, convert currencies or copy a price from another store; re-check before showing a price as current. The top-level `price` stays as the reference price (used by `max_price` search). The api serves `stores[].price` unchanged from `/v1/catalog/search` and `/v1/catalog/{product_id}`; `scripts/import_catalog.py` validates it (amount > 0, 3-letter upper-case currency, real date). Sheet columns: `store_N_price_amount`, `store_N_price_currency`, `store_N_price_checked` (after the other columns; all empty = null).

Product images (changed Oct 13, see DECISIONS): `image_url` is the brand's own official product image, **linked from where the brand or a major retailer already publishes it, never downloaded, copied into the repo or re-hosted in our bucket**. `image_source` is the page it appears on, and the UI credits it ("Image: theordinary.com"). Packshots only: no lifestyle, model, before/after or claims images. If an image fails to load, the UI falls back to the neutral category icon. Brands or retailers can ask for removal, and an empty `image_url` is always valid.

## Collection workflow
Google Sheet with the columns above -> export CSV -> `api/scripts/import_catalog.py` -> `api/seed/products.json` -> Firestore `products/` (seed script, idempotent). Keep the sheet as the source of truth until Friday.

Commands (from `api/`): `uv run python scripts/import_catalog.py from-csv catalog.csv` (validates enums, regions, https links, duplicate ids, then writes `seed/products.json`), `to-csv catalog.csv` (to start or refresh the sheet), `seed` (mirrors `products.json` into Firestore `products/`). Sheet columns: list fields separated by ` | `, `key_actives` as `name:pct` (pct may be empty), and four store column triples `store_N_name`, `store_N_url`, `store_N_region`.

The api serves search, match and product facts from the bundled `seed/products.json` (fast, no Firestore read per request); Firestore `products/` is the copy for the BigQuery export.

## Status (Nov 27)
The seed now holds 3,237 products from 437 brands (Nov 27, 2026): 331 full records (INCI and a checked price; these are the only ones suggested) and 2,906 index records (searchable, shown as "Not checked yet"). 2,812 have a product photo linked from the product's own page (`scripts/enrich_catalog_images.py`). New records came from per-market research shards merged with `scripts/merge_catalog_shards.py` (validated, de-duplicated, one spelling per brand); a European drugstore set was left out as off-brief for APAC.

Nov 27, later: 11 acne-clinic and professional products one person uses (Face Reality, Mixi, Hydrinity, SENTÉ, ISDIN, Plated Skin Science, Epicutis, skinbetter science) were added as full records through `merge_catalog_shards.py`; SENTÉ Dermal Repair Cream was already an index record and was upgraded to full. Their sources and caveats are in `api/seed/VERIFY.md`.

Before the shard merge there were 152 products in `api/seed/products.json`: 39 serums, 31 sunscreens, 21 cleansers, 21 moisturisers, 15 toners, 7 treatments, 6 exfoliants, 6 eye care, 6 masks, every concern covered, with the clash-check actives the demo needs (retinoids, AHA/BHA, benzoyl peroxide, L-ascorbic acid, niacinamide, azelaic acid, alpha arbutin, sunscreens). Reference prices in USD, INR, SGD, AUD, IDR, KRW and MYR; per-store prices carry the day they were checked. `api/seed/catalog.csv` was the first 48 products in sheet columns; `merge_catalog_shards.py --write` (or `import_catalog.py to-csv seed/catalog.csv`) rewrites it from `products.json`. History: 48 SKUs on Oct 13 (18 global, 16 Indian, 14 Korean brands), about 150 from Oct 18. `api/seed/VERIFY.md` covers the first 48 products only: what came from search results and any formula or naming caveat. Products added from shards carry their caveats in their own `notes` instead.

## Product requests (Oct 18)
People ask for products the catalog lacks from the add sheet ("Request a product": a pack photo, or brand + name). Requests never add anything by themselves. Work the queue most-asked first: `uv run python scripts/product_requests.py list`, look at the photos with `photo <key> <dir>`, add the product here by the rules above, deploy the api, then `added <key> <product_id>` (everyone who asked sees it on Routine and gets a push; their photos are deleted) or `declined <key>`.
