# Engine task: face pipeline fixes found on real selfies (Oct 14)

Niwin ran the deployed face pipeline (engine `9fc4ccc`) on real saved sessions and through the app. The numbers below come from his 5-photo laptop selfie session (1760 x 1328 px, about 3.2 px/mm on the face). Paste everything below the line into your Claude Code session. Work in order: items 1 to 3 decide whether a judge's laptop selfie gets measured at all, so they matter most for the demo.

---

Read `engine/CLAUDE.md`, `docs/METRICS.md`, `docs/CONTRACT.md` and `docs/CONTRACT_CHANGES.md` first. No change to `schemas/` or `docs/CONTRACT.md` is needed for anything here. Tests use synthetic arrays only, never commit photos, keep thresholds in `app/config.py` with a one-line reason, run `ruff` and `pytest`, and make one small PR per item (branch `engine/<item>`, commit messages start with `engine:`).

What we saw on 5 laptop selfies (per photo, from `_frame()`):

| photo | sharpness | pitch | roll | result | blemishes | dark spots |
|---|---|---|---|---|---|---|
| 1 | 15.0 | 9.0 | 4.6 | blurry, pose_out_of_range | 3 | 7 |
| 2 | 11.5 | 11.3 | 5.2 | blurry, pose_out_of_range | 1 | 10 |
| 3 | 10.1 | -3.4 | 4.4 | blurry | 0 | 8 |
| 4 | 19.0 | -2.0 | 4.8 | passed | 3 | 17 |
| 5 | 25.8 | 0.6 | 4.9 | passed | 2 | 16 |

Only 2 of 5 photos were used. Of the 20 spots on photo 4, Gemini named 9 as hair or photo artefact (moustache, chin crease, nose highlight, and the fingers of a hand resting on the chin) and 11 as unclear. No skin finding was named confidently.

## 1. Head pitch limit rejects ordinary laptop selfies (high)
`MAX_ABS_PITCH = 8.0` rejected photos at 9.0° and 11.3°. A laptop camera sits above the screen and people look at the screen, so 8 to 12° of pitch is normal. Side views already allow `SIDE_MAX_PITCH = 15`. Check how far pitch can go before the ROIs (forehead band, cheeks, under-eyes) stop landing on the right skin. If 15° (or 12°) is still sound, raise the front-view limit to match, at least for `uncalibrated` sessions. Add a test with landmarks rotated to the new limit that still produces sensible ROIs.

## 2. Sharpness gate on low-resolution faces (high)
Faces are sharpness-checked at `SHARPNESS_PX_PER_MM = 4`, but `scale = min(4 / px_per_mm, 1.0)` never resizes a face that is already below 4 px/mm, so webcam and arm's-length faces (about 3.2 px/mm here) are judged at their own scale against `FACE_SHARPNESS_MIN = 15`. Photos 1 to 3 scored 10 to 15 and were rejected. Look at those values against how the photos actually look. Then either measure every face at one fixed lower scale (for example 3 px/mm, downscaling the larger faces), or make the threshold depend on px_per_mm, so a usable laptop photo passes and a genuinely smeared one still fails. Keep a synthetic test with a sharp and a blurred face patch at both scales.

## 3. `preview.jpg` for every measured session, face RAW included (high)
`prompts/harshini-preview-jpg.md` (proposal 1b) still applies, and nothing writes the file yet. RAW face reports show no photo at all because browsers cannot draw a DNG. Write `{output_prefix}preview.jpg` of the reference frame for the face and forearm pipelines. For faces, the reference is `good[0]` (the first passed front photo), the photo `rois`, `candidates[].bbox` and `image_size` describe. The api already assumes this when no preview exists: it shows the person's own JPEG of the first passed photo for faces, and the first photo whose pen-dot square was found for forearms. Keep the preview at `image_size` or an integer downscale (long edge at most 1600 px). The preview matters most when a side view passes before a front view: the api cannot tell views apart from `quality.per_frame`, so it falls back to the first passed photo, while your reference is the first passed *front* photo, and the rings land on the wrong picture. HEIC uploads have the same gap, because browsers other than Safari cannot show HEIC.

Related wording: `_align()` warns "photo N could not be lined up with photo 1" and "lines up poorly with photo 1", but the reference is `good[0]`, which can be photo 3. Use the reference photo's real number (`ref['index'] + 1`), because the web shows these warnings as they are.

