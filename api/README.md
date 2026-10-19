# api (owner: Niwin)

FastAPI service `willow-api` on Cloud Run. Contract: `docs/CONTRACT.md` section 3. Env vars: `docs/LOCAL_DEV.md`.

```bash
cd api && uv sync && uv run pytest && uv run ruff check .
AUTH_MODE=dev ENGINE_MODE=fixture uv run uvicorn app.main:app --reload --port 8080
curl -s localhost:8080/v1/health
```

`AUTH_MODE=dev` trusts an `X-Dev-Uid` header for local work; the deployed service verifies Firebase ID tokens.
Signed upload URLs are signed with IAM signBlob as `sa-api` (locally your user impersonates it; no key files).

## Routes
| Method | Path | What it does |
|---|---|---|
| GET | `/v1/health` | Health (unauthenticated) |
| POST | `/v1/sessions` | New session + signed PUT URLs |
| GET | `/v1/sessions?site=` | Every session, oldest first, as `SessionView`s with signed previews (the scrubber) |
| GET | `/v1/sessions/{id}` | One `SessionView`, with signed overlay URLs |
| PATCH | `/v1/sessions/{id}` | `{note?, deviation?}` |
| POST | `/v1/sessions/{id}/upload-urls` | Fresh signed PUT URLs for a retry |
| GET | `/v1/sessions/{id}/objects` | Size and MD5 of each uploaded frame, and `duplicate_of` (same MD5 as a frame of an earlier session) |
| POST | `/v1/sessions/{id}/frames` | Add photos: an edit before analyze, or a baseline top-up (status back to `uploading`) |
| DELETE | `/v1/sessions/{id}/frames/{index}` | Remove a photo before analyze |
| POST | `/v1/sessions/{id}/analyze` | Checks frames are uploaded, calls the engine with the stored baseline, saves the result and a template explanation, sets the auto baseline; writes `stage` as it goes; `?force=1` measures a done session again |
| GET | `/v1/timeline?site=` | Per-metric series |
| POST | `/v1/baselines/{site}` | `{session_id}`: pick the baseline by hand |
| GET | `/v1/me` | The person's stored consent |
| PUT | `/v1/me/consent` | `{version, aggregate_insights_opt_in}` -> `users/{uid}.consent` (the web syncs it once signed in) |
| GET | `/v1/retailer/insights` | Public aggregates from BigQuery (synthetic cohort + opted-in people), groups under 10 suppressed |
| DELETE | `/v1/me` | Delete the person's photos, results, sessions, baselines, routine and routine use log |
| GET | `/v1/catalog/search?q=&concern=&category=&max_price=&currency=` | Catalog search (facts only) |
| GET | `/v1/catalog/{product_id}` | One product |
| POST | `/v1/label-scan` | `{images:[{mime_type, data_base64}]}` -> `{scan, match}` via Gemini; saves nothing |
| GET/POST | `/v1/routine?today=` | List / add entries (catalog facts win for a `product_id`); listed entries carry `recent_use` `{days_used, of_days}` over the last 2 weeks from the first tick (null if nothing ticked), counted to the person's own `today` |
| GET | `/v1/routine/log?from=&to=` | Days with "used" ticks (default last 14 days, max 92) |
| PUT/DELETE | `/v1/routine/log/{day}/{entry_id}/{am\|pm}` | Tick / untick a product as used on the person's own day (idempotent; ticks up to 30 days back, only for its slots and dates; unticking always allowed) |
| POST | `/v1/routine/check` | Compatibility: rule table (`source: rule`) plus validated Gemini additions (`source: model`) |
| POST | `/v1/advisor/chat` | `{messages:[{role, text}]}` -> `{message, products, follow_up_suggestions, retrieval, remaining_today}`; 20 a day |
| PATCH/DELETE | `/v1/routine/{id}` | Stop (`ended_at`) or move AM/PM / remove a mistaken entry (its ticks go too) |

`SessionView.session` also carries `measured` (false when the engine returned a placeholder; `result` is then null), `baseline` (`{session_id, frames, has_noise_band}` of the baseline this session is compared with, same site and capture mode), `preview` (signed URL of the api's small `preview.webp` of the engine's `{output_prefix}preview.jpg`, else the JPEG, when it exists, sized to `image_size`; `app/previews.py`), `overlay_urls`, `hours_since_baseline`, `note`, `deviation`, `error` and `explanation_source` (`template` until the Gemini explanation lands, then `gemini`).

## Engine modes
- `ENGINE_MODE=fixture`: answers from `app/contract/analysis_result.sample.json`, filtered to the site's metrics, varied a little per session, with the baseline verdict rules applied. `engine_version` ends in `-fixture` and `warnings[]` says the numbers are a sample.
- `ENGINE_MODE=http`: POSTs to `$ENGINE_URL/v1/analyze` with an ID token (none for `http://localhost`), 120 s timeout. Both the request and the response are checked against the JSON schemas.

`app/contract/` holds copies of `schemas/*.json` and the fixture because the image is built from `api/` only; a test fails if they drift.

## Gemini and the catalog
- `app/gemini.py`: `generate_json(prompt_id, contents, Schema, instructions=...)`. System rules on every call, JSON against a pydantic schema, `thinking_level=LOW` (the lowest Gemini 3.8 Flash accepts), one retry, then `GeminiError` for the caller's fallback. Logs prompt id, latency and token counts only.
- Catalog: `seed/products.json`, built from the sheet by `scripts/import_catalog.py` (see `docs/CATALOG_SPEC.md`).

Judge mode data (sample photos, the seeded journey): `uv run python scripts/seed_demo.py --help`. Samples live in `gs://<bucket>/demo/samples/` with a manifest; the api re-reads it within 5 minutes.

Check-in photos analysed before the api wrote `preview.webp`: `uv run python scripts/backfill_previews.py [--uid <uid>] --apply` writes it from their `preview.jpg` (the demo account by default; dry run without `--apply`).

After the engine starts measuring a new site (face, close-ups): `uv run python scripts/remeasure.py [--site face_full] --apply` measures the photos saved before, oldest first, so the earliest becomes each person's baseline (dry run without `--apply`).

End-to-end test against the real bucket, engine and Firestore: `scripts/e2e.py`, see `docs/LOCAL_DEV.md`. `/v1/dev/*` routes exist only with `AUTH_MODE=dev` and `DEV_UPLOADS=true`.

Deploy: see `infra/README.md`.
