# Gemini spec (owner: Niwin)

## Setup
- SDK: `google-genai` (Python) with `vertexai=True`, `project=$PROJECT_ID`, `location="global"`. Gemini 3.x GA models are served only from the global endpoint (verified Oct 13: regional `us-central1` returns model-not-found; `gemini-2.5-flash` is regional but retires on Vertex around Oct 20, during judging). Every other GCP resource stays in `us-central1`.
- Model: env `GEMINI_MODEL` = `gemini-3.8-flash` (GA since Sep 2, 2026). It is a thinking model: set `thinking_config` to the lowest level/budget for labelling, extraction and routine checks, and always give a generous `max_output_tokens` (thinking tokens otherwise truncate the JSON). Verified Oct 13 with `google-genai==2.25.0`: the lowest accepted level is `thinking_level=LOW` (`MINIMAL` returns 400 "Thinking level is unsupported"); a short JSON extraction takes 1-3 s warm, a label photo about 6 s. Implementation: `api/app/gemini.py` (`generate_json`). Optional `GEMINI_MODEL_PRO` for the weekly summary only.
- Always `response_mime_type="application/json"` + `response_schema` (pydantic). Temperature 0 for labelling/extraction, 0.3 for explanations/chat. Set `max_output_tokens`.
- Never send more than needed: crops, not full faces, for labelling; metrics JSON, not images, for explanations.
- Log prompt id, latency, token counts (no images, no PII) to Cloud Logging.
- Retry once on schema-validation failure; then deterministic fallback.
- Function calling and `response_schema` cannot be combined in one request: the advisor runs the tool loop with plain text, then one final call with `response_schema` to produce the structured message.

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
- Output: `{brand, product_name, category: enum(CATALOG_SPEC), inci: [{name, confidence: high|low}], key_actives: [{name, pct: number|null}], claims_on_pack: string[], confidence, failure: glare|blurry|no_label|cut_off|null}` (Oct 15: per-ingredient legibility and a failure reason; plain `inci` strings still validate as legible items). Validator: a failure caps `confidence` at low, any low-confidence ingredient caps it at medium, `no_label` drops everything read; a failure with nothing read is refunded so the retake is free. The web draws low-confidence ingredients as dashed chips with "?" and gives retry advice per failure reason.
- Then match against catalog (brand + name fuzzy match); if matched, link `product_id`; else store as custom routine entry.
- api: `POST /v1/label-scan` with `{images: [{mime_type, data_base64}]}` (1-2 images, the web downsizes to a JPEG first) returns `{scan, match}` and saves nothing; the web shows a confirm/edit step, then `POST /v1/routine`. Trailing punctuation from printed lists is stripped; active names are lower-cased.

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

