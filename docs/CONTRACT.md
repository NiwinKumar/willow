# Contract: engine <-> api <-> web

Version **1.0** (Oct 13, 2026). Owners: Harshini (engine) and Niwin (api, web).
Changing anything here requires both owners to agree. Propose changes in `docs/CONTRACT_CHANGES.md`.

Machine-readable versions: `schemas/analyze_request.schema.json`, `schemas/analysis_result.schema.json`. Example: `fixtures/analysis_result.sample.json`.

---

## 1. System overview

```
web (Firebase Hosting, React)
  |  Firebase Auth ID token
  v
api (Cloud Run, Python FastAPI)  -- Niwin
  |-- POST signed URLs --> browser uploads frames straight to Cloud Storage
  |-- POST /v1/analyze --> engine (Cloud Run, Python FastAPI) -- Harshini
  |                          reads frames from GCS, writes crops/overlays to GCS
  |                          returns AnalysisResult JSON (no state, no DB)
  |-- Firestore (sessions, baselines, routine, catalog)
  |-- Gemini on Vertex AI (labels, explanations, label scan, routine check, advisor)
  '-- BigQuery (batch loads) -> Looker Studio retailer dashboard
```

Key rules:
- The **engine is stateless**. It never touches Firestore. Everything it needs comes in the request; everything it produces goes back in the response or to `output_prefix` in GCS.
- The **api owns all state** (Firestore), all Gemini calls, and the decision of which session is a baseline.
- Bucket: `gs://<PROJECT_ID>-captures` (region `us-central1`, 30-day lifecycle delete on `uploads/` and `results/`; `demo/` is kept).

GCS paths:
```
uploads/{uid}/{session_id}/frame_{n}.{dng|jpg|heic}
results/{uid}/{session_id}/overlays/{metric_id}.png
results/{uid}/{session_id}/crops/{candidate_id}.jpg
demo/...    (seeded judge data, consented team captures only)
```

## 2. Engine API (Harshini implements, api calls)

