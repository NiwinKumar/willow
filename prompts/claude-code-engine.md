# Kickoff prompt: ENGINE (Harshini)

Open Claude Code at the repo root (`willow/`) and paste everything below the line.

---

You are my senior pair programmer for the **engine** of **Willow**, a hackathon project for the Google Cloud AI Builder Cup 2026 (theme: Retail & Commerce). The deadline is Oct 18, 2026, and my integration deadline with my teammate is **Thu Oct 15, 14:00 IST**. I own `engine/` only. My teammate Niwin owns `api/`, `web/`, `infra/`. We connect only through `docs/CONTRACT.md` and `schemas/`.

## The knowledge base has everything
The `docs/` folder (indexed in `CLAUDE.md`) is the complete, authoritative specification: product, decisions, contract, metric formulas, capture protocol, risks, demo plan. Treat it as the source of truth. Do not invent requirements, metrics, thresholds or fields that aren't there. If something is ambiguous or missing, stop and ask me with a concrete proposal instead of guessing. If the docs contradict each other, `docs/DECISIONS.md` wins, then `docs/CONTRACT.md`.

## Read first (in order), then report back
1. `CLAUDE.md`, `engine/CLAUDE.md`
2. `docs/PRODUCT.md`, `docs/DECISIONS.md`
3. `docs/CONTRACT.md`, `schemas/analyze_request.schema.json`, `schemas/analysis_result.schema.json`, `fixtures/analysis_result.sample.json`
4. `docs/METRICS.md`, `docs/CAPTURE_PROTOCOL.md`
5. `docs/SPLIT.md` (my tasks, milestones M1-M5, cut order), `docs/RISKS.md`, `docs/LOCAL_DEV.md`, `docs/GLOSSARY.md`
Then give me: (a) a 10-bullet summary of what the engine must do, (b) the build plan mapped to milestones M1-M3, (c) any questions or contradictions you found. Wait for my "go" before writing code.

## What the engine is
A **stateless** Python service + CLI. Input: 1-5 photos of one skin site in one session (iPhone DNG with a 24-patch color card = `calibrated_raw`, or browser JPEG/HEIC = `uncalibrated`). Output: an `AnalysisResult` JSON that validates against the schema: quality gates, the metrics valid for that site, per-metric within-session SD and MDC95, verdicts vs an optional baseline, blemish/spot candidate crops, overlay PNGs, ROIs, timings, warnings. No database, no Gemini, no network calls except Google Cloud Storage. **No model training. Classical, deterministic computer vision only.**

## Tech (verify current stable versions before pinning; prefer releases at least two weeks old)
Python 3.12 (3.11 only if a dependency lacks wheels), `uv`, FastAPI, uvicorn, pydantic v2, numpy, `rawpy`, `opencv-contrib-python-headless`, `scikit-image`, `colour-science`, `colour-checker-detection`, `mediapipe` (Face Landmarker task; download `face_landmarker.task` at build time into `engine/models/`, git-ignored), `pillow`, `pillow-heif`, `google-cloud-storage`, `jsonschema`, `pytest`, `ruff`.

## Package layout
```
engine/
  pyproject.toml, uv.lock, Dockerfile, README.md
  app/
    main.py        FastAPI: GET /healthz, POST /v1/analyze (replace the current placeholder)
    cli.py         python -m app.cli analyze --site S --mode M <files...> --out DIR [--roi x,y,w,h] [--baseline baseline.json]
    config.py      all thresholds and constants (quality gates, k for MAD thresholds, ROI landmark index lists, macro mm-per-pixel)
    models.py      pydantic models mirroring schemas/ exactly
    io.py          read frames from local paths or gs://; write crops/overlays to output_prefix or a local dir
    decode.py      DNG -> linear camera RGB (rawpy linear settings in docs/METRICS.md); JPEG/HEIC -> linear sRGB
    calibrate.py   ColorChecker detection, CCM fit, ΔE2000 residual, apply CCM, convert to CIELAB (D65)
    landmarks.py   MediaPipe Face Landmarker (478 pts), ROI polygons, exclusion masks, head pose
    skinmask.py    skin mask inside ROIs (drop specular, shadow, hair)
    quality.py     sharpness, clipping, pose, card gates -> reason codes from the schema
    align.py       similarity transform of frames to the first frame
    metrics/       tone.py (tone_ita, tone_evenness), redness.py, pigment.py, pores.py, texture.py,
                   eye.py (dark_circles), blemish.py (blemishes + candidates + blackheads), lines.py, oil_glow.py
    aggregate.py   per-frame values -> mean, SD, MDC95, delta, verdict, direction (+ texture auto-downgrade)
    pipeline.py    orchestrates one request end to end
  scripts/
    validation_report.py   MDC table per metric/site + DHA treated-vs-control time series (CSV + PNG chart)
  tests/
    test_contract.py, test_calibrate.py (synthetic card recovers a known matrix), test_metrics_*.py (synthetic Lab arrays with known answers), test_aggregate.py (MDC/verdict), test_api.py
```

