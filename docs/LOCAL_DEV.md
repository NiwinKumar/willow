# Local development and environment

## Ports
engine 8081 | api 8080 | web 5173 | Firebase emulators (optional): Auth 9099, Firestore 8085, UI 4000.

## Auth to Google Cloud
```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project <PROJECT_ID>
```
No key files. Cloud Run uses service accounts `sa-engine` and `sa-api`.
Signed upload URLs are signed with IAM signBlob as `sa-api`. Locally the api impersonates `sa-api` (set `SIGNING_SERVICE_ACCOUNT=sa-api@willow-511508.iam.gserviceaccount.com`; your user needs `roles/iam.serviceAccountTokenCreator` on it, which project Owner already has).

## engine (Harshini)
```bash
cd engine && uv sync && uv run pytest
uv run uvicorn app.main:app --reload --port 8081
uv run python -m app.cli analyze --site forearm_treated --mode calibrated_raw ../data/forearm/*.dng --out ../data/out
```
Env: `BUCKET` (optional for local), `LOG_LEVEL`.

## api (Niwin)
```bash
cd api && uv sync && uv run pytest
AUTH_MODE=dev ENGINE_MODE=fixture uv run uvicorn app.main:app --reload --port 8080   # health: GET /v1/health
```
Env vars:
| Var | Example | Notes |
|---|---|---|
| PROJECT_ID | willow-511508 | |
| BUCKET | willow-511508-captures | |
| ENGINE_MODE | fixture / http | fixture returns `fixtures/analysis_result.sample.json` |
| ENGINE_URL | https://willow-engine-hrlt7lqdwa-uc.a.run.app | private; api adds an ID token |
| GEMINI_MODEL | gemini-3.8-flash | latest GA Flash (GA Sep 2, 2026) |
| VERTEX_LOCATION | global | Gemini 3.x GA models are served only from the global endpoint; everything else stays in us-central1 |
| BQ_DATASET | willow_insights | |
| ALLOWED_ORIGINS | http://localhost:5173,https://willow-511508.web.app,https://willow-511508.firebaseapp.com | CORS |
| DEMO_USER_ID | demo_willow | read-only seeded account |

## web (Niwin)
```bash
cd web && npm install && npm run dev
```
`web/.env.local` (never committed): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_API_URL`.

## Testing strategy
- engine: synthetic arrays with known answers per metric; synthetic card for calibration; schema validation for every response; one golden real DNG test kept OUT of git (runs only if `data/golden/` exists).
- api: pytest with `ENGINE_MODE=fixture` and a mocked Gemini client; schema validation of Gemini outputs; number-validator unit tests.
- web: Vitest for utilities; one Playwright smoke test (landing -> demo journey -> report) if time.
- Before each merge: `ruff check`, `pytest` / `npm run lint && npm run build`.

## End-to-end test (real pipeline, from a laptop)
Runs everything except Firebase sign-in for real: uploads land in the bucket, the deployed engine measures them, Firestore stores them. The test person is deleted before and after.

1. api in end-to-end mode (in `.claude/launch.json` as `api-e2e`):
   `cd api && AUTH_MODE=dev DEV_UPLOADS=true ENGINE_MODE=http ENGINE_URL=https://willow-engine-hrlt7lqdwa-uc.a.run.app ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174 uv run uvicorn app.main:app --port 8080`
   - `AUTH_MODE=dev` trusts the `X-Dev-Uid` header (never set on Cloud Run).
   - `DEV_UPLOADS=true` points upload links at the api itself (`/v1/dev/upload`), which writes to the real bucket with your ADC, so no Token Creator grant is needed.
   - The engine call uses `gcloud auth print-identity-token` when ADC cannot mint an ID token.
2. Script: `cd api && uv run python scripts/e2e.py --dng <forearm.dng> --jpeg <forearm.jpg> [--label <label.jpg>]`. 19 checks: real engine measures RAW and quick photos, first session becomes the baseline, one-photo baseline has no noise band, quick selfies get their own baseline, face sessions are saved but never show numbers, timeline, catalog images, manual baseline, delete my data.
3. Website: `web-e2e` in `.claude/launch.json` (`VITE_AUTH_MODE=dev VITE_DEV_UID=e2e_browser VITE_API_URL=http://localhost:8080 npx vite --port 5174`). The web skips Firebase sign-in and sends `X-Dev-Uid`. Put test photos in `web/public/__e2e/` (gitignored, never committed) and feed them to file inputs from the browser console with a `DataTransfer`.

Test photos stay out of git (`*.dng`/`*.jpg` are ignored); keep them in a scratch folder.

## Deploy
See `infra/README.md`. Engine image builds from the repo root via `infra/cloudbuild.engine.yaml`.
