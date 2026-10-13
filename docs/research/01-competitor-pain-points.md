# Research 01: Consumer skin-analysis experiences and their pain points

Prepared for Willow (hackathon, Google Cloud AI Builder Cup 2026). Date: 2026-10-13.
Scope: Neutrogena Skin360, Haut.AI, Perfect Corp / YouCam, Olay Skin Advisor, L'Oréal Skin Genius / ModiFace, TroveSkin, Skinive, Cureskin, Dermalogica Face Mapping, Revieve, Proven, Curology, Function of Beauty, Lumin, Typology, plus 2025-26 entrants (L'Oréal Cell BioPrint, Skin Intelligence, ScanSkinAI, looksmaxxing scanners, Philips Lumea Skin-Selfie Analyser, Ulta Skin Analysis) and research on skin-tone bias.

## Method and limits

- Sources: vendor pages, trade press, hands-on reviews (Gizmodo, Gearbrain, Reviewed, HelloGiggles, Dermatology Times, DermApproved, Dermelloa), App Store / Play / Product Hunt / Trustpilot / Thingtesting review summaries, forums (Mumsnet), one hobbyist measurement project (GitHub "same-light"), peer-reviewed and preprint research, and court/settlement reporting.
- **Reddit (r/SkincareAddiction, r/30PlusSkinCare) is blocked to our crawler**, so no Reddit threads are quoted directly. Community sentiment below comes from Mumsnet, Product Hunt, Trustpilot/Thingtesting aggregations, App Store reviews and Lipstick Alley snippets. Treat it as directional.
- Every accuracy figure quoted from a vendor (95%, 98%, ICC 0.97) is **self-reported with no published methodology** unless stated otherwise. This is itself one of the findings.

## 0. Executive summary

The category has converged on one pattern: one selfie -> a 0-10 / 0-100 "skin score" per concern (often plus a "skin age") -> a routine built from the sponsoring brand's catalog. Users and reviewers hit the same wall every time: the number moves when the light moves, the app never shows the error bars, the output is framed as a deficit to be fixed by buying something, and nobody can tell whether the product they bought did anything. Darker-skinned users get the least reliable readings and the least disclosure. Privacy has already produced a $4.7M settlement (Skin360) and a live case (ModiFace). Nobody in the consumer space does within-person controls, noise-aware verdicts, lighting matching to a baseline, or per-tone confidence disclosure. Those are Willow's open lanes.

## 1. Product-by-product audit

