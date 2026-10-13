# Research 03: Guided capture, iOS Safari upload, consent and judge-mode UX for Willow

Date: 2026-10-13. Scope: desk research on best-in-class patterns, mapped onto the Willow flow in `docs/UX_SPEC.md`, `docs/CAPTURE_PROTOCOL.md`, `docs/CONTRACT.md` (signed PUT URLs, 1-5 frames, quality codes) and `docs/DEMO_PLAN.md`. Where a claim comes from a vendor page or forum rather than a primary doc, it is flagged.

Reading order if short on time: section 0 (principles), section 2 (upload pitfalls; several are day-1 blockers), section 4 (judge mode).

---

## 0. Principles that showed up everywhere

1. **One instruction at a time, tied to a live check.** Every good capture SDK (Incode, Persona, VIDA, Onfido/Entrust, Apple Face ID, Pixel Guided Frame, Apple Object Capture) shows a single short imperative ("Move closer", "Center yourself") that is driven by a real-time gate, and auto-captures when all gates pass. Persona's help page explicitly says live tips "do not count as a failed attempt"; keep that distinction in copy.
2. **Pre-camera tutorial, then camera, then manual fallback.** Incode's state machine: Tutorial -> Permission (with pre-permission context and fallback if the OS dialog is dismissed) -> Auto capture -> Manual capture after a timeout -> Analyzing (blocks UI, shows progress) -> Success / Retry (specific guidance) / Final error / Connection error. Copy this skeleton.
3. **Coverage, not count, for multi-shot.** Apple's Object Capture "capture dial" and Face ID's "complete the circle" show a ring filling as coverage accumulates; Vision Pro Persona turns each direction cue green and uses 4/3/2/1 concentric circles as a visual countdown of remaining steps. For Willow's 5 repositioned baseline frames, a 5-segment ring beats "Photo 3 of 5".
4. **Ritual over free-form for repeated measurement.** Natural Cycles (measure on waking, before snoozing/phone; 5 "normal" mornings a week; "Slept differently" exclusion flag), AHA home BP (same time daily, sit 5 min, two readings one minute apart) and Oura sizing (wear 24 h, check at rest and after a fist) all encode the protocol as a short fixed checklist plus an honest "exclude this reading" escape hatch. Willow's "wash, wait 15 min, same lamp, card in frame, 3/5 frames" is the same shape; present it as a ritual card the user ticks, with a "something was different today" flag stored on the session.
5. **Consent that people read is layered, specific, revisitable and asked at the moment of use.** UK ICO backs just-in-time notices at the point of data entry plus a layered notice; Apple's HIG says ask only when the feature needs it and explain why before the system prompt; Clue is praised (Mozilla) for a separate, optional "contribute to research" question that can be changed later; Apple's privacy labels research shows jargon ("identifiers", "linked", "tracking") kills comprehension. Flo's FTC order shows the cost of opt-in-by-default sharing.
6. **Judges need value in 30-60 seconds with no login wall.** Linear's demo workspace (pre-signup, local changes reset on refresh, exclusions stated up front), Canva/Buttondown "no signup to try", Stripe's always-visible orange "Test mode" bar, and hackathon-judge advice ("judges should know what the solution is within the first 30 seconds", keep a 60-second screen capture as wifi insurance).

---

## 1. Recommended capture flows

### 1.1 Shared pre-capture: site + mode + ritual card

Screen "What are we photographing today?"
- Site chips with tiny line icons: Full face, Cheek close-up, Nose close-up, Forearm treated, Forearm control. Preselect the site(s) the goal picker implies; show "Baseline needs: face, cheek, forearm x2" as a checklist with ticks for completed sites.
- Mode toggle (persisted per user):
  - **Calibrated** "RAW photo + color card. Measured results."
  - **Quick selfie** "Phone camera in the browser. Trend only." (badge is permanent on every result from this mode; `capture_mode: uncalibrated` forces `indicative`)
- Ritual card (one screen, max 6 items, each with a 24 px illustration, tappable to expand "why"). Copy:
  1. "Same lamp, same spot, curtains closed."
  2. "Clean skin, nothing applied, waited 15 minutes."
  3. "Hair back, glasses off, neutral face."
  4. "Color card next to the skin, flat, not in shadow." (calibrated only)
  5. "Cone touching the cheek for close-ups." (cheek/nose only)
  6. "Baseline: 5 photos. Move the phone away and back between each." / "Check-in: 3 photos."
- Footer toggle: "Something is different today (sick, sunburn, new product, different light)" -> stores `session.note` and a `deviation=true` flag the report can show next to the verdict. This mirrors Natural Cycles' "Slept differently" exclusion.
- Primary button: "I'm set up" (calibrated) / "Open camera" (quick selfie).

### 1.2 Calibrated mode (Lightroom Mobile DNG -> Files -> Safari upload)

The capture itself happens outside Willow, so the UX job is (a) make the Lightroom setup unambiguous once, (b) make the 5-frame ritual countable, (c) make the hand-off to Files and the upload boring.

