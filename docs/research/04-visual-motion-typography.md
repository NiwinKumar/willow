# Research 04: Visual, motion and typography direction for Willow

Date: 2026-10-13. Scope: React + Vite + TypeScript + Tailwind v4, iPhone Safari first, desktop retailer dashboard second, 5-day build, judged partly on UI/UX. Version dates below come from `npm view <pkg> time` run on 2026-10-13; "OK" means released at least two weeks before 2026-10-13.

## 0. What the evidence says makes health/beauty/science products feel premium in 2025-2026

Patterns that recur across the brand sites, product teams and design-press sources studied (sources in section 8):

1. **One headline, then drill-down, everything relative to the person's own baseline.** Oura's late-2025 redesign centres Today on "one big thing" and anchors Vitals to personalised baselines rather than population ranges; Whoop's 2025 home screen is score-first with tiles as "doorways, not destinations"; density rises in deliberate steps across separate screens. Willow's "N real changes since your baseline" header + metric cards is the same shape. (ouraring.com, 925studios Whoop breakdown)
2. **Colour carries meaning, nothing arbitrary.** Whoop: a narrow palette where each colour is a state; "no arbitrary accent colours". Oura: a new colour system that signals body state. Willow's brief (one accent for real change, grey for noise) is already aligned; the risk is adding decorative colour on top.
3. **Warm, desaturated neutrals replaced cool blue-greys.** Linear's March 2026 refresh moved both themes "from a cool, blue-tinted hue to a warmer, less saturated grey", dimmed navigation so content wins, cut dividers ("structure should be felt not seen"), and shrank icons. Practitioner colour guides say pure zero-chroma grey "feels lifeless next to a coloured brand" and recommend low-chroma tinted neutrals with chroma falling toward white/black. (linear.app, Impeccable colour reference)
4. **Science is shown as concrete numbers in the product name, not as "clinically proven" claims.** Typology ("Vitamine C 15% + Vitamine E 1%", "Formuler avec moins, exiger plus"), Dieux ("0.05% Next-Gen Retinal Serum", "explained down to the molecule"), Function Health ("$1 per day", biomarker counts per category). Augustinus Bader leads with awards and "visibly restored" language; a Dec 2025 audit praised structure but flagged weak mobile performance. The premium signal is specificity and restraint, not adjectives.
5. **Typography is the centrepiece in 2026, but used with restraint.** Figma's and Envato's 2026 trend reports: oversized headlines, variable fonts, dynamic serif/sans pairings; Siteinspire curates "clean, minimal, typography-driven"; Godly skews bold and brand-led. Motion is "purposeful, scroll-driven rather than decorative"; micro-interactions "used with restraint".
6. **Expressive but calm.** Google's M3 Expressive research (46 studies, 18k+ participants) found expressive designs preferred across ages and key elements found up to 4x faster, but "a strong minority preferred calmer designs" and breaking standard patterns hurt usability. For a health/skin product, take the shape/size/containment hierarchy, skip the bounce.
7. **Fluidity = continuity.** Benji Taylor's Family principles: Simplicity -> Fluidity -> Delight; motion links screens so people can follow their path; button labels morph rather than swap; persistent elements move instead of duplicating; delight intensity scales inversely with usage frequency ("Delight-Impact Curve"). Emil Kowalski: ease-out, under ~300 ms, transform/opacity only, interruptible, skip animation on repeated keyboard actions, respect reduced motion.
8. **What reads as "AI-generated" is a specific, documented bundle** (section 7), and the fix is a concrete design system, not adjectives.

## 1. Three candidate directions and the pick

### A. "Herbarium Lab" (recommended)
Warm bone paper background, ink-dark green-black text, willow sage-green as the only brand hue, copper "bark" as the single accent for real change, a hatched warm grey for noise. A low-contrast serif display face with optical sizing (Fraunces) for headlines and verdict copy, a neutral grotesque (Geist) for UI, and tabular/mono numerals for every measurement. Hairline rules, generous margins, cards that are "felt not seen" (tonal, not bordered), a thin pressed-leaf/line-drawing motif used once or twice (capture ring, empty states), never as decoration on every card. Photos sit on a neutral mid-grey "stage" regardless of theme so skin tones are judged fairly. Feels like a beautifully typeset field notebook that happens to contain a lab's numbers: rich, calm, honest, inclusive. Closest references: Aesop's editorial restraint, Typology's percentage-first science, Oura's one-big-thing hierarchy, Linear's warm greys.

