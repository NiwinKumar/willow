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
9. **MDC.** `mdc95 = max(1.96 * sqrt(2) * sd, t(0.975, n-1) * sd * sqrt(1 + 1/n))` with `sd = max(within_session_sd, MIN_SD[metric])` (`engine/app/config.py`). The second term is the 95% prediction interval for one new photo: an SD from 2-3 photos is itself uncertain, and with z = 1.96 alone a 2-photo baseline called noise a real change about 1 time in 4 (simulated, Oct 14). The floor stops identical values (a count that did not move) from giving a band of 0. A band needs at least 3 passed photos (`MIN_FRAMES_FOR_BAND`): from 2 the spread is so uncertain that bands came out at hundreds of degrees; with fewer the SD is reported but there is no band and no verdict. Verdict vs baseline per `docs/CONTRACT.md` 2.4; the api does not compare across engine minor versions, nor blemish/dark-spot counts between a 1-photo and a 2+-photo session.

## The 11 parameters (build order = priority)

| P | id | Formula / method | Site | Confidence |
|---|---|---|---|---|
| A1 | `tone_ita` | ITA = atan2(L* - 50, b*) * 180/pi from L* and b* taken as each cheek's own median, then the mean of the cheeks (pooling a lit and a shaded cheek swung ITA by 6 degrees between photos; per cheek 1.9). Forearm: square ROI, white-paper corrected; "measured" only when every photo had the paper, else indicative. Extras: L*, b*, ITA band (very light >55, light 41-55, intermediate 28-41, tan 10-28, brown -30-10, dark <-30), Monk estimate (rough mapping, label "estimate"). | face, cheek_macro, forearm | measured, descriptive only |
| A2 | `redness` | Face: mean of the per-ROI median a* over cheeks and nose, each region weighted equally (forearm: median a* over the square). Extra: erythema index EI = 100*(log10(1/G) - log10(1/R)) on linear corrected RGB. | face, cheek_macro, forearm | measured |
| A3 | `tone_evenness` | SD of per-ROI median L* across 6-8 ROIs + mean within-ROI SD of a melanin proxy (MI = 100*log10(1/R_lin) style, or L*/b* contrast). Lower = more even. | face | measured |
| A4 | `pigment_spots` | Melanin-proxy map; subtract ROI median (tone-relative); local contrast; `skimage.feature.blob_log` or adaptive threshold; report area % of skin mask, count, mean contrast. Threshold k * MAD of the person's own skin, never an absolute L*. With 2+ passed photos, only spots that another photo of the session also shows (within 3 mm after aligning the photos on face landmarks) count toward the value; every spot stays a candidate with `features.seen_in_fraction`. | face, cheek_macro | measured |
| A5 | `pores` | Close-ups only (`engine/app/metrics/pores.py`). `blob_log` on how much darker each pixel is than the skin within 0.5 mm, in units of this person's own skin texture (never an absolute L*); dark round blobs 0.05-0.3 mm; pores in a straight row (a hair or crease), near a blemish or dark spot, or at the skin's edge are dropped. Value = pores per cm2; extras mean diameter, count, `px_per_mm`, `scale_from`. Needs 20 px/mm (40 when the scale is assumed). | cheek_macro, nose_macro | measured when the iris sets the scale, else indicative |
| A6 | `texture` | Close-ups only (`metrics/texture.py`). RMS of the scale-normalised Laplacian of L* at 0.4 mm (bumps, enlarged pores) over the skin 1.5 mm in from its edge, divided by mean L* so the same roughness reads the same at every tone. 0.4 mm because at 0.1 mm two photos of the same skin differed 33-54% (it measured camera sharpness), at 0.4 mm 2-8%. Needs 10 px/mm (40 when the scale is assumed). Indicative if mdc95 > 25% of value. | cheek_macro | measured* |
| B1 | `dark_circles` | Built Oct 14. Per visible side: median L* of under-eye skin (ROI ∩ hair-free face skin) minus the same side's cheek; mean of the sides. Extra: Δa*. Skipped when under 20 mm² of under-eye skin is visible. Relative to own cheek, so it works across tones and cancels exposure (session SD 0.8 L* on laptop selfies). | face | indicative (faces have no colour reference) |
| B2 | `blemishes` | Candidate blobs: local a* elevation (redness above ROI median + k*MAD) combined with shading contrast; size filter; output count + `candidates[]` crops (64-128 px + 3x context crop) for Gemini labelling. With 2+ passed photos the count uses only blemishes another photo also shows (same rule as `pigment_spots`). (Blackhead detection was removed from nose close-ups, Oct 15.) | face, cheek_macro, nose_macro | indicative |
| C1 | `lines` | Frangi / Hessian ridge filter on L* in forehead, crow's feet and nasolabial ROIs + Gabor orientation prior; line pixel density. Gate on neutral expression. | face | indicative |
| C2 | `shine` | Specular fraction in T-zone vs U-zone: pixels with high V and low S in HSV (or dichromatic separation). Capture at a fixed time after washing. | face | indicative |
| C3 | `glow` | Composite of mean L* (vs own baseline), chroma, and inverse of fine-scale luminance variance. Change only. | face | indicative |

