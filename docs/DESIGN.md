<!-- Version 3, Oct 15, 2026. Source: the Claude Design handoff (design-from-claude-design/handoff/, generated from
willow-ds.js). It replaces version 2 ("Lens"). Built references: design-from-claude-design/Willow App.dc.html (the app
shell and every destination), Willow App Routine.dc.html, Willow Capture.dc.html, Willow.dc.html (website) and
Willow Retail.dc.html. Tokens: web/src/styles/tokens.css, mapped to Tailwind in web/src/index.css. Where the
design and the backend disagree, the app follows the backend and docs/DESIGN_GAPS.md records it. -->

# Willow design system

Source of truth for the Willow web app (React + Vite + TypeScript + Tailwind, lucide-react, Firebase Hosting). Generated from `willow-ds.js`; tokens live in `web/src/styles/tokens.css` and `tailwind.config.ts`. Reference implementations: `Willow App.dc.html`, `Willow Capture.dc.html`, `Willow Routine.dc.html`, `Willow Retail.dc.html`, `Willow.dc.html`.

## What Willow is

The proof engine for skincare. Weekly phone photos (ideally iPhone RAW + colour card; quick selfie is lower-confidence) are measured by classical computer vision across 11 metrics. Each person’s own minimum detectable change (MDC) sets a noise band; Willow only says “Real change” when a difference exceeds it. Gemini explains, labels spots, reads ingredient labels, checks routines and runs a shopping advisor. It never produces numbers.

## Principles (non-negotiable)

1. **Calm and honest.** Show uncertainty plainly (“within noise”, “trend only”, “first reading”). No scores, streaks or confetti.
2. **Signal vs noise is the hero.** One accent (ember) means real change. Everything within noise is quiet grey. The shaded MDC band looks the same everywhere.
3. **Inclusive for every skin tone.** Monk 1–10. Tone is descriptive only: never a light-to-dark good/bad scale, never green/red on tone, no skin swatches as decoration.
4. **Science you can see.** Tabular numerals, units, info tips on every metric, confidence chips (Measured / Indicative / Trend only).
5. **Guided.** Every capture step says exactly what to do, with line drawings, never face photos.
6. **Mobile-first, arm’s length.** 15px body minimum, 44px+ targets, glass dock in thumb reach. Retail is desktop-first.
7. **Accessible.** WCAG 2.2 AA, glyph + text verdicts, visible focus, labelled inputs, reduced motion.
8. **Cosmetic, not medical.** No clinical red alerts. Gentle disclaimer on every report.

## Brand

| Word | Do | Don’t |
|---|---|---|
| Calm | Short sentences, lots of canvas, one thing per card. | Alert banners, exclamation marks, red. |
| Honest | “Within your normal range” when nothing changed. | “Keep going, results are coming!” |
| Precise | Units, MDC values, sample sizes, dates. | Rounded vague claims (“much better”). |
| Botanical | Frosted bloom blur, willow greens, soft grain. | Leaf clip-art, literal plant illustrations. |
| Warm | “Same window light as last time keeps results comparable.” | Clinical or robotic phrasing. |

**Logo.** Mark: 32px circle, radial #FFF7F0→#E7E3F6, holding a blurred tulip bud (radial #FF6B4A → #F25FA8 → #C9A8FF, blur 1.4px), stem #6FAE9C 1.5px, leaf #86C5B0 blurred 0.9px; inset 1px white + shadow-raised. Wordmark: lowercase “willow”, Outfit 300, −0.03em, ink. Lock-up gap 10px. Minimum mark 24px. On dark: wordmark white, mark unchanged.

**App icon.** App icon: squircle, willow-900 #0F3B3A ground with a soft lilac→periwinkle glow at bottom, the frosted tulip bud centred at 56% size, no wordmark, subtle grain. Reads at 29px because it is one blurred shape.

## Colour