### B. "Clinical Dark"
Whoop/Superpower-style near-black dashboard, large mono numerals, green/amber state glows, dense tiles, sparklines everywhere. Strong "data instrument" feel and fast to build with defaults. Rejected as the primary because (a) dark surrounds make images look brighter and less saturated and flatten perceived contrast (darktable / ISO 12646 colour-assessment guidance), which is exactly wrong for a product whose core claim is fair skin-tone measurement; (b) dark + glow + mono is now the default AI/fintech look and reads "generic"; (c) Whoop's dark justification (glare at 5 am) does not apply to a weekly skincare check-in. Keep as the retailer dashboard's optional theme only if time remains (it will not).

### C. "Soft Lab"
Typology/Dieux-style white, clean sans everywhere, pill badges, rounded cards, soft shadows, pastel sage, percentages in product names. Safe, quick, approachable, but it is the median DTC skincare site and the median shadcn app; judges have seen it hundreds of times. Rejected because it provides no memorable signature and shares most of the "AI-generated" tells.

**Pick: A, with B's data discipline** (one headline score, tiles as doorways, meaning-only colour, tabular numerals), and C's copy habit (numbers in the sentence, not adjectives).

## 2. Type system

All fonts are SIL OFL 1.1, self-hosted via Fontsource (no Google Fonts request on the critical path; better privacy and iOS Safari font-loading control). Fontsource packages below are all at 5.3.0 (released 2026-07-19, OK).

| Role | Font | Why | Package / source |
|---|---|---|---|
| Display (H1-H2, verdict headline, landing) | **Fraunces** variable (wght 100-900, opsz 9-144, SOFT 0-100, WONK 0/1) | Old-style "soft" serif with optical sizing; distinctive without being a 2025 cliche; WONK auto-engages above 18px for character, disables at small sizes | `@fontsource-variable/fraunces` (OFL; github.com/undercasetype/Fraunces) |
| Display alternative | Newsreader variable (opsz 6-72, wght 200-800, italic) | Calmer, more "journal"; use if Fraunces feels too playful in review | `@fontsource-variable/newsreader` (OFL) |
| UI text (body, labels, buttons, chat) | **Geist** variable (wght 100-900, italic) | Neutral grotesque with `tnum`, `pnum`, `ss01-ss11`, `frac`, `sups`, `case` confirmed; pairs with Geist Mono | `@fontsource-variable/geist` (OFL; vercel/geist-font) |
| Numerals (metric values, units, deltas, timestamps, chart axes) | **Geist Mono** variable, fallback JetBrains Mono | Monospace = inherently tabular; "instrument" feel; sparkline/axis alignment for free | `@fontsource-variable/geist-mono`, `@fontsource-variable/jetbrains-mono` (OFL) |

Do **not** use Instrument Serif italic for headlines: it is single-weight (400 + italic only), and the "Instrument Serif italic over Inter" combo is now one of the most recognisable AI-landing-page tells. Avoid Inter as the UI face for the same reason (it is the default of every design tool and most generated UI).

Fraunces settings: `font-variation-settings: "opsz" 96, "SOFT" 30, "WONK" 1; font-weight: 450;` for H1; `"opsz" 48, "SOFT" 20` for H2. Keep weight at or under 500; heavy Fraunces looks like a bakery.

Numerals: `font-variant-numeric: tabular-nums slashed-zero;` on every element that shows a number (Tailwind: `tabular-nums slashed-zero`). NumberFlow explicitly requires `tabular-nums` to avoid width jitter. Units sit in Geist (not mono) at 0.75em, lowercase, `text-2` colour, 0.25em gap: `3.2 <span>ΔE</span>`.

Scale (mobile-first, 1.2 ratio for text, larger jumps for display; use `clamp()` for display on desktop):

| Token | Size / line-height | Font | Use |
|---|---|---|---|
| `display-xl` | clamp(40px, 9vw, 64px) / 1.0 | Fraunces 450, opsz 144 | Landing H1, "1 real change" |
| `display-l` | 32px / 1.1 | Fraunces 450, opsz 96 | Report header, section titles |
| `display-m` | 24px / 1.2 | Fraunces 450, opsz 48 | Screen titles, metric detail |
| `metric-value` | 28px / 1.0 | Geist Mono 500, tnum | Metric card value |
| `metric-value-s` | 18px / 1.0 | Geist Mono 500 | Timeline readout, deltas |
| `body-l` | 17px / 1.5 | Geist 400 | Explanations, chat |
| `body` | 15px / 1.5 | Geist 400 | Default UI text |
| `label` | 13px / 1.3, +0.01em tracking | Geist 500 | Chips, badges, buttons |
| `caption` | 12px / 1.3 | Geist 400 / Mono for numbers | Axis labels, timestamps, disclaimers |