Tiers: **A = must** (M2/M3), **B = should** (M3/M4), **C = only if time** (M4). Cut C first.

## Face regions and fairness (Oct 14)
- Region statistics use the region's hair-free skin (beard, stubble, brows and hair removed by the face-skin refinement) when at least half of the region is left.
- Dark-spot L* thresholds scale with the person's own skin lightness, `(L*skin + 16) / (60 + 16)`, never above 1: a mark that reflects 25% less light is a 4.5 L* step at L* 30 and a 7.5 step at L* 70, so fixed steps missed it on deep skin.
- The sharpest passed front photo is the reference (spots, crops, regions, preview). A hand over a cheek or the nose fails the photo (`occlusion_suspected`); over the chin or forehead it is cut out.
- Side-view sessions are not compared with a front-on baseline.

## Close-ups (Oct 15, `engine/app/pipeline_macro.py`)
- A close-up is a phone photo of one cheek or the nose, about a hand's width away (10-15 cm), with one eye still in view. Face landmarks (found on the photo, or on it shrunk onto a plain canvas when only part of the face shows) give the region: cheek = between the lower lids and the mouth corners, outside the nose wings, both cheeks if in view; nose = the nose without nostril openings. Hair (darker and greyer than the region), nostrils and clipped glare are cut by colour; lit and shaded skin both stay.
- Scale: the visible iris (11.7 mm in nearly all adults) gives px per mm, so pores and texture are "measured". Without an eye, the face mesh's size (indicative). A true macro shot with no face: skin by colour, scale assumed from `MACRO_FIELD_WIDTH_MM` (30 mm across the long edge) until `scripts/macro_scale.py` measures it from a ruler photo; pores and texture stay indicative and the result says the scale is assumed. A photo with no face that cannot be a macro shot (a front-camera lens in its EXIF, or no camera EXIF at all, as the web app's camera saves) fails as `face_not_found`.
- Metrics: cheek = tone_ita, pigment_spots, redness, blemishes, pores, texture; nose = blemishes, pores. Colours are never "measured" (no colour reference). Photos without enough detail still give the colour metrics and say "pores need a closer photo". The web camera asks for its 4K frame for close-ups.

## Face map: following a mark across sessions (Oct 14)
- Every face candidate carries where it sits on MediaPipe's canonical face (`engine/app/facemap.py`): the mark's barycentric weights in the face-mesh triangle around it, applied to the same triangle of the canonical mesh (read from the face model file). Pose, tilt and camera distance drop out; on 5 laptop selfies of one session the same mark landed a median 0.7-2.4 mm apart with no alignment.
- Features (numbers only, as the contract's `features` are): `face_x_mm` (negative = the subject's right), `face_y_mm` (up), `zone` (1-based index into `config.FACE_ZONES`: forehead, nose, right_cheek, left_cheek, around_mouth, chin, right_jaw, left_jaw), `diameter_mm` (on the skin surface, from the triangle's own scale). Marks more than 5 mm off the mesh have none of these.
- Canonical millimetres are an average adult face, not the person's: they say "same place as last time", not how big the face is. The engine stays per session; the api matches marks across sessions (`api/app/tracks.py`).
- Spot diary (`GET /v1/spots`, `api/app/tracks.py`): passed front-view face sessions, oldest first. Marks are paired session to session within 4 mm on the canonical face (closest pairs first). Hair, pores, moles, freckles and scars (Gemini's labels) are never followed. Slow to conclude, because detection flickers: a mark is shown once two sessions show it (or two photos of one session); it is "gone" only after 2 good sessions in a row without it; one missed session is "not seen last time". How long a mark was visible is a range (last seen .. first missing); marks there at the first session say nothing about duration. A zone's typical time needs 3 faded marks; a new mark within 6 mm of one that faded "came back". Every number comes from dates and engine features; Gemini only names what a crop shows. Research notes: Do et al. 2008 (acne lesion tracking on aligned photos), SORT-style track keeping, Kaplan-Meier-style censoring (shown as "at least").

## Forearm (Oct 14)
- DNG BaselineExposure is applied when decoding (phone DNGs decoded about 2x too dark otherwise).
- Pen dots must clearly beat the skin's other spots (every spot but the 8 strongest) and no spot of similar strength may sit inside the square; white paper must be colourless in linear light, brighter than the skin, sheet-sized and level with the skin. Without paper the reading is a trend.

## Not shown (by design)
Hydration (RGB can't measure water), firmness/sagging, skin age, UV spots, porphyrins, eye bags (optional Gemini label only).

## Validation (feeds the science slide)
- 5 repositioned captures per site -> within-session SD and MDC95 for every metric.
- DHA split-forearm: treated vs control ΔITA, Δb*, ΔL* vs MDC over 0/1/4/24/48/72 h.
- Tan line (inner vs outer forearm) as a same-day positive control.
- Per skin-tone group: landmark failure rate, gate rejection rate, MDC per metric.