## Build order (stop after each step: show results, run ruff + pytest, propose a commit message)
1. **Smoke test (today, first):** open one of my DNGs from `data/` with rawpy linear settings; print shape, black/white levels, camera WB; save a quick-look PNG to `data/out/`. If rawpy fails, tell me exactly what to change in the capture app.
2. **Calibration:** detect the ColorChecker (fall back to manual 4-corner input via CLI flag if detection fails); fit CCM to "ColorChecker24 - After November 2014" (colour-science, D65 linear sRGB); report mean ΔE2000; save an annotated PNG. Also support white-balance-only correction from a grey card (`semi_calibrated`, adds a warning). Unit test with a synthetic card.
3. **Forearm metrics = M1 (tonight):** ROI from `--roi` (later: detect tape corners or place relative to the card). `tone_ita` (+ L\*, b\*, band, Monk estimate) and `redness` (+ erythema index). CLI prints a table and writes schema-valid JSON.
4. **Contract + API = M2:** pydantic models, `/v1/analyze`, gs:// IO, multi-frame aggregation, MDC95, verdicts vs baseline, quality gates and reason codes, jsonschema validation of every response in tests, structured logging of timings.
5. **Face pipeline = M2:** landmarks, ROIs, exclusion masks, skin mask, pose, alignment; `tone_ita`, `redness`, `tone_evenness`, `pigment_spots` for `face_full`.
6. **Macro = M3:** `pores` and `texture` for `cheek_macro` (mm-per-pixel from config, which I will measure with the cone); blackheads on `nose_macro`.
7. **B tier:** `dark_circles`; `blemishes` with candidate crops (64-128 px + 3x context) written to `output_prefix/crops/`.
8. **Overlays:** PNGs for redness, pigment_spots, pores, blemishes in `output_prefix/overlays/`.
9. **Dockerfile + deploy with Niwin (Thu by 12:00):** python:3.12-slim, model download at build, non-root, `uvicorn` on `$PORT`, built from the repo root via `infra/cloudbuild.engine.yaml` (the image needs `schemas/` and `fixtures/`). Keep it small; target < 20 s per 5-frame request on 2 vCPU / 4 GiB.
10. **Validation report** for the science slide (MDC table, DHA curves, tan-line control).
11. **C tier only when I say so:** `lines`, `shine`, `glow`.

## Non-negotiable rules
- Same input -> same output. No randomness without a fixed seed.
- Thresholds are relative to the person's own skin (median + k x MAD), never absolute L\* cut-offs. Never encode or imply "lighter is better". Tone is descriptive.
- `uncalibrated` mode: every metric `confidence = "indicative"` + a warning.
- Quality failures return HTTP 200 with `quality.passed = false` and reasons; only malformed requests/unreadable files are errors (codes in the contract).
- Never commit images or RAW files. Real photos only from `data/` (git-ignored) or GCS.
- Never edit `schemas/` or `docs/CONTRACT.md`. If the contract can't be met, write a proposal in `docs/CONTRACT_CHANGES.md` and tell me so I can agree it with Niwin.
- I'm learning CV as we go: keep functions small, add 1-2 line comments explaining non-obvious choices, and explain results in plain language when you show them.

## Definition of done (hackathon)
`/v1/analyze` deployed on Cloud Run, handling `face_full`, `cheek_macro`, `nose_macro`, `forearm_treated`, `forearm_control`; schema-valid; A and B tier metrics; MDC from my 5-frame baselines; < 20 s per request; validation report produced; tests green.
