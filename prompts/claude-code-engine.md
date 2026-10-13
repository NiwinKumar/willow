# Kickoff prompt: ENGINE (Harshini)

Paste everything below the line into Claude Code, opened at the repo root.

---

You are my pair programmer for the **engine** of SkinProof, a hackathon project (Google Cloud AI Builder Cup 2026). Deadline Oct 18, 2026. I own `engine/` only.

## Read first, in this order
1. `CLAUDE.md` (repo rules) and `engine/CLAUDE.md`
2. `docs/CONTRACT.md` and `schemas/*.json` (the interface I must return; do NOT change it)
3. `docs/METRICS.md` (formulas, priorities A/B/C)
4. `docs/CAPTURE_PROTOCOL.md`, `docs/SPLIT.md` (my tasks and milestones)
Then summarize back to me in 10 bullets what you will build and in what order, and wait for my "go".

## What the engine is
A stateless Python service + CLI. Input: 1-5 photos of one skin site (iPhone DNG with a 24-patch color card, or uncalibrated JPEG/HEIC). Output: an `AnalysisResult` JSON (schema-valid) with quality gates, 11 cosmetic metrics, per-metric within-session SD and MDC95, verdicts against an optional baseline, blemish/spot candidate crops, overlays. No database, no Gemini, no model training. Classical CV only.

## Tech
- Python 3.12 (fall back to 3.11 only if a dependency has no 3.12 wheel), `uv`, FastAPI, uvicorn, pydantic v2, numpy, `rawpy`, `opencv-contrib-python-headless`, `scikit-image`, `colour-science`, `colour-checker-detection`, `mediapipe` (Face Landmarker task, model file downloaded at build into `engine/models/`, git-ignored), `pillow`, `pillow-heif`, `google-cloud-storage`, `jsonschema`, `pytest`, `ruff`.
- Pin versions in `uv.lock`. Prefer releases at least two weeks old.

## Package layout to create
```
engine/
  pyproject.toml, Dockerfile, README.md
  app/
    main.py          FastAPI: GET /healthz, POST /v1/analyze
    cli.py           `python -m app.cli analyze --site ... --mode ... <files> --out <dir>`
    config.py        thresholds (quality gates, k for MAD thresholds, ROI definitions)
    models.py        pydantic models mirroring schemas/ (AnalyzeRequest, AnalysisResult, Metric, ...)
    io.py            load frames from local path or gs://, write crops/overlays to output_prefix or local dir
    decode.py        DNG -> linear camera RGB (rawpy); JPEG/HEIC -> linear sRGB
    calibrate.py     card detection, CCM fit, ΔE2000 residual, apply CCM, -> Lab
    landmarks.py     MediaPipe Face Landmarker, ROI polygons, exclusion masks, pose (yaw/pitch/roll)
    quality.py       sharpness, clipping, pose, card gates -> reasons
    align.py         similarity transform across frames
    metrics/
      tone.py        tone_ita, tone_evenness
      redness.py     redness (+ erythema index)
      pigment.py     pigment_spots
      pores.py       pores (macro)
      texture.py     texture (macro)
      eye.py         dark_circles
      blemish.py     blemishes + candidates (+ blackheads on nose_macro)
      lines.py       lines            (tier C)
      oil_glow.py    shine, glow      (tier C)
    aggregate.py     per-frame -> mean, SD, MDC95, delta, verdict, direction
    pipeline.py      orchestrates everything for one request
  tests/
    test_contract.py   fixture + generated outputs validate against schemas/analysis_result.schema.json
    test_calibrate.py  synthetic card image -> CCM recovers known matrix; ΔE small
    test_metrics_*.py  synthetic Lab arrays with known answers per metric
    test_aggregate.py  MDC and verdict logic
```

## Build order (stop and show me results after each step)
1. **Day-1 smoke test:** a script that opens one of my DNGs from `data/` with rawpy using linear settings (see `docs/METRICS.md`), prints shape, black/white levels, and saves a quick-look PNG to `data/out/`. If rawpy fails on the file, tell me exactly what to change in the capture app.
2. **Calibration:** detect the ColorChecker; fit CCM to "ColorChecker24 - After November 2014" reference (colour-science, D65 linear sRGB); report mean ΔE2000 per frame; save an annotated PNG of detected patches. Unit test with a synthetic card.
3. **Forearm metrics (M1):** for `forearm_*` sites the ROI is the taped square (start with a manual rectangle via CLI args `--roi x,y,w,h`; later auto-detect the tape corners). Compute `tone_ita` (+ L*, b*) and `redness`. CLI prints a table and writes JSON.
4. **Contract + API (M2):** pydantic models, `/v1/analyze`, `jsonschema` validation of every response in tests, gs:// IO, multi-frame aggregation, MDC95 and verdicts, quality gates.
5. **Face pipeline (M2):** landmarks, ROIs, masks, pose, alignment; `tone_ita`, `redness`, `tone_evenness`, `pigment_spots` for `face_full`.
6. **Macro (M3):** `pores`, `texture` for `cheek_macro` (scale from cone; make it a config value I measure), `nose_macro` blackheads.
7. **B tier (M3/M4):** `dark_circles`, `blemishes` + candidate crops (64-128 px + 3x context) written to `output_prefix/crops/`.
8. **Overlays:** PNG overlays for redness, pigment_spots, pores, blemishes.
9. **C tier only if I say so:** lines, shine, glow.
10. **Dockerfile** for Cloud Run (python:3.12-slim, download the MediaPipe .task at build, non-root user, `uvicorn app.main:app --host 0.0.0.0 --port $PORT`). Keep the image as small as possible.

## Rules
- Every number comes from deterministic code. Same input -> same output.
- Thresholds are relative to the person's own skin (median + k*MAD), never absolute L* cut-offs. Never encode "lighter is better".
- In `uncalibrated` mode force every metric's `confidence` to `indicative` and add a warning.
- Quality failures return 200 with `quality.passed=false`, not an exception.
- Never commit images. Read test photos from `data/` (git-ignored) or GCS.
- Don't edit `schemas/` or `docs/CONTRACT.md`. If something in the contract is impossible, write a proposal in `docs/CONTRACT_CHANGES.md` and tell me.
- Keep each function small and tested; I'm learning as we go, so explain non-obvious CV choices in 1-2 lines of comments.
- After each step: run `ruff` and `pytest`, show me the output, and suggest the commit message.

## Done (for the hackathon)
`/v1/analyze` deployed on Cloud Run, handling `face_full`, `cheek_macro`, `forearm_*` in < 20 s for 5 frames, schema-valid, with A and B tier metrics, MDC from my 5-frame baseline captures, and a `scripts/validation_report.py` that prints the MDC table and the DHA treated-vs-control time series for the science slide.