Tracking: display -0.02em, body 0, labels +0.01em, all-caps labels +0.06em (use sparingly: group headers "Tone & pigment" only). Body text max width 36rem. iOS Safari: never set an input font-size below 16px or Safari zooms the page on focus.

Font loading: preload the two variable woff2 files used above the fold (Fraunces subset `latin`, Geist `latin`), `font-display: swap`, and set `size-adjust` fallback metrics (Georgia for Fraunces, system-ui for Geist) to minimise CLS. Fraunces full variable is heavy; use Fontsource's `latin` subset only and drop the italic axis file.

## 3. Colour system (OKLCH)

Tailwind v4 defines its own palette in OKLCH and takes custom colours via `@theme { --color-*: oklch(...) }`, so these drop in directly. OKLCH is supported in Safari 15.4+, so no fallback is needed for iPhone Safari 18+. Hex values and WCAG ratios below were computed from the OKLCH values (script in scratchpad `contrast.py`).

```css
@import "tailwindcss";
@theme {
  /* canvas & surfaces (warm bone, hue 85, chroma falls toward white) */
  --color-bg:        oklch(0.975 0.008 85);   /* #f9f6f1 page */
  --color-surface:   oklch(0.992 0.004 85);   /* #fefcf9 cards */
  --color-surface-2: oklch(0.955 0.010 85);   /* #f3f0e9 inset/muted */
  --color-border:    oklch(0.900 0.012 85);   /* #e2ded5 hairlines (1.25:1, decorative only) */
  --color-stage:     oklch(0.620 0.000 0);    /* #868686 neutral photo stage, ~Munsell N6-7 */

  /* text (ink-green-black, hue 130) */
  --color-text:      oklch(0.240 0.018 130);  /* #1c2118  15.2:1 on bg */
  --color-text-2:    oklch(0.460 0.020 130);  /* #545a4f   6.6:1 on bg */
  --color-text-3:    oklch(0.580 0.015 100);  /* #7c7b71   4.0:1 on bg: 18px+ or non-essential only */

  /* willow (brand, hue 145, low chroma = sage) */
  --color-willow-50:  oklch(0.970 0.015 145); /* #eff8ef */
  --color-willow-100: oklch(0.940 0.030 145); /* #dff1df tint fills */
  --color-willow-500: oklch(0.580 0.085 145); /* #59885b icons, strokes, 3.8:1 (non-text) */
  --color-willow-600: oklch(0.500 0.085 145); /* #427044 primary button fill; surface-on-600 5.65:1 */
  --color-willow-700: oklch(0.420 0.080 145); /* #2f5831 brand text on bg 7.6:1; on willow-100 6.9:1 */

  /* bark (the ONE accent: "real change"; copper from willow bark) */
  --color-bark-100:  oklch(0.940 0.035 55);   /* #ffe6d6 badge fill */
  --color-bark-500:  oklch(0.620 0.130 45);   /* #c56a3e strokes, chart points (non-text) */
  --color-bark-600:  oklch(0.550 0.130 45);   /* #ae5528 badge text on bg 4.8:1; surface-on-600 5.0:1 */
  --color-bark-700:  oklch(0.470 0.120 45);   /* #904016 text on bg 6.7:1; on bark-100 6.0:1 */

  /* noise (within normal photo variation) */
  --color-noise-band: oklch(0.930 0.006 85);  /* #eae8e3 timeline band fill */
  --color-noise-500:  oklch(0.660 0.010 85);  /* #95928b band edge, sparkline of noisy metric (non-text) */
  --color-noise-700:  oklch(0.520 0.012 85);  /* #6c6861 badge text 5.1:1 */

  /* semantic states (rare; never for verdicts) */
  --color-warn:       oklch(0.760 0.140 80);  /* #dfa635 quality-issue icon */
  --color-warn-text:  oklch(0.520 0.130 70);  /* #975800 5.3:1 */
  --color-danger:     oklch(0.550 0.170 28);  /* #c13d34 upload/consent errors only, 4.9:1 */
  --color-info:       oklch(0.520 0.070 235); /* #3d6f8c "Indicative"/"trend only" chip text, 5.1:1 */
  --color-focus:      var(--color-willow-500);
}
```

