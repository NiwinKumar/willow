# UX spec (owner: Niwin; Harshini reviews capture screens)

## Principles
1. **Calm and honest.** Show uncertainty plainly ("within noise", "trend only"). Never alarm, never flatter.
2. **Inclusive.** Skin tone is descriptive only. No "bad skin", "flaws", "fix", "fairness", "whitening". Prefer "calmer", "more even", "smoother", "fewer blemishes".
3. **Guided.** Every capture step tells the user exactly what to do and checks it live.
4. **Mobile-first** (iPhone Safari is the main device), good on desktop (judges). Large tap targets, readable at arm's length.
5. **Accessible.** WCAG AA contrast; never color-only meaning (icons + text); labels on all inputs; reduced-motion respected.

## Wording per metric (direction -> friendly text)
| metric | user label | decrease means | increase means | notes |
|---|---|---|---|---|
| tone_ita | Skin tone (ITA°) | "change detected" | "change detected" | Never "better/worse". Shown in Science panel + product tests. |
| pigment_spots | Dark spots | "fewer/lighter spots" | "more visible spots" | |
| tone_evenness | Tone evenness | "more even" | "less even" | value is unevenness; lower = more even |
| redness | Redness | "calmer" | "more redness" | caveat for deep skin tones |
| blemishes | Blemishes | "fewer blemishes" | "more blemishes" | indicative |
| pores | Pores | "less visible pores" | "more visible pores" | macro only |
| texture | Texture | "smoother" | "rougher" | macro only |
| lines | Lines | "softer lines" | "more visible lines" | indicative |
| dark_circles | Under-eye | "darker under-eye" (more negative ΔL\*) | "brighter under-eye" | value is under-eye minus cheek ΔL\* |
| shine | Shine | "less shine" | "more shine" | indicative; depends on goal |
| glow | Glow | "less glow" | "more glow" | indicative |
Verdict badge text: `real_change` -> "Real change" + friendly text; `within_noise` -> "Within normal photo variation"; `no_baseline` -> "First reading"; `low_quality` -> "Photo quality too low to compare".

## Screens
1. **Landing.** Hero line, 15-second explainer, three judge buttons: *Explore a real journey* (seeded demo, read-only), *Try with sample photos*, *Try your own selfie*. Sign in (Google) or continue as guest (anonymous).
2. **Consent.** Plain-language: what we store (photos in a private bucket, deleted after 30 days; results in your account), optional "use my anonymized results to improve recommendations and retailer insights" toggle, delete-my-data, cosmetic disclaimer. Versioned.
3. **Goal picker.** Up to 3 of: clearer skin, even tone & fewer dark spots, calmer skin, smoother texture & pores, softer lines, under-eye, oil control & glow. Sets which groups lead the report.
4. **Capture guide.** Choose site (face, cheek close-up, nose close-up, forearm treated/control). Mode: *Calibrated* (iPhone RAW in Lightroom + color card; upload DNG via "Choose File" -> Files) or *Quick selfie* (browser camera; uncalibrated). Checklist with illustrations: card visible, same light, distance, neutral face, hair back, no makeup. Baseline prompt: "Take 5 photos, moving the phone away and back between each."
5. **Upload + processing.** Per-file progress (signed URL PUT), then stages: "Checking photo quality -> Correcting colors -> Measuring -> Explaining". Typical 10-20 s.
6. **Report.** Header: "N real changes since your baseline". Groups (Tone & Pigment, Redness, Clarity, Texture & Pores, Lines, Under-eye, Oil & Glow) ordered by goal. Each metric: value + unit (info icon), confidence chip (Measured / Indicative), verdict badge, mini sparkline. Overlay toggle on the photo. Gemini explanation card ("Why this matters", next steps). Quality issues listed with fix tips. Disclaimer.
7. **Timeline / compare.** Metric chart over time with shaded MDC band; markers for routine changes; before/after slider on aligned images; treated vs control view for the forearm test.
8. **Routine.** List AM/PM products; add by label scan (camera/photo) or catalog search; Gemini compatibility check: conflicts (severity + how to fix, e.g. "use on alternate nights"), duplicates, gaps (e.g., "no sunscreen while using a retinoid"). Link each product to its outcome on your timeline.
9. **Advisor chat.** Suggested prompts ("Is my niacinamide doing anything?", "What should I add for dark spots under 1,500?"). Answers cite your measured results and catalog products; product cards with multi-store buttons.
10. **Retailer dashboard** (desktop-first). Banner "Synthetic demo cohort + team data". Tabs: Customer needs next, Product outcomes by profile, Brand/category performance, Assortment gaps, Routine conflicts. Embedded Looker Studio + native charts from `/v1/retailer/insights`.
11. **About / science.** How measurement works (card, RAW, MDC), what we don't measure, fairness results, privacy.

## States to design
Empty (no sessions yet), first reading (no baseline), processing, partial quality failure, total quality failure (retake tips), engine timeout (retry), offline, demo read-only notices, deleted data.

## Visual direction
See `docs/DESIGN.md` (Oct 13) for the full direction, tokens, flows, components and motion; it supersedes this paragraph. In short: warm low-chroma paper, ink-green text, sage brand green, one signal accent used only for "real change", grey hatched band for "within noise", rows with hairline rules rather than cards, photos on a neutral grey stage, icons only where they carry meaning, no stock photos of faces.
