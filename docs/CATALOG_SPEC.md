# Catalog spec (owner: Niwin)

Facts only: names, ingredients (INCI), concerns, prices, store links. No marketing copy, no review text, no scraped ratings. Efficacy comes only from Willow measurements (team data + labeled synthetic cohort).

## Size and mix
40-60 real SKUs, global + regional brands, 3 price tiers (budget / mid / premium), across categories and concerns. Suggested brands (pick what you can verify quickly): The Ordinary, CeraVe, La Roche-Posay, Paula's Choice, COSRX, Beauty of Joseon, Neutrogena, Bioderma, Minimalist, The Derma Co, Dot & Key, Plum, Some By Mi, Round Lab, Kiehl's, Clinique. At least 2 options per concern per tier where possible.

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
    {"store": "Nykaa", "url": "https://...", "region": "IN"},
    {"store": "Sephora", "url": "https://...", "region": "US"},
    {"store": "Brand site", "url": "https://...", "region": "GLOBAL"}
  ],
  "source_url": "https://<official product page>",
  "last_verified": "2026-10-14"
}
```
Rules: copy INCI from the official page or pack; record the price you saw with currency and date; store URLs must be real product pages; no product images (show a neutral category icon) to avoid copyright issues.

## Collection workflow
Google Sheet with the columns above -> export CSV -> `api/scripts/import_catalog.py` -> `api/seed/products.json` -> Firestore `products/` (seed script, idempotent). Keep the sheet as the source of truth until Friday.

Commands (from `api/`): `uv run python scripts/import_catalog.py from-csv catalog.csv` (validates enums, regions, https links, duplicate ids, then writes `seed/products.json`), `to-csv catalog.csv` (to start or refresh the sheet), `seed` (mirrors `products.json` into Firestore `products/`). Sheet columns: list fields separated by ` | `, `key_actives` as `name:pct` (pct may be empty), and four store column triples `store_N_name`, `store_N_url`, `store_N_region`.

The api serves search, match and product facts from the bundled `seed/products.json` (fast, no Firestore read per request); Firestore `products/` is the copy for the BigQuery export.
