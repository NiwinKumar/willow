# Willow design brief (owner: Niwin)

Version 2, Oct 13, 2026. This is the design direction for `web/`: the interaction model, visual system, flows, components, motion, copy and the research behind them. `docs/UX_SPEC.md` still holds the screen list and the per-metric wording table; where this document is more specific, it wins. The five research reports it draws on are in `docs/research/` (about 330 cited sources).

Version 2 replaces the "field notebook" direction of version 1 with **"Lens"**: an interaction model where the photo is the canvas, metrics are layers on it, and time is a thumb-scrub away. The notebook's visual system (paper, ink, sage, signal accent, neutral stage) is kept as the base; what changed is the structure of the app. Section 3 explains the choice.

How to read it quickly: section 1 (what the research changed), section 3 (the direction), section 4 (tokens), section 6 (flows). Everything else is reference while building.

---

## 1. What the research changed (ten findings that shaped this brief)

1. **The whole category is one selfie, a 0-100 score, a skin age and a sponsored routine, and users have measured the lie.** One hobbyist project moved YouCam's pore score from 85 to 96 and its skin age from 22 to 25 on unchanged skin with a 20% exposure change. Olay users on Mumsnet got +3 years, then +13, after turning the bathroom light on. Nobody in the category shows a baseline, a noise band or a control. (research/01)
2. **Premium health products have converged on one visual grammar:** a personal baseline learned over a warm-up, a shaded "your typical range" band, today's value as one big number plus one dot, and a three-state label. Apple Vitals, Oura, WHOOP, Garmin and Fitbit all do this. Willow's MDC95 band is the same shape, so the vocabulary is already familiar. Its edge is that the band is a measurement-error band, which is a stronger claim than any wearable makes. (research/02)
3. **The in-band state is always the calm, neutral, expected state** ("Typical", "Balanced", "No signs"). It is never red, never a down arrow. "Real change" must be rare and earned (Natural Cycles resolves uncertainty to the safe answer; that is why people trust it). (research/02)
4. **Toggle or flicker beats side-by-side for seeing change when images are aligned** (radiology change-detection studies), and misalignment kills detection. The engine's alignment is what makes any visual comparison honest. (research/02)
5. **Capture SDKs share one state machine:** tutorial, pre-permission, one live imperative at a time, auto-capture when gates pass, manual fallback after a timeout, a blocking "analyzing" state, then success or a specific-reason retry. Live tips are never counted as failures. For multi-shot, a coverage ring beats "Photo 3 of 5". Haut.AI's own study: 87% usable images with live coaching versus 32% with written instructions. (research/03)
6. **iOS Safari has day-one upload traps:** the Files picker is single-select unless the user taps "... then Select"; iCloud files not yet downloaded upload as zero bytes; the Photos picker hands over a JPEG; `accept` is unreliable; reading or hashing a DNG in JS crashes the tab; haptics do not exist. Upload each file as a raw PUT of the `File` object, two at a time, retry per file, re-issue expired URLs. (research/03)
7. **Judges must get value in 60 seconds with no login wall,** and must never download 100 MB of DNGs. "Try with sample photos" runs the live pipeline on hosted RAW frames with one tap. A persistent amber demo bar tells them nothing is real. (research/03)
8. **Dark surrounds brighten and desaturate perceived image tone (ISO 12646, darktable).** A product whose claim is fair skin-tone measurement must show every photo on a neutral mid-grey stage and must not ship dark mode for the MVP. (research/04)
9. **What reads as "AI-generated" is a documented bundle:** cream background with a high-contrast serif and a clay accent, purple gradients, one radius on everything, a soft shadow under every card, Inter or Instrument Serif, scroll-triggered everything, fake stats. The fix is a specific token system, not adjectives. (research/04)
10. **Routine tools stop at "here is a routine"; none links a product to a measured outcome. Retailer suppression must happen in the data layer, never only in the chart.** (research/05)

---

## 2. Principles (Willow-specific, in priority order)

1. **The band is the brand.** Every screen that shows a number also shows what would have to happen for that number to mean something.
2. **Calm is the default state.** "Within normal photo variation" is quiet, grey, expected. Only "Real change" gets the accent, the stamp and the motion.
3. **Numbers are measured; words are explained.** Every digit traces to the engine or the catalog. Gemini copy renders only after schema validation.
4. **The photo is evidence, never the claim.** Verdict chips sit above or beside images; images sit on a neutral grey stage with a thin white reference border; no photo is ever tinted or placed behind a colour wash.
5. **Measurement and commerce never share a screen.** The Report has zero product cards.
6. **One instruction at a time.** Capture, upload and consent each show a single imperative tied to a live check or a specific reason.
7. **Tone is a description, never a direction.**
8. **Direct manipulation over navigation.** If a question can be answered by dragging, holding or tapping the thing itself, there is no separate screen for it.
9. **It knows it is a web app.** Every view is a URL, back always works, it installs to the home screen, the demo works offline, and the desktop gets a keyboard. No fake native tab bars, no splash screens.

