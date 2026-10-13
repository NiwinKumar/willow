# Willow design brief (owner: Niwin)

Version 1, Oct 13, 2026. This is the design direction for `web/`: principles, visual system, flows, components, motion, copy and the research behind them. `docs/UX_SPEC.md` still holds the screen list and the per-metric wording table; where this document is more specific, it wins. The five research reports it draws on are in `docs/research/` (about 330 cited sources).

How to read it quickly: section 1 (what the research changed), section 3 (the direction and why it is not the generic one), section 4 (tokens), section 6 (flows). Everything else is reference while building.

---

## 1. What the research changed (ten findings that shaped this brief)

1. **The whole category is one selfie, a 0-100 score, a skin age and a sponsored routine, and users have measured the lie.** One hobbyist project moved YouCam's pore score from 85 to 96 and its skin age from 22 to 25 on unchanged skin with a 20% exposure change. Olay users on Mumsnet got +3 years, then +13, after turning the bathroom light on. Nobody in the category shows a baseline, a noise band or a control. (research/01)
2. **Premium health products have converged on one visual grammar:** a personal baseline learned over a warm-up, a shaded "your typical range" band, today's value as one big number plus one dot, and a three-state label. Apple Vitals, Oura, WHOOP, Garmin and Fitbit all do this. Willow's MDC95 band is the same shape, so the vocabulary is already familiar. Its edge is that the band is a measurement-error band, which is a stronger claim than any wearable makes. (research/02)
3. **The in-band state is always the calm, neutral, expected state** ("Typical", "Balanced", "No signs"). It is never red, never a down arrow. "Real change" must be rare and earned (Natural Cycles resolves uncertainty to the safe answer; that is why people trust it). (research/02)
4. **Capture SDKs share one state machine:** tutorial, pre-permission, one live imperative at a time, auto-capture when gates pass, manual fallback after a timeout, a blocking "analyzing" state, then success or a specific-reason retry. Live tips are never counted as failures. For multi-shot, a coverage ring beats "Photo 3 of 5". Haut.AI's own study: 87% usable images with live coaching versus 32% with written instructions. (research/03)
5. **iOS Safari has day-one upload traps:** the Files picker is single-select unless the user taps "... then Select"; iCloud files not yet downloaded upload as zero bytes; the Photos picker hands over a JPEG; `accept` is unreliable; reading or hashing a DNG in JS crashes the tab; haptics do not exist. Upload each file as a raw PUT of the `File` object, two at a time, retry per file, re-issue expired URLs. (research/03)
6. **Judges must get value in 60 seconds with no login wall,** and must never download 100 MB of DNGs. "Try with sample photos" runs the live pipeline on hosted RAW frames with one tap. A persistent amber demo bar (Stripe test-mode pattern) tells them nothing is real. (research/03)
7. **Dark surrounds brighten and desaturate perceived image tone (ISO 12646, darktable).** A product whose claim is fair skin-tone measurement must show every photo on a neutral mid-grey stage and must not ship dark mode for the MVP. (research/04)
8. **What reads as "AI-generated" is a documented bundle:** cream background with a high-contrast serif and a clay accent, purple gradients, one radius on everything, a soft shadow under every card, Inter or Instrument Serif, scroll-triggered everything, fake stats. The fix is a specific token system, not adjectives. (research/04, and the frontend-design skill's calibration list)
9. **Routine tools stop at "here is a routine".** None links a product to a measured outcome; none shows severity, a suggested change and provenance for a conflict. Those three things are Willow's whole Routine screen. (research/05)
10. **Small-group suppression must happen in the BigQuery view and the API, never only in the chart.** Tables, CSV and Looker leak what charts hide. Keep suppressed cells visible as hatched placeholders with "Hidden (under 10 users)". Open the retailer dashboard on the product-by-profile heatmap, the slide merchandisers have never seen. (research/05)

---

## 2. Principles (Willow-specific, in priority order)

1. **The band is the brand.** Every screen that shows a number also shows what would have to happen for that number to mean something. The noise band is the most prominent element on the timeline, not a footnote.
2. **Calm is the default state.** "Within normal photo variation" looks like Apple's "Typical": quiet, grey, expected. Only "Real change" gets the accent, the stamp and the motion.
3. **Numbers are measured; words are explained.** Every digit on screen traces to the engine or the catalog. Gemini copy renders only after schema validation; a number that fails validation is never shown.
4. **The photo is evidence, never the claim.** Verdict chips sit above images. Images sit on a neutral grey stage with a 1 px white reference border. No photo is ever tinted, blurred, or placed behind a colour wash.
5. **Measurement and commerce never share a screen.** The Report has zero product cards. Advice lives in the Advisor and Routine screens, cites the user's own numbers, and lists every store equally.
6. **One instruction at a time.** Capture, upload and consent each show a single short imperative tied to a live check or a specific reason. Errors name the cause and the fix.
7. **Tone is a description, never a direction.** No arrow, colour, axis or word implies that lighter, brighter or more even is better. The ITA metric says "change detected" in both directions.
8. **Spend boldness once per screen.** One memorable element (the band reveal, the stamp, the ring), everything else disciplined.

---

## 3. Direction: "Field notebook, calibrated"

### 3.1 The concept

Willow should feel like a beautifully typeset lab notebook that happens to contain an instrument's numbers: paper-like warm neutral canvas, ink-green text, a quiet sage brand green, monospaced numerals, hairline rules, and one cool "signal" accent that appears only when a measurement clears the noise. Photos live on a neutral grey stage, like a colour-assessment booth. The structure is rows and rules, not cards and shadows. Motion is reserved for the three moments where the product proves itself: the capture ring filling, the noise band growing and the line drawing through it, and the one real-change stamp.

Closest references: Oura's one-headline hierarchy, WHOOP's meaning-only colour, Linear's warm desaturated greys with "structure felt, not seen", Typology's numbers-in-the-sentence copy, Natural Cycles' conservative verdict, Apple Object Capture's coverage dial.

### 3.2 Self-review against generic defaults (what changed from the research recommendation and why)

The visual research (research/04) recommended "Herbarium Lab": warm bone paper, Fraunces serif display, Geist UI, Geist Mono numerals and a copper accent for real change. Three parts of that are exactly the most common generated look of 2026 (warm cream plus high-contrast serif plus clay accent), so they were changed deliberately:

| Element | Research pick | Decision | Why |
|---|---|---|---|
| Canvas | warm bone, chroma 0.008 | warm paper, chroma 0.006, and the photo stage is strictly neutral | UX_SPEC specifies warm neutrals, so they stay, but lower chroma keeps the canvas from biasing skin-tone judgement and from reading as "cream template" |
| Accent for real change | copper (hue 45) | **signal blue-teal (hue 220)**, from the colour card's cyan patch | Copper is the generated-default clay accent and competes with warm skin and the redness overlay. A cyan-blue hue is absent from every human skin tone (Monk 1-10), so the same accent works for the chip, the timeline points and the overlay masks on any skin; and it is literally patch 18 of the ColorChecker Willow calibrates against |
| UI typeface | Geist | **Atkinson Hyperlegible Next** | Geist is Vercel's house face and is becoming the second Inter. Atkinson Hyperlegible was designed by the Braille Institute for low-vision legibility, has tabular numerals (verified), and makes the inclusivity principle visible in the letterforms |
| Numerals | Geist Mono | **Atkinson Hyperlegible Mono** | Same family, inherently tabular, instrument feel |
| Display | Fraunces | Fraunces, weight 450 or lighter, SOFT axis up | Kept: it is a soft, low-contrast serif, not the high-contrast kind that signals "template", and the WONK axis gives it a hand-set character at display sizes only |
| Cards | tonal cards, no border | **rows with hairline rules; cards only for sheets and product tiles** | Identical rounded cards are the SaaS-kit tell. Metric rows (WHOOP's band-bar) scan faster on a phone and put the band in every row |
| Motion | per-card stagger on mount | no stagger on routine screens; orchestration only in three signature moments | "Fade-and-slide every card" is the generated default; one orchestrated reveal lands better |

Checkpoint: the type decision locks after the first rendered screenshot review on Wednesday. If Atkinson reads too casual next to Fraunces at 15 px, the fallback is Geist (already verified for tabular numerals).

### 3.3 Layout concept

Mobile-first, left-aligned, 20 px side gutters, body copy capped at 36 rem, section rhythm 32 px on phones and 48 px on desktop. The page is a single column that becomes a column plus a right rail on desktop (Advisor, Retailer). Structure is encoded by hairline rules and type size, not boxes. Group titles are small Fraunces, metrics are rows, actions are full-width on phones.

```
Report (phone)                               Report (desktop, >= 900px)
┌──────────────────────────────┐             ┌──────────────┬──────────────────────┐
│ 1 real change                │ Fraunces    │ 1 real change│ [photo on grey stage]│
│ since your baseline          │ display-l   │ since your…  │  Photo | Redness |…  │
│ Baseline 12 Sep · 5 photos   │ caption     ├──────────────┤  (overlay toggle)    │
├──────────────────────────────┤             │ Tone & pigm. │                      │
│ Tone & pigment     (rule)    │             │ ├ Dark spots │                      │
│ Dark spots  3.1 %  Measured  │ row         │ ├ Tone even. │  Gemini card         │
│ ├──░░░░░●░░░──┤ Real change ◆│ band-bar    │ Redness      │  "Why this matters"  │
│ Tone evenness 2.9  Measured  │             │ …            │                      │
│ ├────░░●░░░────┤ Within var. │             │              │  Disclaimer          │
├──────────────────────────────┤             └──────────────┴──────────────────────┘
│ Redness            (rule)    │
│ …                            │
├──────────────────────────────┤
│ [photo on grey stage]        │
│  Photo | Redness | Dark spots│
├──────────────────────────────┤
│ Why this matters   (Gemini)  │
│ …next steps                  │
│ Cosmetic tracking, not a     │
│ diagnosis. Photos delete 12 Oct│
└──────────────────────────────┘
```

Row anatomy (every metric, same positions every time, learnable in one session):

```
 Dark spots                          Measured      <- label (Atkinson 500) + confidence chip
 3.1 %   ▼ 0.7 vs baseline                          <- value (Mono 500, 28px) + delta (Mono 18px)
 ├────░░░░░░░●░░░░░──────────────┤                  <- band-bar: band = noise, dot = today
 Real change ◆  fewer/lighter spots       ⓘ         <- verdict chip + UX_SPEC wording + info
```

The band-bar renders every metric's MDC95 band at the same pixel height, so "how far outside" is comparable across rows by eye (research/02, Tufte).

---

## 4. Tokens

### 4.1 Type

All faces are SIL OFL 1.1, self-hosted through Fontsource (no Google Fonts request on the critical path). Verified on Oct 13: Atkinson Hyperlegible Next exposes `tnum` and `pnum`; Fraunces' full variable build on Fontsource is the `full` variant (the `wght`-only subset lacks the `opsz`, `SOFT` and `WONK` axes, so load the full file for display sizes only).

| Role | Face | Settings |
|---|---|---|
| Display (landing H1, report header, screen titles, verdict headlines) | Fraunces variable | weight 420-480, `"opsz" 96, "SOFT" 40, "WONK" 1` at 32 px+, `"opsz" 48, "SOFT" 20` at 24 px; tracking -0.02 em; never above weight 500 |
| UI text (body, labels, buttons, chat, routine) | Atkinson Hyperlegible Next variable | 400 body, 500 labels; `font-variant-numeric: tabular-nums` globally |
| Numerals (metric values, deltas, units' neighbours, axes, timestamps, table cells) | Atkinson Hyperlegible Mono variable | 500 for values, 400 elsewhere; `slashed-zero` |

Scale (mobile; display uses `clamp()` on desktop):

| Token | Size / line | Face | Use |
|---|---|---|---|
| display-xl | clamp(40px, 9vw, 64px) / 1.0 | Fraunces | landing sentence, "1 real change" |
| display-l | 32 / 1.1 | Fraunces | report header, timeline title |
| display-m | 24 / 1.2 | Fraunces | screen titles, group titles on desktop |
| group | 17 / 1.3 | Fraunces 450 | "Tone & pigment" group titles on phones |
| metric-value | 28 / 1.0 | Mono 500 | row value |
| metric-s | 18 / 1.0 | Mono 500 | deltas, band readouts |
| body-l | 17 / 1.5 | Atkinson 400 | explanations, chat, consent cards |
| body | 15 / 1.5 | Atkinson 400 | default |
| label | 13 / 1.3, +0.01 em | Atkinson 500 | chips, buttons, row labels |
| caption | 12 / 1.3 | Atkinson 400 / Mono | axis labels, timestamps, disclaimers |

Units sit after the number in Atkinson at 0.75 em, lowercase where the unit allows ("3.1 %", "13.4 a*", "28.4°"), with a 0.25 em gap. No all-caps labels anywhere except nothing. Inputs are never below 16 px (iOS Safari zooms otherwise). Preload the two above-the-fold woff2 files with `font-display: swap` and `size-adjust` fallbacks (Georgia for Fraunces, system-ui for Atkinson) to keep layout shift near zero.

### 4.2 Colour (OKLCH, Tailwind v4 `@theme`)

Hex equivalents and WCAG ratios were computed on Oct 13 (script in the session scratchpad; recompute with any OKLCH tool).

```css
@import "tailwindcss";
@theme {
  /* canvas: warm paper, very low chroma so it never tints skin judgement */
  --color-bg:         oklch(0.975 0.006 85);  /* #f9f6f2 */
  --color-surface:    oklch(0.992 0.003 85);  /* #fdfcfa sheets, tiles */
  --color-surface-2:  oklch(0.955 0.008 85);  /* #f3f0ea inset, muted */
  --color-border:     oklch(0.900 0.010 85);  /* #e1ded7 hairlines */
  --color-stage:      oklch(0.620 0.000 0);   /* #868686 neutral photo stage (about Munsell N6) */

  /* ink */
  --color-text:       oklch(0.240 0.018 130); /* #1c2118  15.2:1 on bg */
  --color-text-2:     oklch(0.460 0.020 130); /* #545a4f   6.6:1 */
  --color-text-3:     oklch(0.580 0.015 100); /* #7c7b71   4.0:1, 18px+ or decorative only */

  /* willow: brand, sage, quiet */
  --color-willow-100: oklch(0.940 0.030 145); /* #dff1df tint fills */
  --color-willow-500: oklch(0.580 0.085 145); /* #59885b icons, strokes (3.8:1 non-text) */
  --color-willow-600: oklch(0.500 0.085 145); /* #427044 primary button fill; surface on it 5.7:1 */
  --color-willow-700: oklch(0.420 0.080 145); /* #2f5831 brand text 7.6:1; on willow-100 6.9:1 */

  /* signal: the one accent, only for "real change" (colour-card cyan patch) */
  --color-signal-100: oklch(0.940 0.030 220); /* #d6f0f9 chip fill */
  --color-signal-500: oklch(0.620 0.120 220); /* #0096b8 timeline points, overlay masks (3.3:1 non-text) */
  --color-signal-600: oklch(0.500 0.105 222); /* #006f8e chip text 5.4:1; surface on it 5.7:1 */
  --color-signal-700: oklch(0.420 0.095 224); /* #005773 text 7.7:1; on signal-100 7.0:1 */

  /* noise: within normal photo variation */
  --color-noise-band: oklch(0.930 0.006 85);  /* #eae8e3 band fill */
  --color-noise-500:  oklch(0.660 0.010 85);  /* #95928b band edge, hollow dots (non-text) */
  --color-noise-700:  oklch(0.520 0.012 85);  /* #6c6861 chip text 5.1:1 */

  /* semantic, rare, never for verdicts */
  --color-warn:       oklch(0.760 0.140 80);  /* #dfa635 quality-issue icon */
  --color-warn-text:  oklch(0.520 0.130 70);  /* #975800 5.3:1 */
  --color-danger:     oklch(0.550 0.170 28);  /* #c13d34 upload and consent errors only, 4.9:1 */
  --color-info:       oklch(0.520 0.070 235); /* #3d6f8c "Indicative" chip text 5.1:1 */
  --color-focus:      var(--color-signal-500);
}
```

Mapping to product vocabulary (`docs/CONTRACT.md` 2.4, `docs/UX_SPEC.md`):

| State | Fill | Text / mark | Note |
|---|---|---|---|
| `real_change` | signal-100 | signal-700 text, signal-500 dot | the only accented state; direction given by the arrow glyph and the wording, never by a second colour |
| `within_noise` | noise-band with 8% 45° hatching | noise-700 | the hatching says "band", not "disabled" |
| `no_baseline` | willow-100 | willow-700 | "First reading" |
| `low_quality` | surface-2 | warn-text + warn icon | a photo problem, never danger red |
| confidence `measured` | willow-100 | willow-700 | filled chip |
| confidence `indicative` | surface-2 | info | outlined chip; indicative metrics never get a "Real change" verdict |
| demo bar | warn at 18% | warn-text | persistent, not dismissable |

Rules: no gradients except a 2-3% tonal wash from willow-100 to bg on the landing hero; no glow; no coloured shadows; most surfaces are tonal (surface on bg) with no shadow; sheets get `0 1px 2px oklch(0.24 0.018 130 / 0.06)` at most. Overlay masks on photos use signal-500 at 45% with a 1 px signal-700 outline, never red, so they read on every skin tone. Dark mode is out of the MVP; set `color-scheme: light` and `theme-color #f9f6f2` so Safari chrome matches.

### 4.3 Space, radius, borders

- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 48, 64. Gutter 20 px on phones, 32 px on tablets, content max 1120 px on desktop.
- Radii carry hierarchy: chips 4 px, inputs and buttons 8 px, product tiles 12 px, photos 8 px, sheets 20 px top corners only. No pill buttons; chips may be pills.
- Rules: 1 px `border` colour between rows and above group titles. No boxes around metric rows.
- Photo stage: `stage` background, 12 px padding, 1 px `surface` inner border around the image.

### 4.4 Motion

Principles (Kowalski, Apple HIG, Family): ease-out for anything the user triggered; under 300 ms except sheets and the three signature moments; animate only `transform`, `opacity`, `clip-path`, `pathLength`; every animation interruptible; nothing animates on scroll; the delight budget goes to rare moments.

```css
--ease-out:    cubic-bezier(0.22, 1, 0.36, 1);
--ease-in:     cubic-bezier(0.4, 0, 1, 1);      /* exits only */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);  /* on-screen moves */
--dur-instant: 80ms;   /* press feedback */
--dur-fast:    140ms;  /* chips, toggles, exits */
--dur-base:    220ms;  /* enters, overlay fades */
--dur-slow:    320ms;  /* sheets, routes */
--dur-moment:  700ms;  /* signature moments only */
```

Springs: `{ type: "spring", visualDuration: 0.3, bounce: 0.1 }` for sheets and layout moves; `{ visualDuration: 0.45, bounce: 0.2 }` for the one stamp. Bounce above 0.25 reads playful.

| Interaction | Motion |
|---|---|
| Button and row press | scale 0.98 in at instant, out at fast |
| Chips, segmented control | opacity + 4 px translate; thumb slides with `layoutId` |
| Sheets (goal picker, metric detail, product, consent "learn more") | Vaul drawer, drag to dismiss, snap points |
| Route change | React 19.3 `<ViewTransition>` cross-fade; metric row to metric detail shares the value and band-bar by name |
| Numbers | NumberFlow digit roll on first reveal or real change only, never on scroll |
| Timeline reveal, real-change stamp, capture ring, processing notebook | see section 8 |

Reduced motion (`prefers-reduced-motion`, mirrors iOS Reduce Motion): translates become 0 and fades run at fast; NumberFlow and the compare slider disable themselves; path draws show the final state; View Transitions become a 120 ms cross-fade; the only loop anywhere is the processing indicator. Use `<MotionConfig reducedMotion="user">` once at the root.

iPhone Safari rules: `100dvh` and `env(safe-area-inset-*)`, never `100vh`; `backdrop-filter` only on the fixed header; `will-change` only during an animation; chat composer in a flex column, never `position: fixed`; entries in JS, not CSS scroll timelines; autoplay video `playsinline muted`.

---

## 5. Screens (deltas and specifics on top of UX_SPEC)

### 5.1 Landing

One left-aligned Fraunces sentence with real numbers from the fixture, one band graphic that is the product thesis, three equal entry buttons with sub-labels and time estimates, one line about sign-in. No "Introducing" pill, no three icon cards, no fake stats.

```
┌──────────────────────────────────────────┐
│ Dark spots fell 0.7. That is real.       │  display-xl, two lines, left
│ Redness fell 0.8. That is the camera.    │
│                                          │
│ ├───░░░░░░░●░░░░░───────┤ Redness        │  two band-bars, drawn once on load
│ ├─░░░░░░░░░░░░░●────────┤ Dark spots  ◆  │  (the only page-load animation)
│                                          │
│ Willow measures your skin from           │  body-l, max 36rem
│ standardized photos and tells you        │
│ whether a change is real or photo noise. │
│                                          │
│ [ Explore a real journey ]  ~1 min       │  three equal buttons, willow-600
│   5-day self-tanner split-arm test       │
│ [ Try with sample photos ]  ~30 s        │
│   runs the live pipeline on our RAW set  │
│ [ Try your own selfie ]     ~1 min       │
│   uncalibrated, trend only               │
│                                          │
│ No sign-in needed. Sign in with Google   │
│ to keep your results.                    │
└──────────────────────────────────────────┘
```

The footer carries the architecture line for judges ("Firebase, Firestore, Cloud Run, Gemini on Vertex AI") and the link to the 60-second screen recording (wifi insurance).

### 5.2 Demo bar

Once inside any judge path: a persistent 40 px bar, warn tint, "Demo mode · sample data · nothing is saved to a real account · Reset". Lists what the demo excludes in a popover ("retailer dashboard uses a synthetic cohort; capture settings are fixed").

### 5.3 Consent and goals (two screens, under 60 s)

Four plain-language cards with a "Learn more" sheet each: your photos (private, US region, deleted after 30 days, measurements kept), how we measure (classical image analysis; the AI only repeats measured numbers; never a skin age, score or diagnosis), not medical (changing moles: see a dermatologist), optional anonymized sharing (toggle, default off, changeable in Settings). Footer: "Delete everything any time from Settings. Minutes, not days." Store `consent_version`, timestamp and the toggle. Then the goal picker: up to three chips, "This only changes the order of your report. Everything is still measured.", and "When will you usually take photos?" (Evening / Morning / Skip). Camera permission is asked at capture, never here. No skin-type quiz, no age, no gender.

### 5.4 Capture guide

Site chips with small line icons, the mode toggle (Calibrated: "RAW photo + colour card. Measured results." / Quick selfie: "Phone camera in the browser. Trend only."), and a ritual card of at most six items with a 24 px illustration each and a tappable "why". A footer toggle "Something is different today (sick, sunburn, new product, different light)" stores a note and a `deviation` flag that the timeline shows next to that reading.

Calibrated mode: a one-time Lightroom setup card with the exact tap path, a five-segment coverage ring the user taps after each shot ("Now move the phone away, then back to about 35-40 cm"), the export path ("Share, Export Original, Save to Files") with the "Why Files?" disclosure, then the upload screen. Quick selfie: pre-permission card, camera with a face oval or square, one feedback line at a time ("Move closer", "Find brighter, even light", "Hold still"), auto-capture when the three arcs of the ring are filled, manual shutter after 8 s of near-pass, a 30% ghost of the previous frame between shots, a review strip. The browser gates only help framing; no number is ever computed in the browser.

### 5.5 Upload

One big button "Choose 5 DNG files", a three-frame illustrated hint for iOS multi-select ("Browse, then the ... menu, then Select"), rows that appear instantly with name, size and a RAW/JPEG badge, validation before any upload (count, extension, size 0, size under 8 MB for a DNG, duplicates), upload starting immediately, per-row progress and an overall bar, a "Keep this tab open" banner, wake lock, per-file retry with backoff, automatic re-issue of expired signed URLs, an offline state that keeps the selection. Never multipart, never read the file in JS.

### 5.6 Processing

A vertical lab-notebook list: "Checking photo quality", "Correcting colours", "Measuring", "Explaining". Each label morphs into its result when done ("Colour card found, ΔE 1.2") with a drawn check. Frames that fail show the mapped reason and a "Retake this one" link. The report slides up as a sheet over the last stage so the elements persist rather than duplicate.

### 5.7 Report

Header sentence with the real-change count (NumberFlow once), the baseline date and frame count, groups ordered by goal, rows sorted real change first, then within variation, then low quality, then first reading. Photo on the stage with a segmented overlay control. Gemini card titled "Why this matters" with "What to do next" (max three). Quality issues listed with the fix. Footer: disclaimer plus "Photos delete on <date>". Zero product cards.

Info popover per metric, three blocks, no scrolling on a phone: what it measures (one cosmetic sentence), how we decide real change (quoting the user's own band), what else can move it (lighting, time of day, cleansing, temperature). Footer link to the science page.

First-reading report (quick selfie judges, uncalibrated): values with "Indicative" chips, "First reading" verdicts, the permanent "Quick selfie: trend only" badge, and one sentence that makes the screen worth it: "Take another in a few days and Willow will show the trend. Calibrated mode adds your personal noise band."

### 5.8 Timeline and compare

One metric per chart. Five baseline photos drawn as a cluster at x = 0 (hollow dots) so the band width explains itself; the band is flat and anchored on the baseline, never a cone; hollow dots inside the band, filled signal dots outside; routine changes as vertical ticks with labels; low-quality readings as faint crosses with the reason; deviation-flagged sessions marked. Y axis labelled with the plain-language direction from UX_SPEC ("less redness ↓"), never a better/worse word for tone. No fitted trend line; the word "trend" only after three consecutive out-of-band readings on one side. Caption under the chart: "Your noise band (MDC95 from 5 reference photos)".

Compare: three modes, swipe slider (default), hold-to-flicker (best for actually seeing change, per the radiology literature), side-by-side (fallback when alignment failed). Both images on the stage, labelled with dates in Mono, the metric readout under the slider updating as the handle crosses the midpoint. Caption when the verdict is within variation: "Numbers above are measured; the image is for reference." Any two dates can be chosen.

Treated versus control (forearm): two band-bars, each arm against its own baseline and band; the headline verdict is on the difference of differences; the control staying inside its band is reported as "as expected"; if both arms moved, say so and withhold attribution: "Both sides changed. Something other than the product likely moved the reading."

### 5.9 Routine

Header status capped by the worst open item ("1 thing to look at", "Looks compatible", "Add products to check compatibility"), never a score. AM and PM lists in the cleanse-treat-moisturise-protect order, product rows with a neutral category icon, brand and name, key-active chips with percentages when known, an outcome chip ("Real change in dark spots", "No clear change yet (3 wks)", "Too early to tell", "Not measured") computed in the web from the concern-to-metric map and sessions after the start date, and a flag dot when the product is in an open conflict. Add product opens a sheet with two equal options: scan the label or search the catalog.

Label scan: frame guide ("Fit the whole ingredient list inside the frame"), reading stages, then the confirm step most apps skip (editable brand and name, category chip, actives with percentages, the INCI list collapsed with low-confidence tokens underlined), then catalog match ("Found in catalog" / "Not in our catalog yet; kept as your own entry"), then AM/PM and start date. The start date powers the outcome chip and the timeline marker.

Conflict cards, most severe first: icon plus word plus colour, never colour alone. "Keep these apart" (octagon, warn), "Use with care" (triangle, warn), "Good to know" (circle-i, grey), "Same active twice" (two squares), "Missing step" (plus, willow). Each card: the products, the issue in one sentence ("These can irritate when used the same night"), "Suggested change: alternate nights", a provenance tag "rule-based" or "AI-suggested", and three actions: Apply, Tell me more (opens the Advisor with the question pre-filled), Dismiss (AI-suggested only). The word "Fix" never appears.

### 5.10 Advisor

Intro line pinned above the first message: "I can explain your measurements, check your routine and find products from a facts-only catalog. I can't diagnose skin conditions or replace a dermatologist." Four starter chips, one per category (outcome, shopping, routine, capture), replaced by context chips when arriving from a conflict card or an outcome chip. Each Willow turn: a small collapsible retrieval line built from the tool calls actually made ("Checked your results (Oct 10) · Searched catalog: dark spots, under ₹1,500"), the message with every quoted number rendered as a chip that opens a popover with the metric, band and verdict and a link to the timeline, then product cards (max four visible), then up to three follow-up chips. Text streams; cards render only after the final schema-validated message. Rate limit shows "5 questions left today" at five.

Product card: category icon, brand and name, price with currency and "as of <date>", "For:" concerns with the asked one emphasised, key actives, "In your routine" with the outcome chip when yes, every store as an equal secondary button sorted by the user's region then alphabetically, "Add to routine", "Ingredients" (expands the INCI inline). No images, no reviews, no pros and cons, no "best pick". Once per session under the first cards: "Products come from our catalog of ingredients, prices and store links. No reviews, no ads, no commissions."

### 5.11 Retailer dashboard (desktop-first)

Persistent full-width banner: "Synthetic demo cohort + team data · 500 simulated users and N real users · simulated outcomes follow Willow's measured noise model · About this data". Global filters: cohort, region, tone band, window (4 or 8 weeks), price tier. Tabs in the RETAILER_INSIGHTS order, each with the lead question as H1, three or four stat tiles with n, one chart, a table with CSV export. Open on tab 2, the product-by-tone-band heatmap with "62% (n=41)" in every cell and hatched "Hidden (under 10 users)" cells. Dot plots with Wilson intervals for brands, a goal-by-tier matrix for gaps, ranked clash pairs with "products that resolve it" for conflicts. Suppression is enforced in the BigQuery view and the API; the web never computes a suppressed value. Looker Studio embeds only on desktop inside a collapsed "Full report" section; phones get the native charts and a link. Tone bands are a slice, never a sort order by value.

### 5.12 Science page and privacy receipt

Science: headline "Every number comes from calibrated computer vision. Gemini writes the explanation; it never produces a measurement.", a stats panel with only defensible numbers (5 reference photos, 95%, MDC95 per metric from our validation, phones tested), a mini chart explaining the noise band with the forearm analogy, "Why we never rank skin tone", reference methods per metric with citations, first-person limits, and an algorithm changelog by engine version. Privacy receipt in Settings: what is stored, where, the deletion date, one-tap delete with a plain confirm and a completion state.

---

## 6. Flows

### 6.1 Judge first run (target: understanding in 60 s)

0-10 s: the landing sentence and the two band-bars draw. 10-30 s: one tap on any button lands on a real screen with one real-change chip and a band in view, plus at most three dismissable coach marks ("Grey band = your normal photo-to-photo variation", "Treated vs control", "Tap a point to see the photos and the explanation"). 30-60 s: guided chips at the bottom of each screen ("See the routine clash check", "Ask the advisor", "Retailer view"). Per-judge isolation: a fresh anonymous uid is seeded by the api from the read-only demo source on entry, so judges never collide and changes reset. "Try with sample photos" lists hosted sample sessions ("Forearm treated, +24 h, 5 frames") and runs the real pipeline on them with one tap; the download-and-upload path stays as a secondary link to show the upload UI.

### 6.2 Calibrated capture and upload

Set up Lightroom once (card with the exact taps; "Lock it once. Never change it again. If you do, tell Willow and we start a new baseline.") → ritual card → five-segment ring, tapping after each shot, reposition cue between shots → export to Files with the "Why Files?" disclosure → choose files (multi-select hint) → validation → immediate upload with progress, wake lock, retry, URL re-issue → processing notebook → report. Repeat sessions open with "Same setup as before? Yes / Something changed", and three frames instead of five.

### 6.3 Quick selfie

Pre-permission card → camera with the three-arc ring (lighting, distance, alignment) and one imperative at a time → auto-capture with a manual fallback → three frames with a ghost overlay between shots → review strip → upload → processing → first-reading report with the permanent trend-only badge.

### 6.4 Consent, goals, delete

Consent (four cards, toggle off by default) → goals (three chips, photo time) → "Start my baseline". Re-prompt only when the consent version changes, with a diff. Delete: Settings → "Delete my data" → plain confirm ("This removes photos, results and your account. There is no undo.") → completion state listing what was deleted.

### 6.5 Label scan to routine to outcome

Add product → scan or search → confirm what was read → catalog match → AM/PM and start date → compatibility check runs inline → outcome chip appears after the first session past the start date → tapping it opens the timeline filtered to that metric with the start marker highlighted and a sentence that quotes only engine numbers and hedges causation.

---

## 7. Component inventory and build order

Built in this order so every milestone has a complete, polished slice rather than many half-built screens.

| Order | Component | Used by | Notes |
|---|---|---|---|
| 1 | Tokens, fonts, `AppShell` (safe areas, header, demo bar), `Button`, `Chip`, `Sheet` (Vaul), `Toast` (Sonner) | all | M1-M2 |
| 2 | `BandBar` (SVG, shared band height, hollow/filled dot, animated `pathLength`) | landing, report rows, treated-vs-control, outcome popover | the signature primitive; build it first and well |
| 3 | `MetricRow` (label, confidence chip, value, delta, `BandBar`, verdict chip, info popover) | report | M2 |
| 4 | `UploadList` (file rows, validation, XHR PUT, progress, retry, wake lock) | capture | M1 test page, M2 final |
| 5 | `ProcessingNotebook` | capture | M2 |
| 6 | `PhotoStage` + `OverlayToggle` (segmented control, SVG clip-path masks) | report, compare | needs the preview image from the contract proposal |
| 7 | `ExplanationCard` (validated Gemini copy, quoted-number chips) | report, advisor | M3-M4 |
| 8 | `TimelineChart` (Recharts composed chart: band area, baseline reference line, points, event ticks) | timeline, outcome popover | M4 |
| 9 | `CompareSlider` (react-compare-slider; flicker mode via a toggle) | compare | M4 |
| 10 | `CaptureRing` (three arcs, Motion `pathLength`) and the quick-selfie camera | capture | M4 |
| 11 | `ConflictCard`, `ProductRow`, `OutcomeChip`, `LabelScanConfirm` | routine | M4 |
| 12 | `ChatTurn`, `RetrievalLine`, `ProductCard`, `StoreButtons`, `NumberChip` | advisor | M4 |
| 13 | `RetailerBanner`, `StatTile`, `Heatmap`, `DotPlot`, `SuppressedCell`, `DataTable` with CSV | retailer | M4 |
| 14 | `ConsentCards`, `GoalPicker`, `PrivacyReceipt` | onboarding, settings | M2 consent, M5 receipt |

---

## 8. Signature moments (the whole delight budget)

1. **The noise-band reveal (Timeline).** The baseline hairline appears; the grey band grows out of it (400 ms ease-out, `scaleY` from the baseline); the metric line draws left to right (`pathLength`, 500 ms); only then do out-of-band points ignite in signal blue with one 1.15 to 1 pulse and the label "Real change". In-band points never animate. The user watches the app decide what counts.
2. **The real-change stamp (Report).** The header count rolls once ("0" to "1 real change"). On the one row with a real change, the chip lands like a stamp (scale 1.12 to 1, -2° to 0, 450 ms spring, bounce 0.2) with a hairline ring that expands and fades once. Exactly once per report, never on re-render. Within-variation rows get nothing, which is the point.
3. **The capture ring.** One large ring of three arcs (lighting, distance, alignment), a Fraunces numeral in the centre, each arc filling willow green as its check passes; when all three are full the ring breathes once (1 to 1.03 to 1 over 1.2 s) and the shutter enables.
4. **Processing as a lab notebook.** Pending labels in text-2; each completes by morphing into its result with the number rolling in and a check drawing.
5. **The within-variation chip you can tap.** It opens a sheet: "Changes smaller than 1.8 ΔE are photo noise for you. Your five reference photos varied by that much." Nobody else explains their noise floor.
6. **The overlay toggle.** Segmented control with a sliding thumb; the mask fades in over 220 ms and, on first use only, traces its outline once.

Everything else moves only in response to a tap.

---

## 9. Copy system

Verdict ladder (chip, then one line under the number):

| Verdict | Chip | Line |
|---|---|---|
| `real_change` | Real change | "Outside your normal photo-to-photo variation. This is a measurable change." then the UX_SPEC direction phrase |
| `within_noise` | Within normal photo variation | "Today's reading sits inside your noise band (±1.1). Nothing measurable has changed yet. Most skincare effects take 4-8 weeks to exceed photo noise." |
| `no_baseline` | First reading | "This is your reference point. Future photos are compared to it." |
| `low_quality` | Photo quality too low to compare | "Lighting or framing differed too much from your reference. Retake to compare." plus the specific reason |

Quality reason copy (one line each, from research/03): card not found, card colours off, soft (blurry), too bright or too dark, face turned, no face found, something covering the skin, too few usable photos ("Baselines need 5 so we can measure your normal photo-to-photo variation").

Rules: say what the measurement is, not what the product failed to do; put the band number in the sentence; add a time horizon; never "no improvement", "normal" alone, "flaws", "fix", "fairness", "whitening", "brighter" for tone, any disease name, any skin age or score; every number in Gemini copy must exist in the input; the mole line is verbatim from CLAUDE.md; disclaimers sit next to the first answer, not only in a footer; active voice, sentence case, buttons name what happens ("Start my baseline", "Choose 5 DNG files", "Delete my data"), and the same verb carries through to its confirmation.

---

## 10. Accessibility and quality floor

WCAG AA on every text pair in section 4.2; never colour-only meaning (icon plus word plus colour on every chip and conflict); 44 px minimum targets with 8 px spacing; visible focus rings in signal-500; labels on every input and the file picker; alt text on compare images describes the measured difference, not "before and after"; charts ship a visible data table fallback and keyboard focus reveals values; reduced motion honoured everywhere; no horizontal page scroll at 375 px; no layout shift from fonts or images (reserve space; `size-adjust`); screen reader text for the band ("inside your noise band, 0.3 below baseline").

---

## 11. Anti-pattern checklist (run before every web PR)

- [ ] No purple, indigo or gradient text; no blurred colour orbs; no chroma above 0.14 anywhere
- [ ] No Inter, Roboto, Instrument Serif; Fraunces only at 24 px and above
- [ ] No single radius on everything; no shadow under rows; no glassmorphism beyond the header
- [ ] No centered hero with a pill and three icon cards; no fake stats; no "seamless", "elevate", "unlock", "AI-powered"
- [ ] No emoji as icons; no icon per feature; icons only where they carry meaning
- [ ] Nothing animates on scroll; no stagger on routine screens; no looping animation outside processing
- [ ] No product on the Report; no highlighted store; no reviews or ratings anywhere
- [ ] No skin age, overall score, percentile, population comparison, "needs attention" band, red for within-variation
- [ ] No dark surround behind a photo; no tinted photo
- [ ] Unmodified shadcn tokens never reach a screen

---

## 12. Libraries (versions verified on Oct 13, 2026; all at least two weeks old)

| Need | Package | Version (date) |
|---|---|---|
| Build | vite | 8.3.1 (Sep 24) |
| UI | react, react-dom | 19.3.0 (Sep 9), `<ViewTransition>` stable |
| Styling | tailwindcss, @tailwindcss/vite | 4.3.3 (Jul 16) |
| Fonts | @fontsource-variable/fraunces, @fontsource-variable/atkinson-hyperlegible-next, @fontsource-variable/atkinson-hyperlegible-mono | 5.3.x (Jul 2026) |
| Animation | motion | 13.4.6 (Sep 29) |
| Numbers | @number-flow/react | 0.6.2 (Jul 18) |
| Sheets | vaul | 1.1.2 (Dec 2024, stable) |
| Toasts | sonner | 2.0.8 (Aug 9) |
| Primitives | radix-ui | 1.6.7 (Jul 24), scaffolded through shadcn 4.21.0 then re-tokened |
| Before/after | react-compare-slider | 4.0.0 (Mar 20) |
| Charts | recharts | 3.10.1 (Jul 25); sparklines and band-bars are hand-written SVG |
| Icons | lucide-react | 1.49.0 (Sep 29), plus three custom line icons (leaf, colour card, ring) |
| Firebase | firebase | 12.19.0 (Sep 9); 13.0.0 is too new |
| Router | react-router-dom | 7.18.4 (Sep 15) |

Not used: GSAP (second animation runtime for no gain), Rive and Lottie (runtime weight and battery on iPhone), Base UI (still a release candidate), Observable Plot (imperative DOM).

---

## 13. What this brief implies elsewhere

- **Contract proposals already filed** (`docs/CONTRACT_CHANGES.md`): aligned preview image (needed by the photo stage, overlays and compare), optional forearm ROI, semi-calibrated convention.
- **api additions (Niwin, no contract change):** re-issue signed URLs for an existing session; session `note` and `deviation` flag; sample sessions that reference hosted frames in `demo/` (approved Oct 13); per-judge demo clone on entry; `DELETE /v1/me`; a label-scan confirm step (the scan returns a draft, the user confirms, then it is stored). No extra per-user caps beyond the advisor's 20 turns per day in GEMINI_SPEC (decided Oct 13: the link is not expected to leak).
- **Data:** suppression in the BigQuery `product_outcomes` view and in `/v1/retailer/insights` with `n` and `suppressed` per cell; complementary suppression when exactly one child is hidden.
- **Capture protocol (Harshini):** confirm the DNG size Lightroom writes on the 17 Pro Max and prefer 12 or 24 MP; capture both forearm squares in one frame; confirm whether white balance and focus persist between Lightroom launches.
- **Docs:** `docs/DECISIONS.md` gets the direction decision; `docs/UX_SPEC.md` points here.

## 14. Open decisions

1. Type lock after the first screenshot review (Atkinson versus Geist for UI text).
2. One minimum instance on both Cloud Run services during judging, so the 60-second judge path is never a 50-second cold start (cost estimate in `docs/RISKS.md`).
3. Whether the forearm compare uses a single-frame paired slider (both squares in one photo) or two aligned images; depends on how Harshini captures.
4. Preview image: schema field (proposal 1 in `docs/CONTRACT_CHANGES.md`) or the no-schema-change file convention (proposal 1b).