## 4. A hand on the face is treated as face skin (medium)
A hand resting on the chin (a very common selfie pose) was inside the face mask, and its finger edges became blemish and dark-spot candidates. The contract already has the quality reason `occlusion_suspected`. Find skin inside the face outline that is not face: for example, compare the lower-face region's colour and texture against the cheek skin model you already build in `skin_colour()`, or check the jawline landmarks for a foreign edge. Cut that region from `face_skin`. When the cut-out is large (say more than 10% of the lower face), add `occlusion_suspected` to that photo's reasons. Test with a synthetic face mask that has a differently coloured block over the chin.

## 5. Hair and stubble still read as spots (medium)
Moustache, beard edge and a chin crease were candidates (c_001, c_020), on top of the jaw-edge hits already in your known gaps. The dark-spot search could require a roughly round shape (low elongation) and skip thin dark strokes, and the lower-face stubble test in `refine_skin` could cover the philtrum and chin, not only the jaw edges.

## 6. Dark-spot counts swing between photos of one session (medium)
Counts per photo were 7, 10, 8, 17 and 16 on the same face seconds apart, so the pigment_spots noise band is wide (mdc95 0.26 for a value of 0.79 % area). You already compute `seen_in_fraction` by aligning the photos. With 2 or more passed photos, consider counting toward `pigment_spots` (and `blemishes`) only the spots seen in at least two photos. Keep every spot as a candidate, so the web still shows them. Document the rule in `docs/METRICS.md`.

## 7. Crop sizes are fixed in pixels, not millimetres (low)
`CROP_SIZE_PX = (64, 128)` with `CROP_CONTEXT = 3` means that at 3.2 px/mm the tight crop covers about 20 mm and the context crop about 60 mm (half the face) around a 3 mm spot. Near the photo edge the crop is cut off, so the spot is no longer at the centre, and the labeller tells Gemini the spot is at the centre of both crops. Size crops from `px_per_mm` (tight about 4x the spot diameter and at least 6 mm; context 3x that). Pad with edge pixels instead of shifting the window, and upscale to at least 128 px. Niwin's test with tighter crops still gave mostly "unclear" on this laptop photo, because resolution is the real limit there, so do this after 1 to 6.

## 8. RAW face without a colour reference is labelled "measured" (low)
`pipeline_face.py` sets `confidence = "measured"` for every `calibrated_raw` face, but faces never detect a colour card or white paper (the warning says "colours as captured by the camera"). The web then calls it "calibrated". Use `indicative` until a colour reference is detected on the face. This is the same ask as item 2 under "Baseline rule" in `docs/CONTRACT_CHANGES.md`.

## Still open from earlier (in `docs/CONTRACT_CHANGES.md`)
- Asks 3 and 4: one-photo forearm sessions emit two contradictory white-paper warnings, and the forearm square detector can lock onto arm hair with no warning. Require four dots in a plausible 4 cm geometry, or fail with "pen-dot square not found".
- `docs/METRICS.md`: describe the face metrics as built (ROIs, side views, seen-in-photos matching), and mark cheek and nose close-ups as not built yet.

When each item is merged, tell Niwin. The api re-runs saved sessions with `uv run python scripts/remeasure.py --site face_full --session <id> --apply`.

---

## Round 2 (after #32 to #39 were merged and deployed, Oct 14)

Re-measured Niwin's 5-photo laptop session on the deployed engine: 5 of 5 photos used, the hand cut without failing any photo, 10 spots instead of 20, a preview written. Thank you. Two things are left:

1. **`_count_confirmed` drops a photo's count to 0 when the other photo cannot be lined up** (`pipeline_face.py`, the `others` list). With two photos where `similarity()` fails for one, `others` is empty for the photo that did line up, so all its marks count as unconfirmed and its blemish and dark-spot values become 0 while the other photo keeps its full count. The docstring says a photo that cannot be lined up "keeps all its marks". Skip the confirmation for a frame when no other frame could be mapped. Test: two photos, the second with landmarks that `similarity()` rejects; both keep their counts.
2. **The moustache and upper-lip edge still give 3 of 10 candidates** (blemish kind) on that session. A thin dark band of hair just above a red lip edge looks like a red bump. The lip-edge guard (`BLEMISH_LIP_GUARD_MM`) could extend upwards over the philtrum when the lower-face stubble test finds hair there, or the blemish test could require some skin all round the candidate.

The api now does not compare blemish and dark-spot counts between a 1-photo session and a 2+-photo session (one counts every mark, the other only confirmed ones), and says so in the notes. Nothing for you to change there; it is only so you know why a verdict can be missing.

---

## Round 3: what Niwin changed in the engine (Oct 14, branch engine/quality-pass), so you know before M4

Done together with a three-part review (statistics, colour/forearm, face) and measured on real photos. Please review when you can; pull before starting M4 work in these files: `aggregate.py`, `config.py`, `decode.py`, `color.py`, `markers.py`, `io.py`, `main.py`, `pipeline.py`, `pipeline_face.py`, `metrics/pigment.py`, `metrics/redness.py`.

