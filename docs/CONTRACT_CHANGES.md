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
