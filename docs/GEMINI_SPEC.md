# Gemini spec (owner: Niwin)

## Setup
- SDK: `google-genai` (Python) with `vertexai=True`, `project=$PROJECT_ID`, `location="us-central1"`.
- Model: env `GEMINI_MODEL` = latest GA Gemini **Flash** model available on Vertex AI in us-central1 (check Model Garden; pin the exact ID). Optional `GEMINI_MODEL_PRO` for the weekly summary only.
- Always `response_mime_type="application/json"` + `response_schema` (pydantic). Temperature 0 for labelling/extraction, 0.3 for explanations/chat. Set `max_output_tokens`.
- Never send more than needed: crops, not full faces, for labelling; metrics JSON, not images, for explanations.
- Log prompt id, latency, token counts (no images, no PII) to Cloud Logging.
- Retry once on schema-validation failure; then deterministic fallback.

## Global system rules (prepend to every call)
"You are Willow's skincare assistant. Cosmetic guidance only, not medical advice. Never diagnose or name diseases. Never estimate or invent measurements, scores, skin tone, or age; only quote numbers given to you in the input. Never imply lighter skin is better. Be calm, inclusive, brief. If something looks concerning (changing mole, bleeding, pain), suggest seeing a dermatologist."

## 1. Candidate labeller
- Input: candidate crop + 3x context crop (JPEG from GCS), `kind`, site.
- Output schema: `{label: enum[papule_pustule, open_comedone, closed_comedone, post_blemish_mark, freckle, mole, scar, pore, hair_or_artifact, uncertain], confidence: enum[low, medium, high], visible_features: string[] (max 4)}`.
- Run twice (temperature 0, different crop order); keep the label if both agree and confidence != low; else `uncertain`.
- Batch up to 10 candidates per request to save latency (one image pair per candidate).
- UI shows labels as "AI-suggested". `mole` always shows the dermatologist note.

## 2. Explanation
- Input JSON: goal(s), site, metrics (id, label, value, unit, delta, mdc95, verdict, direction, confidence), quality reasons, routine entries with start dates, days since baseline.
- Output schema `Explanation`: `{headline: string, items: [{metric_id, summary, quoted_numbers: string[]}], next_steps: string[] (max 3), disclaimer: string}`.
- Validator: extract all numbers from `headline` and `summary`; each must appear (after rounding to the shown precision) in the input JSON; otherwise retry once, then use a template ("Redness: within normal photo variation (change -0.8, noise threshold 0.86)").
- Rules: only metrics with `real_change` get "changed" language; `within_noise` -> "no clear change yet"; indicative metrics say "trend"; never attribute causation with certainty ("may be linked to starting X 3 weeks ago").

## 3. Label scan
- Input: product photo(s) (front and/or back).
- Output: `{brand, product_name, category: enum(CATALOG_SPEC), inci: string[], key_actives: [{name, pct: number|null}], claims_on_pack: string[], confidence}`.
- Then match against catalog (brand + name fuzzy match); if matched, link `product_id`; else store as custom routine entry.

## 4. Routine compatibility check
- Input: routine entries (AM/PM, INCI, key actives), user goals, current verdicts.
- Ground with the rule table below (send it in the prompt). Gemini may add other well-known cosmetic interactions but must mark them `source: "model"` vs `source: "rule"`.
- Output: `{conflicts: [{products: [ids], issue, severity: enum[info, caution, avoid_same_routine], suggestion, source}], duplicates: [{active, products, note}], gaps: [{need, why, suggestion}], notes: string[]}`.

| Combination | Severity | Suggestion |
|---|---|---|
| Retinoid (retinol, retinal, adapalene, tretinoin) + AHA/BHA in the same routine | caution | Alternate nights |
| Retinoid + benzoyl peroxide same routine | caution | BPO AM, retinoid PM |
| Vitamin C (L-ascorbic acid) + benzoyl peroxide | caution | Separate AM/PM |
| Multiple exfoliants (AHA + BHA + PHA + enzymes, or 2+ acid products daily) | caution | Reduce frequency |
| Strong acids or retinoid with no sunscreen in routine | gap | Add daily SPF |
| Same active in 2+ products (e.g., two niacinamide serums) | duplicate | Keep one |
| Copper peptides + strong acids / L-ascorbic acid same routine | info | Separate |
| Niacinamide + vitamin C | none | Do NOT flag (common myth) |

## 5. Advisor chat (function calling)
Tools (implemented in api, results are the only source of product facts):
- `get_my_metrics(site?: string)` -> latest metrics + verdicts + timeline summary
- `get_my_routine()` -> entries
- `search_catalog(concern: enum, max_price?: number, currency?: string, exclude_ingredients?: string[], category?: enum)` -> up to 8 products with stores
- `compare_products(product_ids: string[])` -> side-by-side facts + any measured outcomes (synthetic cohort marked)
- `check_routine(proposed_change?: object)` -> runs feature 4
Response schema: `{message: string, product_ids: string[], follow_up_suggestions: string[]}`. UI renders product cards with all store links. Max 5 tool calls per turn.

## Cost and quota guardrails
Flash for everything interactive; cache explanations per session; label once per candidate; cap advisor to 20 turns per user per day; budget alerts are already set.
