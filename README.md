# SkinProof

**The proof engine for skincare.** SkinProof turns standardized phone photos into calibrated skin measurements and tells you whether a product *measurably* changed your skin, beyond the noise of the camera. Multi-brand retailers get outcome-based personalization and assortment insights.

Built for the **Google Cloud AI Builder Cup 2026** (Hack2skill), theme **Retail & Commerce: Intelligent Customer and Business Experiences**. Built Oct 12-18, 2026.

> Cosmetic appearance tracking. Not a medical device and not a diagnosis.

## How it works (one paragraph)
Users capture RAW (DNG) photos with a color card in frame (or a quick "uncalibrated" selfie). A Python **engine** on **Cloud Run** decodes RAW, color-corrects against the card, finds face landmarks, and computes 11 cosmetic skin parameters. Every change is tested against the person's own measured noise floor (MDC95), so the app only says "real change" when it is real. An **api** service on Cloud Run stores results in **Firestore** and uses **Gemini on Vertex AI** to label CV-detected regions, explain results, read ingredient labels, check routine compatibility, and act as a catalog-grounded shopping advisor with multi-store links. A **Firebase**-hosted web app is the UI. Anonymized outcomes flow to **BigQuery** and a **Looker Studio** retailer dashboard (demo cohort is labeled synthetic).

## Repo layout
| Path | Owner | What |
|---|---|---|
| `engine/` | Harshini | Python image pipeline + FastAPI service (Cloud Run) |
| `api/` | Niwin | Python FastAPI: sessions, uploads, Gemini, catalog, retailer insights (Cloud Run) |
| `web/` | Niwin | React + Vite + TypeScript web app (Firebase Hosting) |
| `infra/` | Niwin | GCP / Firebase setup scripts |
| `docs/` | both | Plan, split, contract, capture protocol, metrics, demo |
| `schemas/` | both (change only by agreement) | JSON Schemas for the engine contract |
| `fixtures/` | both | Sample engine output for mocking |
| `prompts/` | both | Kickoff prompts for Claude Code |

## Start here
1. Read `docs/SPLIT.md` (who does what, today's tasks).
2. Read `docs/CONTRACT.md` (the interface between engine and api).
3. Open Claude Code at the repo root and paste your prompt from `prompts/`.

## Never commit
Photos of people, RAW files, credentials, `.env` files, service-account keys. Images live in Cloud Storage only. See `data/README.md`.
