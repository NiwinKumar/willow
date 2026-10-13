# CLAUDE.md (repo-wide rules for Claude Code)

Project: Willow, a hackathon entry (Google Cloud AI Builder Cup 2026, Retail & Commerce). Deadline: Oct 18, 2026. Two developers. Speed and a working end-to-end demo matter more than perfection.

## Knowledge base (read before doing anything)
The `docs/` folder is the complete, authoritative knowledge base for this project. It contains every product decision, the interface contract, formulas, UX, Gemini behavior, data model, infra, testing, risks and submission plan. Do not invent requirements; if something is genuinely not covered, ask the human instead of guessing.

| Doc | What it holds |
|---|---|
| `docs/PRODUCT.md` | What Willow is, users, problem evidence, MVP features, non-goals, rubric mapping, business model |
| `docs/DECISIONS.md` | Decision log (latest wins; superseded choices listed) |
| `docs/SPLIT.md` | Ownership, prerequisites, milestones M1-M5, day-by-day tasks, cut order |
| `docs/CONTRACT.md` + `schemas/` + `fixtures/` | Engine <-> api <-> web interface, Firestore model, BigQuery, naming |
| `docs/METRICS.md` | Pipeline steps, the 11 parameters, formulas, tiers, validation |
| `docs/CAPTURE_PROTOCOL.md` | How photos are taken, settings, consent |
| `docs/UX_SPEC.md` | Screens, states, copy rules, per-metric wording |
| `docs/GEMINI_SPEC.md` | Every Gemini feature: inputs, output schemas, validators, rule table, tools |
| `docs/CATALOG_SPEC.md` | Product catalog fields, enums, concern->metric mapping |
| `docs/RETAILER_INSIGHTS.md` | Retailer questions, BigQuery tables, synthetic cohort spec, Looker |
| `docs/LOCAL_DEV.md` | Ports, env vars, local runs, testing strategy |
| `docs/RISKS.md` | Known pitfalls and mitigations |
| `docs/DEMO_PLAN.md`, `docs/SUBMISSION.md` | Demo test, judge flow, video, deck, description |
| `docs/GLOSSARY.md` | Terms (ITA, MDC, CCM, DNG...) |
| `infra/` | `setup.sh`, Firestore rules, Cloud Build config, deploy commands |

## Source of truth
- `docs/CONTRACT.md` and `schemas/*.json` define the engine <-> api interface. Do NOT change them unless the human explicitly says the change is agreed by both owners. If you think a change is needed, write it in `docs/CONTRACT_CHANGES.md` as a proposal and stop.
- `docs/METRICS.md` defines metric IDs, formulas and units.
- `docs/SPLIT.md` defines ownership. Only edit files inside your owner's folders (`engine/` for Harshini; `api/`, `web/`, `infra/` for Niwin) plus docs explicitly assigned.

## Non-negotiable product rules
1. Classical computer vision computes every number. Gemini NEVER produces a measurement, score, skin tone, skin age, or diagnosis.
2. Gemini output must be structured JSON validated against a schema. Explanations may only quote numbers present in the input; reject outputs containing new digits.
3. Every metric is relative to the person's own baseline and skin median. Never rank people by lightness. No "lighter = better" language anywhere.
4. Cosmetic language only. No disease names in UI. Moles -> "not a medical assessment; see a dermatologist for changing moles".
5. Never commit images, RAW files, secrets, or keys. Use Application Default Credentials and service accounts.
6. Region: `us-central1` for all GCP resources.

## Engineering conventions
- Python 3.12 (fallback 3.11 if a dependency lacks 3.12 wheels), `uv` for env management, `ruff` for lint/format, `pytest` for tests, pydantic v2 models mirroring `schemas/`.
- Web: React + Vite + TypeScript + Tailwind, Firebase JS SDK v10+.
- Small PRs, one feature per branch, branch names `engine/<feature>` or `web/<feature>` or `api/<feature>`.
- Pin dependency versions in lockfiles. Prefer versions that have been released for at least two weeks.
- Write a short test for every metric and every endpoint.
