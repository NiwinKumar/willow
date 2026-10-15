# Contract change proposals

Add a section per proposal. Both owners approve before anyone edits `schemas/` or `docs/CONTRACT.md`.

Template:
## YYYY-MM-DD: short title (proposed by NAME)
- Why:
- Change:
- Impact on engine / api / web:
- Approved by: [ ] Harshini [ ] Niwin

## 2026-10-13: Aligned preview image in AnalysisResult (proposed by Niwin)
- Why: browsers cannot render DNG. The Report overlay toggle, the before/after slider and the timeline compare all need a viewable image in the same pixel frame as `overlays[]` and `rois[]`.
- Change: add optional top-level `preview` to `AnalysisResult`: `{"uri": "gs://.../results/{uid}/{session}/preview.jpg", "width": int, "height": int}`. sRGB JPEG of the aligned reference frame, long edge <= 1600 px; `rois`/`candidates.bbox`/overlay PNGs scale by `preview.width / image_size.width`. Null when no frame passed decoding.
- Impact: engine writes one extra JPEG per request (cheap); api turns the gs:// URI into a signed GET URL in `SessionView`; web draws overlays on it. Schema: one new optional object; `schema_version` 1.1.
- Approved by: [ ] Harshini [x] Niwin

### What this is about, in plain words (for Harshini)
Browsers can only display JPEG and PNG, never a DNG. Your engine already decodes and aligns the frames to compute the metrics, so the web app needs one small JPEG of that aligned reference frame to draw the overlays on, to show before/after, and to cross-fade between sessions. Without it, the Report has numbers but no picture. The cheapest way (1b below) is a file written by convention next to the overlays you already write: no schema change, about 15 lines, and it also applies to the CLI output so the seeded demo gets previews too. Paste-ready instructions for Claude Code are in `prompts/harshini-preview-jpg.md`.

