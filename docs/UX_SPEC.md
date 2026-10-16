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
| pigment_spots | Dark spots | "fewer/fainter spots" | "more visible spots" | |
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
   *Sponsored card (Oct 16; RETAILER_INSIGHTS.md "Proof-gated promotion").* Below the person's own routine, at most one small card: "Sponsored · Willow Proven" first (text, not a tooltip), packshot, name and brand, the evidence line with n and cohort label, "Why am I seeing this?" (the matched goals / skin type + the disclosure), "View product" (the product sheet) and "Hide sponsored" (toast with Undo). Never in the demo journey; never above the routine, the check or Suggested today; never styled like an organic suggestion (no aura, no ember). Retail campaign stats: delivery counts are shown as counted; the holdout comparison appears once each group has 10 people.
   *You → "Sponsored suggestions" switch* (on by default) sits with the privacy receipt; off hides the card everywhere (`profile.hide_sponsored`).
9. **Advisor chat.** Suggested prompts ("Is my niacinamide doing anything?", "What should I add for dark spots under 1,500?"). Answers cite your measured results and catalog products; product cards with multi-store buttons.
10. **Retailer dashboard** (desktop-first). Banner "Synthetic demo cohort + team data". Tabs: Customer needs next, Product outcomes by profile, Brand/category performance, Assortment gaps, Routine conflicts. Embedded Looker Studio + native charts from `/v1/retailer/insights`.
11. **About / science.** How measurement works (card, RAW, MDC), what we don't measure, fairness results, privacy.

## Spot diary (face; api `GET /v1/spots`, types `SpotDiary` in `web/src/lib/api.ts`)
What happened to each spot over time: which spots are new, still there, fading or gone, and which areas of the face get new ones. Lives on the face report (`/s/face_full`), below "Spots on this photo".
- **Face map.** `web/src/data/faceMap.ts` (generated by `engine/scripts/export_face_map.py`): outline, eyes, brows, lips, nose and the 8 zones in the api's millimetres (flip y for SVG). Draw it mirrored, like a selfie, so the person's right cheek is on their right; the zone labels stay "Right cheek" / "Left cheek". One dot per track at `x_mm, y_mm`; dot style by status (icon + text in the legend, never colour alone). Zone tint by how many spots appeared there; never skin-coloured palettes.
- **Spot rows.** One row per track: the crops of each sighting in session order (`observations[].crop_url`, columns = `sessions`), an empty slot where it was not seen, the stage chip per crop, status and days. Tap a row: the Stage jumps to that session and rings that spot (`candidate_id`, `bbox`).
- **Zone cards.** Per zone: visible now, appeared, faded, came back; "Spots here usually stay visible about 3 to 5 days" only when `typical_days_visible` is not null (3+ faded spots).
- **Rings on the photo.** A ring whose spot is in a track can say "new" or "here since day 2".
- **Words.** Status: New, Still there (N days), Fading, Not seen last time, Faded (between A and B days). Stage: Raised spot (`bump`), Blackhead or whitehead (`clogged_pore`, use the label's own name when known), Mark left behind (`mark`), Red spot (`red_spot`), Dark spot (`dark_spot`). Zones: Forehead, Nose, Right cheek, Left cheek, Around the mouth, Chin, Right jawline, Left jawline. Never: acne, lesion, papule, pustule, heal, recovery, flare, inflamed, breakout. Durations are always "at least" or a range; stages are AI-suggested.
- **States.** No face sessions: invite the first photo. 1-2 sessions or `enough_data` false: "Take a photo each day in the same place and light; the diary fills in from day 3" with the sessions so far as a strip. `sessions_not_mapped` > 0: "N earlier photos are not in the diary yet". `unconfirmed` > 0: a quiet line "N spots seen only once are not shown". Laptop photos flicker more than phone photos: "Not seen last time" is normal, not an error.
- **Flow.** After a face session: "Same time tomorrow?" with what the diary needs (same place, same light, no makeup). Judge mode needs a seeded person with 4+ daily sessions.

## States to design
Empty (no sessions yet), first reading (no baseline), processing, partial quality failure, total quality failure (retake tips), engine timeout (retry), offline, demo read-only notices, deleted data.

## Visual direction
See `docs/DESIGN.md` (Oct 15, v3, from the Claude Design handoff) for the visual system, components, states and voice, and `design-from-claude-design/Willow App.dc.html` for the built screens; both supersede the screen list above where they differ. `docs/DESIGN_GAPS.md` lists what the design shows that the backend cannot supply yet, and the reverse.