---

## 3. Direction

### 3.1 "Lens" (chosen)

One sentence: Willow is a lens you hold over your own skin. The aligned photo is the canvas; the eleven metrics are layers on it; the baseline and every later session sit on one scrubber under your thumb; and the noise band is drawn wherever a number appears.

Three things make it new, and each one is justified by the research rather than by novelty:

1. **The Scrubber.** A persistent control at the bottom of the Report that holds every session of the current site as a tick, with the baseline cluster at the left. Dragging the thumb cross-fades the stage between aligned session previews, moves every metric's dot inside its band, rolls every delta, and updates the URL. There is no separate Timeline screen and no separate Compare screen: moving through time is the comparison. Hold the thumb still and the stage flickers between that session and the baseline (research/02: toggle beats side-by-side). Desktop: left and right arrow keys scrub, the thumb has inertia, and the per-metric chart with its band appears in the detail panel.
2. **Layers.** Tapping a metric row outlines its region on the photo; tapping a region on the photo selects its row. The overlay mask for the selected metric fades in on the stage in the signal colour. Candidates Gemini labelled appear as small pins the user can tap. The Report is a map with a legend, not a list with a thumbnail.
3. **The landing is the product.** The first screen is a live Lens on the seeded self-tanner forearm series, cached for offline, with the scrubber ready to drag before the visitor reads a word. Three buttons below it. A judge touches the thesis in the first five seconds.

Web-native, on purpose: `/s/:site?t=:index&m=:metric&layer=on` is the state of the Report, so "Copy link to this view" is a share feature and browser back always works; React 19.3 View Transitions carry the stage between routes; a web app manifest, icons and `theme-color` make it installable; a service worker precaches the demo journey (JSON plus previews) so the judge path survives bad wifi; the desktop gets a command palette (⌘K: jump to a metric, a session, a screen) and a keyboard map (arrows scrub, `L` toggles the layer, hold `B` to flicker to baseline, `?` shows the map).

Clean and easy because the structure is one the user already knows: a map app (Maps, Photos, Lightroom): a canvas, a draggable sheet over it with snap points, and a scrubber. There are three persistent regions and nothing else to learn.

```
Report, phone (375 px)                         Report, desktop (>= 1024 px)
┌──────────────────────────────┐               ┌───────────────────────────┬────────────────────┐
│ ‹  Face · 13 Oct          ⌄  │ top bar       │ Face · 13 Oct      ⌘K  ⌄  │ 1 real change      │
│                              │               │                           │ since your baseline│
│    ┌────────────────────┐    │               │   ┌────────────────────┐  ├────────────────────┤
│    │  aligned photo on  │    │ stage         │   │                    │  │ Tone & pigment     │
│    │  neutral grey;     │    │ pinch-zoom    │   │   photo on stage   │  │ Dark spots 3.1 % ◆ │
│    │  faint ROI lines;  │    │ hold = flicker│   │   layer: Dark spots│  │ ├──░░░●░░──┤ Real  │
│    │  selected layer in │    │ tap ROI = row │   │                    │  │ Tone evenness 2.9  │
│    │  signal blue       │    │               │   │                    │  │ ├──░░●░░░──┤ Within│
│    └────────────────────┘    │               │   └────────────────────┘  │ Redness …          │
├──────────────────────────────┤               │  ◦◦◦◦◦──●────◦────◦──▶    │ …                  │
│ ═══                          │ sheet grabber │  baseline     13 Oct      │ Why this matters   │
│ 1 real change · since 12 Sep │ peek state    ├───────────────────────────┴────────────────────┤
│ Tone & pigment               │               │ Dark spots over time  [band chart with ticks]  │
│ Dark spots  3.1 %  ▼0.7  ◆   │ rows          └────────────────────────────────────────────────┘
│ ├────░░░░░●░░░──────┤ Real   │
│ Tone evenness 2.9  ▼0.1      │
│ ├──░░░●░░░──────────┤ Within │
├──────────────────────────────┤
│ ◦◦◦◦◦───●───◦────◦────◦──▶   │ scrubber: baseline cluster, session ticks, thumb
│ 12 Sep          13 Oct       │
└──────────────────────────────┘
```

Sheet snap points: peek (header sentence only, the photo fills the screen), half (rows visible, photo cropped to the selected region), full (rows plus the explanation; the stage shrinks to a thumbnail that stays tappable). Drag the grabber or tap the header to move between them.

Row anatomy (unchanged from version 1, every metric in the same positions):

```
 Dark spots                          Measured      <- label + confidence chip
 3.1 %   ▼ 0.7 vs baseline                          <- value (Mono 500) + delta
 ├────░░░░░░░●░░░░░──────────────┤                  <- band-bar: band = noise, dot = today (moves with the scrubber)
 Real change ◆  fewer/lighter spots       ⓘ         <- verdict chip + UX_SPEC wording + info
```