Mapping to product vocabulary (from `docs/CONTRACT.md` 2.4 and `docs/UX_SPEC.md`):

| State | Fill | Text/stroke | Notes |
|---|---|---|---|
| `real_change` | bark-100 | bark-700 (text), bark-500 (dot/point) | Direction is given by the arrow glyph and the number, not by a second colour. Never red/green for better/worse: a smaller redness index and a larger hydration proxy are both "real change". |
| `within_noise` | noise-band | noise-700 | Add 45-degree hatching at 8% in the badge so it is not just "grey = disabled". |
| `no_baseline` | willow-50 | willow-700 | "First reading" |
| `low_quality` | surface-2 | warn-text + warn icon | Never danger colour; it is a photo problem, not a skin problem |
| confidence `measured` | willow-50 | willow-700 | |
| confidence `indicative` / trend only | surface-2 | info | Blue-grey reads "note", not "warning" |

Contrast notes: all text pairs above meet WCAG AA 4.5:1 except `text-3`, which is 4.0:1 and should only be used for 18px+ or decorative captions. `willow-500`, `bark-500`, `noise-500` are at 2.9-3.8:1: use them for icons, strokes and chart marks (3:1 non-text rule) and for 24px+ display only. APCA (WCAG 3 draft) is stricter for small light text; the chosen body pair `text` on `bg` (15.2:1) is comfortably above any APCA target.

Dark mode: **not for the MVP.** Evidence: (1) dark surrounds brighten and desaturate perceived image tone (darktable / ISO 12646); (2) the brief's warmth and "paper" feel is a light-mode idea; (3) a second theme doubles QA on a 5-day build. Do two cheap things instead: set `color-scheme: light` and `<meta name="theme-color" content="#f9f6f1">` so iOS Safari chrome matches, and put every photo, overlay and before/after slider on `--color-stage` with a 1px `surface` inner border (the darktable "thin white reference border" idea) so whites and skin tones have a fixed reference. If a dark theme is ever added for the retailer dashboard: bg `oklch(0.19 0.012 130)` (#12150f), surface `oklch(0.24 0.012 130)`, text `oklch(0.95 0.008 85)` (15.9:1), text-2 `oklch(0.74 0.012 100)` (8.0:1), willow-500 (4.5:1) and bark-500 (4.8:1) still pass as text on it. Keep the photo stage identical in both themes.

Other colour rules: no gradients except a single 2-3% tonal wash on the landing hero (`willow-50` to `bg`); no glow; no coloured shadows; shadows are `0 1px 2px oklch(0.24 0.018 130 / 0.06)` at most, and most cards use `surface` on `bg` with no shadow at all (tonal layering, as Linear). Skin photos are never tinted, never behind a translucent colour layer.

## 4. Motion system

Principles (Kowalski, Apple HIG, Family): purpose over spectacle; ease-out for anything the user triggered; under 300 ms except sheets and the three signature moments; animate only `transform`, `opacity`, `clip-path`; every animation interruptible; the delight budget goes to rare moments (first real change, first report), not to things seen every visit; "let people cancel motion" (never block input on an animation).

Tokens (Tailwind `@theme`):

```css
--ease-out:     cubic-bezier(0.22, 1, 0.36, 1);     /* enters, hovers, presses release */
--ease-in:      cubic-bezier(0.4, 0, 1, 1);         /* exits only, shorter */
--ease-in-out:  cubic-bezier(0.65, 0, 0.35, 1);     /* on-screen moves (segmented thumb) */
--dur-instant:  80ms;   /* press feedback */
--dur-fast:     140ms;  /* hover, chip, toggle, exit */
--dur-base:     220ms;  /* enter, reveal, overlay fade */
--dur-slow:     320ms;  /* sheet, route transition */
--dur-moment:   700ms;  /* signature moments only */
```