**Structured answers (Oct 15, `api/app/advisor_blocks.py`).** Gemini now writes `{blocks: Block[], product_ids, follow_up_suggestions, photos_show}`; the api derives the plain `message` (kept for older clients, copy and history). `Block` = `answer {text}` (always first, one direct sentence) · `bullets {items[]}` · `note {text}` · `widget {kind, params}` · `products {product_ids[]}`. Prompt: answer first, about 80 words of text at most unless asked for detail, no filler, prefer a widget over describing data. Text uses a tiny inline markup the web parses into elements (never HTML): `**bold**`, `==highlight==`, `[product:ID]`, `[metric:ID]`. Validators: every text (markup stripped, so ids with digits don't count) passes the number and banned-word checks; every product id in text, products blocks, product widgets and `product_ids` must come from a tool result or the routine and exist in the catalog; an unknown `[metric:ID]` or a reply without an answer block is rejected (one retry, then the fixed reply; when the question itself names a condition or asks for a diagnosis, the fixed reply is the cosmetic-scope one, `SCOPE_REPLY`: Willow follows how skin looks, not what a condition is, see a dermatologist). Asked for a diagnosis, a skin score or a skin age, Gemini is told not to repeat the condition or write "diagnose" (the banned-word check would reject an honest refusal). Widgets carry no numbers: `metric_trend {metric_id, site?}`, `session_summary {session_id from CONTEXT | "latest", site?}`, `routine {slot?}`, `product {product_id}`, `spot_diary {}`, `product_test {}`; a widget with unusable params is left out (max 2), and the web draws each from the person's own data with a link to its full screen.
**Photos (Oct 15).** Up to 3 product/label photos go to both calls as image parts; Gemini identifies the product and reads the label, never skin or faces (`photos_show: face_or_skin` gets a fixed refusal); numbers read from a photo still fail the validator unless a tool result has them.
**Progress (Oct 15).** `POST /v1/advisor/chat/stream` sends `reading_context`, `asking_gemini {step: tools|tool|reply}`, `checking_numbers`, then `done {reply}` or `error`; the reply is only sent after validation.

## 6. Ask the retailer data (added Oct 13)
- Input: the same aggregates as `GET /v1/retailer/insights` (groups under 10 already suppressed, no rows) plus the question. Output schema `Answer {answer, chart?: {title, unit: percent|count|weeks, bars[2..8]: {label, value}}, follow_ups[]}`.
- Validators: every number in the answer must be in the aggregates (a fraction may be written as a whole percent); every bar label must be a product, brand, goal, tile or routine issue in the aggregates; every bar value must be a number from them; banned words. One retry, then a fixed "could not answer" message. `POST /v1/retailer/ask` (sign-in, guest is fine; 20 a day).
- Oct 15: the schema adds `refused: bool` (Gemini sets it for individual-level questions or data the aggregates don't hold; a refusal may not carry a chart). The question carries the page's filters (`cohort`, `range`) and is answered from those aggregates (months in words, no page plumbing). The api, not Gemini, adds `n` per percent bar and `source` (aggregate tables named in the chart or the answer); the fallback is `refused: true`.
- Advisor tools `search_catalog` and `compare_products` now return `measured_outcomes` from the cohort (`product_outcomes`, labelled `synthetic_cohort`); the advisor may quote a rate as a whole percent with its n. Each advisor answer returns `checks {model, tool_calls, numbers_checked, products_from_tools}` and the web shows the steps and checks under the answer.

## Status (Oct 13)
- Explanation: live (`api/app/explain.py`). Gemini gets the metrics rounded the way the app shows them; the validator rejects unknown numbers, disease or "lighter/fairer" wording, change language for anything but `real_change`, and unknown metric ids; at most two Gemini calls, then the template. `explanation_source` says which one the person sees.
- Routine check: live (`api/app/routine_check.py`). The rule table runs as code (`source: "rule"`), so it is deterministic; Gemini may add `source: "model"` findings, kept only if they name known products, add no numbers, never flag niacinamide + vitamin C and do not repeat a rule finding.
- Advisor: live (`api/app/advisor.py`). Latest measurements and routine go in as context; tools are `search_catalog`, `compare_products`, `check_routine` (get_my_metrics / get_my_routine are folded into the context to save a round trip). Reply numbers must come from the context, tool results or the person's own words; product ids from tool results or their routine. 20 questions per person per day (`users/{uid}/usage/{date}`).
- Candidate labelling: built Oct 14 (`api/app/labeller.py`), switches on by itself when the engine writes `crops/{id}.jpg` and `crops/{id}_ctx.jpg`. Runs during analyze in parallel with the explanation; batches of 10, each asked twice (reverse order), label kept only if both agree and neither is low confidence, else `uncertain`; a batch that cannot be asked twice stays unlabelled. Stored as `labels {id: label}` (contract) plus `label_details {id: {label, confidence, visible_features}}`; the report draws rings on the photo and a "Spots on this photo" list marked AI-suggested, with the mole note. Verified with real Gemini on test crops.
- The shared Gemini client is created under a lock (parallel first calls used to close each other's client).
- Every call has a 25 s timeout; failures log the error and fall back.

## Cost and quota guardrails
Flash for everything interactive; cache explanations per session; label once per candidate; budget alerts are already set. Daily caps per person and across everyone (`api/app/limits.py`, Oct 13): advisor 20 / 3000, retailer questions 20 / 1500, label scans 30 / 1500, analyses 60 / 2000, judge sample runs 12 / 600. Guest accounts are free to create, so the global cap is what bounds cost; over it the api answers 429 "busy".