Every band-bar renders its MDC95 band at the same pixel height, so "how far outside" is comparable across rows.

### 3.2 "Field notebook" (version 1, kept as the visual base and as the fallback structure)

Warm low-chroma paper, ink-green text, sage brand green, signal accent, rows with hairline rules, photos on a neutral grey stage, Fraunces display. Its tokens survive in section 4 almost unchanged. If the scrubber or the per-session previews slip, the Report degrades to the notebook structure (photo stage at the top, rows below, a separate timeline chart) without any token change. That is the safety net, not the goal.

### 3.3 What changed from version 1 and why

| Element | Version 1 | Version 2 | Why |
|---|---|---|---|
| Report, Timeline, Compare | three screens | one surface: stage, sheet, scrubber | direct manipulation; the comparison is the act of moving through time; fewer screens to build and to learn |
| Before/after | a slider component | hold-to-flicker on the stage, plus the scrubber | flicker is the stronger change detector when frames are aligned; the slider becomes a desktop extra |
| Overlays | a segmented control over a thumbnail | layers tied to rows and regions, bidirectional | the photo becomes the index of the report |
| Landing | a sentence and two drawn band-bars | a live, draggable Lens on seeded data | judges touch the thesis before reading |
| Display type | Fraunces | Atkinson Hyperlegible Next at weight 700, size and tracking do the work | an app that knows it is an app does not need a serif to feel considered; one family, two cuts; Fraunces stays available for the science page and marketing only |
| Primary buttons | willow green fill | ink fill (text colour), willow only for the mark and the "Measured" chip | app chrome stays neutral so the stage and the signal accent carry the meaning |
| Motion budget | three signature moments | the same three, plus scrubber physics and sheet snaps, which are responses to touch, not decoration | motion that answers a gesture is welcome; nothing animates on scroll |

### 3.4 Self-review against generic defaults

The map-app structure is common for maps and rare for health data; the risk is that it reads as "a photo viewer". Three guards: the sheet opens at half by default so the numbers are visible on first paint; the band-bars and verdict chips are the dominant visual, not the photo; and the scrubber is a measurement instrument (baseline cluster, band-anchored dots), not a video timeline. The visual tokens avoid the documented generated bundle (no cream plus serif plus clay, no gradients, no uniform radii, no shadow-on-everything, no Inter). The accent is the colour card's cyan patch, absent from every skin tone, so it works for masks on Monk 1 to 10.

---

## 4. Tokens

### 4.1 Type

All faces are SIL OFL 1.1, self-hosted through Fontsource. Verified on Oct 13: Atkinson Hyperlegible Next exposes `tnum` and `pnum`; the Mono is inherently tabular.

| Role | Face | Settings |
|---|---|---|
| Display (landing sentence, report header, screen titles) | Atkinson Hyperlegible Next variable | weight 700, tracking -0.03 em, line-height 1.0 to 1.1 |
| UI text | Atkinson Hyperlegible Next | 400 body, 500 labels and buttons, 600 row labels; `font-variant-numeric: tabular-nums` globally |
| Numerals (values, deltas, axes, timestamps, scrubber dates, tables) | Atkinson Hyperlegible Mono variable | 500 for values, 400 elsewhere; `slashed-zero` |
| Science page and deck only | Fraunces variable (full build for `opsz`, `SOFT`) | weight 450, never in the app shell |

Scale (mobile; display uses `clamp()` on desktop):

| Token | Size / line | Use |
|---|---|---|
| display-xl | clamp(36px, 8vw, 56px) / 1.0 | landing sentence |
| display-l | 28 / 1.1 | report header sentence, screen titles |
| display-m | 22 / 1.2 | sheet section titles on desktop |
| group | 15 / 1.3, weight 600 | "Tone & pigment" |
| metric-value | 26 / 1.0 Mono 500 | row value |
| metric-s | 17 / 1.0 Mono 500 | deltas, readouts, scrubber date |
| body-l | 17 / 1.5 | explanations, chat, consent |
| body | 15 / 1.5 | default |
| label | 13 / 1.3, +0.01 em, weight 500 | chips, buttons |
| caption | 12 / 1.3 | axis labels, timestamps, disclaimers |

Units follow the number at 0.75 em with a 0.25 em gap. No all-caps labels. Inputs never below 16 px. Preload the two woff2 files, `font-display: swap`, `size-adjust` fallback to system-ui so layout shift is near zero.

### 4.2 Colour (OKLCH, Tailwind v4 `@theme`)

Hex equivalents and WCAG ratios computed on Oct 13.

