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
| `overlays` | array `{metric_id, uri}` | PNG heatmaps/outlines in GCS |
| `rois` | array `{name, polygon:[[x,y],...]}` | in pixel coords of the aligned reference frame |
| `image_size` | `{width, height}` | of the aligned reference frame |
| `timings_ms` | object | per stage |
| `warnings` | array of string | human-readable, non-fatal |

### 2.3 Quality
```json
{
  "passed": true,
  "card_detected": true,
  "card_delta_e_mean": 2.1,
  "sharpness": 412.5,
  "clipped_pct": 0.3,
  "pose": {"yaw": 1.2, "pitch": -2.0, "roll": 0.4},
  "per_frame": [{"index": 0, "passed": true, "reasons": []}],
  "reasons": []
}
```
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
| GET | `/v1/timeline?site=...` | per-metric series for charts |
| POST | `/v1/baselines/{site}` | mark a session as baseline (or auto: first passing 5-frame calibrated session) |
| POST | `/v1/label-scan` | image -> `{brand, product_name, inci[], key_actives[{name, pct?}], confidence}` (Gemini vision) |
| GET/POST/DELETE | `/v1/routine` | routine entries |
| POST | `/v1/routine/check` | Gemini compatibility check -> `{conflicts[], duplicates[], gaps[], notes[]}` |
| POST | `/v1/advisor/chat` | Gemini with function calling over catalog + user's metrics -> `{message, products[]}` |
| GET | `/v1/catalog/search?q=&concern=&max_price=` | catalog search |
| GET | `/v1/retailer/insights` | aggregate JSON for the in-app retailer view (BigQuery) |

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
users/{uid}/sessions/{session_id}
  site, capture_mode, n_frames, created_at, status: uploading|processing|done|failed,
  frame_uris[], is_baseline, result (AnalysisResult), labels{}, explanation{}
users/{uid}/baselines/{site}
  session_id, created_at, metrics: {metric_id: {mean, mdc95, n_frames}}
users/{uid}/routine/{entry_id}
  product_id | null, custom_name, brand, inci[], key_actives[], started_at, ended_at,
  applied_sites[], source: catalog|label_scan|manual
products/{product_id}
  brand, name, category, concerns[], key_actives[{name, pct}], inci[],
  price: {amount, currency}, size, region[], image_url,
  stores: [{store, url, region}], source_url, last_verified
```
Security rules: users read/write only their own `users/{uid}/**`; `products` read-only for signed-in users; demo users read-only.

## 5. BigQuery (Niwin owns)
Dataset `willow_insights` (us-central1). Tables: `sessions_flat` (one row per session x metric, pseudonymous user hash, region, skin-tone band, goal), `routine_flat`, `products`. Loaded by a batch script from Firestore + the synthetic cohort generator (`is_synthetic = true` on every synthetic row; shown on every chart).

## 6. Shared naming
- Session IDs: `s_{yyyymmdd}_{8 random}`.
- Sites and metric IDs exactly as above (snake_case).
- Times: ISO 8601 UTC in JSON; display in local time.
