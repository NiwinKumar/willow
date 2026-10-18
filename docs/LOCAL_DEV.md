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
| VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY | (Secret Manager `willow-vapid-public` / `willow-vapid-private`) | Web Push keys (base64url, raw P-256). Unset = push off and the app offers calendar reminders only; tests and fixture mode need neither. Generate a local pair with the one-liner in `infra/setup.sh` ("Check-in reminders"); never commit them |
| VAPID_SUBJECT | https://willow-511508.web.app | contact for the push services (`mailto:` or https); push needs all three VAPID values |
| APP_URL | https://willow-511508.web.app | the web app, for the calendar event's link |
| REMINDERS_AUDIENCE | https://willow-api-hrlt7lqdwa-uc.a.run.app/v1/internal/reminders | OIDC audience Cloud Scheduler's token must carry; unset = `/v1/internal/reminders` answers 503 (`AUTH_MODE=dev` skips the check) |
| SCHEDULER_SERVICE_ACCOUNT | sa-scheduler@willow-511508.iam.gserviceaccount.com | the only identity allowed to run reminders |
| REMINDER_WINDOW_MINUTES | 30 | a reminder goes out on the first scheduler run up to this long after the check-in time |

## web (Niwin)
```bash
cd web && npm install && npm run dev
```
`web/.env.local` (never committed): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_API_URL`.

Keeping a local api away from the project's Firestore: **without the Firestore emulator (it needs Java), a local api writes to the real project's Firestore**, whatever `AUTH_MODE` says. `DEV_STORE=memory` (only with `AUTH_MODE=dev`) keeps everything in that process's memory instead and starts with one demo campaign for the dev account (`e2e_local`) that has ten days of delivery and a measured holdout (`api/app/dev_seed.py`), so the campaign page has real-shaped data to draw. It resets on every restart. Use it for any local run that creates campaigns, shoppers or events: `AUTH_MODE=dev DEV_STORE=memory ENGINE_MODE=fixture uv run uvicorn app.main:app --port 8080`.

Reminders locally: with `AUTH_MODE=dev`, `curl -X POST localhost:<port>/v1/internal/reminders` runs one scheduler pass. Web Push needs a browser that allows notifications (headless Chrome denies them) and, on iPhone/iPad, Willow added to the Home Screen (iOS 16.4+). The service worker is `web/public/sw.js` (notifications only, no caching).

## Testing strategy
- engine: synthetic arrays with known answers per metric; synthetic card for calibration; schema validation for every response; one golden real DNG test kept OUT of git (runs only if `data/golden/` exists).
- api: pytest with `ENGINE_MODE=fixture` and a mocked Gemini client; schema validation of Gemini outputs; number-validator unit tests.
- web: `npm test` runs pure-function tests in `web/tests/*.test.ts` with Node's own runner (no extra dependency; Node strips the types), for example the "Looks soft" sharpness heuristic; one Playwright smoke test (landing -> demo journey -> report) if time.
- web: `npm test` (node's test runner, `web/scripts/*.test.mjs`) for pure utilities such as the check-in schedule rules; one Playwright smoke test (landing -> demo journey -> report) if time.
- Before each merge: `ruff check`, `pytest` / `npm run lint && npm run build`.

## End-to-end test (real pipeline, from a laptop)
Runs everything except Firebase sign-in for real: uploads land in the bucket, the deployed engine measures them, Firestore stores them. The test person is deleted before and after.

1. api in end-to-end mode (in `.claude/launch.json` as `api-e2e`):
   `cd api && AUTH_MODE=dev DEV_UPLOADS=true ENGINE_MODE=http ENGINE_URL=https://willow-engine-hrlt7lqdwa-uc.a.run.app ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174 uv run uvicorn app.main:app --port 8080`
   - `AUTH_MODE=dev` trusts the `X-Dev-Uid` header (never set on Cloud Run).
   - `DEV_UPLOADS=true` points upload links at the api itself (`/v1/dev/upload`), which writes to the real bucket with your ADC, so no Token Creator grant is needed. The links use `DEV_PUBLIC_URL` (default `http://localhost:8080`): on any other port, set `DEV_PUBLIC_URL=http://localhost:<port>` too, or every upload fails with a refused connection.
   - The engine call uses `gcloud auth print-identity-token` when ADC cannot mint an ID token.
2. Script: `cd api && uv run python scripts/e2e.py --dng <forearm.dng> --jpeg <forearm.jpg> [--label <label.jpg>] [--face <selfie1.jpg> ...]`. 34 checks with `--face`: real engine measures RAW and quick photos, first session becomes the baseline, one-photo baseline has no noise band, quick selfies get their own baseline, a photo without a face is reported as 'no face found', face selfies get five metrics, spot crops, Gemini spot names and the right photo under the rings, timeline, catalog images, explanation, routine check, advisor, retailer insights and question, judge status and samples, manual baseline, delete my data.
3. Website: `web-e2e` in `.claude/launch.json` (`VITE_AUTH_MODE=dev VITE_DEV_UID=e2e_browser VITE_API_URL=http://localhost:8080 npx vite --port 5174`). The web skips Firebase sign-in and sends `X-Dev-Uid`. Keep test photos outside `web/` (for example `data/e2e/`, gitignored) and load them in the dev server through Vite's `/@fs/<absolute path>` URL, then feed them to file inputs from the browser console with a `DataTransfer`. Never put photos in `web/public/`: it is deployed as-is (on Oct 14 a test forearm photo was briefly public this way), and `npm run build` now refuses to build if it finds one.

Test photos stay out of git (`*.dng`/`*.jpg` are ignored); keep them in a scratch folder.

## Deploy
See `infra/README.md`. Engine image builds from the repo root via `infra/cloudbuild.engine.yaml`.