Service: Cloud Run `willow-engine`, private (requires IAM invoker; the api's service account has `roles/run.invoker`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | `{"status":"ok","engine_version":"x.y.z"}` |
| POST | `/v1/analyze` | Analyze 1-5 frames of one site in one session. Body: `AnalyzeRequest`. Returns `AnalysisResult`. |

Local CLI (for development and capture QA, same code path):
```
uv run python -m app.cli analyze --site forearm_treated --mode calibrated_raw data/forearm/*.dng --out out/
```
The CLI accepts local paths; the API accepts `gs://` URIs. Both return the same JSON.

Timeouts: the api waits up to 120 s. Target per request: < 20 s for 5 frames.

### 2.1 AnalyzeRequest
```json
{
  "schema_version": "1.0",
  "session_id": "s_20261013_abc123",
  "user_id": "uid_xyz",
  "site": "face_full",
  "capture_mode": "calibrated_raw",
  "frames": [
    {"uri": "gs://PROJECT-captures/uploads/uid_xyz/s_.../frame_1.dng", "content_type": "image/x-adobe-dng"}
  ],
  "baseline": {
    "redness": {"mean": 14.2, "mdc95": 0.9, "n_frames": 5, "session_id": "s_baseline"},
    "tone_ita": {"mean": 31.5, "mdc95": 1.2, "n_frames": 5, "session_id": "s_baseline"}
  },
  "output_prefix": "gs://PROJECT-captures/results/uid_xyz/s_.../",
  "options": {"compute_overlays": true, "max_candidates": 40}
}
```
- `site`: one of `face_full`, `cheek_macro`, `nose_macro`, `forearm_treated`, `forearm_control`.
- `capture_mode`: `calibrated_raw` (DNG + color card) or `uncalibrated` (browser JPEG/HEIC, no card).
- `frames`: 1-5. The baseline session uses 5 frames (repositioned between shots) so the engine can measure noise.
- `baseline`: optional map of metric_id -> stored baseline. If absent, verdicts are `no_baseline`.

### 2.2 AnalysisResult (top level)
| Field | Type | Notes |
|---|---|---|
| `schema_version` | "1.0" | |
| `engine_version` | string | semver |
| `session_id`, `user_id`, `site`, `capture_mode` | echo of request | |
| `frames_used` | int | frames that passed quality gates |
| `quality` | object | see 2.3 |
| `metrics` | array of Metric | see 2.4; only metrics valid for the site |
| `candidates` | array of Candidate | regions for Gemini to label (blemishes, spots) |
| `overlays` | array `{metric_id, uri}` | PNG heatmaps/outlines in GCS (see below) |
| `rois` | array `{name, polygon:[[x,y],...]}` | in pixel coords of the aligned reference frame |
| `image_size` | `{width, height}` | of the aligned reference frame |
| `timings_ms` | object | per stage |
| `warnings` | array of string | human-readable, non-fatal |

Overlays (engine 0.3.4+, proposal in `docs/CONTRACT_CHANGES.md` 2026-10-15): with `options.compute_overlays` (default true) and an `output_prefix`, `face_full` and `cheek_macro` results list `{"metric_id": "redness", "uri": "{output_prefix}overlays/redness.png"}`. The PNG is RGBA at exactly the pixel size and orientation of `{output_prefix}preview.jpg` (the same reference photo, shrunk by the same whole factor), so the web lays it over the preview with no scaling maths. It shows where on the skin the redness metric measures (face: cheeks and nose; cheek close-up: its skin) the camera sees more red than this person's own skin median in that photo: transparent outside that skin and at or below the median, then a rose-to-deep-red ramp with rising opacity up to the skin's 98th percentile (at least 4 a* units above the median). Descriptive and cosmetic: no shared scale between people, no number, no diagnosis; it moves no metric. Absent when no photo passed, or with no `output_prefix`. `nose_macro` and forearm sites have none.

### 2.3 Quality
```json
{
  "passed": true,
  "card_detected": true,
  "card_delta_e_mean": 2.1,
  "sharpness": 412.5,
  "clipped_pct": 0.3,
  "pose": {"yaw": 1.2, "pitch": -2.0, "roll": 0.4},
  "per_frame": [
    {"index": 0, "passed": true, "reasons": [], "regions": []},
    {"index": 1, "passed": false, "reasons": ["overexposed"], "regions": [{"reason": "overexposed", "region": "forehead"}]}
  ],
  "reasons": []
}
```
`per_frame[].regions` (optional, engine 0.3.4+, `face_full` only): where on the face each of that photo's failed checks is, so the retake hint can say "light is too bright on your forehead". Each entry explains one of the photo's `reasons`: `overexposed` / `underexposed` (the region's own clipped / crushed pixels over the 2% gate), `blurry` (the region's sharpness under the face threshold and under 0.4x the median region's), `occlusion_suspected` (a hand over at least 25% of the region). `region` ∈ `forehead`, `left_cheek`, `right_cheek`, `nose`, `chin`, `under_eyes`, `whole` (`whole`: every region fails it, or none stands out). Other reasons (pose, face not found) are not attributed. It never changes whether a photo passed. Present (possibly empty) on every face photo the engine measured; absent for photos where no face was found, for close-ups and forearm sites, and from engines before 0.3.4.
Gate defaults (tunable in `engine/app/config.py`): card ΔE mean <= 6 for calibrated mode; sharpness (variance of Laplacian on skin ROI) >= 100; clipped pixels in skin ROI <= 2%; |yaw|, |pitch| <= 8 deg, |roll| <= 6 deg for face sites. `reasons` uses codes: `card_not_found`, `card_delta_e_high`, `blurry`, `overexposed`, `underexposed`, `pose_out_of_range`, `face_not_found`, `occlusion_suspected`, `too_few_frames`.

### 2.4 Metric
```json
{
  "id": "redness",
  "group": "redness",
  "label": "Redness",
  "value": 13.4,
  "unit": "a_star",
  "confidence": "measured",
  "within_session_sd": 0.31,
  "mdc95": 0.86,
  "delta": -0.8,
  "verdict": "within_noise",
  "direction": "decrease",
  "extras": {"erythema_index": 41.2}
}
```
- `value`: mean over frames that passed gates.
- `within_session_sd`: SD across frames (null if 1 frame).
- `mdc95`: `1.96 * sqrt(2) * within_session_sd` from THIS session (null if 1 frame). The api stores it when this session becomes the baseline.
- `delta`: `value - baseline.mean` (null if no baseline).
- `verdict`: `no_baseline` | `within_noise` (|delta| <= baseline.mdc95) | `real_change` (|delta| > baseline.mdc95) | `low_quality` (quality gate failed for this metric).
- `direction`: `increase` | `decrease` | `none`. Neutral on purpose. The api/UI decides wording per metric (e.g., lower redness is usually desired; tone change is just "change").
- `confidence`: `measured` or `indicative` (see `docs/METRICS.md`). In `uncalibrated` mode every metric is forced to `indicative` and verdicts may only be `no_baseline` or `within_noise`/`real_change` with a UI note "trend only".

### 2.5 Metric IDs (fixed)
| id | group | unit | sites | confidence |
|---|---|---|---|---|
| `tone_ita` | tone_pigment | deg | face_full, cheek_macro, forearm_* | measured (descriptive, never scored) |
| `pigment_spots` | tone_pigment | pct_area | face_full, cheek_macro | measured |
| `tone_evenness` | tone_pigment | index | face_full | measured |
| `redness` | redness | a_star | face_full, cheek_macro, forearm_* | measured |
| `blemishes` | clarity | count | face_full, cheek_macro, nose_macro | indicative |
| `pores` | texture_pores | per_cm2 | cheek_macro, nose_macro | measured |
| `texture` | texture_pores | index | cheek_macro | measured (auto-downgrade to indicative if MDC too large) |
| `lines` | lines | index | face_full | indicative |
| `dark_circles` | eye_area | delta_l_star | face_full | measured |
| `shine` | oil_glow | pct_area | face_full | indicative |
| `glow` | oil_glow | index | face_full | indicative |

`extras` per metric:
- `tone_ita`: `{l_star, b_star, ita_band, monk_estimate}`
- `pigment_spots`: `{count, mean_contrast}`
- `redness`: `{erythema_index}`
- `blemishes`: `{blackheads}` (nose_macro only)
- `pores`: `{mean_diameter_mm}`
- `dark_circles`: `{delta_a_star, delta_melanin_proxy}`

### 2.6 Candidate (for Gemini labelling, done by the api)
```json
{
  "id": "c_007",
  "kind": "blemish",
  "bbox": [812, 1040, 46, 44],
  "crop_uri": "gs://.../crops/c_007.jpg",
  "context_crop_uri": "gs://.../crops/c_007_ctx.jpg",
  "features": {"a_star_contrast": 4.1, "l_star_contrast": -6.3, "area_px": 1320}
}
```
`kind`: `blemish` or `spot`. The api asks Gemini to label each crop with one of: `papule_pustule`, `open_comedone`, `closed_comedone`, `post_blemish_mark`, `freckle`, `mole`, `scar`, `pore`, `hair_or_artifact`, `uncertain`. Labels go into Firestore next to the result, not into the engine output.

### 2.7 Errors
HTTP 4xx/5xx with `{"error": {"code": "...", "message": "..."}}`. Codes: `bad_request`, `frame_unreadable`, `unsupported_format`, `gcs_access_denied`, `internal`. Quality failures are NOT errors: return 200 with `quality.passed=false`.

## 3. Product API (Niwin implements, web calls)

Service: Cloud Run `willow-api`, public, every route except `/healthz` requires `Authorization: Bearer <Firebase ID token>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/sessions` | `{site, capture_mode, n_frames, content_types[]}` -> `{session_id, upload_urls[]}` (V4 signed PUT URLs, 15 min) |
| POST | `/v1/sessions/{id}/analyze` | calls engine with baseline from Firestore; Gemini labels + explanation; returns `SessionView` |
| GET | `/v1/sessions/{id}` | `SessionView` |
| POST | `/v1/sessions/{id}/analyze?force=1` | measures a `done` session again with all its frames (counts as an analysis); a re-analyzed baseline rebuilds `baselines/{key}`, later sessions keep their stored `compared_with`; a failed forced run leaves the session `done` as it was |
| POST | `/v1/sessions/{id}/frames` | `{add: 1-5, content_types[]}` -> `{session_id, n_frames, upload_urls[] (new frames only, index = place in the session), expires_in_seconds, dropped[]}`. Before analyze: an edit. On a `done` session (baseline top-up): status back to `uploading` (result and baseline kept until re-analyzed), frames the engine left out are dropped (`dropped`, 1-based). 409 `too_many_frames` past 5, `originals_deleted` after the 30-day lifecycle, `conflict` while analyzing or for sample runs |
| DELETE | `/v1/sessions/{id}/frames/{index}` | before analyze only (`uploading`/`failed`): removes frame `index` (1-based; later frames move up, the object is deleted) -> `{session_id, upload_urls[] (all frames), expires_in_seconds}`; 409 `last_frame` for the only frame |
| GET | `/v1/sessions/{id}/objects` | `{session_id, objects[{index, object_uri, exists, size, md5_base64, content_type, duplicate_of: {session_id, index} \| null}]}`: GCS metadata per frame; `duplicate_of` = a byte-identical (MD5) frame of the person's earliest other session (sample runs excluded), else an earlier frame of this one |
| — | `SessionView.session` additions | `stage: 'received'\|'engine'\|'explaining'\|null` (live while `processing`, every view); `frame_urls: (string\|null)[]` (signed GET per frame; null for DNG or a missing object) and `crop_urls: {candidate_id: url}` (signed tight crops that exist): only in `GET /v1/sessions/{id}` and analyze answers, not in the list |
| GET | `/v1/timeline?site=...` | per-metric series for charts |
| POST | `/v1/baselines/{site}` | mark a session as baseline (or auto: first passing 5-frame calibrated session) |
| POST | `/v1/label-scan` | image -> `{brand, product_name, inci[], key_actives[{name, pct?}], confidence}` (Gemini vision) |
| GET/POST/DELETE | `/v1/routine` | routine entries |
| POST | `/v1/routine/check` | Gemini compatibility check -> `{conflicts[], duplicates[], gaps[], notes[]}` |
| POST | `/v1/advisor/chat` | Gemini with function calling over catalog + user's metrics -> `{message, blocks[], products[], product_ids[], follow_up_suggestions[], retrieval[], checks?, remaining_today}`. Body `{messages[≤20], images?: [{mime_type: image/jpeg|png|webp, data_base64 ≤8 MB}] ≤3}` (product/label photos, never stored). 502 `advisor_unavailable` detail carries `standard: {session_id, site, capture_mode, created_at, explanation} \| null` (latest measured session's template explanation). See GEMINI_SPEC.md section 5 for `blocks` |
| POST | `/v1/advisor/chat/stream` | same turn as Server-Sent Events: `reading_context`, `asking_gemini {step: tools\|tool\|reply, photos?, tool?, retrieval?}`, `checking_numbers`, then `done {reply}` or `error {status, code, message, standard?}`; 422/429 are plain HTTP errors |
| GET/DELETE | `/v1/advisor/history` | stored chat, oldest first: `{messages: [{id, role: user\|willow, text, created_at, photos? \| reply?}], keep: 200}`; DELETE (New chat) -> 204 |
| GET | `/v1/me/usage` | `{advisor, routine_check, label_scan, retailer_ask}` each `{used, cap, remaining, resets_at}` (UTC midnight); reading counts nothing |
| GET | `/v1/demo/status` | public: `api`, `engine`, `gemini`, `storage`, `bigquery` (each live: `status: ok\|degraded\|unreachable` (+`waking` for the engine), `latency_ms`, `reason?: slow\|busy`), `catalog`, `checked_at`; cached 60 s (10 s after a failed check) |
| GET | `/v1/catalog/search?q=&concern=&max_price=` | catalog search |
| GET | `/v1/retailer/insights` | aggregate JSON for the in-app retailer view (BigQuery) |
| GET | `/v1/me` | `{uid, consent, profile}`; `consent` and `profile` are null until saved |
| PUT | `/v1/me/profile` | partial update of `users/{uid}.profile` (fields left out keep their value, `null` clears one) -> `{profile}`; 422 on an unknown field or value |
| PATCH | `/v1/routine/{id}` | `{ended_at?, slots?, schedule?}`; `schedule` = `{kind: daily\|alternate\|days, days?: int[] (0=Mon), anchor: YYYY-MM-DD}` or null (every day); stamps `updated_at`. GET `/v1/routine` entries also carry `schedule`, `updated_at`, and the catalog `image_url` / `image_source` (null for own products) |
| POST | `/v1/label-scan` (Oct 15 additions) | `scan.inci` items are `{name, confidence: high\|low}` (plain strings still accepted from the model), `scan.failure: glare\|blurry\|no_label\|cut_off\|null`; a scan with a failure and nothing read is not counted against the daily cap |
| GET/POST | `/v1/product-tests` | list (`{tests[]}`, running one first) / start `{entry_id?, product_id?, name?, length_days? (7-56, default 28), started_at?}`; 409 while another test runs |
| PATCH/DELETE | `/v1/product-tests/{id}` | `{name?, length_days?, ended_at?}` (end, or null to resume) / remove a test (its forearm sessions stay) |
| GET | `/v1/me/reminder.ics` | the check-in schedule (`profile.checkin`) as one weekly `VEVENT` (`RRULE BYDAY`, `DTSTART;TZID` + `VTIMEZONE`, `VALARM` at the time, link to `/home`); 404 without a schedule |
| GET | `/v1/me/push/key` | `{enabled, public_key}`: the VAPID public key; `enabled: false` = no keys on the api, reminders by calendar only |
| POST | `/v1/me/push` | a browser `PushSubscription.toJSON()` `{endpoint, keys: {p256dh, auth}}` -> `{id, enabled}`; idempotent; endpoint must be a browser push service (FCM, Mozilla, Apple, WNS); 503 `push_unavailable` without keys |
| DELETE | `/v1/me/push` | `{endpoint}` forgets that device; no body forgets every device; 204 |
| POST | `/v1/me/push/test` | test notification to every device of this person -> `{sent, removed, failed}`; 10 per day |
| POST | `/v1/internal/reminders` | Cloud Scheduler only (OIDC token: audience `REMINDERS_AUDIENCE`, email `SCHEDULER_SERVICE_ACCOUNT`; no check with `AUTH_MODE=dev`), every 15 min: one push to each person whose check-in time (in the schedule's time zone, DST-safe) came in the last `REMINDER_WINDOW_MINUTES` on a scheduled day and who has no (non-failed) session that local day; one per person per day; 404/410 subscriptions removed -> `{enabled, due, sent, skipped, removed, failed}` |
| GET | `/v1/retailer/insights?cohort=simulated\|mixed\|real&range=30d\|90d\|all` | public (no sign-in) aggregate JSON for the retailer view (BigQuery). Defaults `mixed` + `all` (every row, all time); other values 422. Cached per filter (10 min) over one cached BigQuery read. Range keeps people with a reading in the last 30/90 days. Groups under 10 suppressed in the api. Fields: `cohort`, `empty` (fewer than 10 people: only the head count), `filters {cohort, range, since, today}`, `tiles`, `needs[] {goal, goal_id, n, real, none, early, weeks, weeks_n}`, `needs_by_month {months['YYYY-MM'], people[], goals[{goal, goal_id, counts[], share_of_peak[]}]}`, `kpis {catalog {products, with_outcomes, below_min, unused, not_measured}, continuation_wk8 {k, n, rate}}`, `products[]` (+ `category, goal_ids, cells_skin[], base {k, n, rate}, cont8`), `product_outcomes` (+ `category, cont8, lift`), `tone_bands`, `skin_types`, `brands`, `brands_hidden`, `categories[] {category, label, flows[{goal, goal_id, n, weeks[2,4,8], changed[], using[], rate, median_weeks, base}], brands[], brands_hidden}`, `gaps[]` (per goal; tiers + `n`), `conflicts[] {kind, pair, n, share, fix, resolves}`, `routines_checked` |
| POST | `/v1/retailer/ask` | `{question (3-300), cohort?, range?}` (same filters as the page) -> `{answer, refused, chart: {title, unit, bars[{label, value, n}]} \| null, source[], follow_ups[], checks \| null}`; sign-in (guest ok), 20 a day |
| GET | `/v1/retailer/products?cohort&range` | Willow Proof (Oct 16; public, same filters, caching and 503 as `/insights`; RETAILER_INSIGHTS "Willow Proof views"): `{filters, cohort, products: Row[], counts {products, measured, too_few, unused, not_measured}}`. `Row` = `{product_id, product, brand, category, category_label, goal_ids, price_tier, image_url, users, n, rate, rate_lo, rate_hi, base_rate, lift, lift_lo, lift_hi, weeks, cont8, routine_share, tier: proven\|promising\|unclear\|too_few, tier_label, reason: few\|unused\|not_measured\|null, to_proven}`; outcome numbers null when `too_few` |
| GET | `/v1/retailer/products/{product_id}?cohort&range` | 404 unknown. `{filters, cohort, product: Row & {key_actives, size, price, image_source, stores (count)}, curve {weeks[1..8], users[], base[]}, segments {skin[], tone[], goal[]}` (Seg `{id, label, n, rate, base_rate, suppressed}`, suppressed `n` null), `competitors {rows: (Row & {is_self})[], rank, of, note}, co_used[{product_id, product, brand, category, image_url, n, share}] (top 6), switching {stopped, to[], from[], to_brands[], from_brands[]} ({product_id, product, brand, n}; brands {brand, label, same_brand, n}, own brand labelled "Same brand, other product"), conflicts[{kind, label, fix, n, share}], evidence[{id, kind: efficacy\|speed\|segment\|retention, text, n, method, window, cohort_label, caveat}], evidence_caveat, eligibility {eligible, tier, reasons[], goals[], skin_types[]}}` |
| GET | `/v1/retailer/segments?cohort&range` | `{filters, cohort, skin_types[{id, label, users}], goals[{id, label}], cells[{skin, goal, users, unmet, best, runner_up}]` (best/runner_up `{product_id, product, brand, rate, n}`), `by_skin[{skin, label, users, top_goals[{goal_id, label, share}], top_products[{product_id, product, brand, image_url, rate, n, lift}], conflict_share}]}` |
| GET | `/v1/retailer/brands?cohort&range` | `{filters, cohort, brands[{brand, products, users, n, rate, lo, hi, cont8, routine_share}], note}` |
| GET | `/v1/retailer/brands/{brand}?cohort&range` | 404 unknown (case-insensitive, URL-encoded). `{filters, cohort, brand, products: Row[], goals[{goal_id, label, brand {rate, n, lo, hi}\|null, market {rate, n}\|null, best_competitor {brand, rate, n}\|null, rank, of}], share[{category, label, brand_share, users}], switching {won[{brand, n}], lost[{brand, n}], net}, positioning[{brand, rate, cont8, users, is_self}], skin[{skin, label, brand_rate, market_rate, n}], note}` |
| GET | `/v1/retailer/brief?cohort&range&brand=` | 404 unknown brand. `{filters, cohort, cards[{id, kind: win\|risk\|opportunity\|trend\|gap, title, body, value, unit, n, link {section: products\|categories\|segments\|competitors\|demand\|promote, id?}}], summary {text, validated: true}\|null}`; cards deterministic (brand-centric with `brand`), summary from Gemini (<= 60 words, every number must be in the cards, cached; null on failure). `summary_pending: bool`: the cards never wait on Gemini (at most 1.5 s); while the summary is being written the page asks again |
| GET | `/v1/retailer/eligibility` | proof-gated promotion (sign-in, guest ok): `{products: [{product_id, product, brand, tier, eligible, reasons[], goals[], skin_types[], evidence}]}`, always cohort=mixed, range=all (`app/retail_intel.py`); 503 `insights_unavailable` when the evidence can't be read |
| POST | `/v1/retailer/campaigns` | `{product_id, workspace: 'retailer'\|catalog brand, goals[] (1-8 goal ids), skin_types[] (within the eligible skin types; [] = all eligible), days: 7\|14\|30, placement?: 'routine', holdout_pct?: 0.1-0.5 (default 0.2)}` -> 201 `Campaign`; 422 `{code: not_eligible, message, reasons[]}` (product not `proven`, a goal or skin type outside its evidence, no eligible skin type, or a brand workspace promoting another brand); 422 `bad_request` unknown workspace; 404 unknown product; 429 `too_many_active` past 3 running per owner (or the daily cap, 20) |
| GET | `/v1/retailer/campaigns` | mine, newest first: `{campaigns: Campaign[]}`. `Campaign` = `{id, workspace, product_id, goals, skin_types, placement, holdout_pct, status: active\|paused\|ended (ended once ends_at passed, or ended early by the owner), days, starts_at, ends_at, created_at, product, brand, category, image_url, stats: {reach, impressions, clicks, adds, ctr, daily: [{day, impressions, clicks, adds}], incrementality: {exposed: {n, added, rate}, holdout: {n, added, rate}, lift, lift_lo, lift_hi} \| null, incrementality_note}}`. `reach` = unique people shown the card at least once (members marked `seen` on their first counted impression); delivery counts are shown as counted (once per person per day for each kind; never split by goal or skin type); `ctr` = clicks / impressions (null at 0 impressions); `incrementality` null until both groups have 10 members (within groups of 10+, `added` and `rate` shown as every retail rate; lift CI = diff +- 1.96 sqrt(p1(1-p1)/n1 + p2(1-p2)/n2), 2 dp) |
| PATCH/DELETE | `/v1/retailer/campaigns/{id}` | owner only (others get 404): `{status: active\|paused\|ended}` -> `Campaign` (resuming re-checks the evidence and the cap: 422/429; `ended` stops it now and for good: ends_at moves to now; 409 `ended` on any change once ended) / DELETE -> 204 (stats and members go too) |
| GET | `/v1/sponsored?placement=routine` | `{item: {campaign_id, product_id, product, brand, image_url, category, evidence, cohort_label, label: 'Sponsored', matched: {goals[], skin_type \| null}, disclosure} \| null}`: running campaigns whose product is still eligible and not in the person's routine (any entry), goals overlapping `profile.goals`, `profile.skin_type` in the campaign's `skin_types` (or, when empty, in the product's eligible skin types; no skin type never matches); rotated by hash(uid + day); the person is assigned once to `exposed`/`holdout` per campaign (hash(campaign_id + uid) < holdout_pct = holdout; a holdout member gets the next match or null). null with `profile.hide_sponsored`, no goals, or the evidence unavailable |
| POST | `/v1/sponsored/{campaign_id}/events` | `{kind: impression\|click\|add}` -> 204; each person counts once per day per kind; a click or add only after that day's impression, an add only with the product in the routine; 404 unknown campaign; 60 a day |
| — | `POST /v1/routine` addition | a catalog product added by any path marks `added: true` on the person's membership in every running campaign for it (holdout attribution) |

`SessionView` = `{session, result: AnalysisResult, labels: {candidate_id: label}, explanation: Explanation}`.

`Explanation` (Gemini, structured):
```json
{
  "headline": "1 real change since your baseline",
  "items": [{"metric_id": "redness", "summary": "...", "quoted_numbers": ["-0.8", "0.86"]}],
  "next_steps": ["..."],
  "disclaimer": "Cosmetic appearance tracking, not a diagnosis."
}
```
Validator: every number in `summary` must appear in the metrics JSON sent to Gemini; otherwise regenerate once, then fall back to a template.

## 4. Firestore data model (Niwin owns)

```
users/{uid}
  display_name, created_at, goal, is_demo,
  consent: {version, accepted_at, aggregate_insights_opt_in}
  profile: {goals: string[] (<= 3 of dark_spots|even_tone|redness|blemishes|pores_texture|lines|
             under_eye|oil_glow), photo_time: morning|midday|evening|null, display_name: string|null (<= 60),
             skin_type: oily|combination|dry|normal|sensitive|null,
             checkin: {days: int[] (0 = Mon .. 6 = Sun), time: "HH:MM", tz: IANA name} | null, updated_at,
             hide_sponsored: bool (default false; Routine's sponsored card off)}
users/{uid}/sessions/{session_id}
  site, capture_mode, n_frames, created_at, status: uploading|processing|done|failed,
  frame_uris[], is_baseline, result (AnalysisResult), labels{}, explanation{}
  content_types[], frame_md5s[] (GCS MD5 per frame, null if missing; written by GET .../objects,
    used for duplicates across sessions), frame_seq (highest frame_N used; names never reused),
  stage: received|engine|explaining|null (written by the analysis while processing)
users/{uid}/baselines/{site}
  session_id, created_at, metrics: {metric_id: {mean, mdc95, n_frames}}
users/{uid}/advisor_messages/{id}          (newest 200 kept; removed by DELETE /v1/me and "New chat")
  role: user|willow, text, created_at, photos (user: count only, photos never stored),
  reply (willow: {message, blocks[], product_ids[], follow_up_suggestions[], retrieval[], checks})
users/{uid}/usage/{yyyy-mm-dd}
  advisor, routine_check, label_scan, retailer_ask, analyze, sample_runs (daily counters)
users/{uid}/routine/{entry_id}
  product_id | null, custom_name, brand, inci[], key_actives[], started_at, ended_at,
  applied_sites[], source: catalog|label_scan|manual
  schedule: {kind: daily|alternate|days, days?: int[] (0=Mon..6=Sun), anchor: YYYY-MM-DD} | null
    (alternate = every other day from anchor; null = every day), created_at, updated_at
users/{uid}/product_tests/{test_id}
  entry_id | null, product_id | null, name, site_pair: forearm, started_at (YYYY-MM-DD),
  length_days (7-56), ended_at | null, created_at, updated_at
users/{uid}/push/{sha256(endpoint)[:32]}
  endpoint, keys: {p256dh, auth}, created_at, updated_at        (Web Push subscriptions, one per device)
users/{uid}/reminders_sent/{YYYY-MM-DD}
  day, at                                                       (created once per local day: reminder dedupe)
products/{product_id}
  brand, name, category, concerns[], key_actives[{name, pct}], inci[],
  price: {amount, currency}, size, region[], image_url,
  stores: [{store, url, region, price: {amount, currency, checked: 'YYYY-MM-DD'} | null}],
  source_url, last_verified
  (stores[].price, added Oct 15: the price that store's own page showed for the same product
   and size on `checked`, in the page's currency; null when not verified. Never estimated,
   converted or copied between stores. The top-level `price` is unchanged. Served as-is by
   GET /v1/catalog/search, GET /v1/catalog/{product_id} and advisor product cards.)
campaigns/{campaign_id}                      (proof-gated promotion, api only; c_ + 12 hex)
  owner_uid, workspace ('retailer' | brand name), product_id, goals[], skin_types[] ([] = every eligible skin type),
  placement: 'routine', status: active|paused|ended (ended is also computed from ends_at), days (7|14|30),
  holdout_pct (default 0.2), starts_at, ends_at, created_at, updated_at, ended_early? (true when the owner ended it)
campaigns/{campaign_id}/daily/{YYYY-MM-DD}
  day, impressions, clicks, adds                                (people per day, Increment)
campaigns/{campaign_id}/seen/{sha256(uid + ":" + day)[:32]}
  day, impression, click, add (bools)                           (once per person per day per kind)
campaigns/{campaign_id}/members/{sha256(uid)[:32]}
  group: exposed|holdout, first_day, added, added_day?, seen?, seen_day?  (randomised holdout; created once;
                                                                seen = shown the card at least once: reach)
  (queries: owner_uid ==, status == : single-field, automatic indexes; no composite index)
```
Security rules: users read/write only their own `users/{uid}/**`; `products` read-only for signed-in users; demo users read-only.

## 5. BigQuery (Niwin owns)
Dataset `willow_insights` (us-central1). Tables: `sessions_flat` (one row per session x metric, pseudonymous user hash, region, skin-tone band, skin type, goals), `users_flat` (one row per person: goals, skin type, started_at, first/last reading, last week), `goals_monthly` (person x month with a reading: the goals that month), `routine_flat` (started/stopped week), `routine_conflicts` (rule-table findings incl. `duplicate_active`, `none` when clear), `products` (+ goals). Loaded by `api/scripts/export_bq.py` (WRITE_TRUNCATE, idempotent) from Firestore (opted-in people only: `users/{uid}.consent.aggregate_insights_opt_in`; goals and skin type from `users/{uid}.profile`) + the synthetic cohort generator (`is_synthetic = true` on every synthetic row; shown on every chart). Goals are the app's 8 goal ids; older rows with catalog concerns are mapped to them on read.

## 6. Shared naming
- Session IDs: `s_{yyyymmdd}_{8 random}`.
- Sites and metric IDs exactly as above (snake_case).
- Times: ISO 8601 UTC in JSON; display in local time.