### 1b. Same need, zero schema change (fallback if 1 is not agreed in time)
- Change: by convention the engine also writes `{output_prefix}preview.jpg`: an sRGB JPEG of the aligned reference frame at exactly `image_size` (or at an integer downscale; the api reads the JPEG's own dimensions and scales `rois`, `candidates[].bbox` and overlay PNGs by `preview_width / image_size.width`). No new field; `schema_version` stays 1.0. The CLI writes the same file into `--out`.
- Engine effort: about 15 lines (convert the aligned reference frame to sRGB, `cv2.imwrite`, upload). Needed for the Report overlay toggle, the before/after slider and the timeline compare; without it browsers have nothing to draw on because they cannot render DNG.
- api behaviour: if the file is missing, the Report shows metrics without the photo stage and says "Preview not available for this session".
- Approved by: [ ] Harshini [x] Niwin

## 2026-10-13: Forearm square localization for API requests (proposed by Niwin)
- Why: the CLI takes `--roi x,y,w,h`, but `AnalyzeRequest` has no way to say where the taped forearm square is. For the hackathon the DHA series will be run through the CLI and seeded into the demo account, so this is not blocking M3. It matters only if a judge or user uploads forearm photos through the app.
- Change (minimal): add optional `options.roi: [x, y, w, h]` (pixel coords of the first frame). If absent for a forearm site, the engine either detects the tape corners or returns `quality.passed=false` with a new reason `roi_not_found`.
- Impact: engine reads one optional field; api passes it through when the web provides a tap-to-select rectangle (M4 stretch); schema: one optional array + one enum value.
- Approved by: [ ] Harshini [x] Niwin

## 2026-10-13: Convention for grey-card (semi-calibrated) sessions (proposed by Niwin)
- Why: the color checker may arrive after the DHA baseline. `capture_mode` only has `calibrated_raw` and `uncalibrated`. The UI needs to say "partially calibrated" honestly without a schema change.
- Change (no schema change): engine adds the exact warning string `semi_calibrated: white-balance-only correction (grey card)` to `warnings[]` and sets `quality.card_detected=false`, `card_delta_e_mean=null`. The api stores a `calibration: "semi"` flag on the session and the web shows a "Grey-card calibrated" chip next to "Measured".
- Approved by: [ ] Harshini [x] Niwin

## 2026-10-13: /healthz is unreachable on Cloud Run URLs (observation, proposed by Niwin)
- Why: on both deployed services, `GET /healthz` is answered by Google's frontend with an HTML 404 before the request reaches the container; every other path works. Verified with and without identity tokens.
- Change: none to the schemas. The api exposes its health at `/v1/health`. For the engine, the api never calls `/healthz`; if you want a reachable health route, add `GET /v1/health` with the same body and keep `/healthz` for local use.
- Approved by: [ ] Harshini [x] Niwin

## 2026-10-13: api-only additions to `SessionView.session` (note, no engine impact)
- What: `SessionView.session` carries `preview` (signed GET URL of `{output_prefix}preview.jpg` when the engine wrote one, else null), `overlay_urls` (signed), `hours_since_baseline`, `note`, `deviation`, `error`, `explanation_source` (`template` | `gemini`). New api routes: `PATCH /v1/sessions/{id}`, `POST /v1/sessions/{id}/upload-urls`, `GET /v1/sessions?site=`, `DELETE /v1/me` (all listed in DESIGN.md section 8 as api work with no contract change).
- Impact on the engine: none. The api reads `preview.jpg` only if it exists, so it works with or without proposal 1b.
- Approved by: n/a (api and web are both Niwin's)

## 2026-10-13: Baseline rule and placeholder handling in the api (note for Harshini, no schema change)
- Baseline (CONTRACT.md section 3 says "auto: first passing 5-frame calibrated session"): now the first *measured* session with passing quality, per site **and** capture mode, any frame count. Firestore: `baselines/{site}` for calibrated (as in section 4), `baselines/{site}__uncalibrated` for quick selfies. Niwin asked for this after testing: one-photo sessions never became a baseline, so nothing was ever compared. With a one-photo baseline the engine already does the right thing (delta, verdict stays `no_baseline` because `mdc95` is null) and the web says "No noise band yet".
- Placeholders: results with `engine_version` ending `-placeholder` (or a `placeholder:` warning) are stored with `measured: false` and never returned as numbers or used as a baseline.
- Asks for the engine (Harshini):
  1. The face/macro placeholder returns the fixture unchanged, including `frames_used: 5` and baked-in deltas and `real_change` verdicts even when no baseline was sent. The api now ignores it, but returning `metrics: []`, `frames_used` = frames received and `quality.passed: false` with a warning would be safer for any other caller.
  2. A RAW photo with no colour card and no white paper still gets `confidence: "measured"` and `quality.passed: true` (seen on Oct 13 with a plain iPhone DNG; warnings say colours were not corrected). Suggest `indicative`, or a quality reason, when no colour reference is found.
- Follow-up (same day, api/web only): the first session of a site asks for 5 photos (repositioned, same pose) so most baselines get a noise band; the baseline never switches automatically; when the engine starts measuring face/macro, `api/scripts/remeasure.py --apply` re-runs saved sessions oldest first so each person's earliest one becomes the baseline. Nothing changes in the engine.
- Spot labels (Oct 14, api/web only): the api reads `crop_uri` and `context_crop_uri` for each candidate (JPEG, any size; about 120 px tight and 3x context works well). Until the face pipeline writes them, candidates are simply not labelled.
- More asks for the engine (Oct 14, from testing the live judge flow; the web now works around them):
  3. With one photo and no white paper, warnings say both "colours corrected with the white paper only" and "no white reference found in some photos": please emit one or the other per session.
  4. On a forearm photo with no pen dots, the square detector locked onto arm hair and measured that patch without a warning (ITA came out -55 on the DNG vs +71 on the JPEG of the same frame). Please require four dots in a plausible 4 cm geometry, or fail with "pen-dot square not found".
- Approved by: [ ] Harshini [x] Niwin

## 2026-10-14: Face-map features on face candidates (note, no schema change; engine 0.3.1)
- What: face candidates' `features` gain `face_x_mm`, `face_y_mm`, `zone` (1-based code into `engine/app/config.py FACE_ZONES`) and `diameter_mm` (docs/METRICS.md "Face map"). `features` already allows any numeric keys, so the schema is unchanged; old results simply lack them.
- Why: the api follows each mark across sessions (spot diary: new, still there, fading, gone; new marks per zone). Matching needs a position that does not depend on head pose; photo pixels do.
- Impact: engine adds `app/facemap.py` and three lines in `_candidates`; the api reads the keys when present and re-runs old sessions with `scripts/remeasure.py --all --apply` to fill them.
- Approved by: [ ] Harshini [x] Niwin
- api/web (Niwin, no engine impact): `GET /v1/spots` returns the spot diary (`SpotDiary` in `web/src/lib/api.ts`).

## 2026-10-15: Routine use log (api/web only, no engine impact)
- What: the person can tick a routine product as used on a day (AM or PM), for Home's "routine today". `PUT` / `DELETE /v1/routine/log/{YYYY-MM-DD}/{entry_id}/{am|pm}` (idempotent, answers that day's ticks), `GET /v1/routine/log?from=&to=` (default last 14 days, at most 92). The day is the person's own calendar day (may be one ahead of UTC); ticks can be changed up to 30 days back, only for a slot the product is in, and only between its start and stop dates. `GET /v1/routine` entries gain `recent_use: {days_used, of_days}` over the last 4 weeks, so a product's outcome can say how often it was actually used.
- Firestore: `users/{uid}/routine_log/{YYYY-MM-DD}` = `{date, used: {entry_id: [slots]}, updated_at}`; deleted with the person (delete my data).
- Web: `RoutineLogDay`, `api.routineLog()`, `api.markUsed()`; no UI yet (the Home redesign uses it).
- Approved by: n/a (api and web are both Niwin's)