```css
@import "tailwindcss";
@theme {
  /* canvas: warm paper, very low chroma so it never tints skin judgement */
  --color-bg:         oklch(0.975 0.006 85);  /* #f9f6f2 sheets, pages */
  --color-surface:    oklch(0.992 0.003 85);  /* #fdfcfa raised sheet, tiles */
  --color-surface-2:  oklch(0.955 0.008 85);  /* #f3f0ea inset, muted, scrubber rail */
  --color-border:     oklch(0.900 0.010 85);  /* #e1ded7 hairlines */
  --color-stage:      oklch(0.620 0.000 0);   /* #868686 neutral photo stage (about Munsell N6) */

  /* ink: text and primary actions */
  --color-text:       oklch(0.240 0.018 130); /* #1c2118  15.2:1 on bg; primary button fill */
  --color-text-2:     oklch(0.460 0.020 130); /* #545a4f   6.6:1 */
  --color-text-3:     oklch(0.580 0.015 100); /* #7c7b71   4.0:1, 18px+ or decorative only */

  /* willow: the mark, "Measured", first reading */
  --color-willow-100: oklch(0.940 0.030 145); /* #dff1df */
  --color-willow-500: oklch(0.580 0.085 145); /* #59885b icons, capture-ring arcs (3.8:1 non-text) */
  --color-willow-700: oklch(0.420 0.080 145); /* #2f5831 chip text 7.6:1; on willow-100 6.9:1 */

  /* signal: the one accent, only for "real change" and the active layer mask */
  --color-signal-100: oklch(0.940 0.030 220); /* #d6f0f9 chip fill */
  --color-signal-500: oklch(0.620 0.120 220); /* #0096b8 points, masks, focus ring (3.3:1 non-text) */
  --color-signal-600: oklch(0.500 0.105 222); /* #006f8e 5.4:1 */
  --color-signal-700: oklch(0.420 0.095 224); /* #005773 chip text 7.7:1; on signal-100 7.0:1 */

  /* noise: within normal photo variation */
  --color-noise-band: oklch(0.930 0.006 85);  /* #eae8e3 band fill */
  --color-noise-500:  oklch(0.660 0.010 85);  /* #95928b band edge, hollow dots, ROI outlines */
  --color-noise-700:  oklch(0.520 0.012 85);  /* #6c6861 chip text 5.1:1 */

  /* semantic, rare, never for verdicts */
  --color-warn:       oklch(0.760 0.140 80);  /* #dfa635 quality icon, demo bar tint */
  --color-warn-text:  oklch(0.520 0.130 70);  /* #975800 5.3:1 */
  --color-danger:     oklch(0.550 0.170 28);  /* #c13d34 upload and consent errors only */
  --color-info:       oklch(0.520 0.070 235); /* #3d6f8c "Indicative" chip text 5.1:1 */
  --color-focus:      var(--color-signal-500);
}
```

| State | Fill | Text / mark |
|---|---|---|
| `real_change` | signal-100 | signal-700 text; signal-500 dot and mask |
| `within_noise` | noise-band with 8% 45° hatching | noise-700 |
| `no_baseline` | willow-100 | willow-700 ("First reading") |
| `low_quality` | surface-2 | warn-text + warn icon |
| confidence `measured` | willow-100 | willow-700, filled chip |
| confidence `indicative` | surface-2 | info, outlined chip; never gets "Real change" |
| selected ROI outline | none | text at 60%, 1.5 px |
| unselected ROI outlines | none | noise-500 at 50%, 1 px, hidden at peek |
| demo bar | warn at 18% | warn-text |

Rules: no gradients; no glow; no coloured shadows; sheets get `0 -1px 0 border` and, when raised over the stage, `0 -8px 24px oklch(0.24 0.018 130 / 0.10)`; masks are signal-500 at 45% with a 1 px signal-700 outline; photos are never tinted. Dark mode is out of the MVP; `color-scheme: light`, `theme-color #f9f6f2`.

### 4.3 Space, radius, borders, layout

- Spacing scale 4, 8, 12, 16, 20, 24, 32, 48, 64. Gutter 20 px on phones, 32 px on tablets. Sheet content max 36 rem; desktop app max 1280 px with the stage taking 58% and the panel 42%.
- Radii carry hierarchy: chips 4 px, inputs and buttons 8 px, product tiles 12 px, photo corners 0 inside the stage, sheet 20 px top corners.
- Hairlines between rows; no boxes around rows.
- Stage: `stage` background, 12 px padding, a 1 px `surface` border around the image, pinch-zoom from 1x to 3x, double-tap resets; safe areas respected with `env(safe-area-inset-*)`.
- Scrubber: 56 px tall on phones (44 px touch target plus labels), full width, rail in surface-2, ticks in noise-500, baseline cluster as five hollow ticks, the thumb a 28 px ink circle with a white inner ring.

### 4.4 Motion

Principles: ease-out for anything the user triggered; under 300 ms except sheets, scrubbing and the three signature moments; only `transform`, `opacity`, `clip-path`, `pathLength`; interruptible; nothing animates on scroll; delight is spent on rare moments.

```css
--ease-out:    cubic-bezier(0.22, 1, 0.36, 1);
--ease-in:     cubic-bezier(0.4, 0, 1, 1);
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
--dur-instant: 80ms;  --dur-fast: 140ms;  --dur-base: 220ms;  --dur-slow: 320ms;  --dur-moment: 700ms;
```

