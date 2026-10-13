# Research 02: How premium health / quantified-self products present baselines, trends, uncertainty and "is this change real"

Scope: patterns Willow can borrow for the Report and Timeline screens (personal baseline, MDC95 noise band, per-metric verdicts, Measured/Indicative confidence, before/after slider, treated-vs-control forearm test). Researched 2026-10-13 from vendor help centers, science pages, and the uncertainty-visualization literature. Where a claim is a vendor's own marketing number it is flagged as such.

---

## 0. The one-paragraph takeaway

Every credible product in this space has converged on the same grammar: **a personal baseline learned over a fixed warm-up (7 to 30 days), a shaded "your typical range" band, today's value as a single dot/number, and a three-state label (inside / slightly outside / clearly outside)**. None of them explain the statistics on the main screen; they put a one-line plain-English sentence next to the number and push the math into an info sheet or a science page. The products that users trust most (Apple Vitals, Oura, Natural Cycles) also share two habits: they are *conservative by default* (when unsure, say "typical" or "red", never a false positive) and they *gray out* or label results during the learning period rather than hiding them. Willow's MDC95 band is a direct analogue of Apple's "typical range", Garmin's "baseline range", Fitbit's "personal range" and WHOOP's "typical range", so the visual vocabulary is already familiar to the target user; Willow's edge is that its band is a *measurement-error* band (test-retest), which is a stronger, more honest claim than any of the wearables make, and the science page should say so.

---

## 1. Patterns for personal baseline + noise band + today's value

### 1.1 What the products actually do

| Product | Baseline window | Band semantics | Today's value | States / labels |
|---|---|---|---|---|
| **Apple Watch Vitals** (watchOS 11+) | 7 nights to "establish your typical range" | "Typical range" per metric; no formula published; built from Apple Heart and Movement Study data | Overnight value plotted as a dot/bar against the range | **Typical / Outlier** (also High / Typical / Low counts in the States view). Notification only when 2+ metrics are outliers in the same night. |
| **Garmin HRV Status** | 3 weeks of sleep data before any status | "Baseline range" (personal) plus age-norm range | 7-day average, not single night | **Balanced** (green, inside range) / **Unbalanced** (orange, above or below) / **Low** (red, well below) / **Poor** (vs age norm) / **No status** (insufficient data) |
| **WHOOP Health Monitor** | ~30 days to compute typical range; bar only shown "provided there is sufficient data to create a baseline" | "Typical range" per vital (RHR, HRV, RR, SpO2, skin temp) | Last night's reading | Green check = "within or near the typical range"; orange / red exclamation = "outside of the typical range and you may want to keep an eye on the metric over the next few days" |
| **Fitbit Health Metrics** | Up to 30 days; skin temp needs 3 nights | "Personal range, which is based on the average of your recent data" | Nightly value; skin temp shown as *variation from your baseline*, not absolute | In / out of personal range |
| **Oura Readiness contributors** | "Up to two weeks for the Oura App to learn your average values"; "long-term" = past 2 months | Contributor evaluated against personal average; temperature shown as +/- deviation from baseline with a 3-day weighted smoothing in Trend view | Today's contributor value | **Optimal / Good / Fair / Pay attention** (85-100 / 70-84 / 60-69 / 0-59) on contributor bars |
| **Oura Symptom Radar** | Personal baseline | Deviation of a *combination* of metrics | n/a | **No signs / Minor signs / Major signs**, with the deviating metrics listed underneath as the explanation |
| **Apple Health / Fitness Trends** | 180 days before Trends appear | Compares last 90-day average vs last 365-day average | Arrow up / down per metric; chart draws a step function between the two averages | "Improving" vs "needs a look" groups; tap shows both averages |
| **Levels** | Rolling 4-hour glucose baseline | Spike = rise of 30+ mg/dL above baseline AND above 109 mg/dL (two conditions, both required) | "+35" label = peak minus rolling baseline | Spiking / Recovering / Crashing phases; Stability Score 60-100 with "aim for 85+" guidance |
| **Natural Cycles** | Learns in 1-3 cycles but outputs from day 1 | Binary outcome from a probabilistic model | Red / Green day | When uncertain (noisy or missing temperatures) the day is Red. Uncertainty always resolves to the safe side. |
| **Withings / trend-weight apps** | Exponential moving average | Trend line drawn through noisy daily weigh-ins | Raw point + smoothed trend | No labels; the line is the message |

### 1.2 The convergent visual grammar (sketch in words)

The canonical card, as seen in Apple Vitals, WHOOP Health Monitor and Fitbit, looks like this:

```
 Redness (a*)                               Measured
 ──────────────────────────────────────────────────
 14.2   ▼ 1.1 vs your baseline
 
 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  <- shaded band = your noise band (MDC95)
 ──────────────●─────────────────  <- baseline line (median of 5 reference photos)
          ▲
     today's dot, filled, with 2px halo
 
 Within normal photo variation
 Your band: 13.1 - 15.3          ⓘ
```