- **Noise band:** `mdc95(sd, n)` is now at least the t-based prediction interval for one new photo; `config.MIN_SD` floors the SD per metric. A 2-photo baseline used to call noise "real" about 1 time in 4.
- **Face:** ITA from each cheek's median, then the mean (SD 6.3 -> 1.9 degrees on the laptop session); regions use hair-free `face_skin` when at least half is left; redness = mean of per-region medians; **dark_circles** added (`eye_area`, `delta_l_star`); dark-spot L* thresholds scale with skin lightness (`metrics/pigment.py tone_scale`); sharpest passed front photo is the reference; a hand over a cheek or the nose -> `occlusion_suspected`; side views not compared with a baseline; `_count_confirmed` and `_seen_in` fixed for photos that cannot be aligned; empty regions fail one photo, not the request.
- **Forearm:** pen dots must stand out from skin texture and have nothing similar inside the square (the hairy arm with no dots no longer gives a square); paper must be colourless, brighter than skin, sheet-sized, level with the skin; BaselineExposure applied to DNGs; unusable paper is a warning, not a 500; "measured" only when every photo had paper; redness uses the median a*.
- **Speed:** one GCS client, parallel frame downloads and crop uploads, measurement in a worker thread, models loaded at startup.
- **Version 0.3.0.** Please bump `app/__init__.py` whenever a change can move a number: the api stores it on baselines and does not compare across minor versions.
- Tests added for each (follicles vs ink dots, band at small n, SD floor, direction, fairness at three tones).

---

## Round 4: close-ups merged (#51), what changed around them, and what is left (Oct 15)

#51 is merged and deployed; engine tests pass with main (152). Niwin connected close-ups through the api and app (PR #52) and changed three small things in the engine, so you know before you touch these files:

- **`pipeline_macro._front_camera`**: a JPEG with no camera EXIF at all (no Model, no LensModel) is now treated as "cannot be a macro shot". The web app's camera saves a canvas JPEG with no EXIF, always from the front camera; before, such a close-up with no face in view was measured on the assumed 30 mm field (128 px/mm at 4K: invented pores and tone). It now fails as `face_not_found`. `tests/test_macro.py` `_macro` writes a camera Model tag so the synthetic macro shots still use the assumed scale; a new test covers the web case.
- **`confidence`** for pores and texture is "measured" only when every photo used has a known scale (`all(map(_scale_known, have))`), not just the first.
- **`facemap.locate`** returns no position if the result is not finite (all facing triangles degenerate).
- Engine version **0.3.2**.

What the reviews found for you (not changed):

1. **The face scale is about 1.4x off (high, but do it after the demo).** `config.EYE_DISTANCE_MM = 63` is commented "outer-eye distance", but 63 mm is the distance between pupils; the outer eye corners (mesh 33, 263) are 89 mm apart on MediaPipe's canonical face, and the adult average is about 88-90 mm. Independent check: on Niwin's laptop selfie the iris (11.7 mm) gives 2.26 px/mm; the eye-corner scale gives 3.2. Every `*_MM` threshold on faces therefore covers about 1.4x more pixels than its name says. They were tuned on real photos at this scale, so they work; changing it moves many numbers 2 days before freeze. Suggest after submission: switch to the iris (or 89 mm) and rescale the face thresholds together, then bump the minor version.
2. **Close-ups need a check on real phone photos.** Everything Niwin could test was synthetic or a crop of a laptop selfie. On a tiny crop (222 x 190 px, one eye and a cheek) the landmarks found on the shrunk canvas were off (iris scale 1.77 vs 2.26 on the full photo) and ITA came out -25 vs +16 for the same skin. A real 4K close-up should behave better, but please run 5 real close-ups (front camera at ~10 cm with one eye in view, the way the app now asks) and compare tone and redness with the face session of the same minute. Also consider failing a close-up whose skin region is below some pixel count (the tiny crop passed quality).
3. **Close-up guidance in the app says "about 10 cm, one eye in view"** (pores need ~20 px/mm: a 4K front camera gives roughly 25 px/mm at 10 cm and 17 at 15 cm). If your real photos say otherwise, tell Niwin and the copy changes.
4. **Candidates are cut at 40, blemishes first** (`_candidates`). A face with many marks loses dark spots at the cut, and the cut moves between sessions, which the spot diary (`/v1/spots`) would read as spots disappearing. If you can, order by score (or keep confirmed ones first) so the same strong marks always make the cut.
5. **Close-ups average each photo's own count** (no cross-photo matching like faces). Fine for now; the explanation prompt says so.
