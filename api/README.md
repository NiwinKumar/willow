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
| DELETE | `/v1/me` | Delete the person's photos, results, sessions and baselines |

`SessionView.session` also carries `preview` (signed URL of the engine's `{output_prefix}preview.jpg` when it exists, sized to `image_size`), `overlay_urls`, `hours_since_baseline`, `note`, `deviation`, `error` and `explanation_source` (`template` until the Gemini explanation lands, then `gemini`).

## Engine modes
- `ENGINE_MODE=fixture`: answers from `app/contract/analysis_result.sample.json`, filtered to the site's metrics, varied a little per session, with the baseline verdict rules applied. `engine_version` ends in `-fixture` and `warnings[]` says the numbers are a sample.
- `ENGINE_MODE=http`: POSTs to `$ENGINE_URL/v1/analyze` with an ID token (none for `http://localhost`), 120 s timeout. Both the request and the response are checked against the JSON schemas.

`app/contract/` holds copies of `schemas/*.json` and the fixture because the image is built from `api/` only; a test fails if they drift.

Deploy: see `infra/README.md`.