One data accent: `signal-change` (ember #FF6A00) means Real change only. Aura hues are surfaces only and never encode data.

### Surfaces & background (light)

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--bg-canvas` | #ECEBE7 | Page canvas everywhere in the shopper app. Always under the grain overlay. | — |
| `--bg-surface` | #FAFAF8 | Cards, sheets, modals, list containers. | — |
| `--bg-sunken` | #F4F3F0 | Inputs, wells, chart plot area, skeleton base. | — |
| `--bg-muted` | #E9E7E2 | “Not measured” cards, disabled fills, table header rows. | — |
| `--bg-glass` | rgba(255,255,255,.60) | Dock, profile pill, segmented track, glass buttons. Always with backdrop-filter: blur(12–28px) saturate(1.5). | — |
| `--bg-scrim` | rgba(18,18,18,.32) | Behind bottom sheets and modals. | — |

### Text

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--text-primary` | #121212 | Headings, body, metric values. | 17.93:1 vs #FAFAF8 |
| `--text-secondary` | #5E5B56 | Supporting copy, units, captions, axis labels. Passes AA on canvas and surface. | 5.67:1 vs #ECEBE7 |
| `--text-disabled` | #8A867F | Disabled labels only. Not for readable body text. | 3.47:1 vs #FAFAF8 |
| `--text-inverse` | #FFFFFF | On black pills, ink buttons, dark retail surfaces. | 18.73:1 vs #121212 |

### Lines

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--line-subtle` | rgba(18,18,18,.12) | Row dividers, card hairlines, gridlines. | — |
| `--line-strong` | rgba(18,18,18,.24) | Input borders, unselected chip outline. | — |
| `--line-glass` | rgba(255,255,255,.80) | Inset 1px highlight on every card and glass surface. | — |

### Signal — the only data accent

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--signal-change` | #FF6A00 | Ember. Means “Real change” and nothing else: chart points/segments beyond the noise band, the ◆ glyph, aura of the Real-change hero. Fill/mark only (2.75:1 as text). Ink text on it is 6.5:1. | 2.75:1 vs #FAFAF8 |
| `--signal-change-ink` | #A84300 | Ember text: delta values that are a real change (e.g. “−0.7 pts”). | 5.79:1 vs #FAFAF8 |
| `--signal-change-soft` | #FFE3CC | Background for a real-change row highlight or calendar cell. | — |
| `--signal-change-glow` | rgba(255,106,0,.55) | Coloured long shadow under a real-change aura card. | — |
| `--signal-noise` | #B8B5AE | Points and line segments that sit inside the noise band. Decorative mark colour, never text. | 1.96:1 vs #FAFAF8 |
| `--signal-noise-band` | rgba(18,18,18,.07) | Fill of the shaded MDC band on every chart, sparkline and ruler. | — |
| `--signal-noise-edge` | rgba(18,18,18,.22) | Dashed 1px edges of the MDC band. | — |
| `--signal-baseline` | #DCF24B | Lime. Marks the baseline session (calendar cell, chart marker ring, “Baseline” tag). Ink text on it 15:1. | 15.03:1 vs #121212 |

### Actions

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--action-primary` | #F6DE5C | CTA yellow. One primary action per view (Check in, Continue, Save). Ink text 13.9:1. | 13.85:1 vs #121212 |
| `--action-primary-hover` | #FBE97F | Hover/pressed lift of the yellow CTA. | 15.22:1 vs #121212 |
| `--action-selected` | #121212 | Black pill: active dock item, active filter, selected tab in dark-on-light groups. | 18.73:1 vs #FFFFFF |
| `--action-tag` | #DCF24B | Lime tag chip (“New”, “Baseline”, “Simulated” is NOT lime — see synthetic). | 15.03:1 vs #121212 |
| `--focus-ring` | #3D7BFF | 2px focus outline, 3px offset. 3.2:1 on canvas (meets non-text 3:1). | 3.21:1 vs #ECEBE7 |

### Routine-check severity (states)

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--state-info-fg` | #2456D6 | Info text + icon (gaps, tips). | 5.34:1 vs #E6EEFF |
| `--state-info-bg` | #E6EEFF | Info container. | — |
| `--state-caution-fg` | #6E5A00 | Caution text + icon (duplicate actives, use on alternate nights). | 6.17:1 vs #FDF6D2 |
| `--state-caution-bg` | #FDF6D2 | Caution container. | — |
| `--state-avoid-fg` | #9E2E1C | Avoid text + icon (clashing actives). Never a full red fill, never “danger”. | 6.25:1 vs #FBE9E4 |
| `--state-avoid-bg` | #FBE9E4 | Avoid container. Also the hatched “not usable photo” cell. | — |

### Willow green family (brand, botanical)

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--willow-900` | #0F3B3A | Deep willow. Brand dark, app-icon ground, retail headers. | 11.77:1 vs #FAFAF8 |
| `--willow-700` | #226B37 | Green text when needed (routine “Started” notes). | 6.23:1 vs #FAFAF8 |
| `--willow-500` | #2E8B47 | Routine-change markers on timelines and calendar dots. Not a verdict colour. | 4.1:1 vs #FAFAF8 |
| `--willow-400` | #4FB866 | Leaf. Aura hue for Routine cards and the “used today” tick fill. | — |
| `--willow-200` | #B8E986 | Mint. Aura highlight for Routine/Oil & Glow. | — |
| `--willow-stem` | #6FAE9C | Logo stem. | — |
| `--willow-leaf` | #86C5B0 | Logo leaf. | — |

### Aura hues (surfaces only — never encode data)

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--aura-coral` | #FF6B4A | Logo bud core, hero blobs. | — |
| `--aura-pink` | #F25FA8 | Logo bud, Tone & Pigment group aura. | — |
| `--aura-apricot` | #FFB27A | Canvas corner blob (top-right). | — |
| `--aura-sky` | #3D7BFF | Quick-selfie mode card, Clarity group aura. | — |
| `--aura-ice` | #9CD3FF | Quick-selfie session identity (calendar), Under-eye aura. | 11.75:1 vs #121212 |
| `--aura-violet` | #7A5CFF | Avatar, Redness group aura, Advisor orb. | — |
| `--aura-lilac` | #D8B8FF | Canvas corner blob (top-left), Texture group aura. | — |

### Chart palette (non-verdict categorical series, retail)

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--chart-1` | #121212 | Series 1 / “all users”. | 17.93:1 vs #FAFAF8 |
| `--chart-2` | #7A5CFF | Series 2. | 4.18:1 vs #FAFAF8 |
| `--chart-3` | #2456D6 | Series 3. | 5.95:1 vs #FAFAF8 |
| `--chart-4` | #2E8B47 | Series 4. | 4.1:1 vs #FAFAF8 |
| `--chart-5` | #F25FA8 | Series 5. | 2.88:1 vs #FAFAF8 |
| `--chart-6` | #9A978F | Series 6 / “other”. | 2.79:1 vs #FAFAF8 |

### Synthetic & demo data

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--synthetic-bg` | #F6DE5C | Synthetic-data banner + “SIMULATED” badge, with 45° hatch overlay rgba(18,18,18,.08) 0 6px / transparent 6px 12px. | 13.85:1 vs #121212 |
| `--synthetic-fg` | #121212 | Badge text, Geist Mono caps. | 13.85:1 vs #F6DE5C |
| `--real-only-bg` | #DCF24B | Retail “REAL CONSENTED USERS ONLY” banner. | 15.03:1 vs #121212 |
| `--demo-bg` | #121212 | Demo read-only banner (full-width strip, white mono text). | 18.73:1 vs #FFFFFF |

### Dark (retail; shopper opt-in)

| Token | Value | Note |
|---|---|---|
| `--bg-canvas` | #07070A | Retail canvas |
| `--bg-surface` | #111116 | Retail cards |
| `--bg-sunken` | #16161B | Retail wells, inputs |
| `--bg-muted` | #24242B | Dividers as fills, suppressed cells |
| `--bg-glass` | rgba(255,255,255,.08) | Glass on dark |
| `--text-primary` | #FFFFFF |  |
| `--text-secondary` | #A3A3AD | 7.5:1 on #111116 |
| `--text-disabled` | #6B6B75 |  |
| `--text-inverse` | #121212 |  |
| `--line-subtle` | rgba(255,255,255,.10) |  |
| `--line-strong` | rgba(255,255,255,.22) |  |
| `--line-glass` | rgba(255,255,255,.14) |  |
| `--signal-change` | #FF8A3D | 8.0:1 on #111116, so it may also be text on dark |
| `--signal-change-ink` | #FF8A3D |  |
| `--signal-change-soft` | rgba(255,138,61,.16) |  |
| `--signal-noise` | #5C5C66 |  |
| `--signal-noise-band` | rgba(255,255,255,.08) |  |
| `--signal-noise-edge` | rgba(255,255,255,.24) |  |
| `--action-selected` | #FFFFFF | Selected pill flips to white with ink text |
| `--focus-ring` | #4F82FF | 5.7:1 on #07070A |

Dark mode decision: the retail dashboard is dark by default (dense data, long sessions, distinguishes the B2B surface). ASSUMPTION: the shopper app ships light-only for the hackathon because the calm warm canvas and aura cards are the brand; dark overrides are defined so it can be enabled later without new colours.

## Typography

Google Fonts: `https://fonts.googleapis.com/css2?family=Outfit:wght@200;300;400;500;600&family=Instrument+Serif:ital@0;1&family=Doto:wght,ROND@600..900,0..100&family=Geist+Mono:wght@400;500&display=swap`

| Family token | Stack | Use |
|---|---|---|
| font-ui | "Outfit", system-ui, -apple-system, "Segoe UI", sans-serif | All UI text. Weights 300/400/500 only. 300 for large numbers and display. |
| font-serif | "Instrument Serif", "Iowan Old Style", Georgia, serif | Greetings and editorial headlines only (“Good morning, Asha”). Never for data or buttons. |
| font-dot | "Doto", "Geist Mono", ui-monospace, monospace | Dot-matrix metric numerals on cards (weight 900, font-variation-settings: "ROND" 100). Monospaced, so figures are tabular by construction. |
| font-mono | "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace | ■ CAPS labels, eyebrows, table numerals, units in tables, code. Tabular by construction. |

| Token | Family | Size | Line height | Weight | Tracking | Use |
|---|---|---|---|---|---|---|
| display-xl | ui | 72px | 0.95 | 300 | -0.04em | Landing hero line (desktop). 48 on phone. |
| display | ui | 48px | 1 | 300 | -0.03em | Hero numbers in Outfit (“3 real changes” count when not Doto). |
| greeting | serif | 44px | 1.05 | 400 | -0.01em | Greeting / editorial headline. 36 on phone. |
| h1 | ui | 32px | 1.1 | 400 | -0.02em | Screen title. |
| h2 | ui | 22px | 1.2 | 400 | -0.01em | Section title. |
| h3 | ui | 18px | 1.3 | 400 | -0.01em | Card title (“What changed”). |
| body-lg | ui | 17px | 1.45 | 400 | -0.01em | Lead paragraph, Gemini explanation text. |
| body | ui | 15px | 1.5 | 400 | 0 | Default body. Never smaller on phone. |
| body-sm | ui | 13px | 1.45 | 400 | 0 | Secondary row text, helper text. |
| caption | ui | 12px | 1.4 | 400 | 0.01em | Captions, footnotes, disclaimer body. text-secondary. |
| label | mono | 11px | 1.2 | 500 | 0.1em | ■ CAPS eyebrows and section labels. Uppercase. Prefix “■ ”. |
| metric-dot-lg | dot | 96px | 0.85 | 900 | 0 | Hero metric numeral (report header count). |
| metric-dot | dot | 46px | 0.85 | 900 | 0 | Metric card numeral. |
| metric-num | mono | 15px | 1.2 | 500 | 0 | Metric values in rows/tables, deltas, MDC values. Always with unit. |
| metric-unit | ui | 13px | 1.2 | 400 | 0 | Unit next to a value (“%”, “°”, “pts”). text-secondary. |
| input | ui | 16px | 1.4 | 400 | 0 | Form inputs. 16px minimum stops iOS Safari zoom. |

- Tabular figures: every metric value, delta, MDC, n, percentage and date column uses Doto or Geist Mono, or Outfit with font-variant-numeric: tabular-nums. ASSUMPTION: Outfit’s tnum support is incomplete, so columns that must align use Geist Mono.
- Units always follow the number with a thin gap (gap: 4px) in metric-unit style. Never drop a unit.
- Minus sign is U+2212 (−), not a hyphen. Plus is shown explicitly on deltas (+0.4).
- Max line length 64ch for body text. text-wrap: pretty on paragraphs, balance on headings.
- Instrument Serif appears at most once per screen.

## Space, layout, shape

Spacing (4px base): `0`=0, `0.5`=2, `1`=4, `1.5`=6, `2`=8, `2.5`=10, `3`=12, `3.5`=14, `4`=16, `5`=20, `6`=24, `7`=28, `8`=32, `10`=40, `12`=48, `16`=64, `20`=80

| Breakpoint | Range | Behaviour |
|---|---|---|
| phone | 0–639px | Single column, 16px gutters, glass bottom dock, full-screen check-in. |
| tablet | 640–1039px | Cards pair in halves (span 6 of 12), 24px gutters, top header + dock. |
| desktop | 1040–1179px | 12-col grid, 14px gap, collapsible glass sidebar (72px collapsed / 232px open), check-in as centred sheet. |
| wide | ≥1180px | Quarter cards (span 3) allowed. Max content width 1280px. Retail dashboard is designed here first. |

- 12 columns, gap 14px (space-3.5) at every width.
- Page padding: clamp(16px, 4vw, 40px).
- Cards in a row stretch to equal height (align-items: stretch). Never leave a hole in a row: if a card is absent, the neighbour spans the space.
- Home rows (active user, desktop): [Hero 6 | Check-in 6] · [What changed 3 | Next step 3 | Product test 3 | Spot diary 3] · [Routine 6 | Your goals 6]. Tablet: everything span 6, routine/goals span 12. Phone: span 12.
- Touch targets ≥ 44×44px; buttons are 48px tall on phone.

| Radius | px | Use |
|---|---|---|
| radius-xs | 8 | Tooltips, small swatches |
| radius-sm | 12 | Inputs, list-row highlight, small tiles |
| radius-md | 20 | Chips that are not pills, thumbnails, photo frames |
| radius-lg | 30 | Standard card, sidebar, sheet top corners |
| radius-xl | 40 | Aura hero cards, modal |
| radius-pill | 999 | Buttons, chips, segmented, dock |

Cards add corner-shape: squircle where supported (progressive enhancement; falls back to the same border-radius).

| Border | Value |
|---|---|
| border-hairline | 1px solid rgba(18,18,18,.12) |
| border-input | 1px solid rgba(18,18,18,.24) |
| border-dashed-band | 1px dashed rgba(18,18,18,.22) |
| border-selected | 0 0 0 2px #FAFAF8, 0 0 0 3.5px #121212 (box-shadow ring) |

| Shadow | Value | Use |
|---|---|---|
| shadow-card | inset 0 0 0 1px rgba(255,255,255,.8), 0 26px 54px -38px rgba(0,0,0,.35) | Every surface card. |
| shadow-glass | inset 0 0 0 1px rgba(255,255,255,.75), inset 0 0 40px rgba(255,255,255,.35), 0 30px 60px -40px rgba(0,0,0,.35) | Dock, sidebar, glass pills. |
| shadow-aura | inset 0 0 0 1px rgba(255,255,255,.55), inset 0 0 60px rgba(255,255,255,.35), 0 40px 70px -40px var(--aura-glow) | Aura squircle cards. --aura-glow is the card’s hue at .45–.6 alpha. |
| shadow-raised | 0 4px 12px -4px rgba(0,0,0,.25) | Logo mark, small floating buttons. |
| shadow-sheet | 0 -20px 60px -30px rgba(0,0,0,.35) | Bottom sheet. |
| shadow-modal | 0 50px 100px -40px rgba(0,0,0,.45) | Centred check-in sheet / modal. |
| shadow-focus | 0 0 0 2px #FAFAF8, 0 0 0 4px #3D7BFF | Focus on elements where outline is clipped. |

| Opacity | Value |
|---|---|
| opacity-disabled | 0.55 |
| opacity-grain | 0.22 |
| opacity-muted | 0.65 |
| opacity-placeholder | 0.55 |

| Layer | z |
|---|---|
| z-bg | 0 |
| z-content | 1 |
| z-header | 20 |
| z-sidebar | 40 |
| z-dock | 50 |
| z-sheet | 60 |
| z-modal | 70 |
| z-toast | 80 |
| z-tooltip | 90 |
| z-grain | 9999 |

Grain: body::before { content:""; position:fixed; inset:0; pointer-events:none; z-index:9999; opacity:.22; mix-blend-mode:multiply; background-image: SVG feTurbulence fractalNoise baseFrequency .85, numOctaves 2, alpha .5, 180×180 tile }

## Motion

| Duration | ms |
|---|---|
| dur-instant | 0 |
| dur-fast | 140 |
| dur-base | 220 |
| dur-medium | 360 |
| dur-slow | 600 |
| dur-draw | 1200 |
| dur-breathe | 6000 |
| dur-drift | 22000 |

| Easing | Value | Use |
|---|---|---|
| ease-standard | cubic-bezier(.2,.8,.2,1) | Enters, pill morphs, chart reveal |
| ease-exit | cubic-bezier(.4,0,1,1) | Leaves (page exit 140ms) |
| ease-spring | cubic-bezier(.32,.72,0,1) | Sidebar width, sheets |
| ease-ambient | ease-in-out | Blobs and orb |

| What | Animation | Reduced motion |
|---|---|---|
| Page enter | opacity 0→1, blur 8px→0, translateY 14px→0 · 360ms standard | Instant (no transform, no blur) |
| Page exit | opacity 1→0, blur 6px, translateY −10px · 140ms exit | Instant |
| Tab / segmented white pill | translate + width morph · 600ms standard | Pill jumps |
| Dock black pill | morphs between items · 450ms spring | Jumps |
| Bottom sheet / check-in sheet | translateY 40px→0 + fade · 360ms spring | Fade only 140ms |
| Card stagger on load | translateY 14px→0 + fade, 60–90ms stagger, once per session | No stagger |
| Chart line draw | stroke-dashoffset · 1200ms standard, once on first view | Drawn statically |
| Gemini text reveal | per-word fade + 4px blur clear, 30ms/word | Text appears whole |
| Processing orb | scale 1↔1.08, opacity .85↔1 · 6s ambient loop | Static orb; stage tracker still advances |
| Canvas blobs | translate 46px/−34px, scale 1.14 · 20–25s alternate | Static |
| Skeleton shimmer | background-position sweep 1.4s linear | Static grey |

Never:
- Metric numbers never count up or tick; values appear final.
- Verdict badges never animate in a way that suggests celebration (no bounce, glow pulse, confetti).
- No looping motion on data marks. Ambient motion is only background blobs and the processing orb.
- No parallax on photos of skin.
- No streak, flame or score animations (none of those exist).

## Icons & illustration

lucide-react, strokeWidth 1.5, size 20 (UI) / 16 (inline) / 24 (dock). Color currentColor. absoluteStrokeWidth off.
Lucide is open, tree-shakeable, matches the thin geometric strokes of Outfit 300. ASSUMPTION: names below exist in lucide-react ≥0.4; verify at import.

| Use | lucide |
|---|---|
| Home | House |
| Progress | ChartSpline |
| Routine | ListChecks |
| You | CircleUser |
| Check in | Camera |
| Advisor | MessageCircle |
| Info | Info |
| Close | X |
| Back | ArrowLeft |
| Open | ArrowUpRight |
| Retry | RotateCcw |
| Offline | WifiOff |
| Delete | Trash2 |
| Privacy | Lock |
| Upload | Upload |
| Store link | ExternalLink |
| AI-written | Sparkles (only on AI content) |
| Light | SunMedium |
| Card | SquareDashed |
| Done | Check |

| Product category | lucide |
|---|---|
| Cleanser | Droplets |
| Toner | GlassWater |
| Serum | Pipette |
| Treatment | FlaskConical |
| Exfoliant | Waves |
| Moisturizer | Cloud |
| Sunscreen | Sun |
| Eye care | Eye |
| Mask | Layers |

Category icon sits in a 40px circle of bg-sunken with ink stroke. Never a product photo, never a brand logo.

Verdict glyphs are NOT lucide. Render the custom <VerdictGlyph> SVG (12×12): ◆ filled diamond (signal-change), ○ 1.5px ring (text-secondary), ◌ dotted ring 1.5px dash 1.5/1.5, — 8×1.5 bar, · 3px dot. SVG keeps them identical across fonts.

Capture-guide illustrations: 120×120 viewBox, 1.5px ink stroke, round caps/joins, no fills except one signal-baseline (lime) accent per drawing, face drawn as a neutral oval with no features beyond a centre line. Never photos of faces.

- Card in frame — phone outline, colour card rectangle in lower third of frame, corner brackets.
- Same light — window rectangle with soft rays, face oval turned toward it.
- Distance — face oval and phone with a double arrow labelled “30–40 cm”.
- Neutral face — oval with straight mouth line, eyes open dots.
- Hair back — oval with hairline pulled above forehead, band line.
- No makeup — oval with a crossed-out small compact.
- Take 5 photos — phone with 5 ghosted positions along an arc, arrows away and back.

## Verdicts & confidence

| Glyph | Label | Short | Meaning |
|---|---|---|---|
| ◆ | Real change | Changed | Difference from baseline is larger than this person’s MDC. |
| ○ | Within normal photo variation | Normal range | Difference is inside the MDC band. |
| · | First reading | First reading | No baseline yet; nothing to compare. |
| — | Photo quality too low to compare | Not compared | Quality gate failed for this metric. |

ASSUMPTION: the long label is canonical (reports, metric rows, tooltips). The short label is for chips/calendar cells under 160px wide, matching the current build (“Changed”, “Normal range”).

| Glyph | Confidence | Meaning |
|---|---|---|
| ● | Measured | Calibrated RAW + card, metric validated. |
| ◐ | Indicative | Metric is measured but less validated; shown with a trend tone. |
| ◌ | Trend only | Quick selfie (no card) or no noise band yet. Never called a real change. |

## Data visualisation

### Global

- Plot area bg-sunken (light) / #16161B (dark), radius-md.
- Gridlines: horizontal only, 1px line-subtle, 3–4 lines max.
- Axis labels: Geist Mono 11px text-secondary; dates “14 Oct”; values rounded per metric precision.
- No y-axis line; x baseline 1px line-strong.
- Tooltip: ink pill radius-pill, white Geist Mono 12, format “14 Oct · 3.1 % · ◆ Real change”. Drop line 1px dashed text-secondary from point to x axis.
- Number formatting: 1 decimal for %, ° and indices; integers for counts; −/+ explicit on deltas; locale en-GB dates.
- Every chart has an accessible data table (visually hidden) and a one-sentence summary above it.

### Noise band (MDC)

- Band = baseline ± MDC, fill signal-noise-band rgba(18,18,18,.07), edges 1px dashed signal-noise-edge.
- Baseline line: 1px solid line-strong across the band centre, label “Baseline” mono 11.
- Band label at right edge: “Normal photo variation ±0.4 %”.
- Same band treatment on sparkline (no labels), ruler and timeline so it reads as one object across the app.
- No band yet (fewer than 3 baseline photos / quick selfie): band omitted, line dashed 4/3, label “Trend only”.

### Metric sparkline

- 96×32 viewBox, line 1.5px #121212, round joins.
- Points only at last value: 5px circle; ember fill if verdict real, signal-noise fill otherwise, 1.5px #FAFAF8 ring.
- Null values break the line (no interpolation).

### Timeline chart

- Height 220 phone / 280 desktop.
- Line 2px #121212; points 6px circle: inside band signal-noise, outside band signal-change with 2px #FAFAF8 ring.
- Segments leaving the band are drawn ember from the last in-band point.
- Baseline session point: ring 2px signal-baseline (lime) + “Baseline” tag.
- Routine-change markers: vertical 1px willow-500 line, 8px willow-500 diamond on the x axis, label in tooltip (“Started glycolic toner”).
- Quick-selfie points: hollow circle 1.5px, never ember.

### Treated vs control (forearm)

- Treated line 2px #121212, control line 2px #9A978F dashed 4/3, legend with text labels “Treated arm” / “Control arm”.
- Difference bar below: horizontal track, combined MDC band shaded, difference marker as triangle pointer; ember only if |difference| > combined MDC.
- Missing control → no attribution sentence, show “— No comparison”.

### Before/after slider

- Only on aligned photos (alignment flag true).
- Divider 2px #FFFFFF with shadow-raised; knob 44px glass circle with ChevronsLeftRight.
- Labels “Baseline · 2 Oct” / “Today · 14 Oct” mono pills on glass top corners.

### Photo overlay

- Layers: redness, dark spots, pores, blemishes. Each layer is outline-only (1.5px), never a heat colour on skin.
- Overlay colours: redness #7A5CFF, spots #121212 on light zones / #FFFFFF on dark zones (auto by local luminance), pores #2456D6, blemishes #F25FA8. These are identification colours; legend uses shape + text.
- Opacity 0.9 strokes; photo itself is never tinted or brightened.
- Legend: chips under photo, shape swatch + label + count.

### Retail charts

- Outcome rate by product × profile: heat table, cell value as % in Geist Mono + n below; cell fill ink at alpha = rate×0.6; never green/red.
- Brand/category performance: pill-capped horizontal bars (radius-pill), chart-1..6 palette, value label at bar end.
- Assortment gaps: dot-grid field (2px dots every 16px, line-subtle), bubbles x=tier, y=unmet share, area ∝ users, fill chart-2 .35 + blur 0.
- Conflict rates: single-series bars ink, severity in label text.
- Small groups: any group with n<10 shows “—” and “n<10, hidden” in caption; aggregates exclude nothing silently — footnote counts hidden groups.
- Every retail chart carries a “SIMULATED” synthetic badge when cohort ≠ real.

### Willow Proof (retail sub-brand)

The retail dashboard is branded **Willow Proof** (“Retail intelligence by Willow”). Its mark, lockups, clear space, minimum sizes, Proof tokens (`--proof-*`, all Willow tokens or tints), dense type scale (`text-proof-*`) and do/don't live in `docs/RETAIL_BRAND.md`; this document stays the source for every shared token. Since Oct 16 (round 2) Proof follows Vercel's Geist language in its own light and dark themes (`features/retail/retail.css` redefines the semantic tokens under `html[data-proof]`), set in Geist with tabular figures; leaf green is its only accent and the retail-chart rules above (Geist Mono cells, per-chart SIMULATED badge) are superseded there: the data scope is stated once in the top bar.

## Components

| Component | File | Props | Variants / anatomy | States | Accessibility | Don’t |
|---|---|---|---|---|---|---|
| Button | `web/src/components/ui/Button.tsx` | `{ variant?: 'primary'\|'ink'\|'glass'\|'ghost'; size?: 'md'\|'lg'; icon?: LucideIcon; loading?: boolean; disabled?: boolean; onClick?: () => void; children: ReactNode }` | primary = yellow #F6DE5C/ink; ink = #121212/white; glass = bg-glass/ink; ghost = transparent/ink underline on hover. md 44px, lg 52px; radius pill; padding 0 22px; body 15/500. | default · hover · focus-visible · active · disabled · loading (spinner replaces icon, label stays, aria-busy) · error n/a | Native <button>. Loading keeps width. Disabled uses aria-disabled when it must stay focusable for a tooltip. | Max one primary per view. Never colour a button with signal-change. |
| IconButton | `web/src/components/ui/IconButton.tsx` | `{ icon: LucideIcon; label: string; variant?: 'glass'\|'ink'; size?: 44\|48 }` | Circle, glass or ink. | default · hover · focus-visible · active · disabled | aria-label required (label prop). | No icon-only button without label. |
| TextField | `web/src/components/ui/TextField.tsx` | `{ label: string; value: string; onChange: (v: string) => void; hint?: string; error?: string; type?: string; disabled?: boolean }` | Label above, 48px field, bg-sunken, radius-sm, input type 16px. | default · hover · focus-visible · active · disabled · error (state-avoid-fg text + icon below, border state-avoid-fg) | <label for>, aria-describedby for hint/error, aria-invalid. | No placeholder-as-label. |
| Select | `web/src/components/ui/Select.tsx` | `{ label: string; value: string; options: {value: string; label: string}[]; onChange: (v: string) => void }` | Native <select> styled like TextField with ChevronDown. | default · hover · focus-visible · active · disabled · error | Native select for iOS picker. |  |
| Toggle | `web/src/components/ui/Toggle.tsx` | `{ label: string; checked: boolean; onChange: (v: boolean) => void; description?: string; disabled?: boolean }` | 44×26 track; off = rgba(18,18,18,.18), on = #121212; knob #FFF. | default · hover · focus-visible · active · disabled | role="switch", aria-checked; label clickable. | Never green for on. |
| SegmentedControl | `web/src/components/ui/SegmentedControl.tsx` | `{ options: {value: string; label: string}[]; value: string; onChange: (v: string) => void; label: string }` | Translucent track bg-glass, white pill indicator morphs (600ms), 40px items. | default · hover · focus-visible · active · disabled | role="radiogroup" + role="radio", arrow keys move. | Max 4 options. |
| Chip | `web/src/components/ui/Chip.tsx` | `{ label: string; selected?: boolean; tone?: 'neutral'\|'tag'\|'selected'; onToggle?: () => void; icon?: ReactNode }` | neutral = line-strong outline; selected = black pill; tag = lime. | default · hover · focus-visible · active · disabled | Toggle chips are buttons with aria-pressed. |  |
| Tabs | `web/src/components/ui/Tabs.tsx` | `{ tabs: {id: string; label: string}[]; value: string; onChange: (id: string) => void }` | Text tabs with 2px ink underline indicator that slides. | default · hover · focus-visible · active · disabled | role="tablist"/"tab"/"tabpanel", aria-controls. |  |
| Card | `web/src/components/ui/Card.tsx` | `{ variant?: 'surface'\|'aura'\|'muted'\|'glass'; aura?: AuraName; as?: ElementType; children: ReactNode }` | surface #FAFAF8 radius-lg shadow-card padding 22–28; aura radius-xl layered radial gradients + shadow-aura; muted bg-muted. | default · hover (interactive: translateY −2px, shadow deepens) · focus-visible · loading (Skeleton inside) | Interactive card = single <button>/<a> wrapper with clear name. | Aura hue never encodes a verdict. |
| ListRow | `web/src/components/ui/ListRow.tsx` | `{ title: string; meta?: string; leading?: ReactNode; trailing?: ReactNode; onClick?: () => void; divider?: boolean }` | 56px min, hairline divider, chevron trailing when navigable. | default · hover · focus-visible · active · disabled | Row is a button when clickable. |  |
| BottomSheet | `web/src/components/ui/BottomSheet.tsx` | `{ open: boolean; onClose: () => void; title: string; children: ReactNode }` | Phone: rises from bottom, radius-lg top, grabber 36×4. ≥1040px renders as centred Modal. | open · closing · reduced-motion | role="dialog" aria-modal, focus trap, Esc closes, returns focus. |  |
| Modal | `web/src/components/ui/Modal.tsx` | `{ open: boolean; onClose: () => void; title: string; size?: "md"\|"lg"; children: ReactNode }` | Centred, radius-xl, shadow-modal, scrim. | open · closing | Same as BottomSheet. |  |
| Toast | `web/src/components/ui/Toast.tsx` | `{ message: string; tone?: 'neutral'\|'info'\|'caution'; action?: {label: string; onClick: () => void} }` | Ink pill bottom-centre above dock, 4s. | enter · idle · exit | role="status" aria-live="polite". | Never for errors that need action — use an inline card. |
| Tooltip | `web/src/components/ui/Tooltip.tsx` | `{ content: ReactNode; children: ReactElement }` | Ink bg, white body-sm, radius-xs, 8px padding, max 260px. | hidden · shown (hover 300ms delay, focus immediate) | aria-describedby; also opens on tap for touch. |  |
| InfoTip | `web/src/components/willow/InfoTip.tsx` | `{ metric: MetricKey }` | Info icon 16px opening a tooltip/sheet: what it measures, unit, direction wording, measured vs indicative. | default · hover · focus-visible · active · disabled | Button with aria-label "About {metric}". |  |
| EmptyState | `web/src/components/ui/EmptyState.tsx` | `{ title: string; body: string; action?: ReactNode; illustration?: GuideName }` | Centred, one line drawing, serif title optional. | default |  | No cheerful filler copy. |
| Skeleton | `web/src/components/ui/Skeleton.tsx` | `{ shape?: 'line'\|'block'\|'circle'; width?: string; height?: string }` | bg-sunken with shimmer. | loading · reduced-motion (static) | aria-hidden; parent sets aria-busy. |  |
| ProgressStepper | `web/src/components/ui/ProgressStepper.tsx` | `{ steps: string[]; current: number }` | Dots + labels, done ●, current ◐, todo ○. | per step: done · current · todo | <ol>, aria-current="step". |  |
| VerdictBadge | `web/src/components/willow/VerdictBadge.tsx` | `{ verdict: 'real'\|'normal'\|'first'\|'lowQuality'; size?: 'sm'\|'md'; short?: boolean }` | real = black pill white text + ember ◆; normal = glass pill ink ○; first = outline pill ·; lowQuality = muted pill —. | static | Glyph aria-hidden; text always present. | Never colour-only; never green/red. |
| ConfidenceChip | `web/src/components/willow/ConfidenceChip.tsx` | `{ level: 'measured'\|'indicative'\|'trend' }` | Mono 11px caps on line-strong outline, glyph ● ◐ ◌. | static | Text label always present; tooltip explains. |  |
| MetricRow | `web/src/components/willow/MetricRow.tsx` | `{ metric: MetricKey; value: number\|null; unit: string; delta: number\|null; mdc: number\|null; verdict: Verdict; confidence: Confidence; series: (number\|null)[]; onOpen?: () => void }` | Label + InfoTip · value metric-num + unit · VerdictBadge sm · Sparkline 96×32. | default · hover · focus-visible · active · disabled · not measured (value “—”) | Row button name: “{label}, {value}{unit}, {verdict}”. | Delta text uses signal-change-ink only when verdict is real. |
| MetricGroupCard | `web/src/components/willow/MetricGroupCard.tsx` | `{ group: GroupKey; metrics: MetricRowProps[]; order: number }` | Card surface; header label (■ TONE & PIGMENT) + count of real changes; rows. | default · loading · partial (some rows —) | Section with aria-labelledby. |  |
| ReportHeader | `web/src/components/willow/ReportHeader.tsx` | `{ realCount: number; since: string; session: Session; quality: QualitySummary }` | Aura hero (ember aura when realCount>0, grey aura when 0, lime when first reading); Doto count; chips of verdict counts; ruler. | real>0 · zero · first reading · low quality | H1 text “{N} real changes since your baseline”. | Never “great job”, never a score. |
| GeminiCard | `web/src/components/willow/GeminiCard.tsx` | `{ text: TemplateWithValues; values: Record<string, MeasuredValue>; source: string }` | Surface card, top-left “AI-suggested” tag, body-lg; inline values rendered as <MeasuredValue> chips identical to MetricRow numerals. | loading (word reveal) · ready · unavailable (“Explanation unavailable. Measurements above are unaffected.”) | Region labelled “Explanation written by Gemini”. | Model never inserts digits; all numbers come from values. |
| AITag | `web/src/components/willow/AITag.tsx` | `{ label?: 'AI-suggested'\|'AI-written' }` | Glass pill, Sparkles 12px, mono 11 caps. | static | Text label. | Only on Gemini output. |
| QualityIssueCard | `web/src/components/willow/QualityIssueCard.tsx` | `{ issue: 'dark'\|'blur'\|'glare'\|'noCard'\|'angle'\|'distance'\|'occluded'; severity: 'partial'\|'total'; tips: string[]; onRetake: () => void }` | state-caution-bg container, line drawing, 2–3 tips, Retake (primary). | partial · total | Heading names the issue. |  |
| ProcessingTracker | `web/src/components/willow/ProcessingTracker.tsx` | `{ stage: 0\|1\|2\|3\|4; outcome?: 'success'\|'partial'\|'timeout'\|'rejected'\|'offline' }` | Stages: Checking photo quality → Correcting colors → Measuring → Explaining; orb above. | per stage done/current/todo · timeout (Retry) · offline (paused) | aria-live="polite" announces stage changes. | No fake percentages. |
| CaptureChecklistItem | `web/src/components/willow/CaptureChecklistItem.tsx` | `{ guide: GuideName; title: string; detail: string; state: 'todo'\|'ok'\|'warn' }` | 40px icon circle + text; ok = check, warn = caution tone. | todo · ok · warn | List item; state in text. |  |
| ModePicker | `web/src/components/willow/ModePicker.tsx` | `{ value: 'calibrated'\|'quick'; onChange: (v) => void }` | Two tall tiles: Calibrated (RAW + card, Measured) and Quick selfie (Trend only). | default · hover · focus-visible · active · disabled · selected | radiogroup. | Do not hide the confidence difference. |
| GoalTile | `web/src/components/willow/GoalTile.tsx` | `{ goal: GoalKey; selected: boolean; disabled: boolean; onToggle: () => void }` | Aura tile per group, check when selected; max 3 then others disabled with hint. | default · hover · focus-visible · active · disabled · selected · max reached | Checkbox semantics, “3 of 3 chosen” live text. |  |
| RoutineEntry | `web/src/components/willow/RoutineEntry.tsx` | `{ product: Product; slot: 'AM'\|'PM'; usedToday?: boolean; onToggleUsed?: () => void; onRemove?: () => void }` | Category icon, name, brand, actives; “used today” tick. | default · hover · focus-visible · active · disabled | Checkbox for used today. |  |
| RoutineCheckResult | `web/src/components/willow/RoutineCheckResult.tsx` | `{ kind: 'conflict'\|'duplicate'\|'gap'; severity: 'info'\|'caution'\|'avoid'; title: string; why: string; fix: string; products: string[] }` | State container + icon + title + why + “How to fix”. | static | Severity in text (“Avoid together”). | Never red alert styling or “danger”. |
| ProductCard | `web/src/components/willow/ProductCard.tsx` | `{ product: Product; stores: {name: string; url: string; price?: string}[]; reason: string }` | Category icon, name, key actives, reason, row of store pill buttons (ExternalLink). | default · hover · focus-visible · active · disabled | Store links say “{store}, opens in new tab”. | No product images, no “best seller”. |
| ChatBubble | `web/src/components/willow/ChatBubble.tsx` | `{ role: 'user'\|'advisor'; children: ReactNode; products?: Product[] }` | User: ink bubble right; advisor: surface bubble left with AITag. | streaming · done · error | log region aria-live="polite". |  |
| SuggestedPrompt | `web/src/components/willow/SuggestedPrompt.tsx` | `{ text: string; onPick: () => void }` | Glass pill chip. | default · hover · focus-visible · active · disabled | Button. |  |
| ConsentBlock | `web/src/components/willow/ConsentBlock.tsx` | `{ id: string; title: string; body: string; required?: boolean; checked: boolean; onChange: (v: boolean) => void }` | Surface card, Toggle, plain-language body. | default · hover · focus-visible · active · disabled · required (cannot proceed without) | Toggle labelled by title, described by body. | No pre-checked optional consents. |
| Disclaimer | `web/src/components/willow/Disclaimer.tsx` | `{ variant?: "inline"\|"footer" }` | caption text-secondary with Info icon: “Cosmetic measurements from photos. Not a medical assessment.” | static | role="note". | Appears on every report. |
| DemoBanner | `web/src/components/willow/DemoBanner.tsx` | `{ message?: string }` | Full-width ink strip, mono 12 caps white: “■ DEMO JOURNEY · READ-ONLY”. | static | role="note". |  |
| SyntheticBanner | `web/src/components/willow/SyntheticBanner.tsx` | `{ cohort: 'synthetic'\|'mixed'\|'real' }` | synthetic/mixed = yellow hatched; real = lime. Mono caps. | static | role="note"; repeated as “SIMULATED” badge on every chart. |  |
| Sparkline | `web/src/components/charts/Sparkline.tsx` | `{ series: (number\|null)[]; baseline: number; mdc: number\|null; verdicts: Verdict[] }` | 96×32; band; line 1.5 ink; last point marker. | normal · no band (dashed line) · gaps | aria-hidden; parent row carries text. |  |
| TimelineChart | `web/src/components/charts/TimelineChart.tsx` | `{ series: Point[]; mdc: number\|null; baselineIndex: number; markers: {at: number; label: string}[]; unit: string }` | See chart specs. | default · hover/focus point · empty · single point | Keyboard: arrow keys move between points; table fallback. |  |
| ForearmCompare | `web/src/components/charts/ForearmCompare.tsx` | `{ treated: number[]; control: (number\|null)[]; mdc: {treated: number; control: number; combined: number} }` | Two lines + difference bar with combined MDC band. | treated · drift · no difference · missing control · no band | Summary sentence above chart. |  |
| BeforeAfter | `web/src/components/charts/BeforeAfter.tsx` | `{ before: PhotoRef; after: PhotoRef; aligned: boolean }` | Draggable glass knob, 2px white divider. | drag · keyboard (←/→ 5%) · not aligned (disabled with reason) | role="slider" aria-valuenow. | Never shown when alignment failed. |
| OverlayToggle | `web/src/components/charts/OverlayToggle.tsx` | `{ layers: ('redness'\|'spots'\|'pores'\|'blemishes')[]; active: string[]; onChange }` | Chips above photo; legend below. | default · hover · focus-visible · active · disabled | aria-pressed chips; legend text. |  |
| Dock | `web/src/components/shell/Dock.tsx` | `{ current: 'home'\|'progress'\|'routine'\|'you'; onCheckIn: () => void }` | Glass pill, 4 items + central ink Check-in circle; active = black pill. | default · hover · focus-visible · active · disabled | <nav aria-label="Primary">, aria-current="page". |  |
| Sidebar | `web/src/components/shell/Sidebar.tsx` | `{ current: Destination; collapsed: boolean; onToggle: () => void }` | Glass, radius-lg, 72/232px. | default · hover · focus-visible · active · disabled · collapsed | Nav landmark. |  |

## Screens

| # | Screen | Built reference | Components (in order) | Layout |
|---|---|---|---|---|
| 01 | Landing (`/about`; `/` is the front door: returning people go to Home, new people to onboarding `/welcome`) | `Willow.dc.html` | Logo → Hero (greeting serif + display-xl, blurred floral aura) → Button primary “Explore a real journey” → Button glass “Try with sample photos” → Button glass “Try your own selfie” → Sign-in row: Google · Continue as guest → How it works (3 cards) → Disclaimer | Phone: stacked, buttons full-width 52px. Desktop: hero left 7 cols, ways-in card right 5 cols. |
| 02 | Consent | `Willow.dc.html#consent` | ProgressStepper → h1 → ConsentBlock × 3 (photos stored, used for measuring, optional anonymised research) → Button primary Continue (disabled until required) → Disclaimer | Single column max 560px at all widths. |
| 03 | Goal picker | `Willow.dc.html#goals` | ProgressStepper → h1 “Choose up to 3 goals” → GoalTile × 7 (groups) → Live count text → Button primary | Phone 2 cols; tablet 3; desktop 4 within 880px. |
| 04 | Capture guide | `Willow Capture.dc.html#guide` | ModePicker → CaptureChecklistItem × 7 (line illustrations) → Button primary “Open camera” | Phone: full-screen flow, no dock. Desktop: centred sheet 720px. |
| 05 | Upload + processing | `Willow Capture.dc.html#files` | Upload rows (per-file status) → ProcessingTracker + orb → QualityIssueCard (partial/total) → Toast on success | Same sheet; tracker centred. |
| 06 | Report | `Willow App.dc.html#session` | DemoBanner (demo only) → ReportHeader → GeminiCard → MetricGroupCard × 7 ordered by goals then: Tone & Pigment, Redness, Clarity, Texture & Pores, Lines, Under-eye, Oil & Glow → OverlayToggle + photo → Disclaimer | Phone: single column. Desktop: header span 12, groups span 6. |
| 07 | Timeline / compare | `Willow App.dc.html#history` | SegmentedControl (metric) → TimelineChart → BeforeAfter → Calendar of sessions → Disclaimer | Desktop: chart span 8, calendar span 4. |
| 08 | Routine + check | `Willow App Routine.dc.html` | SegmentedControl AM/PM → RoutineEntry list → RoutineCheckResult list → Product test card (ForearmCompare) → Button ink “Add product” | Desktop: routine span 7, check results span 5. |
| 09 | Advisor chat | `Willow Routine.dc.html#advisor` | Context chip → ChatBubble stream → ProductCard inside advisor bubble → SuggestedPrompt row → Input + send | Phone full-screen; desktop right-side panel 420px. |
| 10 | Retailer dashboard (desktop) | `Willow Retail.dc.html` | SyntheticBanner → Tabs: Customer needs next · Product outcomes by profile · Brand/category performance · Assortment gaps · Routine conflicts → KPI cards (with n) → Charts per tab → Suppressed cells “—, n<10” | Dark tokens. Designed at 1280–1440; ≥1040 supported; below shows “Best on a laptop” note with stacked cards. |
| 11 | About / science | `Willow.dc.html#science` | How measurement works (stage diagram) → What we don’t measure → Fairness (Monk 1–10, descriptive only) → Privacy → Disclaimer | Editorial, max 720px text column. |

### States

| State | Screens | Treatment |
|---|---|---|
| Empty (no sessions) | Home, Progress, Report | EmptyState with “Card in frame” drawing. “No check-ins yet. Your first five photos become your baseline.” Action: Check in. |
| First reading | Report, Home | ReportHeader lime aura, count “—”. Every MetricRow verdict “First reading”. Copy: “This is your baseline. Next check-in shows what changed.” |
| Processing | Capture, Home lead card | ProcessingTracker with orb. “You can leave; the result lands here.” No percentages. |
| Partial quality failure | Report | Affected rows show “—” + “Photo quality too low to compare”. QualityIssueCard (partial) above groups with retake tips. Other metrics display normally. |
| Total quality failure | Capture | QualityIssueCard (total) with drawing + 3 tips; Retake primary; nothing measured is shown. |
| Engine timeout | Capture, Report | Inline card: “Measuring is taking longer than usual. Your photos are saved.” Buttons: Retry (primary), Come back later (glass). |
| Offline | All | Glass pill under header with WifiOff: “Offline. Showing your last saved results.” Check-in disabled with reason. |
| Demo read-only | All in demo journey | DemoBanner at top; write actions replaced by “Available in your own account”. |
| Data deleted | You → Delete | Full-screen confirmation: “Your photos and measurements are deleted.” Button: Back to start. No undo. |

## Voice

| Metric | Decrease | Increase |
|---|---|---|
| Skin tone (ITA°) | change detected | change detected |
| Dark spots | fewer/lighter spots | more visible spots |
| Tone evenness | more even | less even |
| Redness | calmer | more redness |
| Blemishes | fewer blemishes | more blemishes |
| Pores | less visible pores | more visible pores |
| Texture | smoother | rougher |
| Lines | softer lines | more visible lines |
| Under-eye | darker under-eye | brighter under-eye |
| Shine | less shine | more shine |
| Glow | less glow | more glow |

- Plain, warm, brief, specific. Sentences under 20 words.
- Indicative metrics say “trend”, never “change”.
- Gemini never states causation with certainty: “may be linked to…”, “started around the same time as…”.
- Numbers in AI text are interpolated from engine values, never typed by the model.
- Never: flaws, fix, bad skin, fairness, whitening, glow-up, perfect, amazing, journey (in UI copy), streak.
- Skin tone never “better” or “worse”.
- Say what to do next in the same card as a problem.

| Say | Don’t say |
|---|---|
| Dark spots are lighter than your baseline, by more than your normal photo variation. | Amazing! Your spots are disappearing 🎉 |
| Redness stayed within your normal range. | No improvement in redness yet. |
| Skin tone: change detected (−2.1° ITA). | Your skin got brighter. |
| Texture is trending smoother. This is a quick-selfie reading, so it shows a trend only. | Texture improved 12%. |
| This may be linked to the glycolic toner you started on 1 Sep. | The glycolic toner fixed your pores. |
| We couldn’t compare today. The photo was too dark. Move closer to a window and retake. | Error: bad image. |

## References

| # | Reference | Status | What we take / why rejected | Where |
|---|---|---|---|---|
| 1 | Keto website | USED | Blurred floral hero imagery; white-pill nav on translucent track; yellow pill CTA; 40px-radius image cards. | Landing hero, segmented control, CTA yellow (action-primary). |
| 2 | Time-related radial data | USED | Layered translucent radial bands around an empty centre, thin concentric gridlines. | Retail “Customer needs next” goal-demand radial. |
| 3 | Machines Like Me palette | USED | Logic of darker shades for hard data, lighter for soft/service; thin geometric sans. | Ink for measurements, aura pastels for surfaces; Outfit choice. |
| 4 | Alien pixels sales report | USED | Stream/flow band chart with white pill value labels in mono; soft glow behind chart; mono numerals list. | Retail category-flow chart, tooltip pill style, Geist Mono table numerals. |
| 5 | Four shapes on black | USED | Fully rounded bar ends and dot legends. CONFLICT: multicolour categorical data — we keep only the shape; colour follows chart palette rules. | Retail bar charts (pill caps), legend dots. |
| 6 | Dark glass 78% card | USED | Luminous bottom edge on dark glass card, vertical drop lines from points. | Retail dark surfaces; drop lines in timeline tooltips. Not the hype percentage. |
| 7 | Dataviz blob on dot grid | USED | Dot-grid plot field with blurred density blobs. | Retail assortment-gaps chart; the soft edge idea behind the noise band. |
| 8 | CreditKarma health dashboard | USED | White squircle cards with black circular arrow buttons, black active pill tabs, large light numerals with small units. CONFLICT: the score gauge is a gamified score — rejected. | Card + arrow button, active black pill, number + unit pattern. |
| 9 | Irides-cent HMI | USED | Radial aura gradients around a dark disc holding a light numeral; hairline tick arcs. | Aura card recipe, report-header ruler ticks. |
| 10 | GCT balance phone | USED | Glass pill top bar, floating glass dock, aura squircles with white light numerals. | Glass dock, aura metric cards. |
| 11 | Day 19 cycle app | NOT USED | Low-contrast text on dark amber imagery and mood emoji chips; fails contrast and calm. |  |
| 12 | Weather typography | USED | Giant thin numerals, ■-style mono caps labels, grain over soft blobs on a light canvas. | Outfit 300 display, label style, grain overlay. |
| 13 | Blob icons with eyes | NOT USED | Mascot characters make the AI feel like a persona; Willow’s AI is a labelled explainer, not a character. |  |
| 14 | AI calendar | USED | AI tip as a distinct gradient pill with sparkle; black/white “All / New” segmented pills. | Gemini explanation card marker, filter pills. |
| 15 | Hot pink squircle cards | USED | Doto dot-matrix numerals; dotted arc graph inside squircle. CONFLICT: hot-pink-on-black theme rejected. | metric-dot type, dotted sparkline markers. |
| 16 | Noisy step chart | USED | A stepped line inside a grainy, fuzzy band: noise made visible. | The core MDC noise-band treatment; grain texture. |
| 17 | Superpower health dashboard | USED | Doto values with units, lime tag pills, “In range” status pills, product cards with lime tags. CONFLICT: “Superpower Score” and “years younger” are gamified — rejected. | Metric cards, status chips, product card tag. |
| 18 | AI OS widgets | NOT USED | Dense, saturated widget-OS grid; too loud for a calm report and overlaps with #10. |  |
| 19 | Fluffy clouds on grass | NOT USED | Literal 3D illustration style; Willow uses abstract blur and line drawings only. |  |
| 20 | Biomarker cards close-up | USED | Blurred green/pink aura squircles, white + button, Doto value with unit, concentric target rings. | Aura card, add-tile, capture target rings. |
| 21 | Sport tracker 21K | USED | Glass dock with a black active circle, frosted aura card, thin line with a glass knob. | Dock active state, before/after slider knob. |
| 22 | Pink tulip | USED | Single blurred tulip bud on blue-green, grain. | Logo mark (frosted tulip bud), app icon. |
| 23 | Simpl iOS analytics | USED | Doto “07” numeral, dotted curve with a drop-line marker. CONFLICT: red notification badge rejected. | Sparkline last-point marker. |
| 24 | Hydrogen & water stats | USED | White pill segmented tabs on translucent track, circular glass icon buttons, metric aura pills with % chip, dotted baseline line on chart. | Segmented control, icon buttons, baseline line style. |
| 25 | Blurred carnations | USED | Soft botanical blur in peach and blue. | Landing imagery mood (assets/hero-flower.png). |
| 26 | Airofit dark | NOT USED | Built around a “Daily Streak” counter and black theme; streak pressure breaks principle 1. |  |
| 27 | AI support blue orb | USED | Breathing blurred orb inside a soft panel; round glass controls. | Processing orb, Advisor presence. |
| 28 | Heart & circulation tablet | NOT USED | Human body imagery and clinical panel density; no body/face imagery in Willow. |  |
| 29 | Haiqu cards | USED | ■ mono caps labels on blurred photo cards; serif quotes. | label token (■ CAPS), editorial serif. |
| 30 | Good morning Maria | USED | Serif greeting over blurred gradient; full-width white check-in button. | Greeting type, Home hero. |
| 31 | Two frosted tulips | USED | Frosted bloom behind glass, peach to periwinkle. | Logo/landing mood, hero blobs. |
| 32 | Sounds for sundown | USED | Grainy orb, lowercase sans wordmark. | Lowercase “willow” wordmark, orb. |
| 33 | Moonshot white UI | USED | Checklist rows with icon circles, scan-frame corners, “Perfect! Scan now” confirmation. Gradient CTA not used (CTA stays yellow). | Capture checklist item, camera frame brackets, quality confirmation. |
| 34 | Tap the water | USED | One blob on warm grey with a tiny serif caption; extreme restraint. | Canvas #ECEBE7, empty states. |
| 35 | Why less is more | USED | Grain texture, editorial grid, restraint. | Grain overlay, About/science layout. |
| 36 | Vocal coach | USED | White results sheet rising over a gradient; “Stats / Rhythm” segmented pill. CONFLICT: “Excellent”, streak level and avatars rejected. | Result sheet, segmented control. |
| 37 | Vertical oscillation close-up | USED | Dark pill + glass circle dock detail; triangle marker on an arc. | Dock check-in button, ruler pointer. |

## Rules for Claude Code

1. Always use tokens (CSS variables / Tailwind theme keys). No raw hex, px font sizes, or shadows in components.
2. Never introduce a new colour. If a combination is missing, compose from existing tokens and check contrast.
3. signal-change (ember) means “Real change” only. It never decorates, never marks a CTA, never means “good”.
4. Within-noise is always neutral grey. No green for “stable”, no red for “worse”.
5. Skin tone changes are “change detected”: ember marks, neutral words; never better/worse, never a light-to-dark scale.
6. Verdicts always render glyph + text (VerdictBadge). Colour is never the only carrier.
7. Metric numbers use tabular figures (Doto/Geist Mono) and always show units.
8. Numbers in Gemini text are inserted from engine values via <MeasuredValue>, never generated text.
9. No stock face photos, no body imagery, no product photos, no brand logos. Line drawings + aura blur only.
10. Respect prefers-reduced-motion: every animation has the fallback listed in Motion.
11. Copy comes from the voice rules and the metric-direction table. No hype words.
12. Check contrast for every new token pairing: 4.5:1 text, 3:1 large text and UI marks.
13. Disclaimer on every report and every retail export.
14. Touch targets ≥ 44px; inputs 16px text.
15. One primary (yellow) button per view.
16. Grain overlay and canvas blobs live once in the app shell, not per component.

## Definition of done

- [ ] Built only from components in the inventory; no one-off styles.
- [ ] No hard-coded colours, sizes, radii or shadows (grep for # and px in className/style).
- [ ] Every verdict shows glyph + text; screen passes a greyscale screenshot check.
- [ ] All metric values tabular, with units, correct rounding and U+2212 minus.
- [ ] Copy matches voice table; no banned words (run the lint list).
- [ ] Contrast AA verified for every text/background pair used.
- [ ] Keyboard: every control reachable, visible focus ring, logical order, Esc closes overlays.
- [ ] Screen reader: landmarks, labelled inputs, live regions for processing and chat.
- [ ] Reduced motion checked (OS toggle on).
- [ ] Phone 375px, tablet 768px, desktop 1280px all checked; no horizontal scroll; no empty grid holes.
- [ ] Empty, first reading, processing, partial/total failure, timeout, offline, demo, deleted states implemented where listed.
- [ ] Disclaimer present on reports; synthetic badge on every retail chart when not real.
- [ ] iPhone Safari: safe-area insets, 100dvh, backdrop-filter with -webkit- prefix.

### Home: compact cards
- Home cards are kept small and quiet: a bigger card is shrunk to match its neighbour, never the other way round. Product and measure rows are one line (name, a short status, a small chart), with no tally lines or long legends.
- What changed: the three leading measures (changed first) with value and move against the baseline; the rest are one count.
- Your goals replaced Recent: up to three goal measures as small trends against the person's normal range, beside Routine today once a measured check-in follows the baseline (otherwise Routine today takes the row).
- Check-in card: the big number (days since baseline) sits above the title; the Check in button is bottom right.
