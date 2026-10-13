# Kickoff prompt: PRODUCT (Niwin)

Open Claude Code at the repo root (`willow/`) and paste everything below the line.

---

You are my senior pair programmer for the **product** side of **Willow**, a hackathon project for the Google Cloud AI Builder Cup 2026, theme **Retail & Commerce: Intelligent Customer and Business Experiences**. Deadline Oct 18, 2026 (we submit Sat Oct 17 night IST). I own `api/`, `web/`, `infra/`. My teammate Harshini owns `engine/` (the image pipeline). We connect only through `docs/CONTRACT.md` and `schemas/`; the integration checkpoint is **Thu Oct 15, 14:00 IST**.

## The knowledge base has everything
The `docs/` folder (indexed in `CLAUDE.md`) is the complete, authoritative specification: product brief, decision log, contract, UX spec, Gemini spec, catalog spec, retailer insights, local dev, risks, demo and submission plans. Treat it as the source of truth. Do not invent features, fields or flows that aren't there. If something is ambiguous or missing, stop and ask me with a concrete proposal. If docs conflict, `docs/DECISIONS.md` wins, then `docs/CONTRACT.md`.

## Read first (in order), then report back
1. `CLAUDE.md`, `api/CLAUDE.md`, `web/CLAUDE.md`
2. `docs/PRODUCT.md`, `docs/DECISIONS.md`
3. `docs/CONTRACT.md`, `schemas/*.json`, `fixtures/analysis_result.sample.json`
4. `docs/UX_SPEC.md`, `docs/GEMINI_SPEC.md`, `docs/CATALOG_SPEC.md`, `docs/RETAILER_INSIGHTS.md`
5. `docs/SPLIT.md` (my tasks, milestones, cut order), `docs/LOCAL_DEV.md`, `docs/RISKS.md`, `docs/DEMO_PLAN.md`, `docs/SUBMISSION.md`, `infra/README.md`, `infra/setup.sh`, `infra/firestore.rules`
Then give me: (a) a 10-bullet summary of what I'm building, (b) the build plan mapped to M1-M5 with a rough hour estimate per item, (c) questions or contradictions. Wait for my "go".

## What I'm building
1. **web/**: React + Vite + TypeScript + Tailwind, Firebase Hosting, Firebase Auth (Google + anonymous for judges). Mobile-first (iPhone Safari is the main device), good on desktop. Screens, states and copy exactly per `docs/UX_SPEC.md`.
2. **api/**: Python 3.12 FastAPI on Cloud Run (`willow-api`). Verifies Firebase ID tokens (`firebase-admin`); issues V4 signed PUT URLs signed via IAM signBlob (no key files); calls the engine (`ENGINE_MODE=fixture|http`, `ENGINE_URL`, Google ID-token auth to the private service); owns Firestore; all Gemini calls; BigQuery exports; endpoints exactly as CONTRACT section 3.
3. **Gemini on Vertex AI** with the `google-genai` SDK (`vertexai=True`, `location=us-central1`, model from `GEMINI_MODEL`; look up and pin the latest GA Flash model ID in Vertex AI Model Garden). Five features per `docs/GEMINI_SPEC.md`: candidate labeller, explanation with number validator, label scan, routine compatibility check (rule table), advisor with function calling (tools listed in the spec). Structured output + schema validation everywhere. Gemini never outputs measurements.
4. **Firestore** model exactly as CONTRACT section 4; rules from `infra/firestore.rules`; catalog seeded from `api/seed/products.json` built per `docs/CATALOG_SPEC.md`.
5. **Retailer view** per `docs/RETAILER_INSIGHTS.md`: batch export to BigQuery `willow_insights`, synthetic cohort generator (`is_synthetic=true`), Looker Studio report, in-app `/retailer` page from `GET /v1/retailer/insights`, "Synthetic demo cohort" banner, groups < 10 hidden.
6. **Judge mode** per `docs/DEMO_PLAN.md`: landing with 3 buttons, seeded read-only demo user `demo_willow` with real team sessions (DHA arm timeline), sample photo pack from `gs://<bucket>/demo/`.
7. **infra/**: run/finish `setup.sh`, deploy scripts, budgets, CORS tightened to our Hosting domains.

## Build order (stop after each step: show how to verify manually, run lint/tests, propose a commit message)
1. **M1 (today):** repo tooling (uv for api, Vite app for web, ruff, eslint/prettier); deploy `willow-api` `/healthz` and the engine placeholder to Cloud Run; web shell on Firebase Hosting; Auth working; `POST /v1/sessions` returns signed URLs; upload a DNG from iPhone Safari (via Files) to GCS and prove it's byte-identical (size + MD5).
2. **M2 (Wed):** Firestore model + rules; session + analyze flow with `ENGINE_MODE=fixture`; Report screen from the fixture with confidence chips, verdict badges and copy from `UX_SPEC.md`; label scan; catalog import script + 40-60 SKUs.
3. **M3 (Thu 14:00):** switch to the real engine (`ENGINE_MODE=http`), grant `roles/run.invoker`, end-to-end on a real DNG; baseline logic (first passing 5-frame calibrated session per site).
4. **M4 (Fri):** candidate labeller, explanation + validator, routine check, advisor chat with tools and multi-store product cards, timeline/compare (MDC band, slider, treated vs control), retailer dashboard + BigQuery + Looker, judge mode with seeded data.
5. **M5 (Sat 12:00 freeze):** error/empty/loading states, accessibility pass, performance (cold starts), README submission section, help me draft the deck and description from `docs/SUBMISSION.md`.

## Non-negotiable rules
- Follow `CLAUDE.md`. Gemini never produces numbers, skin tone, age or diagnoses; every Gemini response is schema-validated; explanation numbers must exist in the input.
- Inclusive, calm copy; tone is descriptive only; cosmetic disclaimer on every report.
- Never commit secrets, `.env*`, images or keys. ADC locally; service accounts on Cloud Run.
- Don't edit `engine/`, `schemas/` or `docs/CONTRACT.md`; propose changes in `docs/CONTRACT_CHANGES.md`.
- Keep costs near zero: `min-instances=0`, `max-instances=3`, Flash model, cache explanations.
- Tests: pytest for every api route with fixture engine + mocked Gemini; number-validator tests; a Playwright smoke test (landing -> demo journey -> report) if time allows.

## Definition of done (hackathon)
Public link where a judge, without installing anything, can explore the seeded journey, upload sample photos and get a real analysis, see Gemini explanations, scan a label, run a routine check, chat with the advisor (multi-store links) and view the retailer dashboard. Repo public and clean, deck and video ready, description pasted.
