# Metrics: definitions, formulas, priorities (owner: Harshini)

All metrics are computed by classical CV in `engine/`. No model training. Gemini never computes a metric.

## Shared pipeline
1. **Decode.** DNG via `rawpy`: `postprocess(gamma=(1,1), no_auto_bright=True, use_camera_wb=False, user_wb=[1,1,1,1], output_color=rawpy.ColorSpace.raw, output_bps=16)` gives linear camera RGB. JPEG/HEIC (uncalibrated mode): decode with Pillow / pillow-heif, linearize sRGB (inverse gamma).
2. **Card.** Detect the 24-patch ColorChecker (`colour-checker-detection`, or OpenCV `mcc` from opencv-contrib). Fallback: let the user tap 4 card corners (UI) and pass them as metadata (stretch).
3. **Color correction.** Fit a 3x3 matrix (least squares, optionally + white-balance diagonal first) from measured patch means (linear camera RGB) to reference linear sRGB (D65) values for "ColorChecker24 - After November 2014" from `colour-science`. Report mean ΔE2000 on patches after correction -> `quality.card_delta_e_mean`.
4. **Convert** corrected linear sRGB -> XYZ -> CIELAB (D65) with `colour-science`.
5. **Landmarks.** MediaPipe Face Landmarker (478 points, `face_landmarker.task`, downloaded at build). ROIs as landmark polygons: forehead, left/right cheek, nose, chin, left/right under-eye, crow's feet L/R, nasolabial L/R, T-zone, U-zone. Exclusion masks: eyes, brows, lips, nostrils, hairline band.
6. **Skin mask.** Inside ROIs, drop specular pixels (L* > ROI p99) and deep shadows (L* < ROI p1), and hair (dark thin structures via morphological black-hat).
7. **Alignment across frames/sessions.** Similarity transform from landmarks to the first frame (face). Forearm: tape-corner markers or card-relative coordinates.
8. **Aggregation.** Each metric computed per frame, then mean and SD across frames that passed gates.
9. **MDC.** `mdc95 = 1.96 * sqrt(2) * within_session_sd`. Verdict vs baseline per `docs/CONTRACT.md` 2.4.

## The 11 parameters (build order = priority)

| P | id | Formula / method | Site | Confidence |
|---|---|---|---|---|
| A1 | `tone_ita` | ITA = atan2(L* - 50, b*) * 180/pi, median over cheek ROIs (forearm: square ROI). Extras: L*, b*, ITA band (very light >55, light 41-55, intermediate 28-41, tan 10-28, brown -30-10, dark <-30), Monk estimate (rough mapping, label "estimate"). | face, cheek_macro, forearm | measured, descriptive only |
| A2 | `redness` | Mean a* over cheek+nose ROIs (forearm: square). Extra: erythema index EI = 100*(log10(1/G) - log10(1/R)) on linear corrected RGB. | face, cheek_macro, forearm | measured |
| A3 | `tone_evenness` | SD of per-ROI median L* across 6-8 ROIs + mean within-ROI SD of a melanin proxy (MI = 100*log10(1/R_lin) style, or L*/b* contrast). Lower = more even. | face | measured |
| A4 | `pigment_spots` | Melanin-proxy map; subtract ROI median (tone-relative); local contrast; `skimage.feature.blob_log` or adaptive threshold; report area % of skin mask, count, mean contrast. Threshold k * MAD of the person's own skin, never an absolute L*. With 2+ passed photos, only spots that another photo of the session also shows (within 3 mm after aligning the photos on face landmarks) count toward the value; every spot stays a candidate with `features.seen_in_fraction`. | face, cheek_macro | measured |
| A5 | `pores` | Macro only. High-pass luminance (DoG), `blob_log` dark blobs 0.05-0.3 mm (scale from cone/known card size), density per cm2, mean diameter. | cheek_macro, nose_macro | measured |
| A6 | `texture` | Macro only. Energy of Laplacian / Gabor bank on L* within skin mask, normalized by mean L*. Auto-downgrade to indicative if mdc95 > 25% of value. | cheek_macro | measured* |
| B1 | `dark_circles` | Under-eye ROI minus cheek ROI: ΔL* (value), Δa*, Δmelanin proxy (extras). Relative to own cheek, works across tones. | face | measured |
| B2 | `blemishes` | Candidate blobs: local a* elevation (redness above ROI median + k*MAD) combined with shading contrast; size filter; output count + `candidates[]` crops (64-128 px + 3x context crop) for Gemini labelling. With 2+ passed photos the count uses only blemishes another photo also shows (same rule as `pigment_spots`). Nose macro also reports `blackheads` (small dark blobs). | face, cheek_macro, nose_macro | indicative |
| C1 | `lines` | Frangi / Hessian ridge filter on L* in forehead, crow's feet and nasolabial ROIs + Gabor orientation prior; line pixel density. Gate on neutral expression. | face | indicative |
| C2 | `shine` | Specular fraction in T-zone vs U-zone: pixels with high V and low S in HSV (or dichromatic separation). Capture at a fixed time after washing. | face | indicative |
| C3 | `glow` | Composite of mean L* (vs own baseline), chroma, and inverse of fine-scale luminance variance. Change only. | face | indicative |

Tiers: **A = must** (M2/M3), **B = should** (M3/M4), **C = only if time** (M4). Cut C first.

## Not shown (by design)
Hydration (RGB can't measure water), firmness/sagging, skin age, UV spots, porphyrins, eye bags (optional Gemini label only).

## Validation (feeds the science slide)
- 5 repositioned captures per site -> within-session SD and MDC95 for every metric.
- DHA split-forearm: treated vs control ΔITA, Δb*, ΔL* vs MDC over 0/1/4/24/48/72 h.
- Tan line (inner vs outer forearm) as a same-day positive control.
- Per skin-tone group: landmark failure rate, gate rejection rate, MDC per metric.