Springs (Motion's duration/bounce API, which maps to physical springs and is easier to tune than stiffness/damping): `{ type: "spring", visualDuration: 0.3, bounce: 0.1 }` for sheets and layout moves; `{ visualDuration: 0.45, bounce: 0.2 }` for the one "stamp" moment. Rationale: Material's expressive scheme is "more overshoot, longer settle" than standard; for a health product take the standard-scheme feel (community ports list standard spatial default around damping 0.9, expressive around 0.8; treat those numbers as unofficial). Bounce above 0.25 reads playful/fintech.

What gets motion:

| Interaction | Motion | Duration / easing |
|---|---|---|
| Button / card press | scale 0.97, `--dur-instant` in, `--dur-fast` out (asymmetric) | ease-out |
| Chips, toggles, overlay switch | opacity + 4px translate; segmented thumb slides with `layoutId` | fast / in-out |
| Metric cards on Report mount | stagger 30 ms per card, max 8 cards, 8px rise + fade | base, ease-out |
| Bottom sheets (goal picker, metric detail, product card) | Vaul drawer, drag-to-dismiss, snap points | ~400 ms spring, no bounce |
| Route changes | React 19.3 `<ViewTransition>` cross-fade; metric card -> metric detail uses a shared-element `name` on the value and sparkline | slow |
| Number changes | NumberFlow digit roll, `trend` follows sign | its default timing (~750 ms); only when a value is first revealed or changes, never on scroll |
| Timeline reveal | noise band grows from the baseline line, then line draws (`pathLength` 0->1), then out-of-band points pop | moment (see section 6) |
| Before/after slider | handle follows finger with no easing; 150 ms ease-out when tapped (library default) | - |
| Toasts (Sonner) | library default (bottom, iOS-safe-area aware) | - |
| Processing stages | label morphs to result; checkmark stroke draws | base |

Reduced motion (`prefers-reduced-motion: reduce`, Safari 10.1+, mirrors iOS Reduce Motion): all translates become 0 (opacity-only fades at `--dur-fast`), stagger 0, NumberFlow disables itself (`respectMotionPreference` default true), react-compare-slider drops its transition automatically, Vaul keeps drag but sheets fade, path-draw animations show the final state immediately, View Transitions use a plain cross-fade (set `::view-transition-group(*) { animation-duration: 120ms }` under the media query). Use Motion's `useReducedMotion()` and `<MotionConfig reducedMotion="user">` once at the root so this is automatic. Never auto-play looping animation on the Report; the only loop is the processing indicator.

iPhone Safari risks: `backdrop-filter` blur over scrolling content is expensive and janky, limit to the fixed header at most; `100vh` is wrong, use `100dvh` and `env(safe-area-inset-*)`; `will-change` on many elements explodes memory, apply only during an animation; `position: fixed` inputs plus the on-screen keyboard shift the viewport, keep chat composer in a flex column; `@starting-style` combined with scroll-driven animations behaved inconsistently in Safari in a Nov 2025 test (bram.us), so do entries in JS/Motion, not CSS scroll timelines; large canvas/WebGL (Rive) costs battery and bundle; autoplay video needs `playsinline muted`.

## 5. Library and chart recommendations (versions as of 2026-10-13)

| Need | Pick | Version (date) | Notes |
|---|---|---|---|
| Component animation, shared layout, gestures | **motion** (`motion/react`) | **13.4.6 (2026-09-29, OK)** | 14.0.0 (2026-10-02) and 14.1.1 (2026-10-13) are too new for the 2-week rule but have no breaking changes for React, so upgrade later is trivial. MIT. `layoutId`, `AnimatePresence`, `useReducedMotion`, `MotionConfig`. |
| Route / shared-element transitions | **React 19.3 `<ViewTransition>`** + `addTransitionType` | react 19.3.0 (2026-09-09, OK) | Stable in 19.3; same-document View Transitions supported in Safari/iOS 18.0+ (caniuse), cross-document 18.2+. Animates only inside `startTransition`/Suspense; gracefully no-ops where unsupported. Use for route changes only; Motion for in-page. |
| Animated numbers | **@number-flow/react** | 0.6.2 (2026-07-18, OK) | Dependency-free, honours reduced motion, `trend`, `NumberFlowGroup`; requires `tabular-nums`. MIT. |
| Bottom sheets | **vaul** | 1.1.2 (2024-12-14, OK) | Stable, iOS-tested drag sheet by Kowalski; no release since Dec 2024 but it is feature-complete and widely used; shadcn's Drawer wraps it. MIT. |
| Toasts | **sonner** | 2.0.8 (2026-08-09, OK) | MIT. |
| Primitives | **radix-ui** (unified package) via shadcn | radix-ui 1.6.7 (2026-07-24, OK); shadcn CLI 4.21.0 (2026-09-04, OK) | Use shadcn only as a primitives scaffold, then replace its tokens/radius/shadows with section 3 (see section 7). Base UI is still `1.0.0-rc.0` (2025-12-04): skip. |
| Before/after | **react-compare-slider** | 4.0.0 (2026-03-20, OK) | v4: `defaultPosition`, CSS-var handle colour, `onlyHandleDraggable` defaults true on touch, honours reduced motion, high-contrast handle. MIT. |
| Charts (timeline with band, retailer dashboard) | **recharts** | 3.10.1 (2026-07-25, OK) | `ComposedChart` with `Area` (band = `[lo, hi]` range area) + `Line` + `ReferenceLine` (baseline) is a one-evening job. MIT. |
| Sparklines in metric cards | **hand-written SVG** (`<polyline>` + band `<path>`) | - | 30 lines, no bundle cost, lets the band and bark points share tokens; animate with Motion `pathLength`. |
| Charts alternative (more control) | @visx/xychart + @visx/shape | 4.0.0 (2026-06-11, OK) | Only if Recharts fights you on the band. Observable Plot 0.6.17 (2025-02-14) is imperative DOM and awkward in React: skip. |
| Icons | lucide-react | 1.49.0 (2026-09-29, OK); 1.50.0+ are under two weeks old | Use a small, consistent set; swap in 2-3 custom line icons (leaf, colour card, ring) for brand moments. |
| Styling | tailwindcss + @tailwindcss/vite | 4.3.3 (2026-07-16, OK) | OKLCH-native `@theme`. |
| Build | vite | 8.2.4 (2026-10-06) is 7 days old; prefer 8.1.x if the scaffold allows, else accept | Check what the existing scaffold pins. |
| Not recommended | GSAP 3.15.0 (2026-04-13; now 100% free incl. plugins since 3.13, 2025-04-29, under Webflow) | Excellent, but a second animation runtime next to Motion for no gain in a 5-day app. |
| Not recommended | Rive (@rive-app/react-canvas 4.36.0, 2026-09-30) and Lottie (@lottiefiles/dotlottie-react 0.19.16, 2026-08-28) | WASM/canvas runtimes, authoring time, battery on iPhone; independent 2025 benchmarks were not found. The capture guide can be drawn with SVG + Motion. |
| Not recommended | react-spring 10.1.2 (2026-06-24) | Fine library, but Motion already covers springs. |

## 6. Signature moments

1. **The noise band reveal (Timeline).** Order matters: first the baseline hairline, then the grey noise band *grows* out of the baseline (scaleY from the baseline, 400 ms ease-out), then the metric line draws left-to-right (`pathLength`, 500 ms), and only then do points outside the band "ignite" in bark copper with one 1.15-to-1 scale pulse and a label ("Real change"). Points inside the band stay noise-grey. The user literally watches the app decide what counts. Honesty becomes the animation.
2. **The real-change stamp (Report header and card).** The header count rolls in with NumberFlow ("0" -> "1 real change since your baseline"). On the one card with `real_change`, the verdict badge lands like an ink stamp (scale 1.12 -> 1, slight -2deg -> 0 rotation, 450 ms spring, bounce 0.2) with a hairline ring that expands and fades once. Used exactly once per report, never on re-render; `within_noise` cards get no stamp, which is the point.
3. **The capture ritual.** A single large ring (Fraunces numeral in the centre for the countdown) made of three arcs: lighting, distance, alignment. Each arc fills willow-green as its check passes (Motion `pathLength`); when all three are green the ring breathes once (scale 1 -> 1.03 -> 1, 1.2 s) and the shutter enables. Copy is one short line per arc ("Move a little closer", "Face the window"). This turns the protocol into a calm, repeatable ritual and demos beautifully on video.
4. **Processing as a lab notebook.** Vertical list of stages; each pending label is `text-2`; when a stage completes its label morphs to its result ("Finding colour card" -> "Colour card found, ΔE 1.2") with the number via NumberFlow and a drawn checkmark. The report then slides up as a sheet over the last stage, keeping continuity (Family's "elements persist rather than duplicate").
5. **Overlay toggle on the photo.** Segmented control ("Photo / Redness / Pores") with a sliding thumb; the overlay mask is drawn as an SVG `clip-path` that fades in 220 ms and, on first use, traces its outline once (`stroke-dashoffset`). Photo stays on the neutral stage with a 1px white reference border.
6. **Before/after slider.** Hairline handle with a tiny leaf grip, labels "Day 0" / "Day 28" in Geist Mono tabular, the stage is `--color-stage`, and the metric readout under the slider updates with NumberFlow as the handle crosses the midpoint (left of centre shows baseline values, right shows current).
7. **Within-noise honesty chip.** Grey badge with faint hatching and copy "Within normal photo variation". Tapping it opens a sheet showing the band width for that metric in the same units ("Changes smaller than 1.8 ΔE are photo noise for you"). Nobody else explains their noise floor.
8. **Advisor shelf.** Product cards in chat arrive as a horizontal "shelf" that slides up from the composer, each card a bone-paper tile with the concern-to-metric link in bark copper only when the metric showed real change. Compatibility check renders as a small ingredient grid with hairlines, not traffic lights.

## 7. Anti-patterns that make apps look AI-generated (and the Willow rule for each)

Documented in 2025-2026 writing (superdesign.dev, VP0, noqta, the "purple gradient" post, the unslop-ui skill):

| Tell | Willow rule |
|---|---|
| Purple/indigo-to-blue gradients, gradient headline text, blurred colour orbs | No gradient except a 2-3% tonal wash on landing; zero chroma above 0.14 anywhere |
| Inter or Roboto (or Geist Sans alone) as the whole personality; Instrument Serif italic hero | Fraunces display + Geist text + Geist Mono numerals; the serif only at 24px+ |
| One exaggerated radius on everything (cards, inputs, badges, images) | Radii: 4px chips, 8px inputs/buttons, 12px cards, 20px sheets, photos 8px; never pill buttons except chips |
| Soft drop shadow at fixed low opacity on every card; glassmorphism everywhere | Tonal layering (surface on bg); `backdrop-filter` only on the fixed header |
| Centered hero + "Introducing" pill + primary/ghost button pair + three icon cards | Landing is one left-aligned Fraunces sentence with a real number in it, one button, one photo-on-stage |
| Lucide icon per feature; emoji as icons; neon glow on dark | Icons only where they carry meaning; three custom line icons for brand moments; no glow |
| Identical density and rhythm on every section | Report is dense (cards), Timeline is spacious (one chart), Capture is a single ring |
| "Seamless", "elevate", "unlock", "supercharge", "AI-powered" | Copy rule from UX_SPEC: calm and honest, numbers in the sentence, no superlatives |
| Fake stats ("10k+ users", "99.9%"), lorem-ish sample data | Demo data comes from real fixtures with real units |
| Unmodified shadcn zinc theme | Run `shadcn` for primitives only, then overwrite `--radius`, colours, shadows, fonts with sections 2-4 before building a single screen |
| Everything animates on scroll | Nothing animates on scroll; motion is triggered by user action or by data arriving |
| Dark mode "because premium" | Light paper + neutral grey photo stage, for measurement fairness |

## 8. Sources

Brand and product experiences
- Oura, "A New Look for the Oura App" (late 2025): https://ouraring.com/blog/new-app-design/
- 925 Studios, "WHOOP Design Breakdown: Data-Dense UI That Feels Simple": https://www.925studios.co/blog/whoop-design-breakdown
- WHOOP, "The all-new WHOOP Home screen": https://www.whoop.com/us/en/thelocker/the-all-new-whoop-home-screen/
- Superpower App Store listing (dashboard/score positioning): https://apps.apple.com/us/app/superpower/id6747997159
- Elo Health 2026 biomarker test review (Function "medical" vs Superpower "dashboard"): https://elo.health/blogs/articles/the-best-comprehensive-blood-biomarker-tests-2026-review
- Function Health homepage (copy and layout): https://www.functionhealth.com/
- Typology homepage (percentage-first product naming): https://www.typology.com/
- Dieux homepage (concentrations, "down to the molecule"): https://dieuxskin.com/
- Augustinus Bader site audit, Dec 2025 (theacare.de): https://www.theacare.de/post/augustinus-baders-science-first-playbook-a-digital-and-brand-strategy-breakdown-for-skincare-marketing-leaders
- Augustinus Bader homepage: https://augustinusbader.com/en-eu
- Aesop homepage returned HTTP 403 to automated fetch; not analysed first-hand.

Product design posts
- Linear, "Behind the latest design refresh" (2026-03-12): https://linear.app/blog/behind-the-latest-design-refresh
- Linear, "How we redesigned the Linear UI": https://linear.app/blog/how-we-redesigned-the-linear-ui
- Benji Taylor, "Family Values" (Simplicity, Fluidity, Delight; trays; continuity): https://benji.org/family-values
- Google Design, "Expressive design: Google's research" (46 studies, 18k participants): https://design.google/library/expressive-material-design-google-research
- Material 3 motion overview (JS-rendered; spring token values quoted via community ports and flagged unofficial): https://m3.material.io/styles/motion/overview/how-it-works ; Flutter `motor` port with stiffness/damping tables: https://pub.dev/packages/motor
- Apple HIG, Motion ("Add motion purposefully", "Don't add motion for the sake of adding motion", "Make motion optional", "Let people cancel motion"): https://developer.apple.com/design/human-interface-guidelines/motion
- Emil Kowalski, "Great animations" (ease-out, <300 ms, transform/opacity, interruptible, reduced motion): https://emilkowal.ski/ui/great-animations

Trends and galleries
- Figma, "Top Web Design Trends for 2026": https://www.figma.com/resource-library/web-design-trends/
- Envato, "Web design trends for 2026: kinetic type, broken grids": https://elements.envato.com/learn/web-design-trends
- Inspire Fusion, inspiration-site comparison (Awwwards/Godly/Siteinspire positioning): https://www.inspirefusion.com/best-inspiration-for-web-design/
- reallygooddesigns, "Top 10 Web Design Trends 2026": https://reallygooddesigns.com/web-design-trends-2026/

AI-generated look
- superdesign.dev, "Why AI design looks generic": https://www.superdesign.dev/blog/why-ai-design-looks-generic
- VP0, "Why does my AI app look generic?": https://vp0.com/blogs/why-does-my-ai-app-look-generic
- noqta, "AI design slop: overused UI patterns and how to fix them (2026)": https://noqta.tn/en/blog/ai-design-slop-overused-ui-patterns-fix-2026
- "Why your AI keeps building the same purple gradient website": https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website

Typography
- Fraunces (axes opsz/SOFT/WONK; OFL): https://github.com/undercasetype/Fraunces and https://fonts.google.com/specimen/Fraunces/about
- Geist (OFL 1.1; tnum/pnum/ss01-11 features): https://fontsource.org/fonts/geist/about and https://github.com/vercel/geist-font
- Instrument Serif (single weight + italic): https://fontsource.org/fonts/instrument-serif/cdn
- Tailwind `font-variant-numeric`: https://tailwindcss.com/docs/font-variant-numeric
- Type Network, "OpenType at work: figure styles": https://typenetwork.com/articles/opentype-at-work-figure-styles

Colour
- Tailwind v4 colours in OKLCH and `@theme`: https://tailwindcss.com/docs/colors
- OKLCH token blueprint (perceptual uniformity, browser support): https://dev.to/okabrionz/universal-oklch-color-system-blueprint-one-base-color-design-tokens-3639
- Impeccable "Color & Contrast" reference (tinted neutrals, chroma toward extremes): https://git.secluded.site/agent-skills/blob/main/vendor/impeccable/skill/reference/color-and-contrast.md
- darktable colour-assessment mode (dark surround brightens/desaturates; mid-grey frame, thin white border; ISO 12646:2008): https://docs.darktable.org/usermanual/5.6/en/module-reference/utility-modules/darkroom/color-assessment/
- Adobe forum on grey app backgrounds / Munsell N8 surround (anecdotal): https://community.adobe.com/t5/photoshop-ecosystem-discussions/why-is-the-background-color-of-the-photoshop-application-designed-gray/m-p/10078168

Platform and libraries
- caniuse, View Transitions (same-document; Safari/iOS 18.0+): https://caniuse.com/view-transitions
- caniuse, `@view-transition` cross-document (Safari/iOS 18.2+): https://caniuse.com/mdn-css_at-rules_view-transition
- React 19.3 release post (ViewTransition stable, addTransitionType), 2026-09-09: https://react.dev/blog/2026/09/09/react-19-3
- WebKit, "WebKit Features in Safari 26.0" (scroll-driven animations): https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- Bramus, scroll-driven animations + `@starting-style` Safari inconsistency (Nov 2025): https://www.bram.us/2025/11/06/combining-scroll-driven-animations-with-starting-style
- WebKit, prefers-reduced-motion test page: https://webkit.org/blog-files/prefers-reduced-motion/prm.htm
- Motion changelog and React upgrade guide (13: is-prop-valid; 14: no breaking changes): https://motion.dev/changelog and https://motion.dev/docs/react-upgrade-guide
- GSAP 3.13 "100% free" announcement, 2025-04-29: https://gsap.com/blog/3-13/
- NumberFlow docs: https://number-flow.barvian.me/
- react-compare-slider v4.0.0 release notes: https://github.com/nerdyman/react-compare-slider/releases
- Rive vs Lottie (vendor claims; no independent 2025 iOS Safari benchmark found): https://rive.app/blog/rive-as-a-lottie-alternative and https://callstack.com/blog/lottie-vs-rive-optimizing-mobile-app-animation
- npm registry `time` fields for all versions above, queried 2026-10-13.