Springs: `{ type: "spring", visualDuration: 0.3, bounce: 0.1 }` for sheets, layout moves and the scrubber thumb settling; `{ visualDuration: 0.45, bounce: 0.2 }` for the one stamp. Bounce above 0.25 reads playful.

| Interaction | Motion |
|---|---|
| Scrubber drag | thumb follows the finger with no easing; on release it snaps to the nearest tick with the 0.3 s spring; stage cross-fades between previews over 140 ms; dots and deltas interpolate continuously while dragging |
| Hold on the stage | after 250 ms the stage flickers to the baseline frame and back every 600 ms until release; a thin caption "Baseline" / "13 Oct" alternates |
| Sheet | Vaul snap points; drag to move; the stage scales 1 to 0.96 as the sheet rises |
| Layer select | mask fades in over 220 ms; selected ROI outline thickens; on first use only the outline traces once |
| Row tap | row expands in place (band chart inside) with `layoutId`; on desktop the detail panel updates |
| Route change | React 19.3 `<ViewTransition>`; the stage keeps its identity between landing, report and capture |
| Numbers | NumberFlow on first reveal and on real change; while scrubbing, plain interpolation |

Reduced motion: translates become 0 and fades run at fast; scrubbing updates instantly without cross-fade; flicker becomes a tap toggle; NumberFlow disables itself; path draws show the final state; View Transitions become a 120 ms cross-fade; `<MotionConfig reducedMotion="user">` at the root.

iPhone Safari rules: `100dvh` and safe-area insets; `backdrop-filter` only on the top bar; `touch-action: none` on the stage and scrubber only; `will-change` only during an animation; previews are JPEGs under 250 KB prefetched for the two neighbouring sessions only; the chat composer lives in a flex column; entries in JS, not CSS scroll timelines.

---

## 5. Screens

### 5.1 Landing

The live Lens on the seeded forearm series sits above the fold, offline-cached, with a one-line caption under the stage ("Self-tanner on the left square, nothing on the right. Drag through four days.") and the scrubber ready. Over it, one sentence in display-xl: "Did your serum actually work? Willow measures your skin and tells you whether a change is real or just the camera." Below, three equal ink buttons with sub-labels and time estimates (Explore a real journey, about 1 min; Try with sample photos, about 30 s; Try your own selfie, about 1 min), then "No sign-in needed. Sign in with Google to keep your results." The footer carries the architecture line for judges and the 60-second screen recording link. Nothing else: no feature grid, no fake stats.

### 5.2 Demo bar

Inside any judge path: a persistent 40 px bar, warn tint: "Demo mode · sample data · nothing is saved to a real account · Reset". A popover lists what the demo excludes.

### 5.3 Consent and goals

Unchanged from research/03: four plain-language cards with "Learn more" sheets (your photos; how we measure; not medical; optional anonymized sharing, off by default), the delete line in the footer, then the goal picker (three chips, photo time). Camera permission is asked at capture, never here. No quiz, no age, no gender.

### 5.4 Capture guide

Site chips, mode toggle (Calibrated: "RAW photo + colour card. Measured results." / Quick selfie: "Phone camera in the browser. Trend only."), a ritual card of at most six items with a tappable "why", and the "Something is different today" toggle that stores a note and a `deviation` flag shown on the scrubber as a small mark.

Calibrated: one-time Lightroom setup card with the exact taps; a five-segment ring the user taps after each shot with the reposition cue; export to Files with the "Why Files?" disclosure; upload. Quick selfie: pre-permission card; camera with the three-arc ring (lighting, distance, alignment) and one imperative at a time; auto-capture when all arcs fill, manual shutter after 8 s of near-pass; three frames with a 30% ghost of the previous shot; review strip. The browser gates only help framing; no number is ever computed in the browser.

### 5.5 Upload

As research/03 section 2: one button, the three-frame multi-select hint, instant rows with a RAW/JPEG badge, validation before upload (count, extension, zero size, under 8 MB for a DNG, duplicates), upload on selection, per-row and overall progress, "Keep this tab open", wake lock, per-file retry with backoff, automatic re-issue of expired signed URLs, an offline state that keeps the selection. Never multipart; never read the file in JS.

### 5.6 Processing

The stage shows the frames arriving as a contact sheet on the grey; each gets a drawn check or its mapped reason. The sheet lists the stages ("Checking photo quality", "Correcting colours", "Measuring", "Explaining"); each label morphs into its result ("Colour card found, ΔE 1.2"). When the result lands, the contact sheet resolves into the aligned preview and the sheet fills with rows: same surfaces, no new screen.

### 5.7 Report (the Lens)

Top bar: back, site switcher (sheet), session date, share ("Copy link to this view"), on desktop ⌘K. Stage as in 3.1. Sheet: header sentence with the real-change count, baseline date and frame count; groups ordered by goal; rows sorted real change first; the Gemini card "Why this matters" with up to three next steps at the bottom of the full state; quality issues with fixes; footer disclaimer with "Photos delete on <date>". Scrubber as in 3.1. Zero product cards.