Key properties that recur:

1. **The band is drawn, not described.** A light tint (Tufte's "gray band" for the normal range), full-width, with the baseline as a thin line through its middle. The band is *behind* the line; the line must stay clearly visible (Tufte).
2. **One dot for today.** Larger than history dots, high-contrast fill, optional halo. Apple and WHOOP put the number in large type at the top-left of the card and the dot on the chart; the two are visually linked by color (Tufte's advice: color-accent the current number and the latest point identically).
3. **Delta sentence, not raw numbers only.** "▼ 1.1 vs your baseline" or "+35 above baseline" (Levels). Oura temperature is *only* shown as deviation from baseline, never as an absolute, which is exactly the right instinct for Willow's non-absolute metrics.
4. **Three-state semantics, two of which are calm.** Inside band = quiet neutral; just outside = attention color (amber); clearly outside = strong color. Nobody uses red for "no change".
5. **Warm-up handled explicitly.** Garmin: "No status" with a count-down. WHOOP: bar hidden until baseline exists and recovery score "grayed out for the first four days". Apple: "wear for 7 nights". Willow's equivalent: the band is drawn *dashed* and labeled "Baseline: 3 of 5 reference photos" until MDC95 exists, and the verdict chip reads "First reading".
6. **Smoothing the history, not the point.** Oura Trend view: 3-day weighted average. Withings: EMA. Apple Trends: 90-vs-365 averages. The *current* value is never smoothed; the *trend* is.

### 1.3 Timeline-with-noise-band pattern (per metric)

Sketch:

```
 Redness over 6 weeks                      [ 1M  3M  6M  All ]
 
  16 ┤
     │        ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  <- MDC95 band, constant height,
  15 ┤  ○  ○  ░░○░░░░○░░░░░░░░○░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░     anchored on the baseline
  14 ┤ ─ ─ ─ ─░─○─ ─ ─ ─ ─ ─○─ ─ ─ ─ ─●─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  <- baseline median (dashed)
  13 ┤        ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  12 ┤                                          ●        ●       <- points outside band: filled + accent color
     └──┬────────┬────────┬────────┬────────┬────────┬─────────
      baseline  wk1      wk2      wk3      wk4      wk5
      (5 photos)
                 │ started product                                  <- event marker (vertical tick + label)
```

Decisions embedded here, each borrowed from a product:

- **Baseline photos drawn as a cluster at x=0** (five hollow dots), so the user *sees* why the band is as wide as it is. This is the honest version of Natural Cycles' "noisy temperatures produce more red days": the spread of the five dots explains the band width.
- **Band height constant, anchored to baseline** (not a cone). Cones imply growing uncertainty over time, which is not the case for a fixed test-retest band, and cones are widely misread (hurricane literature: viewers read the cone as "the area affected" and "the storm growing"). A flat band avoids both misreadings.
- **Points inside the band are hollow / muted; points outside are filled / accented.** This is the same encoding Apple Vitals uses for Typical vs Outlier and Tufte's "importance flags".
- **Event marker for "started product"** (vertical tick with label). Apple's Trends and Oura's tags do this; it is what makes the timeline answer the question "did the product do it".
- **Low-quality readings drawn as a faint x or an open square with a tooltip** ("Photo quality too low to compare"), not omitted (omission looks like a gap in adherence; WHOOP greys out rather than hides).
- **Direction of "good"**: Apple Fitness uses an up arrow for improving regardless of whether the metric is "more" or "less". For Willow, the y-axis must be labeled with the plain-language direction ("less redness ↓") and the verdict copy must avoid any "higher/lower = better" framing on tone metrics (product rule 3).

### 1.4 Handling the "is this a trend" question

Apple Health's step-function trend (90-day vs 365-day averages) is criticized (Dr Drang) because it draws a discrete jump where the data show gradual scatter. Lesson for Willow: do not fit a line through noisy points and call it a trend. Instead:

- State the comparison in words: "Last 3 readings average 12.4, your baseline is 14.2, difference 1.8, your noise band is ±1.1" and let the shaded band do the visual work.
- Only use the word "trend" when at least N (e.g. 3) consecutive readings are outside the band on the same side. WHOOP's copy is a good model: "outside of the typical range; keep an eye on it over the next few days" for one reading, versus a firm statement for a sustained run.

---

## 2. How to word and visualize "within noise" without it feeling like failure

### 2.1 Evidence from the products

- **Apple Vitals' default state is "Typical"**, rendered in the calm neutral color, and the app "won't flash you with an alert or warning" for one metric outside the range. Typical is framed as the *good* state, the thing you want to see every morning. Reviewers explicitly recommend "looking for patterns rather than reacting to one night".
- **Garmin names the in-range state "Balanced"** (green), a positive word, and the out-of-range states "Unbalanced"/"Low". The in-band state is the aspirational one.
- **Natural Cycles' uncertainty always resolves to the safe answer** (Red). The equivalent for Willow is: when unsure, say "Within normal photo variation", never "Real change". That makes the "Real change" verdict rare and therefore credible.
- **Oura Symptom Radar: "No signs"** is the normal state; it is phrased as absence of a signal, not as a failed test. It also says the radar may detect strain "despite your biometrics being within their usual range", i.e. it acknowledges that "within range" is a statement about the measurement, not a verdict on the body.
- **Levels** explains *why* a number differs from what the user expects ("the spike value won't match peak-minus-lowest because the baseline is a rolling average"). Explaining the mechanism removes the sense that the app is withholding a result.
- **Cochrane framing review (35 studies, ~16k participants):** positive vs negative framing of health messages made little difference to behavior but positively framed messages were perceived as more effective. So gain framing is cheap and does no harm; it is not a substitute for clarity.
- **Hullman 2019, "Why Authors Don't Visualize Uncertainty":** authors omit uncertainty because they fear it undermines their result and competes for attention. Willow's product thesis is the opposite (uncertainty *is* the product), so the uncertainty band should be the most prominent chart element, not a footnote.

### 2.2 Recommended wording ladder for Willow (cosmetic, no diagnosis)

Primary chip (one of four, from the contract):

| Verdict | Chip color | One-line body copy under the number |
|---|---|---|
| Real change | accent (brand), filled | "Outside your normal photo-to-photo variation. This is a measurable change." |
| Within normal photo variation | neutral gray, outlined | "Today's reading sits inside your personal noise band (±1.1). Nothing measurable has changed yet." |
| First reading | neutral, dashed | "This is your reference point. We will compare future photos to it." |
| Photo quality too low to compare | amber, outlined | "Lighting or framing differed too much from your reference. Retake to compare." |

Principles behind the "within noise" copy:

1. **Say what it is, not what it isn't.** "Inside your noise band" (a fact about the measurement) rather than "no improvement" (a judgment about the product).
2. **Put the number of the band in the sentence** so the user sees it is a *threshold*, not an opinion: "(±1.1)". Levels and Oura always quote the baseline number in the explanation.
3. **Add a time horizon**, the way WHOOP does ("keep an eye on it over the next few days"): "Most skincare effects take 4-8 weeks to exceed photo noise." This turns "no change" into "not yet", without promising a result.
4. **Never color the in-band state red or use a downward icon.** Use the same neutral as Apple's "Typical".
5. **Make the Real change state rare and earned.** If most readings are in-band, the in-band state becomes the normal, expected screen, and the accent-colored Real change becomes the event. Products that fire positive verdicts often (early Neutrogena-style "your score went up 2 points!") train users to distrust them.
6. **For the control-arm comparison, "within noise" is the control doing its job**: "Your untreated side stayed inside its noise band, as expected. That means the change on the treated side is not photo drift."
7. **Avoid "normal" alone** (reads as a medical judgment). Prefer "your normal photo variation" or "your noise band". The phrase "normal range" in wearables refers to the person's own range and all of them say "your".

### 2.3 Visual treatment of in-band readings

- Hollow dot, muted stroke; the band tint is slightly stronger than the background so the dot visibly sits *inside* something.
- Optionally a tiny caption under the chart: "4 of 5 readings inside your band" — this is Apple Vitals' "States" view (count of days Typical / High / Low), and it reframes the in-band state as the baseline fact rather than a failure.
- Do not animate in-band readings. Reserve motion (dot settles, band pulses once) for the Real change state.

---

## 3. Best practices for metric cards, sparklines, confidence chips and info popovers

### 3.1 Metric cards

Observed across Oura contributors, WHOOP Health Monitor, Apple Vitals, Fitbit Health Metrics:

- **Fixed anatomy, top to bottom:** metric name + confidence chip on the same line; big number with unit; delta vs baseline in small text with an arrow; sparkline or band-bar; one-sentence verdict; info affordance (ⓘ or "More Info") at the end.
- **Band-bar variant (WHOOP Health Monitor style)** for a compact list: a horizontal track with the typical range shaded and a dot for today. Everything readable at one glance; the user scans five of them vertically. Sketch:

  ```
  Texture (roughness)         Measured
  ├────░░░░░░░●░░░░────────┤   Within normal photo variation
  ```

- **Four-tier label bars (Oura)** work for scores, not for raw physical measurements. Willow's metrics are physical quantities with a noise band, so use the band-bar, not a 0-100 score bar.
- **Number precision:** Oura/WHOOP show 0 or 1 decimal. Never show more decimals than the MDC95 justifies (if the band is ±1.1, show 1 decimal).
- **Sort order:** Apple Vitals sorts outliers first, Oura puts "Pay attention" contributors on the home screen. Willow: Real change cards first, then Within noise, then Low quality, then First reading.

### 3.2 Sparklines (Tufte, "Beautiful Evidence" pp. 46-63)

- "Small, intense, word-sized graphic with typographic resolution." Put it *next to the number* it describes; the number gains meaning from its history.
- **Shade the normal range as a gray band** behind the line (Tufte's clinical glucose example): readings outside the band are what the eye should catch. Keep the band modest so the line stays visible; "avoid stoplight charts".
- **Color-accent the last point and the big number in the same color.** Mark the endpoints (first/last) in one color, min/max in another, if space allows.
- **Aspect ratio:** follow Cleveland's 45° rule so slopes average ~45°, "lumpy not spiky". For a row of sparklines use one shared aspect ratio.
- **Scale consistency:** if several sparklines are compared, share the y-scale or they lie (Bissantz note on Tufte's forum). For Willow, each metric has its own units, so instead share the *band height* visually: render every sparkline so the MDC95 band occupies the same pixel height. Then "how far outside the band" is comparable across metrics by eye.
- **Outliers:** sparklines are vulnerable to one wild point flattening the rest; clamp low-quality readings out of the y-range calculation.

### 3.3 Confidence chips ("Measured" vs "Indicative")

Analogues: Oura's "HRV rating" vs "HRV Balance" distinction; Garmin's "Poor" (vs age norm) vs "Low" (vs own baseline); Welltory's measurement "accuracy 95-100%" badge split into *behavior quality* and *technical quality*; Natural Cycles' Red default.

Recommendations:

- Two chips only, always visible on the card, same position, so the user learns them in one session: `Measured` (filled, quiet) and `Indicative` (outlined, with a small "~" or dotted icon).
- The chip is about **the metric's measurement validity**, not about the verdict. Keep that separation explicit in the popover: "Measured = computed from calibrated color under the capture protocol, with a personal noise band. Indicative = a directional estimate; we do not draw a noise band or declare Real change for it."
- Indicative metrics should never show the "Real change" verdict (otherwise the chip is decorative). Their verdict set is "First reading / Looks higher / Looks lower / Looks similar / Photo quality too low" or simply trend arrows without a band.
- Welltory's split into *behavior* vs *technical* quality maps cleanly to Willow's capture-quality reasons: "framing / distance / lighting" (behavior) vs "white-balance / exposure / blur" (technical). Surface the specific reason in the low-quality chip's popover so the user can fix it.

### 3.4 Info popovers / "How we calculate this"

Observed patterns: Apple Vitals' "More Info" sheet ("what results you may see, what it means to be outside your typical range, which lifestyle factors may affect results"); Levels' support guide addressing the exact confusion users hit ("why doesn't +35 equal peak minus lowest?"); Oura's per-contributor explanation; WHOOP's "possible explanations of any variation".

Recommended popover structure for each Willow metric (3 short blocks, no scrolling on iPhone):

1. **What it measures** (one sentence, cosmetic language): "Redness: how much red the skin region shows relative to your own skin median, after color calibration."
2. **How we decide Real change** (two sentences, quoting the user's own numbers): "Your five reference photos varied by ±1.1. A reading has to move more than that to count as Real change (this is the MDC95: the smallest change bigger than photo-to-photo noise with 95% confidence)."
3. **What can move it that is not your skin** (bullets): lighting, time of day, exercise, temperature, retaking after cleansing. This is the Apple/WHOOP "possible factors" list and does the most to prevent the user from over-reading one reading.
4. Footer link: "Read the methodology" to the science page.

Copy rules: no new digits beyond those in the input (product rule 2 already requires this for Gemini output; apply it to the static popover copy too); no disease names; "not a medical assessment" line on any metric that touches moles.

---

## 4. Before/after and treated-vs-control comparison patterns

### 4.1 Before/after image comparison

What the skin apps do:

- **Neutrogena Skin360 / Perfect Corp YouCam "Skin Diary":** weekly re-scan prompt, side-by-side "before and after selfies", an overall score as "a baseline for tracking", per-attribute sub-scores. Notable weakness: YouCam also compares the user "to the same demographic", which is exactly the population ranking Willow must not do.
- **Haut.AI:** emphasizes standardized capture tools; the before/after is only trusted because capture is standardized. This matches Willow's capture protocol being the foundation of the comparison.

Evidence on *which* comparison mode works:

- **Toggle/flicker beats side-by-side for change detection when images are aligned.** Drew et al. 2015 (23 radiologists, mammography): toggling was ~6 s faster, accuracy +5% (not significant in the small sample). Josephs, Drew & Wolfe 2015: toggle ("shuffle") about 6 s faster; the advantage is strongest when the two images are nearly aligned and shrinks when misaligned. AJNR 2011: subtraction and automated change detection (with or without flicker) more sensitive than side-by-side for tumor progression.
- **Misalignment kills the comparison**: "substantial changes can be missed if the images are misaligned" (Drew). Willow's registration step (same framing, warp to reference) is therefore not cosmetic; it is what makes the slider honest.

Slider best-practice checklist (from general before/after component guidance plus the above):

- Same crop, same registration, same color calibration applied to both; show the capture date on each side.
- Start the handle at 50%; labels ("Baseline, 12 Sep" / "Today, 13 Oct") fade while dragging and return on release.
- Offer **three modes**: swipe slider (default, best for emotional impact), **tap-to-toggle / hold-to-flicker** (best for actually seeing change), and side-by-side (fallback when registration failed). Keyboard arrows step the slider on desktop.
- Make the slider *subordinate to the numbers*: the verdict chips sit above the image. The image is evidence, the chips are the claim. Never let the image imply a change the metrics did not find; add the caption "Numbers above are measured; the image is for reference" when the verdict is Within noise.
- Let the user pick any two dates, not only first vs latest.
- Alt text should describe the measured difference ("redness lower by 1.8 on the treated side"), not "before and after".
- No auto-animation of the handle (motion implies a reveal).
- Do not show a tone/lightness-based comparison as "improvement" (product rule 3).

### 4.2 Treated-vs-control (split-forearm) presentation

Clinical split-face trials (IPL rejuvenation RCT; clascoterone cream trial, 50 participants) use: random assignment of side, blinded photographic evaluation, per-side ratings, and report *per-endpoint* results (e.g. 82% judged better on treated side at 1 month, but rhytids not significantly different). The consumer-facing lesson: report per metric, and let some metrics be null.

No consumer product in the researched set has a true within-person control UI; WHOOP's "treated vs untreated" nearest analogue is the Journal feature (behaviour tagged vs untagged days, shown as two averages). So Willow can define the pattern. Proposed sketch:

```
 Self-tanner test: left forearm (treated) vs right forearm (control)
 
 Tone shift (ITA)                         Measured
                      Treated     Control
 Baseline (5 photos)   41.2        41.0
 Today                 33.8        40.6
 Change                -7.4        -0.4
 Noise band            ±1.6        ±1.6
 
 [ Real change on treated side ]  Control stayed within noise
 
    Treated  ├──░░░░░░●░░░░──────────────────┤  (band centered on its own baseline)
    Control  ├──░░░░░●░░░░░───────────────────┤
 
 Difference-in-difference: -7.0 (outside noise band)   ⓘ
```

Rules:

- **Each arm has its own baseline and its own band**, drawn in the same two-row band-bar style, so the eye compares two dots against two bands.
- **The headline verdict is on the difference of differences**, not on the treated arm alone. Copy: "The treated side changed by 7.4 and the untreated side by 0.4. The gap (7.0) is well outside photo noise, so this is a real effect of the product, not lighting or time of day."
- **Control staying inside its band is reported as a success of the test** ("as expected"), never as a null.
- **Paired image slider** underneath: left/right forearm in one frame (they are captured together), with the slider running across the midline so the user sees treated vs control at the same moment in the same lighting. This is the consumer version of the blinded split-face photo.
- **If the control arm also moved outside its band**, say so plainly and downgrade the verdict: "Both sides changed. Something other than the product (lighting, sun, temperature) likely moved the reading. We can't attribute this change to the product."
- Timeline variant: two lines (treated solid, control dashed) with one shared band height, event marker at "first application".

---

## 5. Trust-building patterns (science page, methodology, validation numbers)

### 5.1 What the best science pages contain (structure)

**Natural Cycles /science** (the strongest template for a regulated-feel page):
- Hero: "regulated medical device" claim with a stats panel: 15,000 women, 180,000 cycles, 93% typical use, 98% perfect use.
- Regulatory status by region (FDA cleared 2018, CE Class IIb, ARTG 2020) with linked certificates.
- "Typical vs perfect use" explained, linking to an effectiveness page.
- Peer-review FAQ ("evaluated by independent experts").
- Logos of research partners (NIH, Karolinska, UCL, FIU).
- Separate "How does it work?" page with the learning-period and Red-day-when-uncertain explanation, and the explicit "No method of contraception is 100% effective".

**Oura /science-and-research**:
- Headline numbers *with the reference method*: HR 99% (r² vs ECG), HRV 98% (r² vs ECG), ovulation 94% (vs OPK), sleep 79% (vs PSG). The reference method next to every number is the key move.
- "130+ peer-reviewed publications", "50+ PhDs", "14 active collaborations", "12+ years"; named institutions (UCSF, UCLA, Scripps, NUS, Michigan, Harvard/BWH advisors).
- Sensor explanation (which LEDs measure what).
- Medical advisors with names.
- Weakness: one number ("at 83%") is shown without explanation, and no explicit medical disclaimer; a reminder that every number needs a definition.

**WHOOP**: cites a third-party funded study (Australian Institute of Sport / CQUniversity, published in Sensors) with "99.7% HR, 99% HRV vs ECG"; independent reviewers note the study was sleep-only and on older hardware. Lesson: say *what conditions* the validation covers.

**Levels / Lingo**: no formulas published, but the support center explains thresholds precisely (30 mg/dL AND >109; 4-hour rolling baseline), explains rounding, and explains why similar inputs score differently. Lingo explains that the target is "population benchmark for week 1, then personalized", and that a slower algorithm may revise a number later in the day. Explaining *revision* builds trust.

**Apple**: attributes the Vitals algorithm to "real-world data from the Apple Heart and Movement Study"; every feature page ends with "not a diagnosis". Apple also publishes per-feature validation white papers (not retrieved here, but worth emulating as a one-page PDF per metric for judges).

### 5.2 Recommended Willow "How Willow measures" page (one screen on phone, expandable)

1. **Headline:** "Every number comes from calibrated computer vision. Gemini writes the explanation; it never produces a measurement." (This is product rule 1 stated as a trust claim; no other product can say the AI is excluded from the numbers.)
2. **Stats panel (only numbers you can defend):** number of reference photos per baseline (5), the confidence level (95%), the capture-protocol items (distance, color card, exposure lock), test-retest repeatability per metric from your own validation (e.g. "MDC95 for redness: ±1.1 across N sessions"), and the camera/phone models tested.
3. **"What is a noise band?"** with the forearm analogy and a mini chart.
4. **"Why we never rank skin tone"** paragraph (rule 3) as a stated principle; this doubles as an ethics/trust statement.
5. **Reference methods**: name what each metric is benchmarked against (colorimeter / ITA definition / published formula), with citations. Mirror Oura's "X% vs ECG" structure: "ITA agreement vs handheld colorimeter: r = ...".
6. **Limits, stated first-person**: "Willow is a cosmetic measurement tool, not a medical assessment. Moles: see a dermatologist for changing moles."
7. **Changelog of algorithm versions** (Oura publishes "Sleep Staging Algorithm 2.0" posts; Lingo tells users values may be revised). If the engine version changes, say which readings were re-computed.

### 5.3 Small trust behaviours inside the app

- Gray out, don't hide, during warm-up (WHOOP, Garmin).
- When unsure, default to the conservative verdict (Natural Cycles).
- Quote the user's own numbers in every explanation (Levels, Oura).
- Tell the user what *else* could have moved the number (Apple, WHOOP).
- Show "this reading was retaken / excluded for quality" explicitly rather than silently dropping it.
- Keep the same label vocabulary everywhere (Oura's "Pay attention" vs "pay attention" inconsistency is small but noticed).

---

## 6. Anti-patterns to avoid

1. **Population comparison / demographic ranking.** YouCam compares skin scores "to the same demographic"; WHOOP publishes member-average HRV by age. For Willow this would violate rule 3 and also destroys the within-person logic. Never show a cohort percentile for a tone metric.
2. **Step-function trends that invent a jump** (Apple Health's 90-vs-365 step; Dr Drang's critique). Show the band and the points; do not draw a fitted line and call it a trend.
3. **Cone of uncertainty.** Widely misread as "the affected area" and "the thing growing"; a hard boundary creates a false "safe outside the cone" feeling. Use a flat, anchored band with soft edges.
4. **Bare error bars on bars** (Correll & Gleicher 2014, "Error Bars Considered Harmful"): viewers judge values inside the bar as more likely than values just outside (within-the-bar bias), and read error bars as all-or-nothing. Prefer a shaded band / gradient; if a point sits near the band edge, say "at the edge of your noise band" rather than letting the edge imply a cliff.
5. **Unlabeled ranges.** A shaded band can mean 95% CI, 80% CI, SD, min-max... (Datawrapper warning). Always caption the band: "Your noise band (MDC95 from 5 reference photos)".
6. **Fake motion / jitter.** The NYT needle's artificial jitter was reviled and removed; motion should only reflect real data changes.
7. **Too many decimals and false precision.** Show one decimal at most when the band is ±1.
8. **Overfiring positive verdicts.** Early skin apps gave a new score every scan; users learn that scores drift ±2 for no reason and stop believing them. Keep Real change rare.
9. **Red / downward iconography for "no change".** Within noise is a neutral, not a loss.
10. **Hiding results during warm-up or hiding bad photos.** Both look like the app is withholding; show the state and the reason.
11. **Before/after images that out-shout the numbers.** The slider is evidence, not a verdict; never let an un-registered or un-calibrated image stand alone.
12. **Numbers without reference method** on the science page (Oura's unexplained "83%").
13. **Medical or disease framing** (contrast Oura Symptom Radar's careful "signs of strain" vs press coverage's "predicts sickness"). Use Willow's own cosmetic vocabulary and never let Gemini-generated copy upgrade it.
14. **"Lighter = better" or any absolute tone scale**, including in chart axis direction and arrow colors.
15. **Animated uncertainty (HOPs) on the main screen.** HOPs help trained and untrained viewers judge weak trends (Hullman/Kale), but they are animation-heavy and unfamiliar in consumer health; keep them (if at all) as an optional "show me the five baseline photos' spread" toggle in the info sheet, not as the default chart.

---

## 7. Sources

Products / help centers
- Oura readiness and contributors: https://support.ouraring.com/hc/en-us/articles/360057791533
- Oura HRV trends (90-day average, top-left latest value): https://support.ouraring.com/hc/en-us/articles/360055983614
- Oura body temperature as deviation from baseline: https://ouraring.com/blog/your-body-temperature-and-oura/
- Oura Symptom Radar: https://ouraring.com/blog/symptom-radar/ and https://support.ouraring.com/hc/lv/articles/52627030482707
- Oura science and research page: https://ouraring.com/science-and-research
- Oura Tokyo PSG validation: https://ouraring.com/blog/oura-ring-accuracy-validation-study-university-of-tokyo/
- WHOOP Health Monitor: https://www.whoop.com/thelocker/health-monitor-feature/ ; Wareable write-up (30-day baseline, green/amber/red): https://www.wareable.com/wearable-tech/how-whoop-health-monitor-guided-me-through-a-nasty-bug
- WHOOP recovery colors (67/34 thresholds): https://www.whoop.com/thelocker/how-does-whoop-recovery-work-101
- WHOOP accuracy claims (CQUniversity/AIS study): https://www.whoop.com/thelocker/whoop-proven-most-accurate-wearable-in-heart-rate-heart-rate-variability-measurements ; critique: https://the5krunner.com/2022/11/12/is-whoop-accurate/
- WHOOP baseline grayed out in first days (podcast): https://www.whoop.com/thelocker/podcast-40-whoop-recovery-maximize-readiness/
- Apple Watch Vitals (7 days, typical range, outliers, More Info sheet): https://support.apple.com/120142 ; Wareable: https://www.wareable.com/apple/how-vitals-app-finally-makes-apple-watch-a-wellness-powerhouse ; iGeeksBlog: https://igeeksblog.com/?p=692224
- Apple Fitness Trends (90 vs 365 days, 180 days to start): https://apple.co/36ggRsf ; Macworld explainer: https://www.macworld.com/article/233093/ios-13-and-apple-watch-activity-trends-give-you-the-big-picture.html
- Apple Health trends critique (step function): https://leancrew.com/all-this/2024/11/apple-health-trends/
- Apple Health highlights and trends (20 data types, newsroom 2021): https://www.apple.com/newsroom/2021/06/apple-advances-personal-health-by-introducing-secure-sharing-and-new-insights/
- Garmin HRV Status (Balanced/Unbalanced/Low/Poor, 3 weeks): https://www8.garmin.com/manuals/webhelp/GUID-4462687B-8DF5-4719-872E-E16754F9D4B0/EN-US/GUID-5247CEC7-AF06-44FB-B6AD-87C53D4F7941.html
- Garmin Body Battery explainer: https://www.wareable.com/garmin/garmin-body-battery-explained-how-it-works-8734
- Fitbit personal range (up to 30 days): https://support.google.com/fitbit/answer/14236917?hl=en
- Levels scores and metrics guide (baseline, spike rule, stability score): https://support.levels.com/article/768-how-levels-scores-and-glucose-metrics-work-a-complete-guide ; zone scores: https://support.levels.com/article/32-zone-scores ; stability: https://support.levels.com/article/266-about-the-stability-score
- Lingo Count target (population benchmark then personalized): https://support.hellolingo.com/hc/en-us/articles/16066333980695-How-do-you-determine-my-Lingo-Count-target ; values revised later in the day: https://support.hellolingo.com/hc/en-us/articles/21824745598354-Why-are-my-Lingo-Count-values-changing-throughout-the-day
- Natural Cycles science page: https://www.naturalcycles.com/science ; how it works: https://www.naturalcycles.com/how-does-natural-cycles-work ; red days when data is missing: https://help.naturalcycles.com/hc/en-us/articles/360003317413-What-happens-if-I-sometimes-forget-to-measure ; learning period: https://help.naturalcycles.com/hc/en-us/articles/360003313193-How-long-will-it-take-the-app-to-get-t
- Natural Cycles effectiveness literature: Contraception 2017 https://pubmed.ncbi.nlm.nih.gov/28882680/ ; BMJ Open 2019 https://bmjopen.bmj.com/content/9/3/e026474 ; NICE MIB244 https://www.nice.org.uk/advice/mib244/chapter/Clinical-and-technical-evidence
- Eight Sleep (respiratory rate "alongside your typical range"): https://www.eightsleep.com/himsandhers/
- ZOE PREDICT: https://zoe.com/learn/zoe-predict-studies-what-we-ve-learned ; https://zoe.com/post/nature-medicine-predict-1
- Welltory measurement accuracy / quality split: https://welltory.com/rules-accurate-hrv-measurements/ ; https://help.welltory.com/articles/4412277 ; https://welltory.com/how-welltory-tracks-heartbeat/
- Withings trend weight (moving average, Hacker's Diet): https://blog.withings.com/2010/07/06/its-now-even-easier-to-follow-your-weight-trend
- Ultrahuman recovery contributors (color-coded bars): https://techcrunch.com/?p=2484486

Skin apps
- Neutrogena Skin360 (weekly scan, before/after selfies): https://jnj.com/innovation/neutrogena-skin360-the-revolutionary-face-scanning-device-and-beauty-app ; https://gizmodo.com/neutrogenas-free-skincare-app-actually-works-mostly-1841026360
- Perfect Corp YouCam Skin Diary and demographic comparison: https://www.businesswire.com/news/home/20200925005178/en
- Haut.AI standardized capture: https://www.personalcareinsights.com/news/hautai-ai-skin-analysis-platform.html

Uncertainty visualization research
- Hullman, Resnick, Adar 2015, HOPs outperform error bars and violins: https://mucollective.northwestern.edu/files/2015-HOPs-PLOS.pdf
- Kale, Nguyen, Kay, Hullman 2019, HOPs for trend inference: https://idl.uw.edu/papers/hops-trends
- Hullman 2019, Why Authors Don't Visualize Uncertainty: https://arxiv.org/abs/1908.01697
- Correll & Gleicher 2014, Error Bars Considered Harmful (gradient and violin plots, within-the-bar bias): https://graphics.cs.wisc.edu/Papers/2014/CG14/Error%20Bars%20Considered%20Harmful%20Exploring%20Alternate%20Encodings%20for%20Mean%20and%20Error.pdf
- Cone of uncertainty misreadings (NOAA literature review; Northwestern summary; Witt et al.; Millet/Cairo redesign): https://www.aoml.noaa.gov/general/lib/lib1/nhclib/Bibliographies/Cone%20of%20Uncertainty%20Literature%20Review_4_10_19%20%281%29%20%281%29.pdf ; https://www.mccormick.northwestern.edu/computer-science/news/articles/2019/how-data-visualizations-can-clarify-and-confound-uncertainty.html ; https://virtual.ieeevis.org/year/2020/paper_w-comm-1023.html
- Tufte sparklines (gray normal-range band, aspect ratio, endpoint markers): https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/
- Datawrapper on labeling ranges and within-the-bar bias: https://www.datawrapper.de/blog/confidence-intervals-value-markers-bar-charts/ ; line-chart bands: https://www.datawrapper.de/academy/how-to-show-confidence-intervals-in-datawrapper-line-charts
- FiveThirtyEight 2020 forecast design (ball swarm, grid of maps): https://www.niemanlab.org/2020/07/this-is-how-fivethirtyeight-is-trying-to-build-the-right-amount-of-uncertainty-into-its-2020-election-data-analysis/ ; Gelman on whether it helped: https://statmodeling.stat.columbia.edu/2020/11/06/is-there-a-middle-ground-in-communicating-uncertainty-in-election-forecasts/
- NYT needle jitter criticism and removal: https://www.cjr.org/special_report/2018-midterms-forecasts-538-cnn-times-needle.php ; https://www.niemanlab.org/2020/11/bad-polls-fake-news-and-that-damned-needle-heres-how-the-media-covered-a-twisty-election-night/

Change detection / image comparison
- Drew et al. 2015 (toggle vs side-by-side, mammography): https://aval.psych.utah.edu/pdf/Drew%20et%20al.,%202015%20JMI.pdf
- Josephs, Drew, Wolfe 2015 (shuffle/toggle advantage depends on alignment): https://aval.psych.utah.edu/pdf/Psychonomic%20Bulletin%20and%20Review%202015%20Josephs.pdf
- AJNR 2011 subtraction/flicker vs side-by-side: https://www.ajnr.org/content/ajnr/32/9/1652.full.pdf
- Split-face trial examples (IPL RCT with blinded photo evaluation; clascoterone half-face): https://pubmed.ncbi.nlm.nih.gov/16924047/ ; https://clinicaltrials.gov/study/NCT06415292

MDC / clinical change interpretation and framing
- MDC vs MCID distinction and individual-level use: https://pmc.ncbi.nlm.nih.gov/articles/PMC4994512 ; https://pubmed.ncbi.nlm.nih.gov/21934362 ; https://cris.maastrichtuniversity.nl/en/publications/three-ways-to-quantify-uncertainty-in-individually-applied-minima/
- Cochrane review on positive vs negative framing of health messages: https://www.cochrane.org/evidence/CD006777_framing-health-information-message-either-negative-or-positive-words
