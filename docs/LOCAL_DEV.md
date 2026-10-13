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
ENGINE_MODE=fixture uv run uvicorn app.main:app --reload --port 8080
```
Env vars:
| Var | Example | Notes |
|---|---|---|
| PROJECT_ID | willow-2026 | |
| BUCKET | willow-2026-captures | |
| ENGINE_MODE | fixture / http | fixture returns `fixtures/analysis_result.sample.json` |
| ENGINE_URL | https://willow-engine-xxxx.run.app | private; api adds an ID token |
| GEMINI_MODEL | (pin exact Flash model ID) | |
| VERTEX_LOCATION | us-central1 | |
| BQ_DATASET | willow_insights | |
| ALLOWED_ORIGINS | http://localhost:5173,https://<project>.web.app | CORS |
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

## Deploy
See `infra/README.md`. Engine image builds from the repo root via `infra/cloudbuild.engine.yaml`.