Metric detail (row tap): the row expands with the per-metric band chart (baseline cluster at x = 0, flat band anchored on the baseline, hollow dots inside, signal dots outside, event ticks for routine changes, faint crosses for low-quality readings, deviation marks), the three-block info text (what it measures, how we decide real change quoting the user's band, what else can move it), and "Read the methodology".

Treated versus control: the stage splits into two panes (both squares, same lighting, same scrub position), two band-bars under it, the headline verdict on the difference of differences, and "Both sides changed" withholding attribution when the control also moved.

First reading (quick selfie, uncalibrated): the scrubber shows one tick, rows show "Indicative" chips and "First reading" verdicts, the permanent "Quick selfie: trend only" badge sits in the top bar, and the sheet header says "Take another in a few days and Willow will show the trend. Calibrated mode adds your personal noise band."

### 5.8 Routine, 5.9 Advisor, 5.10 Retailer, 5.11 Science and privacy

Unchanged in substance from version 1 and research/05, re-skinned with the version 2 tokens:

- **Routine:** header status capped by the worst open item; AM and PM lists in cleanse-treat-moisturise-protect order; product rows with category icon, actives with percentages, an outcome chip computed in the web from the concern-to-metric map and sessions after the start date, and a flag dot when in a conflict. Label scan: frame guide, reading stages, the confirm step (editable name, category, actives, INCI with low-confidence tokens underlined), catalog match, AM/PM and start date. Conflict cards most severe first with icon plus word plus colour, the issue in one sentence, "Suggested change", a provenance tag ("rule-based" or "AI-suggested"), and Apply / Tell me more / Dismiss. "Fix" never appears.
- **Advisor:** pinned scope line; four starter chips, one per category, replaced by context chips when arriving from a conflict or an outcome chip; each turn shows a collapsible retrieval line built from the real tool calls, the message with every quoted number as a chip that opens its metric popover, up to four product cards, up to three follow-ups; text streams, cards render only after validation. On desktop the Advisor is a right panel beside the stage, and a quoted metric highlights its region on the photo. Product card: category icon, name, price with "as of <date>", "For:" concerns, actives, "In your routine" with the outcome chip, every store as an equal button sorted by region then alphabetically, "Add to routine", "Ingredients". No images, reviews, pros and cons or "best pick".
- **Retailer:** persistent synthetic banner; global filters; tabs in RETAILER_INSIGHTS order, each with the lead question, stat tiles with n, one chart, a table with CSV; open on the product-by-tone-band heatmap with "62% (n=41)" cells and hatched "Hidden (under 10 users)" cells; suppression enforced in the BigQuery view and the API; Looker embeds desktop-only inside a collapsed section.
- **Science page:** headline "Every number comes from calibrated computer vision. Gemini writes the explanation; it never produces a measurement.", a stats panel of defensible numbers, the noise-band explainer, "Why we never rank skin tone", reference methods per metric, first-person limits, an algorithm changelog. **Privacy receipt** in Settings: what is stored, where, the deletion date, one-tap delete with a plain confirm and a completion state.

---

## 6. Flows

### 6.1 Judge first run (understanding in 60 s)

0-5 s: the landing Lens is on screen and draggable; the sentence reads above it. 5-30 s: one tap on any button lands on a Lens with one real-change chip and a band in view, with at most three dismissable coach marks ("Drag to move through time", "Grey band = your normal photo-to-photo variation", "Hold the photo to flicker to your baseline"). 30-60 s: guided chips at the bottom of the sheet ("See the routine clash check", "Ask the advisor", "Retailer view"). Per-judge isolation: a fresh anonymous uid cloned from the read-only demo source on entry; changes reset. "Try with sample photos" lists hosted sample sessions and runs the real pipeline on them with one tap; the download path stays as a secondary link.

### 6.2 Calibrated capture and upload

Set up Lightroom once → ritual card → five-segment ring with reposition cues → export to Files → choose files (multi-select hint) → validation → immediate upload with progress, wake lock, retry, URL re-issue → processing on the stage → the Lens. Repeat sessions open with "Same setup as before? Yes / Something changed" and three frames.

### 6.3 Quick selfie

Pre-permission card → camera with the ring and one imperative → auto-capture with manual fallback → three frames with a ghost → review strip → upload → processing → first-reading Lens.

### 6.4 Consent, goals, delete

Consent (four cards, toggle off) → goals → "Start my baseline". Re-prompt only on a consent-version change, with a diff. Delete: Settings → "Delete my data" → plain confirm → completion state.

### 6.5 Label scan to routine to outcome

Add product → scan or search → confirm → match → AM/PM and start date → compatibility check inline → outcome chip after the first session past the start date → tapping it opens the Lens with that metric selected and the scrubber at the start marker.

### 6.6 Share

"Copy link to this view" copies the URL (site, scrub index, selected metric, layer). A "Proof card" action renders a PNG client-side: the aligned frame on the stage, the verdict chip, the band-bar with the band baked in, the dates, and "Willow · cosmetic tracking, not a diagnosis". Nobody exports uncertainty; Willow does.

---

## 7. Component inventory and build order

Built so that the Lens exists early in a rough form and gets refined, rather than many screens half-built.

| Order | Component | Notes |
|---|---|---|
| 1 | Tokens, fonts, `AppShell` (safe areas, top bar, demo bar), `Button`, `Chip`, `Sheet` (Vaul with snap points), `Toast` | M1-M2 |
| 2 | `BandBar` (SVG, shared band height, hollow/filled dot, animated dot position) | the signature primitive |
| 3 | `MetricRow` (label, confidence chip, value, delta, `BandBar`, verdict chip, info) | M2 |
| 4 | `Stage` (neutral stage, aligned preview, pinch-zoom, ROI outlines, mask layer, hold-to-flicker, split mode) | M2 with the fixture preview; needs `preview.jpg` from the engine for real sessions |
| 5 | `Scrubber` (ticks, baseline cluster, thumb physics, keyboard, URL state) | M2 against fixture sessions, M4 polish |
| 6 | `UploadList`, `ProcessingStage` | M1 test page, M2 final |
| 7 | `ExplanationCard`, `NumberChip`, metric detail chart (Recharts composed chart) | M3-M4 |
| 8 | `CaptureRing`, quick-selfie camera | M4 |
| 9 | `ConflictCard`, `ProductRow`, `OutcomeChip`, `LabelScanConfirm` | M4 |
| 10 | `ChatTurn`, `RetrievalLine`, `ProductCard`, `StoreButtons` | M4 |
| 11 | `RetailerBanner`, `StatTile`, `Heatmap`, `DotPlot`, `SuppressedCell`, `DataTable` | M4 |
| 12 | `ConsentCards`, `GoalPicker`, `PrivacyReceipt`, `ProofCard`, command palette, PWA manifest and service worker for the demo journey | M2 consent; M5 the rest |

Estimated cost of version 2 over version 1: about half a day net. The scrubber and the stage replace the separate timeline and compare screens and the slider; the extra is the preview prefetching, the URL state and the flicker.

---

## 8. Signature moments (the whole delight budget)

1. **The first drag.** On the landing Lens the scrubber thumb has a soft pulse until first touched; the moment it moves, the stage cross-fades through four days of the forearm series and the treated square's dot crosses its band while the control's dot stays inside. The visitor has understood the product without reading.
2. **The noise-band reveal.** In the metric detail, the baseline hairline appears, the band grows out of it, the line draws left to right, and only out-of-band points ignite in signal blue with one pulse. In-band points never animate.
3. **The real-change stamp.** The sheet header count rolls once; on the one row with a real change the chip lands like a stamp with a hairline ring that expands and fades. Once per report, never on re-render.
4. **Hold to flicker.** Press the photo and it alternates with the baseline; the caption alternates with it. The cheapest, most honest before/after on any phone.
5. **The capture ring.** Three arcs fill as the checks pass; the ring breathes once when all three are full and the shutter enables.
6. **The within-variation chip you can tap.** It opens a sheet: "Changes smaller than 1.8 ΔE are photo noise for you. Your five reference photos varied by that much."

Everything else moves only in response to a gesture.

---

## 9. Copy system

Verdict ladder (chip, then one line under the number):

| Verdict | Chip | Line |
|---|---|---|
| `real_change` | Real change | "Outside your normal photo-to-photo variation. This is a measurable change." then the UX_SPEC direction phrase |
| `within_noise` | Within normal photo variation | "Today's reading sits inside your noise band (±1.1). Nothing measurable has changed yet. Most skincare effects take 4-8 weeks to exceed photo noise." |
| `no_baseline` | First reading | "This is your reference point. Future photos are compared to it." |
| `low_quality` | Photo quality too low to compare | "Lighting or framing differed too much from your reference. Retake to compare." plus the specific reason |

Quality reasons, one line each (research/03): card not found, card colours off, soft (blurry), too bright or too dark, face turned, no face found, something covering the skin, too few usable photos ("Baselines need 5 so we can measure your normal photo-to-photo variation").

Rules: say what the measurement is, not what the product failed to do; put the band number in the sentence; add a time horizon; never "no improvement", "normal" alone, "flaws", "fix", "fairness", "whitening", "brighter" for tone, any disease name, any skin age or score; every number in Gemini copy must exist in the input; the mole line is verbatim from CLAUDE.md; disclaimers sit next to the first answer; active voice, sentence case, buttons name what happens and the verb carries through to its confirmation. Gesture hints are written as what happens, not as instructions: "Hold to see your baseline", "Drag to move through time".

---

## 10. Accessibility and quality floor

WCAG AA on every text pair; never colour-only meaning; 44 px targets; visible focus rings in signal-500; labels on every input; the scrubber is a `role="slider"` with arrow keys, Home/End, and a live region announcing the session date and the count of metrics outside their band; hold-to-flicker has a tap-toggle equivalent and a keyboard key; every band-bar has screen-reader text ("inside your noise band, 0.3 below baseline"); charts ship a data table fallback; reduced motion honoured; no horizontal page scroll at 375 px; no layout shift from fonts or images; the Lens works with a mouse, a keyboard and a finger.

---

## 11. Anti-pattern checklist (run before every web PR)

- [ ] No purple, indigo or gradient text; no blurred colour orbs; no chroma above 0.14
- [ ] No Inter, Roboto, Instrument Serif; no serif in the app shell
- [ ] No single radius on everything; no shadow under rows; no glassmorphism beyond the top bar
- [ ] No centered hero with a pill and three icon cards; no fake stats; no "seamless", "elevate", "unlock", "AI-powered"
- [ ] No emoji as icons; icons only where they carry meaning
- [ ] Nothing animates on scroll; no stagger on routine screens; no looping animation outside processing and the first-drag pulse
- [ ] No product on the Report; no highlighted store; no reviews or ratings anywhere
- [ ] No skin age, overall score, percentile, population comparison, "needs attention" band, red for within-variation
- [ ] No dark surround behind a photo; no tinted photo; the stage is always the neutral grey
- [ ] No fake native chrome (tab bars, splash screens); every view has a URL and back works
- [ ] Unmodified shadcn tokens never reach a screen

---

## 12. Libraries (versions verified on Oct 13, 2026; all at least two weeks old)

| Need | Package | Version (date) |
|---|---|---|
| Build | vite | 8.3.1 (Sep 24) |
| UI | react, react-dom | 19.3.0 (Sep 9), `<ViewTransition>` stable |
| Styling | tailwindcss, @tailwindcss/vite | 4.3.3 (Jul 16) |
| Fonts | @fontsource-variable/atkinson-hyperlegible-next, @fontsource-variable/atkinson-hyperlegible-mono (Fraunces only on the science page) | 5.3.x (Jul 2026) |
| Animation, gestures | motion | 13.4.6 (Sep 29) |
| Numbers | @number-flow/react | 0.6.2 (Jul 18) |
| Sheets | vaul | 1.1.2 (Dec 2024, stable) |
| Toasts | sonner | 2.0.8 (Aug 9) |
| Primitives | radix-ui | 1.6.7 (Jul 24), scaffolded through shadcn 4.21.0 then re-tokened |
| Charts | recharts | 3.10.1 (Jul 25); band-bars and the scrubber are hand-written SVG |
| Command palette | cmdk (desktop only) | pin at scaffold time, two-week rule |
| PWA | vite-plugin-pwa (precache the demo journey only) | pin at scaffold time, two-week rule |
| Icons | lucide-react | 1.49.0 (Sep 29), plus three custom line icons (leaf, colour card, ring) |
| Firebase | firebase | 12.19.0 (Sep 9); 13.0.0 is too new |
| Router | react-router-dom | 7.18.4 (Sep 15) |

Not used: react-compare-slider (replaced by hold-to-flicker and the scrubber; keep as a desktop extra only if time remains), GSAP, Rive, Lottie, Base UI, Observable Plot.

---

## 13. What this brief implies elsewhere

- **Contract:** the aligned `preview.jpg` (proposal 1 or 1b in `docs/CONTRACT_CHANGES.md`) is now load-bearing: the stage, the layers, the scrubber cross-fade and the flicker all need one aligned preview per session. Without it the Lens degrades to the notebook structure with metric-only scrubbing.
- **api (Niwin, no contract change):** sessions list per site with preview URLs and verdict summaries for the scrubber; re-issue signed URLs for an existing session; session `note` and `deviation`; server-side sample sessions on `demo/` (approved); per-judge demo clone on entry; `DELETE /v1/me`; label-scan confirm step. No extra per-user caps beyond the advisor's 20 turns per day.
- **Data:** suppression in the BigQuery `product_outcomes` view and in `/v1/retailer/insights` with `n` and `suppressed` per cell; complementary suppression when exactly one child is hidden.
- **Capture protocol (Harshini):** confirm the DNG size Lightroom writes on the 17 Pro Max and prefer 12 or 24 MP; capture both forearm squares in one frame (the split stage assumes it); confirm whether white balance and focus persist between Lightroom launches.
- **Docs:** `docs/DECISIONS.md` records the direction; `docs/UX_SPEC.md` points here.

## 14. Open decisions

1. Preview image: schema field (proposal 1) or file convention (proposal 1b); needed by the 10:00 sync.
2. One minimum instance on both Cloud Run services during judging (cost estimate in `docs/RISKS.md`).
3. Whether the forearm compare uses a single frame with both squares (preferred) or two aligned frames; depends on how Harshini captures tonight.
4. Type lock after the first screenshot review on Wednesday (Atkinson at 700 for display versus a short list of alternatives).
