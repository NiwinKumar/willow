# Kickoff prompt: PRODUCT (Niwin)

Paste everything below the line into Claude Code, opened at the repo root.

---

You are my pair programmer for the **product** side of SkinProof, a hackathon project (Google Cloud AI Builder Cup 2026, theme Retail & Commerce). Deadline Oct 18, 2026. I own `api/`, `web/`, `infra/`. My teammate owns `engine/` (image pipeline) and we connect only through `docs/CONTRACT.md`.

## Read first, in this order
1. `CLAUDE.md`, `api/CLAUDE.md`, `web/CLAUDE.md`
2. `docs/CONTRACT.md`, `schemas/*.json`, `fixtures/analysis_result.sample.json`
3. `docs/SPLIT.md` (my tasks + milestones), `docs/PLAN.md`, `docs/DEMO_PLAN.md`, `infra/README.md`
Summarize back in 10 bullets what you will build and in what order, then wait for my "go".

## What I'm building
1. **web/** React + Vite + TypeScript + Tailwind on Firebase Hosting, Firebase Auth (Google + anonymous for judges). Mobile-first, works great on iPhone Safari, good on desktop.
2. **api/** Python 3.12 FastAPI on Cloud Run (`skinproof-api`): verifies Firebase ID tokens (firebase-admin), issues V4 signed upload URLs (signed with the service account via IAM signBlob, no key file), calls the engine (`ENGINE_URL`, ID-token auth; mock mode `ENGINE_MODE=fixture` returns the fixture), writes Firestore, calls **Gemini on Vertex AI** using the `google-genai` SDK with `vertexai=True`, `location=us-central1`, model from env `GEMINI_MODEL` (latest GA Flash available on Vertex AI; verify the exact ID in the Vertex AI Model Garden).
3. **Gemini features** (all structured output with response schemas, temperature 0-0.3):
   - **Candidate labeller:** for each engine candidate crop, label one of the enum in CONTRACT 2.6 + confidence; run twice, keep agreeing labels, else `uncertain`. Never produce numbers.
   - **Explanation:** input = metrics JSON + verdicts + routine; output = `Explanation` schema. Validator rejects any number not present in the input; retry once, then template fallback.
   - **Label scan:** product photo -> brand, name, INCI list, key actives (+ % if printed).
   - **Routine compatibility check:** routine INCI lists -> conflicts (e.g., retinoid + strong AHA/BHA same routine, benzoyl peroxide + vitamin C/retinoid, multiple exfoliants), duplicated actives, likely cancel-outs, gaps vs the user's goal. Cosmetic guidance only, with "check with a dermatologist if irritated".
   - **Advisor chat:** function calling with tools `get_my_metrics()`, `get_my_routine()`, `search_catalog(concern, max_price, exclude_ingredients)`, `compare_products(ids)`; answers grounded only in returned catalog items; every product shows **multi-store links** (user chooses the store).
4. **Firestore** model + security rules exactly as CONTRACT section 4. Catalog seeded from `api/seed/products.json` (40-60 real SKUs, global brands, ingredients, concerns, price, store links; facts only).
5. **Retailer view:** BigQuery dataset `skinproof_insights` loaded by `api/scripts/export_bq.py` (Firestore -> flat rows) + `api/scripts/synthetic_cohort.py` (500 synthetic users with effect sizes sampled from our measured MDC/noise; `is_synthetic=true` on every row). Looker Studio report + an in-app `/retailer` page using `GET /v1/retailer/insights`: what customers need next, which products help which profiles (measured outcomes), brand/category performance, assortment gaps, routine-conflict rates. Banner: "Synthetic demo cohort".
6. **Judge mode:** landing with 3 buttons (Explore a real journey / Try with sample photos / Try your own selfie). Seeded read-only demo user with real team sessions (DHA arm timeline etc.). Sample photo pack downloadable from `demo/` in GCS.

## Screens (web)
Landing -> Consent (versioned, aggregate-insights opt-in, delete-my-data) -> Goal picker -> Capture guide (site picker, checklist: card visible, distance, light, neutral face; DNG upload via Files; or browser selfie = uncalibrated) -> Processing (progress) -> Report (grouped metrics, confidence chips "Measured/Indicative", verdict badges "Real change / Within noise / No baseline", overlays toggle, Gemini explanation, disclaimer) -> Timeline/compare (metric chart with shaded MDC band, before/after slider, treated vs control) -> Routine (label scan, list, compatibility check) -> Advisor chat -> Retailer dashboard -> About/science. Calm, inclusive, no "bad skin" wording.

## Build order (show me results after each step)
1. **M1 today:** deploy `api` hello (`/healthz`) and the engine placeholder (`engine/app/main.py` already returns the fixture) to Cloud Run; web shell on Firebase Hosting; Auth working; `POST /v1/sessions` returns signed URLs; upload a DNG from iPhone Safari to GCS and verify the object is byte-identical (not converted to JPEG).
2. **M2:** Firestore model + rules; analyze flow with `ENGINE_MODE=fixture`; Report page from fixture; label scan.
3. **M3 (Thu 14:00):** switch to the real engine; end-to-end on a real DNG.
4. **M4:** candidate labeller, explanation + validator, routine check, advisor with function calling, timeline UI, retailer dashboard, judge mode, seeded data.
5. **M5:** polish, error states, loading states, accessibility pass, README section for the submission.

## Rules
- Follow `CLAUDE.md`. Gemini never outputs measurements. Validate every Gemini response against its schema.
- Never commit secrets, images, or `.env*`. Use ADC locally (`gcloud auth application-default login`) and service accounts on Cloud Run.
- Keep the engine contract untouched; propose changes in `docs/CONTRACT_CHANGES.md`.
- Tests: pytest for api routes (with fixture engine + mocked Gemini), a Playwright or Vitest smoke test for the main web flow if time allows.
- After each step: lint, test, show me how to verify manually, and propose a commit message.
