# CLAUDE.md (repo-wide rules for Claude Code)

Project: SkinProof, a hackathon entry (Google Cloud AI Builder Cup 2026, Retail & Commerce). Deadline: Oct 18, 2026. Two developers. Speed and a working end-to-end demo matter more than perfection.

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
