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
| GET | `/v1/sessions/{id}/objects` | Size and MD5 of each uploaded frame |
| POST | `/v1/sessions/{id}/analyze` | Checks frames are uploaded, calls the engine with the stored baseline, saves the result and a template explanation, sets the auto baseline |
| GET | `/v1/timeline?site=` | Per-metric series |
| POST | `/v1/baselines/{site}` | `{session_id}`: pick the baseline by hand |
| DELETE | `/v1/me` | Delete the person's photos, results, sessions, baselines and routine |
| GET | `/v1/catalog/search?q=&concern=&category=&max_price=&currency=` | Catalog search (facts only) |
| GET | `/v1/catalog/{product_id}` | One product |
| POST | `/v1/label-scan` | `{images:[{mime_type, data_base64}]}` -> `{scan, match}` via Gemini; saves nothing |
| GET/POST | `/v1/routine` | List / add entries (catalog facts win for a `product_id`) |
| POST | `/v1/routine/check` | Compatibility: rule table (`source: rule`) plus validated Gemini additions (`source: model`) |
| POST | `/v1/advisor/chat` | `{messages:[{role, text}]}` -> `{message, products, follow_up_suggestions, retrieval, remaining_today}`; 20 a day |
| PATCH/DELETE | `/v1/routine/{id}` | Stop (`ended_at`) or move AM/PM / remove a mistaken entry |

`SessionView.session` also carries `measured` (false when the engine returned a placeholder; `result` is then null), `baseline` (`{session_id, frames, has_noise_band}` of the baseline this session is compared with, same site and capture mode), `preview` (signed URL of the engine's `{output_prefix}preview.jpg` when it exists, sized to `image_size`), `overlay_urls`, `hours_since_baseline`, `note`, `deviation`, `error` and `explanation_source` (`template` until the Gemini explanation lands, then `gemini`).

## Engine modes
- `ENGINE_MODE=fixture`: answers from `app/contract/analysis_result.sample.json`, filtered to the site's metrics, varied a little per session, with the baseline verdict rules applied. `engine_version` ends in `-fixture` and `warnings[]` says the numbers are a sample.
- `ENGINE_MODE=http`: POSTs to `$ENGINE_URL/v1/analyze` with an ID token (none for `http://localhost`), 120 s timeout. Both the request and the response are checked against the JSON schemas.

`app/contract/` holds copies of `schemas/*.json` and the fixture because the image is built from `api/` only; a test fails if they drift.

## Gemini and the catalog
- `app/gemini.py`: `generate_json(prompt_id, contents, Schema, instructions=...)`. System rules on every call, JSON against a pydantic schema, `thinking_level=LOW` (the lowest Gemini 3.8 Flash accepts), one retry, then `GeminiError` for the caller's fallback. Logs prompt id, latency and token counts only.
- Catalog: `seed/products.json`, built from the sheet by `scripts/import_catalog.py` (see `docs/CATALOG_SPEC.md`).

End-to-end test against the real bucket, engine and Firestore: `scripts/e2e.py`, see `docs/LOCAL_DEV.md`. `/v1/dev/*` routes exist only with `AUTH_MODE=dev` and `DEV_UPLOADS=true`.

Deploy: see `infra/README.md`.