| Product | Onboarding | Capture guidance | Results presentation | Complaints | Praise | Worth borrowing |
|---|---|---|---|---|---|---|
| **Neutrogena Skin360** (Kenvue; Perfect Corp engine 2020, Haut.AI engine 2024-25) | 2018: $59.99 clip-on SkinScanner. 2020: free app, 3 selfies + NAIA chatbot quiz on goals/habits. Now web app only (Android app removed Apr 2023). Haut.AI refresh: one selfie + short questionnaire. | 2018 scanner: press on forehead, eye corner, cheek, chin; 8 LEDs, 30x magnify. 2020: plain selfie. Refresh: Haut.AI LIQA live coaching on head position, lighting, shadows. | 2018: moisture/pores/lines 1-100, >81 good, 50-81 "tweaks", <50 "room for improvement". 2020: five scores /10 (wrinkles, fine lines, dark circles, smoothness, dark spots) banded Okay 1-4.9 / Good 5-7.9 / Great 8-10. Refresh: 8 indicators, overall 1-10, AM/PM Neutrogena routine with a "must-have" pick. Weekly rescan nudge. | Google Play 2.76/5 (270 ratings). Gizmodo: side-by-side compare showed the same two photos under different dates; slow/finicky; can't add missing brands; "will never describe your skin as bad"; "ramps up insecurity so you buy whatever it is they're hocking". HelloGiggles: 85 first scan then a 19-point moisture drop a week later. Gearbrain: recommendations "made me feel bad"; 25% discount only pays off after ~$240 spend; site stores every 30x photo. BIPA class action (facial geometry stored with name/DOB), court rejected the "healthcare" exemption, **$4.7M settlement Aug 2025**. Dermatologists in Fortune: "partially a marketing strategy". | Free; add your own (non-Neutrogena) products; weekly cadence is enough; gamified; 1M+ faces scanned. | LIQA-style live quality coaching (Haut.AI study: 87% usable images with live guidance vs 32% with written instructions). Weekly cadence. Letting users log any product. |
| **Haut.AI** (B2B SaaS behind Skin360, used by Beiersdorf, Ulta, Grupo Boticário) | Embedded widget, no app; selfie + optional questionnaire. | LIQA: real-time position/angle/lighting/framing checks plus a backend quality check. | 0-100 per metric, grades, overlays, plain-language text; claims "150+ biomarkers" on one page and "15+" on another; Fitzpatrick and Monk outputs. | All validation vendor-reported: "98% accuracy", "ICC 0.97-0.98 across lab/clinic/home" with no protocol, sample or ICC model; uses generative AI to synthesize "underrepresented skin types" (a fairness red flag if it substitutes for real data). | Capture coaching, home/clinic/lab capture tiers, accepts VISIA uploads. | The three capture tiers (lab / clinic / home) map directly to Willow's calibrated / semi-calibrated / quick modes. |
| **Perfect Corp YouCam / Skincare Pro** | Single selfie; consumer in YouCam Makeup (free "skin score"), pro iPad app for clinics by subscription. | App claims to "validate lighting and environmental quality" before analysis; Skin Diary feature tells users to shoot in the same position and lighting each day. | Overall skin score 0-100 and 0-99 per concern across up to 16 concerns, plus **skin age**; "Rate My Face". | **Measured drift** (GitHub same-light): same file is deterministic, but ±20% exposure and warm/cool shifts move pore 85->96, wrinkle 82->89, texture 85->92, acne 93->99, skin age 22->25 on unchanged skin; after histogram-matching to a baseline residual noise is wrinkle ±2, pore ±3, texture ±2, acne ±4 and anything beyond 35% exposure / 0.25 warmth must be retaken. "95% test-retest" is Perfect Corp's own report (Wake Forest, 50 consumers, "same key concerns" not same numbers). Dermelloa: "limited value", proprietary score, "beauty-retail conversion tool" (vendor markets ~14x sales uplift). App privacy label: tracks across apps, photos linked to identity. | Slick, fast, free; virtual try-on. | Pre-capture lighting validation is the right idea; Willow should do it against the user's own baseline, not a generic threshold. |
| **Olay Skin Advisor** (P&G) | One selfie + a few questions; ~1 min. | "Well-lit area, remove makeup, glasses, pull back hair." | A single **skin age** plus the zones "ageing you", then Olay products. Trained on ~50k selfies (P&G employees), female faces only (P&G scientist: less accurate for men). | Mumsnet: "+3 years first time, +13 second"; "only thing I did differently was turning the bathroom light on"; "+8 then -6, only my hair was different"; "I'm now having a proper strop and not playing anymore". Dermatology Times (Draelos, n=60, FST I-IV only because "app companies themselves say their apps are inaccurate for deeply pigmented skin"): subjects read ~3 years younger under incandescent than under LED/fluorescent. Dermelloa: "limited value", P&G cites ~200% conversion uplift. | Fun, fast, free; mamabella's 10 runs mostly returned the same age (stable in fixed conditions). | Only the brevity. Skin age as a headline is the clearest anti-pattern in the category. |
| **L'Oréal Skin Genius / ModiFace** | Selfie, then age, skin type (dry/normal/combo/oily), sensitivity. | "Remove glasses and makeup, tie hair back, natural well-lit light, avoid pouting, frowning or smiling." Selfie "deleted after the test". | 8 attributes scored 1-10 and banded Excellent 9-10 / Good 7-8 / Moderate 4-6 / **Needs Attention 1-3**, one tagged "Priority concern" (sample: Radiance 6.6 Moderate). Strengths vs focus areas, AM/PM routine from 30+ products, retake every 6-8 weeks. "Up to 95% accuracy vs dermatologist" (brand claim; 10k clinical + 18k selfies in 5 lighting settings; no per-tone results). | No independent test on darker skin found. ModiFace BIPA suit (Kukovec v. L'Oréal) allowed to proceed Sept 2024 because the privacy policy never mentioned facial geometry. | Neutral-expression instruction; explicit retake interval; selfie deletion statement; strengths listed first. | Stated retake interval and "we delete the selfie" line. Avoid the 1-3 "Needs Attention" deficit band. |
| **TroveSkin** (Singapore; 1.2M users, ~60% Indonesia) | Selfie analysis + daily skin diary, log products, habits, lifestyle triggers. | Third-party guidance: repeat the same distance/time/lighting, review weekly not daily. | Skin type and problem areas, trend charts by week/month, reminders. | 3,000-review Play Store study: mostly positive but negatives cite performance, accuracy of product recommendations, clarity of instructions, privacy. Perfect Corp blog: "accuracy has received mixed reviews". | Habit + trigger logging next to photos; trend view. | The diary pattern: log the routine change on the same timeline as the measurement. |
| **Skinive** (CE Class I MDR, ISO 13485; mole/condition scanner) | Photo of a spot, 3 photos of the same area requested, risk level, weekly self-check nudge. | FAQ admits misreads when photo quality is inadequate; a Dutch dermatologist notes it "doesn't warn users when a photo is too blurry". | Risk categories, "detailed reports that explain why". | Play 3.8/5 (1.89k). Product Hunt: company admits "our algorithm is adapted to 1-5 skin phototypes" (FST VI not covered); reviewer: dataset sources undisclosed, ISIC not licensed for commercial use, accuracy report "not tested on NEW photos taken with the smartphone". Dutch experts: low positive predictive value, false cancer warnings, weekly self-test "utterly over the top", ignores history. | Clear report structure, quick scan. | Only the plain "not a diagnosis" wording and dermatologist handoff. |
| **Cureskin** (India) | App, photos + questions, dermatologist-reviewed regimen, kit ₹499-2,000. | Standard selfie. | Detected concerns (dark spots, dandruff), routine, kit. | App Store IN 4.3 (1.1k): worsened acne, "redness, burn, itching"; "generic responses" from support; refund refused, return policy not disclosed; "the goalposts kept moving on how quickly results would appear"; failed deliveries. | Simple, detected dark spots the user cared about, products "suited to Indian climates", doctors answer follow-ups. | A human in the loop reassures; Willow's equivalent is Gemini explanations that only quote measured numbers. Avoid vague time-to-results. |
| **Dermalogica Face Mapping (online)** | Selfie **or** a detailed quiz (quiz is the fallback when the photo fails). | Photos often rejected: poor lighting, multiple faces, tilt, low resolution, with a retake tip. Consent text says vendors may process "facial geometry". | 7+ concerns rated 1-100 "seriousness", then redirect to e-commerce and a live aesthetician chat; copy deliberately worded "to not overpromise". | Sales funnel; facial-geometry consent. | Honest about being a product finder; quiz fallback; rejection reasons are specific. | Quiz fallback when capture fails; naming the exact rejection reason. |
| **Revieve** (B2B, Oriflame, Matas, KICKS, Skin First) | Selfie + short lifestyle questionnaire, "within seconds". | Minimal. | "20 core metrics / 200 sub-metrics" (another page says 100+ markers), chat assistant, products matched to the partner's inventory. | Only vendor KPIs exist (3.6x conversion, +29% AOV, +180% conversion); claims it beats in-store consultants with no evidence. | Fast for retailers. | Nothing for the user side; a warning about catalog-constrained advice presented as neutral. |
| **Proven Skincare** | 3-minute "Skin Genome Quiz" (age, ethnicity, skin type, priorities, environment), custom formulas, subscription; Sephora tie-in. | None (no photo). | Custom product set. | Charged for a system not ordered, "no refunds", white cast, fragrance irritation. Dermelloa: "depends on your goal; requires subscription". | Pleasant quiz, some glowing reviews. | Quiz brevity (3 min). Avoid quiz-as-science. |
| **Curology** | Questionnaire + 3 selfies, provider reviews, prescription subscription. | Front + both sides, face fills screen, no mirror selfies, no makeup, no filters, natural light or "best bathroom lighting"; before/after lighting "as similar as possible". Progress photo gallery. | Provider notes, formula, progress page. | Trustpilot: cancel button errors, charges with no pre-ship notice, refund chasing; retinoid irritation. | Long-term users, customer service, human provider. | Three-angle self-capture and explicit before/after lighting matching. Avoid subscription dark patterns. |
| **Function of Beauty** | Quiz -> custom hair/skin formulas. | None. | Personalized bottle. | Thingtesting 3.1/5, 42% would recommend: "inconsistent, underwhelming formula performance"; Illuminate Labs ran the quiz with random answers and found no evidence-backed actives. | Quiz is "engaging and customizable", packaging. | Lesson: personalization theater does not survive contact with results. Willow sells proof, not personalization. |
| **Lumin** (men) | Quiz + free trial -> subscription; ~50% of trials convert (company figure). | None. | Product set. | Trustpilot themes: "hidden subscriptions", "Big scam", hard to cancel, delayed shipping, irritation. | Simple routine, decent products. | Nothing. |
| **Typology** | ~15 questions, up to 3 concerns picked in priority order, 24 skin profiles (codes like "VE(+)"). | None. | Profile code, detailed analysis, AM/PM routine from essentials only. **Retaking permanently replaces old results; "we cannot restore old results."** | Cryptic profile codes; history destroyed on retake; 4.3/5 is self-reported. | Concern priority ordering; essentials-only routine. | Priority-ordered goals (Willow's goal picker already does this). Never overwrite history. |

### 2025-26 entrants and adjacent signals

- **L'Oréal Cell BioPrint (CES 2025)**: tape-strip proteomics in a credit-card cartridge + "Skin Connect" face imaging; reports "biological skin age", retinol responsiveness and "issues before they are visible". Pilot in Asia; no validation published. Signals that big beauty is moving to "measurement" language, still anchored on age.
- **Skin Intelligence**: ran its own two-light test and found "every service we tried scored differently"; ships a lighting gate, a five-scan onboarding "ritual", a two-model blend, and frames scores as "directional readings that track change, not verdicts". Closest philosophical neighbour to Willow, but still ML-scored and no noise band.
- **ScanSkinAI**: free web-first scanner; the only one in its own comparison that states testing across Fitzpatrick I-VI; paid reports and dermatologist review upsell.
- **Looksmaxxing scanners (Umax, PSL, SkinPal)**: Umax 7M+ downloads, ~$500k/month; Fortune reports psychologists say they worsen teen mental health; Bark rates PSL 1.0/5 for turning appearance into a score. The "face rating" framing is spreading into skincare apps ("facial harmony score /100" next to skin age).
- **App Store clone apps** ("AI Skin Scanner Face Analyzer", "AI Skin Age Test", "SkinMax"): claim "95% accuracy" on "100K+ samples" with no validation, subscriptions, inconsistent privacy labels.
- **Philips Lumea Skin-Selfie Analyser** support page openly admits: if your score is "significantly different from one photo to the next", recreate the same lighting, distance and angle. A hardware brand telling users the number is capture-dependent.
- **Ulta Skin Analysis**: three questions (skin type, age, goals), then front camera, "pull back hair, find good lighting"; recommendations from Ulta's assortment.

### Research on bias and capture (what the evidence actually says)

- Daneshjou et al., Science Advances 2022 (DDI dataset): state-of-the-art dermatology AI "exhibit substantial limitations" on dark skin tones; fine-tuning on diverse images closes the gap.
- 2025 narrative review (PMC12624499): lower accuracy on darker skin in "the majority of studies"; many studies lack skin tone data entirely.
- ChatGPT-4o melanoma study: lower sensitivity/specificity for FST III-VI. Pipsqueak dataset: melanoma sensitivity 67% -> 11% on darker-skin lesions, model attending to surrounding skin rather than the lesion.
- Gender Shades (MIT 2018): 0.8% error for light-skinned men vs 34.7% for dark-skinned women in commercial facial analysis.
- Practical Dermatology on consumer/cosmetic apps: "we do not know where the data derived to come up with these algorithmic models comes from"; asks whether models account for how light falls on darker skin and whether that makes it read as oilier.
- Dermatology Times (Draelos): LED point sources exaggerate fine lines; incandescent softens them (~3 "years" difference). Apps are "not designed to give an accurate age assessment", they are "an in-home channel for selling".
- PMC12851522 (mobile 2D capture for aesthetics trials): ~15 cm optimal distance, daylight best, >5° pose deviation triggers a reposition prompt, auto-capture with audio guidance, self-captured photos reached ICC 0.75-0.93 vs live clinician rating; limited FST V/VI, lighting "could not be fully controlled".
- VISIA validation (PMC9175133): even the clinic reference has avg r=0.74 across measures; wrinkles among the least consistent.
- Monk Skin Tone scale (Google/Ellis Monk) and Sony's hue-angle work: lightness alone misses hue bias; cosmetic "redness" reads are the ones most likely to break on darker skin.

## 2. Pain-point table

| # | Pain point | Evidence / source | How Willow answers it in the UI |
|---|---|---|---|
| 1 | **Same skin, different number.** Scores move with light, angle, hair, camera. | same-light: pore 85->96, skin age 22->25 on unchanged skin; Mumsnet: "+3 then +13 years... the only thing I did differently was turning the bathroom light on"; Draelos: ~3 years younger under incandescent; Philips Lumea support page; Skin Intelligence two-light test. | Five-frame baseline per site -> MDC95 band per metric; verdict badge `within_noise` = "Within normal photo variation". Timeline shows the shaded MDC band so the user sees the noise floor, not just the line. |
| 2 | **No lighting control at capture; retakes come too late.** | Dermalogica rejects after upload; Skinive "doesn't warn when a photo is too blurry"; same-light's retake thresholds (35% exposure / 0.25 warmth) are the only published numbers. | Live capture checklist (UX_SPEC screen 4) should add a **baseline-match meter**: compare live frame exposure, white balance and card patch readings to the user's baseline, show green/amber/red with a one-line fix ("Too warm, move away from the lamp"). Block capture on red. |
| 3 | **Fake precision / no error bars.** 0-99 scores, 6.6/10, "150+ biomarkers". | DermApproved: "a snapshot with error bars the app never shows you"; Dermelloa: proprietary score is "not a standardised clinical metric". | Show value ± MDC95 and a Measured / Indicative chip on every metric; round to the precision the MDC supports; never an overall "skin score". |
| 4 | **Skin age and face scores drive insecurity.** | Gizmodo: "may catapult your neuroticism to new heights"; Mumsnet "proper strop"; Fortune on looksmaxxing apps and teen mental health; Bark 1.0/5. | No skin age, no overall score, no attractiveness or symmetry readings, no ranking. Header is "N real changes since your baseline". Tone shown as ITA band + Monk estimate, both marked descriptive, with "no direction is better". |
| 5 | **Measurement and merchandising are the same screen.** | Gearbrain: recommendations "made me feel bad"; Draelos: "in-home channel for selling"; Olay ~200% and Revieve 3.6x conversion uplifts; DermApproved: "if different skin types all lead to the same hero serum, the diagnosis is doing marketing work". | Report screen contains zero product cards. Advice lives in the Advisor and Routine screens, is opt-in, cites the user's measured numbers, and shows multi-store links so no single retailer is privileged. |
| 6 | **Darker skin gets worse readings and no disclosure.** | Skinive: "adapted to 1-5 skin phototypes"; Draelos: companies "say their apps are inaccurate for deeply pigmented skin"; Daneshjou 2022; Gender Shades; Practical Dermatology on unknown training data in cosmetic apps. | All thresholds are relative to the person's own skin (k * MAD, under-eye minus cheek, tone-relative pigment map). Redness carries an explicit deep-tone caveat and drops to Indicative when erythema contrast is low. About/Science page publishes per-ITA-band validation results, including where Willow is weak. |
| 7 | **Colorism baked into "brightening" and "radiance" scores.** | L'Oréal "Radiance" scored as a concern; YouCam "skin tone evenness"; Monk/Sony research on lightness bias. | tone_ita direction is always "change detected", never better/worse. Glow is change-only and composite (chroma + fine-variance), with copy reviewed so a higher L* alone never reads as a win. Banned words list from UX_SPEC enforced in Gemini validators. |
| 8 | **Biometric privacy.** | Skin360 BIPA class action -> $4.7M settlement (court: calling it "medical care" was "a reach"); ModiFace suit survives because the policy never mentioned facial geometry; Dermalogica consent names facial geometry; YouCam privacy label tracks across apps; Gearbrain: Neutrogena stored every 30x photo. | Consent screen in plain language: what is stored, 30-day photo deletion, one-tap delete, no face-geometry identification, no cross-app tracking, no sale of data. Show a "Photos delete on <date>" line in the report footer. |
| 9 | **Nobody can tell if the product worked.** | HelloGiggles wanted "whether a product is working beyond what I can see"; Cureskin "goalposts kept moving"; Function of Beauty quiz praised, results "underwhelming"; DermApproved advises standardized photos every few weeks as a "measuring stick". | Product-linked timeline: each routine change is a marker; each product gets a verdict after its expected time-to-effect ("No measurable change in dark spots after 6 weeks"). Treated vs control forearm view for a real within-person test. |
| 10 | **Results overwritten or history lost.** | Typology: "we cannot restore old results"; Gizmodo: compare view showed the same two photos under different dates. | Sessions are immutable; compare picker always shows capture timestamps and thumbnails; baseline can never be silently replaced. |
| 11 | **Photo rejected with no usable fix; all-or-nothing failure.** | Dermalogica rejections; Skinive FAQ; PMC12851522 shows pose prompts and auto-capture reduce failures. | `low_quality` state names the specific reason with an illustrated fix and a "retake only this site" button; partial reports render the metrics that passed. |
| 12 | **Jargon and cryptic outputs.** | Typology "VE(+)"; Haut "150+ biomarkers" vs "15+"; L'Oréal "glabellar / marionette". | User labels from the UX_SPEC wording table; unit behind an info icon; Gemini explanations may only quote numbers present in the input (validator rejects new digits). |
| 13 | **Unverifiable accuracy claims.** | "95%" (Perfect Corp, L'Oréal), "98%" (Haut.AI), "94.2%" (Skinive) all self-reported; Product Hunt reviewer: Skinive's report "not tested on NEW photos taken with the smartphone". | Science page explains the method (color card, RAW, 5-frame MDC, DHA/forearm validation) and shows the actual repeatability numbers per metric and per tone band, including failures. |
| 14 | **Scan-anxiety cadence.** | Skinive weekly self-test called "utterly over the top"; Skin360 weekly nudge; looksmaxxing daily checking. | Re-check dates are tied to ingredient time-to-effect (e.g. 8-12 weeks for pigment actives). Copy: "Daily scans mostly measure your lighting." |
| 15 | **Medical framing and overdiagnosis.** | Dutch experts on Skinive: low PPV, false warnings; Fortune dermatologist: infections can look like acne. | Cosmetic-only language, no disease names; moles get the fixed line "not a medical assessment; see a dermatologist for changing moles". |
| 16 | **Hardware and cost friction.** | $59.99 Skin360 scanner (iPhone-only, flaky Bluetooth); Cell BioPrint is a tabletop device. | Phone + optional color card. Quick-selfie mode works with nothing; calibrated mode is a $10-30 card, not a gadget. |
| 17 | **Subscription dark patterns.** | Curology cancel errors and unannounced charges; Lumin "Big scam"; Proven "no refunds". | Measurement is free, guest mode works without an account, no auto-renew anywhere in the MVP. |
| 18 | **Single selfie = no baseline.** Every app treats scan 1 as truth. | All audited consumer apps; Skin Intelligence's 5-scan ritual is the only exception. | `no_baseline` state = "First reading"; baseline prompt "Take 5 photos, moving the phone away and back between each" with a short explanation of why. |
| 19 | **Gendered or narrow training data.** | Olay trained on female faces; PMC12851522 cohort "predominantly female and White". | Classical CV only; no demographic model to be biased by. Say so on the science page. |

## 3. Borrow / Avoid

**Borrow**
- Haut.AI LIQA-style live capture coaching (87% vs 32% usable images) and its lab/clinic/home capture tiers.
- Curology's three-angle self-capture rules and explicit "match before and after lighting" instruction.
- L'Oréal Skin Genius: neutral-expression prompt, stated retake interval (6-8 weeks), "selfie deleted after the test" line, strengths listed before focus areas.
- Dermalogica: specific rejection reasons with a retake tip, and a quiz fallback when capture is impossible.
- Skin360 / TroveSkin: let users log any product and habit on the same timeline as measurements; weekly (not daily) cadence.
- Typology: pick up to three concerns in priority order.
- same-light: calibrate noise bands per metric and refuse to "certify" a change outside the calibrated capture range.
- Skin Intelligence: frame readings as directional and insist on a scan ritual for the first sessions.
- PMC12851522: ~15 cm macro distance, >5° pose deviation triggers a prompt, auto-capture with audio cue so users don't have to look at the screen.
- Skinive's one good line: "preliminary information for skin awareness, not a diagnostic decision".

**Avoid**
- Skin age, overall skin score, face rating, symmetry, "harmony", percentile vs other people.
- "Needs attention" / "room for improvement" / "flaws" deficit bands; red-amber-green traffic lights that make a 4/10 feel like a failure.
- Product cards on the measurement screen; "must-have" picks; single-retailer links.
- Unverifiable headline accuracy ("95%", "98%") without method.
- Silent overwrite of past results; compare views without timestamps.
- Weekly fear-based rescan nudges; daily scanning.
- Facial-geometry consent buried in a policy; cross-app tracking; storing photos indefinitely.
- Synthetic (generative) data as a substitute for real darker-skin validation.
- Cryptic profile codes and "150+ biomarkers" numerology.
- Quiz-as-diagnosis ("Skin Genome") and personalization theater.
- Subscriptions, trials that auto-convert, no-refund policies.

## 4. Ten UX opportunities nobody in this space does well

1. **"What would count as real" on every metric.** Next to each reading show the MDC band and the sentence "A change of more than X would be a real change." Users of every audited app are left guessing whether a 3-point move means anything.
2. **Baseline-match meter before the shutter.** Live comparison of exposure, white balance and color-card patch values to the user's own baseline, with a specific fix per failure. Only a hobbyist GitHub project does this today; no shipping app does.
3. **Per-product verdict cards with a scheduled re-check.** When a product is added, Willow stamps the timeline with its expected time-to-effect and books the re-check; at that date the card says "Real change / Within normal photo variation / Decide later", with the measured numbers. Turns "is my niacinamide doing anything?" into a yes/no with evidence.
4. **Within-person split test (treated vs control forearm).** A guided two-square protocol that makes the user their own control. No consumer app offers a control condition; it is the single strongest proof mechanism available on a phone.
5. **Per-tone confidence disclosure.** Each metric shows the validation status for the user's ITA band ("Redness is Indicative for deep tones; here is why"). Competitors either hide this or admit it only when asked on Product Hunt.
6. **A report with zero commerce and an advisor that cites your numbers.** Hard firewall between measurement and advice; the advisor's product cards state which measured metric they target, expected time-to-effect, and multi-store prices. Opt-in "don't suggest products" toggle.
7. **Quality failures that teach and degrade gracefully.** Specific reason, illustrated fix, "retake just this site", and a partial report for the metrics that passed, instead of the all-or-nothing rejection users hit in Dermalogica and Skinive.
8. **Routine conflicts linked to measured outcomes.** If redness rose after a new acid was added alongside a retinoid, the conflict card shows the overlap with dates and the measured delta. Clash checkers (and Curology providers) exist; none are wired to a measurement.
9. **An honest "proof card" export.** Aligned before/after with the verdict badge and the noise band baked into the image, shareable, as a counter to lighting-tricked social before/afters. Nobody exports uncertainty.
10. **Privacy receipt and data dignity.** A single screen listing what is stored, where, the deletion date, and a one-tap delete, plus a plain statement that no facial geometry is computed for identification. The Skin360 settlement shows the cost of getting this wrong; no competitor surfaces it as a feature.

Bonus: **"Why there is no skin score"** explainer on the About/Science page. Judges and users have been trained by the category to expect one; a 15-second explanation of why Willow refuses it is a differentiator in itself.

## 5. Sources

Neutrogena Skin360
- Gizmodo, "Neutrogena's Free Skincare App Actually Works...Mostly": https://gizmodo.com/neutrogenas-free-skincare-app-actually-works-mostly-1841026360
- Gearbrain, Skin360 scanner review: https://www.gearbrain.com/neutrogena-skin-360-review-2634120119.html
- Reviewed, preview of the new Skin360 app: https://www.reviewed.com/beauty/features/a-preview-of-the-new-neutrogena-skin360-app
- HelloGiggles Skin360 review (via search snippet; site unreachable at time of fetch): https://hellogiggles.com/neutrogena-skin360-app-review/
- AppBrain Play Store listing (2.76/5, removed Apr 2023): https://www.appbrain.com/app/neutrogena-skin360%C2%AE/com.neutrogena.skin360
- Personal Care Insights, Haut.AI x Neutrogena refresh: https://www.personalcareinsights.com/news/hautai-neutrogena-skin360-refresh.html
- Fortune / Yahoo Finance, face-scanning AI apps and cosmetics companies: https://finance.yahoo.com/news/face-scanning-ai-apps-giving-150000900.html
- Cosmetics Business, J&J BIPA lawsuit: https://www.cosmeticsbusiness.com/j-j-faces-biometric-privacy-lawsuit-in-us
- Cosmetics Business, $4.7M settlement: https://cosmeticsbusiness.com/neutrogena-johnson&johnson-kenvue-settle-skin-360-privacy-claims
- Data Privacy and Security Insider on the healthcare-exemption ruling: https://www.dataprivacyandsecurityinsider.com/2025/03/johnson-johnsons-neutrogena-skin360-app-cant-escape-scrutiny-under-illinois-biometric-law/
- Lipstick Alley thread (403 to crawler; snippet only): https://www.lipstickalley.com/threads/new-neutrogena-skin360-app-and-skin-scanner-59-99-do-you-think-this-really-works.1904764/

Haut.AI
- Product page (LIQA, 0-100 scores, 98% claim): https://haut.ai/product/ai-skin-analysis
- Clinical software page (ICC 0.97-0.98 claim, capture tiers): https://haut.ai/products/clinical-software
- Body analysis / Fitzpatrick validation claims: https://haut.ai/products/body-analysis
- Microsoft feature on Haut.AI: https://blogs.microsoft.com/bayarea/2026/02/19/beyond-skin-deep-beauty-startup-uses-ai-to-help-people-improve-their-skincare/

Perfect Corp / YouCam
- Dermelloa honest review: https://www.dermelloa.com/app-scanner-comparison/youcam-perfect-corp
- Dermelloa comparison index (15 tools): https://www.dermelloa.com/app-scanner-comparison
- GitHub "same-light" (measured YouCam score drift and calibration bands): https://github.com/bisale24-ops/same-light
- Personal Care Insights on the Wake Forest test-retest study: https://www.personalcareinsights.com/news/perfect-corp-study-finds-ai-powered-skincare-imaging-at-par-with-conventional-analysis-methods.html
- Perfect Corp B2B skin diagnostic page: https://www.perfectcorp.com/business/products/ai-skin-diagnostic
- Perfect Corp "Rate My Face": https://www.perfectcorp.com/consumer/blog/ai-skincare/rate-my-face-test
- YouCam Makeup App Store listing (privacy label): https://apps.apple.com/us/app/youcam-makeup-face-editor/id863844475

Olay Skin Advisor
- Mumsnet thread: https://www.mumsnet.com/talk/style_and_beauty/4567909-olay-skin-advisor-how-old-does-it-say-you-look-and-how-old-are-you
- mamabella 10-run test: https://www.newwebsite.mamabella.uk/olay-skin-advisor-uk-tool-website/
- Dermelloa review: https://www.dermelloa.com/app-scanner-comparison/olay-skin-advisor
- NVIDIA developer blog on training data: https://developer.nvidia.com/blog/?p=28433
- Dermatology Times, "Do facial appearance apps work?" (Draelos lighting study): https://www.dermatologytimes.com/view/do-facial-appearance-apps-work

L'Oréal Skin Genius / ModiFace
- Skin Genius India page (flow, 1-10 bands, sample report): https://www.lorealparis.co.in/skin-genius
- L'Oréal + ModiFace diagnostic announcement: https://www.loreal.com/en/news/research-innovation/loreal-and-modiface-an-artificial-intelligencepowered-skin-diagnostic/
- Woman&Home on training data and "95%": https://www.womanandhome.com/beauty/digital-dermatology-loreal-paris-skin-genius-378115/
- Top Class Actions, Kukovec v. L'Oréal BIPA: https://topclassactions.com/es/lawsuit-settlements/privacy/bipa/loreal-class-action-says-makeup-companys-virtual-try-on-tool-violates-privacy/
- Northwestern JTIP on Sephora/ModiFace BIPA: https://jtip.law.northwestern.edu/2023/11/06/sephoras-biometric-scandal-an-analysis-of-data-privacy-crisis-management-in-the-beauty-industry/

TroveSkin
- The Edge Singapore profile: https://alfi.dev.theedgesingapore.com/news/startups-entrepreneurs-digital-economy/skincare-app-company-leverages-treasure-trove-data
- 3,000-review sentiment study (UPN Veteran Jakarta): https://oalib-perpustakaan.upi.edu/Record/repoupnvj_28866/Details
- MakeUseOf roundup: https://www.makeuseof.com/best-skincare-apps-android/

Skinive
- Product Hunt reviews (phototype 1-5 admission, dataset critique): https://www.producthunt.com/products/skinive-ai-skin-health-scanner/reviews
- Google Play listing: https://play.google.com/store/apps/details?id=com.skinive.App
- Skinive 2026 accuracy report: https://skinive.com/skinive-accuracy2026/
- Skinive FAQ: https://skinive.org/support/faq/
- Innovation Origins / IO+ expert critique: https://ioplus.nl/archive/en/smartphone-app-skinive-helps-prevent-skin-cancer-yet-experts-are-critical

Cureskin
- App Store India reviews: https://apps.apple.com/in/app/cure-skin-hair-experts/id1447467785?see-all=reviews
- Google Play listing: https://play.google.com/store/apps/details?id=com.heallo.skinexpert&hl=en_IN
- NetZero India review (503 at fetch; snippet only): https://netzeroindia.org/cureskin-app-review-2025/
- Worthepenny aggregate: https://cureskin.worthepenny.com/

Dermalogica Face Mapping
- Official page and FAQ: https://www.dermalogica.com/face-mapping
- Glossy on the online AI launch: https://www.glossy.co/beauty/dermalogica-debuts-online-ai-feature-to-capture-new-customers
- Beauty Bay explainer (1-100 scale): https://edited.beautybay.com/?p=71790

Revieve
- Skincare Advisor platform page: https://www.revieve.com/platform/skincareadvisor
- Oriflame deployment: https://www.personalcareinsights.com/news/oriflame-and-revieve-ramp-up-personalized-beauty-with-ai-skincare-advisor.html
- Skin First case study: https://www.revieve.com/resources/skin-first-r-boosts-consumer-engagement-and-business-growth-with-an-online-skincare-advisor-experience
- Revieve interview on data and training: https://www.personalcareinsights.com/news/revieve-shares-its-ingredients-for-a-successful-ai-beauty-advisor-tool.html

Proven, Curology, Function of Beauty, Lumin, Typology
- The Dermatology Review on Proven: https://thedermreview.com/proven-skincare-review/
- Proven x Sephora (3-minute quiz): https://www.businesswire.com/news/home/20230815746375/en/
- Curology selfie guide: https://curology.com/blog/how-to-take-your-curology-selfies-like-a-pro
- Curology before/after guide: https://curology.com/guides/lifestyle/before-and-after/
- Curology Trustpilot (UK): https://uk.trustpilot.com/review/curology.com
- Thingtesting Function of Beauty reviews: https://thingtesting.com/brands/function-of-beauty/reviews
- Illuminate Labs Function of Beauty analysis: https://illuminatelabs.org/blogs/health/function-of-beauty-review
- Kimola Trustpilot analysis of Lumin: https://kimola.com/reports/lumin-skincare-feedback-analysis-insights-trends-trustpilot-en-us-146184
- Beauty Independent on Lumin trial conversion: https://www.beautyindependent.com/lumin-wants-personal-grooming-important-working-out-men/
- Typology diagnostic how-it-works: https://uk.typology.com/support/how-it-works---diagnostic
- Typology "why did my results change": https://global.typology.com/support/why-did-my-diagnostic-results-change

2025-26 entrants and adjacent
- L'Oréal Cell BioPrint announcement: https://www.loreal-finance.com/eng/news-event/loreal-groupe-unveils-loreal-cell-bioprint-revolution-consumer-skin-intelligence-rooted
- Skin Intelligence accuracy/lighting page: https://skinintelligence.ai/accuracy
- ScanSkinAI 2026 comparison: https://www.scanskinai.com/blog/best-free-ai-skin-checker-apps-2026
- Fortune (via texxr) on looksmaxxing apps and teen mental health: https://texxr.com/868607/looksmaxxing-apps-worsen-teen-mental-health
- Bark review of PSL face-rating app: https://www.bark.us/app-reviews/apps/psl-app-review/
- Philips Lumea Skin-Selfie Analyser inconsistent results: https://www.philips.co.uk/c-f/XC000021434/why-does-the-philips-lumea-skin-selfie-analyser-show-inconsistent-results
- Ulta Skin Analysis hands-on (Yahoo): https://sports.yahoo.com/ulta-beautys-app-skin-care-163809512.html
- Cosmetics Business, best AI skin analysis tools 2026: https://cosmeticsbusiness.com/best-ai-skin-analysis-tools-in-2026
- DermApproved, "AI Skin-Analysis Apps: Useful or Gimmick?": https://dermapproved.com/blog/ai-skin-analysis-apps-useful-or-gimmick/
- Pabau, skin assessment tools compared: https://pabau.com/blog/skin-assessment-tools/

Bias and capture research
- Daneshjou et al., Science Advances 2022, DDI dataset: https://pubmed.ncbi.nlm.nih.gov/35960806/ (PMC: https://pmc.ncbi.nlm.nih.gov/articles/PMC9374341)
- Narrative review, AI diagnostic capability on darker skin (2025): https://pmc.ncbi.nlm.nih.gov/articles/PMC12624499/
- ChatGPT-4o across Fitzpatrick types: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12323556/
- Pipsqueak dataset, melanoma sensitivity 67% -> 11%: https://www.sciencedirect.com/science/article/pii/S1877750326000761
- Skin color bias in lesion segmentation (2024): https://www.sciencedirect.com/science/article/pii/S0169260724000403
- Beyond Fitzpatrick: ITA vs Monk agreement: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12179258/
- Survey of skin tone assessment in prospective research: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11252344/
- MIT Gender Shades: https://news.mit.edu/2018/study-finds-gender-skin-type-bias-artificial-intelligence-systems-0212
- Practical Dermatology, AI and skin of color hidden biases: https://practicaldermatology.com/topics/skin-of-color/ai-and-skin-of-color-hidden-biases-raise-questions/23994/
- Google Monk Skin Tone scale (Osgoode): https://www.yorku.ca/osgoode/iposgoode/2022/06/08/how-google-is-reducing-ai-bias-with-skin-tone-inclusive-technology/
- Sony AI, Beyond Skin Tone (hue angle): https://ai.sony/blog/Beyond-Skin-Tone-A-Multidimensional-Measure-of-Apparent-Skin-Color/
- Mobile 2D facial image capture for remote aesthetics trials (PMC12851522): https://pmc.ncbi.nlm.nih.gov/articles/PMC12851522/
- VISIA validation study (PMC9175133): https://pmc.ncbi.nlm.nih.gov/articles/PMC9175133/
- Selfie hydration/TEWL vs VISIA-CR preprint: https://arxiv.org/pdf/2509.06282
- iPad AI skin analysis under three lighting levels (preprint, not peer-reviewed; 403 to crawler, snippet only): https://www.preprints.org/manuscript/202409.0822