Step 1 "Set up Lightroom once" (first calibrated session only; later a one-line "Settings unchanged? [Yes] [Show me]")
- Card with the exact tap path from Adobe's docs: Camera -> tap "Auto" left of shutter -> "Professional" -> file format DNG. Set ISO (50-200), shutter (1/60-1/125), WB fixed Kelvin (e.g. 5000 K) via the WB picker then the checkmark, focus manual; tap the lock so it turns yellow. Show screenshots of the three controls. Copy: "Lock it once. Never change it again. If you do, tell Willow and we start a new baseline."
- Risk note from research: the yellow lock covers exposure; verify on-device whether WB and focus persist between app launches and write the result into `docs/CAPTURE_PROTOCOL.md`.

Step 2 "Take your 5 photos" (in-app counter screen the user keeps open next to Lightroom, or reads once)
- 5-segment progress ring. Each segment lights when the user taps "Took one" (manual, since Willow cannot see Lightroom). Under the ring: "Now move the phone away, then back to about 35-40 cm" (face/forearm) or "Lift the cone off, put it back on the same spot" (macro).
- Optional ghost overlay: show the baseline reference frame (JPEG thumbnail from the engine's aligned reference) at 30% opacity on the counter screen so the user can eyeball framing. Progress-photo apps (ProgressCam, EZ Progress, MatchShot) all converge on an adjustable-opacity ghost of the previous shot as the main alignment aid; MatchShot's pitch is "align before the shutter, not by cropping after". For Willow this is a visual reminder only (Lightroom owns the viewfinder); in quick-selfie mode it can be a real overlay.
- Haptics are not available in iOS Safari web (`navigator.vibrate` is a no-op; the checkbox-`switch` trick exists but one tester page reports Apple patched it in iOS 26.5). Use a short tick sound + the ring segment animation instead, and respect reduced-motion.

Step 3 "Export to Files"
- Copy with Adobe's menu names: "In Lightroom select the 5 photos -> Share -> Export Original -> Save to Files -> Willow/<today>. Do not use 'Export to Camera Roll'." Explain the why in a "Why Files?" disclosure: Photos/AirDrop/WhatsApp hand over a JPEG; the raw DNG is what makes the measurement comparable (matches `docs/RISKS.md`).
- Pitfall from research: if Lightroom only has a smart preview (original not on device), Export Original silently produces a JPEG. Willow's upload step must detect this (see 2.4) and say: "This is a JPEG, not the RAW file. In Lightroom, open the photo so it downloads the original, then export again."

Step 4 "Upload" -> see section 2 for the full spec. Summary of the screen:
- Big single button "Choose 5 DNG files" (3 for check-ins) that opens `<input type=file multiple accept=".dng,image/x-adobe-dng,image/dng">`.
- Inline helper with a 3-frame illustration: "Tap Browse -> the ... menu -> Select -> tap all 5 -> Open". (iOS Files browse is single-select unless the user does this; Apple Developer Forums thread 129845, still open as of 2022.)
- After selection: one row per file (name, size, RAW/JPEG badge, status). Validation before any upload starts: count, extension, size > 0, size in 10-120 MB, duplicate (name+size+lastModified).
- Upload progress per file + overall; "Keep this tab open. Uploads pause if you switch apps." banner; `navigator.wakeLock` request (Safari 16.4+) so the screen does not dim during a 3-5 minute upload on cellular.

Step 5 "Processing" (reuse Incode's "Analyzing" state: blocked UI with staged progress)
- Stages from `UX_SPEC.md`: "Checking photo quality -> Correcting colors -> Measuring -> Explaining". Show which frames passed quality gates as they come in; a frame failing with `card_not_found`/`blurry`/`overexposed` shows its reason code mapped to human text and a "Retake" affordance that deep-links back to Step 2 for one more frame if `frames_used` < 3.

Live feedback states for calibrated mode (post-hoc, since the engine does the check)

| Quality code (CONTRACT 2.3) | User copy | Action |
|---|---|---|
| `card_not_found` | "We couldn't find the color card. Put it flat next to the skin, fully in frame." | Retake one frame |
| `card_delta_e_high` | "The card colors are off. Check the lamp is the same and the card isn't in shadow or glare." | Retake session |
| `blurry` | "This one is soft. Hold still, or rest your elbows on the table." | Retake one frame |
| `overexposed` / `underexposed` | "Too bright / too dark. Same lamp, same distance, settings locked?" | Retake session |
| `pose_out_of_range` | "Face a little turned. Look straight at the phone." | Retake one frame |
| `face_not_found` | "No face found. Full face, hair back, phone at arm's length." | Retake one frame |
| `occlusion_suspected` | "Something is covering the skin (hair, glasses, hand)." | Retake one frame |
| `too_few_frames` | "Only N usable photos. Baselines need 5 so we can measure your normal photo-to-photo variation." | Add frames |

### 1.3 Quick-selfie mode (browser camera, trend only)

What is realistic in iOS Safari: `getUserMedia` with `facingMode: 'user'`, grab frames to a canvas, run cheap classical checks on a downscaled frame. Not available: exposure/white-balance lock (no WebKit support found), ImageCapture `takePhoto` reliability, haptics. `facingMode: 'environment'` has defaulted to the ultra-wide lens on some recent iPhones (WebKit bug), so for forearm shots enumerate devices and prefer the one labelled "Back Camera" / widest frame that is not "Ultra Wide", and tell the user to use the front camera for face sites.

Flow
1. Pre-permission screen (Apple HIG: explain before the system prompt). Copy: "Willow needs your camera for this selfie. Photos stay in your private space and are deleted after 30 days. [Allow camera]". If denied: Incode-style fallback with OS-specific steps ("Safari -> aA -> Website Settings -> Camera -> Allow") and an "Upload a photo instead" button.
2. Camera screen with a face oval (or square for forearm/cheek) and one feedback line under it. Gates, all classical CV on the client, evaluated ~5x per second on a 320 px frame:
   - Face present and single (MediaPipe Face Landmarker WASM, or a lightweight Haar/BlazeFace); inter-ocular distance in a target band -> distance.
   - Yaw/pitch/roll from landmarks within the contract's 8/8/6 degrees.
   - Brightness: mean luma of the skin ROI in [0.35, 0.7]; clipped pixels < 2%.
   - Sharpness: variance of Laplacian on the ROI above a threshold calibrated on day 1.
   - Lighting direction: left/right cheek luma ratio within 0.85-1.15 (RealSelfie research uses the shade pattern near the nose as the lighting cue). Copy: "Face the window or lamp so both cheeks are lit evenly."
   - Stability: landmark motion < threshold over 400 ms ("Hold still").
   Feedback copy, one at a time, priority order: "We can't see a face" -> "Only one person in frame" -> "Move closer" / "Move back a little" -> "Turn to face the camera" -> "Find brighter, even light" -> "Hold still".
   When all gates pass: oval turns green, 1-second countdown ring, auto-capture (Guided Frame finding: blind users loved auto-capture, sighted users wanted control -> also keep a shutter button that is enabled only when gates pass, Incode-style manual fallback after 8 s of near-pass).
3. Multi-shot: after each capture, "Great. Lower the phone, then raise it again" with the 3- or 5-segment ring; the previous capture becomes a 30% ghost overlay so the user re-aligns (opacity slider optional).
4. Review strip: thumbnails, tap to retake one. Then "Use these 3 photos" -> upload JPEG (canvas `toBlob('image/jpeg', 0.92)`, full sensor resolution) with the same upload component as calibrated mode.
5. Permanent badge on everything downstream: "Quick selfie: trend only, not calibrated". Never show `measured` confidence.

Important: these client gates are only to help framing; every number still comes from the engine (rule 1). The browser never computes a metric.

### 1.4 Repeat-session ritual (both modes)

- Reminder cadence: user picks a time on the goal screen ("Most people do this after washing their face in the evening"). Natural Cycles' wording model: consistency matters more than perfection; skipping a day does not break anything, it only widens the "within normal variation" band.
- Session start card shows the baseline settings that were locked ("ISO 100, 1/60, 5000 K, 1x, lamp: desk") and asks "Same as before? [Yes] [Something changed]".
- Timeline shows a small marker for sessions flagged "something was different" (sick/sunburn/new product) so a `real_change` on that day is contextualised.

---

## 2. Multi-file upload UX spec for iOS Safari (DNG, 25-75 MB each, 3-5 files)

### 2.1 Mechanism (fits CONTRACT: `POST /v1/sessions` -> V4 signed PUT URLs, 15 min)

- One `XMLHttpRequest` PUT per file, body = the `File` object itself (not FormData, not a Blob read into memory). Reasons: XHR gives `upload.onprogress`; passing the `File` lets WebKit stream from disk; FormData/multipart has a Safari 26.5.2 report of empty bodies and forces the body to be materialised; `FileReader` chunked reads on iOS stop after ~60 s with `WebKitBlobResource error 1` (WebKit bug 228683); a plain JS array of ~100 MB crashes a tab on an iPhone SE (iOS 26.2 test) so never decode or preview the DNG client-side.
- Concurrency 2. Uppy's 300-file issue showed failures scale with request volume, not memory; 2 keeps a 5 x 60 MB session at a sane pace on cellular without starving the progress UI.
- Retry: 3 attempts with 1/3/9 s backoff on network error or 5xx; a 403/400 from an expired signed URL (15-min TTL is tight for 5 x 75 MB on cellular) triggers a fresh `POST /v1/sessions` for the remaining files, not a restart of done ones. Keep `session_id` stable; the api should accept re-issuing URLs for an existing session.
- Resumability: GCS resumable sessions (256 KiB-multiple chunks, 308 responses, offset query) are possible from the browser but cost CORS setup (expose `Range`, allow `Content-Range`) and client code. For the hackathon: do not build it. A failed 60 MB PUT restarts that one file only; the per-file granularity is the resume unit. Revisit if judges complain.
- Completion: after each PUT returns 200, call `POST /v1/sessions/{id}/frames/{n}/complete` (or let `/v1/analyze` HEAD the objects) so the api verifies size > 0 and magic bytes (`II*\0`/`MM\0*` TIFF header for DNG) before analysis. Zero-byte uploads are a documented iCloud symptom (see 2.3).

### 2.2 Screen states

| State | UI | Copy |
|---|---|---|
| Idle | one big button, helper illustration | "Choose 5 DNG files" / "How to select several files in Files" (3-frame strip: Browse -> ... -> Select) |
| Selected, validating | list rows appear instantly with name + size | "Checking 5 files..." |
| Validation error (row) | red icon, inline text, row removable | see 2.4 |
| Uploading | per-row thin bar + %, header overall bar, cancel per row | "Uploading 2 of 5 - 38 MB/s" plus banner "Keep this tab open. Uploads pause if you switch apps or lock the phone." |
| Paused (tab hidden) | on `visibilitychange`/`pageshow` back to visible: re-check each in-flight XHR; failed ones go to Retry | "Upload paused while Willow was in the background. Resuming..." |
| Row failed | retry icon, reason | "Network dropped. [Retry this file]" |
| Signed URL expired | automatic | silent re-request; toast "Refreshing upload link" |
| All done | green ticks, auto-advance to Processing | "5 of 5 uploaded. Checking photo quality..." |
| Offline | detect `navigator.onLine` + failed PUT | "You're offline. Your selection is kept; tap Retry when you're back." (keep the `File` handles in memory; they do not survive reload) |

### 2.3 Known iOS Safari pitfalls and mitigations

| Pitfall | Evidence | Mitigation |
|---|---|---|
| Files "Browse" is single-select by default | Apple Dev Forums 129845 (iOS 12-15, no fix reported) | Illustrated hint "... -> Select"; also accept 1-5 files across several picker rounds ("Add more" button appends to the list instead of replacing) |
| `accept` MIME filters unreliable; DNG may be greyed out or JPEGs allowed | WebKit bug 190982; iOS 14 report that `.mp3,.m4a` worked where `audio/*` did not | `accept=".dng,image/x-adobe-dng,image/dng"`; validate by extension + size client-side and magic bytes server-side; never rely on the picker |
| Picking from Photos (not Files) hands over a converted JPEG; HEIC -> JPEG conversion also reported | Nextcloud/ownCloud reports; Apple ProRAW page (editing then sharing yields JPG); `docs/RISKS.md` already notes this | Copy steers to Files; detect `image/jpeg` or size < 8 MB in calibrated mode and block with the "this is a JPEG" message; accept HEIC/JPEG only in quick-selfie mode |
| iCloud Drive files not yet downloaded upload as 0 bytes / NOT_READABLE | WebKit bugs 151975/173548 | Client: reject `file.size === 0` with "Open this file once in the Files app so it downloads, then choose it again"; server: reject 0-byte objects |
| Filenames with accents fail | single forum report | Sanitise object names server-side; use `frame_{n}.dng` per contract, never the user filename |
| Background tab / lock screen kills JS and in-flight requests; `visibilitychange`, `pagehide`, `unload` may not fire | WebKit bugs 207256, 199854, 180523 | Banner + wake lock; on return, verify each file by state (XHR readyState / server HEAD), retry the rest; keep uploads short by uploading as soon as files are picked (do not wait for a "Start" tap) |
| Memory: 100-200 MB JS heap crashes the tab | lapcatsoftware test on iOS 26.2 | Never read, decode, thumbnail or hash the DNG in JS; show a generic RAW tile; thumbnails come back from the engine after processing |
| FileReader chunked reads time out at 60 s | WebKit 228683 | Do not slice/hash files; PUT the File object |
| `webkitdirectory` unsupported | Apple forums | Do not offer folder upload |
| Signed URL TTL | contract: 15 min | Re-issue per file on 403; show elapsed time only if > 60 s |
| Cellular cost / Low Power Mode throttling | general | Show total size before upload ("5 files, 290 MB. Wi-Fi recommended."); `navigator.connection` is not in Safari, so just show the size |
| Safari 26.5.2 multipart POST empty body | WebKit 319396 (single report) | Avoid multipart entirely (PUT raw body) |

### 2.4 Client-side validation copy

- Count: "Baseline needs exactly 5 photos of this site (you chose 3). Add 2 more." / check-in: "Choose 3 photos. You can add up to 5."
- Type: "frame_2.jpg is a JPEG. Calibrated mode needs the RAW .dng from Lightroom (Share -> Export Original -> Files)."
- Size 0: "frame_4.dng is empty on this phone. Open it in the Files app once so iCloud downloads it, then choose it again."
- Size small (< 8 MB with .dng): "This DNG is unusually small; it may be a smart preview. Export the original again."
- Duplicate: "frame_1.dng was chosen twice."
- Mixed sites: not detectable; rely on the site chosen before the picker and name objects by session.

### 2.5 Desktop (judges)

Same component; add drag-and-drop zone and multi-select works natively. Show the same "RAW vs JPEG" badge. Chrome desktop handles 5 x 75 MB without issue.

---

## 3. Consent + goal picker

Design targets: under 60 seconds, two screens, every sentence answers "what, where, how long, who else, how to undo". Layered (ICO), just-in-time (camera permission asked at capture, research opt-in asked on first upload, retailer-aggregate opt-in explained where it matters), revisitable (Clue), jargon-free (Apple privacy label research: "identifiers", "linked", "tracking" are not understood), opt-in defaults off for sharing (Flo/FTC).

### 3.1 Consent screen (one screen, four cards, each 1-2 lines + "Learn more" sheet; ResearchKit visual-consent shape)

Header: "Before your first photo"

1. **Your photos** - "Stored privately in your own space, in the US (us-central1). Deleted automatically after 30 days. Measurements and a small aligned crop are kept so you can see your trend." Learn more: bucket lifecycle, who on the team can access, encryption at rest.
2. **How we measure** - "Classical image analysis measures color, spots, redness and texture against your own earlier photos. An AI assistant explains results and only repeats numbers we measured; it never guesses a skin age, diagnosis or score." Learn more: link to About/Science.
3. **Not medical** - "Cosmetic tracking only. Willow cannot assess moles or skin conditions. For changing moles, see a dermatologist."
4. **Optional: help improve recommendations** (toggle, default OFF) - "Share anonymized results (numbers only, never photos, never your name) to improve product recommendations and retailer insights. Change this any time in Settings." Learn more: exactly which fields, how aggregation works (min cohort size), retention.

Footer: "You can delete everything from Settings -> Delete my data. Done in minutes, not days." Buttons: "Agree and continue" (primary), "Read full policy" (secondary). Store `consent_version`, timestamp, toggle state in `users/{uid}`.

Rules: no auto-dismissing banners; no pre-ticked boxes; don't gate the demo on the research toggle; re-prompt only when `consent_version` changes, with a diff ("What changed: ...").

### 3.2 Just-in-time moments

- Camera (quick selfie): pre-permission card then the browser prompt (section 1.3).
- First calibrated upload: inline line "These RAW files are 25-75 MB each and are deleted after 30 days." No new dialog.
- Retailer dashboard / brand sharing: the aggregate toggle is explained again where the user's data would flow ("Your results are/aren't part of this cohort").
- Deletion: Settings -> "Delete my data" with a plain confirm ("This removes photos, results and your account. There is no undo."). Show a completion state with what was deleted.

### 3.3 Goal picker (second screen)

"What would you like to track?" - pick up to 3 chips: Clearer skin, Even tone & fewer dark spots, Calmer skin, Smoother texture & pores, Softer lines, Under-eye, Oil control & glow. Under the chips: "This only changes the order of your report. Everything is still measured." Then "When will you usually take photos?" (Evening / Morning / Skip) to set reminder copy. One primary button: "Start my baseline".

Avoid: skin-type quizzes, age, gender, "skin concerns" scoring - none of them feed a measurement and they add friction and bias risk.

---

## 4. Judge-mode first-run (60-second understanding)

### 4.1 Landing (desktop and mobile)

Above the fold: one sentence ("Did your serum actually work? Willow measures your skin from standardized photos and tells you whether a change is real or just photo noise."), one 12-15 s muted autoplay loop (capture -> ring -> report badge), three equally weighted buttons with a one-line sub-label and a time estimate:

1. **Explore a real journey** - "A 5-day self-tanner split-arm test and team face sessions. Read-only. ~1 min."
2. **Try with sample photos** - "Run the live pipeline on our RAW samples. ~30 s." (see 4.3: hosted samples, no 300 MB download)
3. **Try your own selfie** - "Phone or laptop camera, uncalibrated, trend only. ~1 min."

Below: "No sign-in needed. Sign in with Google to keep your data." Persistent top bar once inside any judge path, Stripe-test-mode style: amber "Demo mode - sample data - nothing is saved to a real account - [Reset demo]". Linear's precedent: state what the demo excludes ("Retailer dashboard uses a synthetic cohort; capture settings are fixed").

### 4.2 Entry 1: Explore a real journey

- Opens directly on the forearm timeline at +24 h with the MDC band visible and one `real_change` badge in view. First-visit coach marks (3 max, dismissable): "Grey band = your normal photo-to-photo variation", "Treated vs control", "Tap a point to see the photos and the explanation".
- Per-judge isolation: seed a fresh anonymous `uid` cloned from the demo journey (Firestore `demo/` read-only source, copied on entry) so two judges never collide (DEV Community demo-account lesson); Firestore rules already make demo users read-only. Changes (e.g. goal order) are local and reset on refresh, as in Linear's demo.
- Guided "next" chips at the bottom: "See the routine clash check" -> "Ask the advisor" -> "Retailer view". Each one screen.

### 4.3 Entry 2: Try with sample photos

- Do not make judges download DNGs. Show a gallery of hosted sample sessions (RAW, with card) that live in `demo/` in the bucket: "Forearm treated, +24 h (5 frames)", "Face, baseline (5 frames)". One tap = `POST /v1/analyze` with `gs://` URIs; the judge watches the real Processing stages and lands on the real report. Keep the illustrative "upload your own DNG" path available as a secondary link with a 3-file sample pack (small JPEG-converted set is fine for showing the upload UI; label it honestly).
- Show the frames as they pass quality gates, then the report, with a "What just happened" strip: "Found card -> corrected colors -> aligned 5 frames -> measured 11 metrics -> Gemini explained using only these numbers".

### 4.4 Entry 3: Try your own selfie

- Straight to the pre-permission card -> camera with live guidance (section 1.3) -> 3 frames -> report with the permanent "trend only" badge and a "First reading - take another in a few days to see a trend" verdict. On desktop with no camera: fall back to file upload of any JPEG.
- Judges on a laptop: webcam framing is poor; set the ring to accept a wider distance band in demo mode and say "Laptop camera: expect lower quality".

### 4.5 60-second structure the landing should achieve

0-10 s: what it is (one line + loop). 10-30 s: tap one button, see a real screen with one `real_change` badge and the noise band. 30-60 s: one Gemini explanation card citing a number, one routine conflict, one store link. Put the architecture ("Firebase, Firestore, Cloud Run, Gemini") in the footer of the demo bar, not in the flow. Keep a 60-second screen recording linked from the landing as wifi insurance.

---

## 5. Anti-patterns to avoid

Capture
- Multi-line instruction blocks on the camera screen; more than one correction at a time; generic "Try again" without the reason.
- Counting live guidance as failed attempts; retry counters visible during guidance.
- Auto-capture with no manual fallback (slow devices, odd lighting) or manual-only with no gates.
- "Photo 3 of 5" text instead of a coverage ring; no cue to reposition between frames (defeats the MDC measurement).
- Letting the user change Lightroom settings mid-journey without starting a new baseline.
- Any wording that ranks tone ("brighter", "fairer", "improved tone"); any score, skin age or diagnosis from the AI.
- Relying on haptics or `navigator.vibrate` in Safari.

Upload
- Multipart/FormData; reading or hashing the DNG in JS; client-side DNG preview; a "Start upload" button after picking (upload immediately).
- Accepting Photos-picker JPEGs in calibrated mode silently; trusting `accept`; trusting `file.type`.
- Treating 0-byte iCloud placeholders as success; a single all-or-nothing retry; 15-minute signed URLs without re-issue.
- Blocking on a resumable-upload implementation before the demo works.

Consent
- Wall-of-text policy with one "Accept" button; pre-ticked research/retailer sharing; auto-dismissing notices; jargon ("identifiers", "linked to you", "third parties"); consent you cannot revisit; a deletion flow that emails support.
- Asking camera permission on landing; asking age/skin type quizzes before value.

Judge mode
- Login or email wall before the first screen; a shared demo account that judges can edit and break; a 300 MB download as the only "try" path; an empty state after "Try"; tours longer than three tips; demo data mixed into real user tables; no visible "this is demo data" bar; no reset.

---

## 6. Sources

Capture SDKs and guidance
- Persona, live guidance tips (exact prompt wording, "tips do not count as failed attempts"): https://help.withpersona.com/articles/Vh3GKBF4l7hy1X6cOL1bfw/
- Incode, ID capture screens and states (tutorial -> permission -> auto -> manual fallback -> analyzing -> success/retry/final/connection): https://developer.incode.com/design-and-ux/id-capture-screens-and-states/
- Incode, ID capture feedback messages ("Move closer", "Avoid glare", "Show all four corners"): https://developer.incode.com/docs/id-capture-2
- VIDA KYC SDK document capture (quality gates, auto-capture): https://docs.vida.id/identity-stack/verify/kyc-mobile-sdk/sdk-user-journey/document-capture
- Onfido (now Entrust) Android SDK: real-time glare/blur detection, auto-capture: https://documentation.identity.entrust.com/sdk/android/
- Entrust Web SDK changelog (translation overrides, versioning): https://documentation.identity.entrust.com/sdk/web/changelog/
- Veriff Assisted Image Capture (2020): https://www.veriff.com/blog/product-update-april2020
- Stripe Identity selfie checks: https://stripe.com/en-cy/docs/identity/selfie ; iOS SDK README: https://raw.github.com/stripe/stripe-ios/master/StripeIdentity/README.md
- iProov signals (GPA flash vs LA oval): https://docs.iproov.com/implementation/api/signals
- IDEMIA web capture SDK (best-frame selection, distance/glare/angle guidance): https://experience.idemia.com/identity-proofing/develop/capture-sdk/web/3_9/document-webcapture
- Google, how Guided Frame and Real Tone were tested (audio + haptic + visual, auto-capture when centered): https://blog.google/products/pixel/how-we-tested-the-pixels-new-inclusive-camera-features/
- Popular Science on Guided Frame prompts ("Hold for a photo", "Move your phone down"): https://www.popsci.com/technology/google-pixel-guided-frame/
- Apple, Capture and edit your Persona (direction cues turn green, 4/3/2/1 circles, skip an expression): https://support.apple.com/guide/apple-vision-pro/dev934d40a17/visionos and https://support.apple.com/118496
- Apple, Face ID with Accessibility Options: https://support.apple.com/en-tm/guide/iphone/iph646624222/ios ; VoiceOver percentage progress anecdote: https://www.applevis.com/comment/188106
- Apple WWDC23 Meet Object Capture for iOS (capture dial, automatic frame selection, feedback): https://developer.apple.com/videos/play/wwdc2023/10191 ; notes: https://wwdcnotes.com/documentation/wwdc23-10191-meet-object-capture-for-ios/
- RealSelfie, interactive selfie guidance based on empirical models (lighting cue near the nose, +26% ratings): https://uwspace.uwaterloo.ca/items/1832fefc-db80-4ae3-ac0c-ef969f7bbf2a
- Patent: system for guiding a user to take a selfie (wireframe limits: lighting, occlusion, blur): https://patents.justia.com/patent/10574883
- Haut.AI LIQA for Neutrogena Skin360: https://haut.ai/blogs/haut-ai-collaborates-with-neutrogena ; https://www.cosmeticsdesign.com/Article/2025/09/12/neutrogena-taps-hautai-to-boost-digital-skin-care-personalization-push
- SkinVision capture tips via reseller (10-20 cm, blue ring, daylight): https://www.solbari.com.au/pages/how-to-skincheck
- PCDS clinical photography guidance for patients (rest the limb, neutral background): https://www.pcds.org.uk/clinical-guidance/photography-for-the-patient-how-to-take-a-good-photograph-of-a-skin-conditi
- Progress-photo ghost overlays: ProgressCam https://mwm.ai/apps/progresscam-progress-photos/6760968159 ; EZ Progress https://apps.apple.com/dm/app/ez-progress/id6748616451 ; MatchShot https://www.producthunt.com/p/matchshot/matchshot
- ColorChecker detection research (acquisition conditions, detection rates): https://www.catalyzex.com/paper/fast-and-robust-multiple-colorchecker ; patent EP2940626: https://data.epo.org/gpi/EP2940626B1

Repeated-measurement rituals
- Natural Cycles help: measure 5 mornings/week, within ~2 h of usual wake time, "Slept differently": https://help.naturalcycles.com/hc/en/articles/360003290614 ; https://help.naturalcycles.com/hc/en-us/articles/360003316973-Should-I-measure-my-temperature-on-the-weekend
- Oura sizing kit (wear 24 h, fist test, confirm before shipping): https://support.ouraring.com/hc/en-us/articles/360025590653
- Withings BPM positioning (rest 5 min, don't move or speak, app auto-starts): https://support.withings.com/hc/articles/201493187
- AHA home BP monitoring (same time daily, two readings one minute apart): https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/monitoring-your-blood-pressure-at-home
- Home diagnostics UX (packaging enforces step order, app carries steps): https://www.team-consulting.com/work/streamlining-the-user-experience-of-home-diagnostics/ ; at-home PCR kit usability study: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8673714/

Lightroom Mobile
- Adobe, capture photos (Pro mode, DNG requirements): https://helpx.adobe.com/si/lightroom-cc/using/capture-photos-mobile-android.html
- Pro mode controls and lock: https://photography.tutsplus.com/tutorials/lr-dng-manual-pro-camera--cms-37450 ; https://www.lightstalking.com/lightroom-mobile-camera-app/
- Export Original to Files; smart preview exports JPEG: https://community.adobe.com/t5/lightroom-classic-discussions/multiple-export-original-in-lightroom-mobile/m-p/9038489 ; https://community.adobe.com/questions-680/lr-on-iphone-no-dng-export-926453
- Apple ProRAW sharing behaviour: https://support.apple.com/119916

iOS Safari upload
- Multiple-file selection in Files requires "... -> Select": https://developer.apple.com/forums/thread/129845
- `accept` attribute unreliable on iOS: https://bugs.webkit.org/show_bug.cgi?id=190982
- iCloud files not downloaded -> NOT_READABLE / 0-byte uploads: https://bugs.webkit.org/show_bug.cgi?id=151975 ; https://bugs.webkit.org/show_bug.cgi?id=173548 ; https://developer.apple.com/forums/thread/67861
- FileReader chunked read stops at 60 s (WebKitBlobResource error 1): https://developer.apple.com/forums/thread/686192
- Background tab JS suspension, missing lifecycle events: https://bugs.webkit.org/show_bug.cgi?id=207256 ; https://bugs.webkit.org/show_bug.cgi?id=199854 ; https://bugs.webkit.org/show_bug.cgi?id=180523 ; https://www.raymondcamden.com/2013/01/20/FYI-iOS-JavaScript-and-inactive-tabs
- Safari 26.5.2 multipart empty body report: https://bugs.webkit.org/show_bug.cgi?id=319396
- iOS Safari tab memory crash around 100-200 MB (iOS 26.2 test): https://lapcatsoftware.com/articles/2026/1/7.html
- tus-js-client / Uppy iOS large-file issues: https://github.com/tus/tus-js-client/issues/146 ; https://github.com/tus/tus-js-client/issues/227 ; https://github.com/tus/tus-js-client/issues/142 ; https://github.com/transloadit/uppy/issues/1761
- GCS resumable uploads (256 KiB chunk multiples, 308): https://docs.cloud.google.com/storage/docs/resumable-uploads ; browser example: https://dev.to/kacase/resumable-multi-chunk-upload-to-gcp-bucket-1chk
- Firebase Storage web uploads (uploadBytesResumable): https://firebase.google.com/docs/storage/web/upload-files
- HEIC -> JPEG conversion when uploading from Photos (forum reports): https://help.nextcloud.com/t/ios-upload-to-nextcloud-webapps-automatically-converts-to-jpeg/91672/8 ; https://central.owncloud.org/t/iphone-photo-uploads-seem-to-be-converted/36300
- MDN `<input type=file>`: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/Input/file

Web camera and haptics on iOS
- Torch constraint support history (iOS 17.5, getSettings fix): https://bugs.webkit.org/show_bug.cgi?id=280970 ; https://bugs.webkit.org/show_bug.cgi?id=243075
- facingMode environment defaulting to ultra-wide: https://bugs.webkit.org/show_bug.cgi?id=253186
- Web haptics on iOS (switch-checkbox trick, reported patched in iOS 26.5): https://azukiazusa.dev/en/blog/ios-safari-web-haptics ; https://rapidtoolset.com/en/tool/ios-haptics-tester ; https://github.com/ionic-team/ionic-framework/issues/29942

Consent
- Apple HIG, accessing private data / requesting permission: https://developer-mdn.apple.com/design/human-interface-guidelines/patterns/accessing-private-data ; Apple tech talk on privacy purpose strings: https://developer.apple.com/videos/play/tech-talks/110152
- ICO privacy notices code (just-in-time, layered): https://www.pinsentmasons.com/out-law/news/ico-backs-just-in-time-consent-and-greater-control-for-consumers-in-new-privacy-notices-code- ; DMA on just-in-time notices: https://dma.org.uk/article/gdpr-in-practice-just-in-time-notices
- Revisiting the design agenda for privacy notices (2023): https://arxiv.org/pdf/2304.08780
- Apple privacy labels usability studies: https://www.petsymposium.org/popets/2022/popets-2022-0106.pdf ; https://par.nsf.gov/biblio/10399852 ; https://par.nsf.gov/biblio/10577928
- Mozilla privacy review of Clue (separate research opt-in, revisitable): https://www.mozillafoundation.org/en/nothing-personal/clue-period-tracker-app-privacy-review/
- FTC settlement with Flo (affirmative consent before sharing): https://www.ftc.gov/news-events/news/press-releases/2021/01/developer-popular-womens-fertility-tracking-app-settles-ftc ; Flo Anonymous Mode coverage: https://mobihealthnews.com/node/152009 ; Privacy International Flo findings: https://www.privacyinternational.org/long-read/5561/flo-research-findings
- ResearchKit informed consent (visual consent step, Learn more, comprehension quiz, sharing step): https://www.researchkit.org/docs/docs/InformedConsent/InformedConsent.html

Demo / judge mode
- Linear start guide (demo workspace, local changes reset on refresh, excludes settings/SLAs): https://linear.app/docs/start-guide.md
- Stripe test mode toggle and orange header (third-party guides): https://www.stably.ai/blog/mastering-stripes-test-mode ; sandbox vs test mode: https://getautonoma.com/blog/stripe-test-mode-vs-sandbox ; Stripe Apps "Try in test mode": https://edge-docs.stripe.com/stripe-apps/handling-modes
- Figma Community (public remixable files): https://www.figma.com/blog/introducing-figma-community/
- Demo accounts: per-visitor seeded accounts, keep demo data out of real tables: https://dev.to/samuelcasey/creating-demo-accounts-for-web-apps-learnings-from-my-two-last-projects-49cb ; public demo accounts: https://www.indiehackers.com/post/username-demo123-password-demo123-why-public-demo-accounts-help-saas-startups-grow-faster-UenXMWIiSdas5lGvukE9
- Buttondown no-signup demo site: https://buttondown.com/blog/2024-08-26
- Onboarding patterns (value before signup, seeded empty states): https://www.appcues.com/blog/the-10-best-user-onboarding-experiences
- Hackathon judging: https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l ; https://dev.to/jacklyn/how-to-make-your-devpost-submissions-not-suck-37i0 ; https://tkslife.super.site/copy-of-playbooks/playbook-hackathon-pitches
