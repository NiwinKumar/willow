# Product brief: Willow

> Working name **Willow** (willow bark is the natural source of salicylic acid: a quiet link between nature and skin science). Final name check before Thursday.

## One line
**Willow is the proof engine for skincare:** calibrated phone photos show whether a product *measurably* changed your skin, and multi-brand retailers use those outcomes to personalize recommendations and understand their assortment.

## Hackathon fit
- Event: Google Cloud AI Builder Cup 2026 (Hack2skill). Deadline Oct 18, 2026.
- Theme: **Retail & Commerce: Intelligent Customer and Business Experiences**. Problem statement: "Build an AI-powered solution that transforms how businesses understand, engage, and serve customers while improving operational efficiency across physical and digital commerce" (discovery, personalization, conversational shopping, demand planning, inventory, customer insights, fraud).
- Rubric: Technical Merit & Gen AI 40% | Problem Alignment & Impact 25% | Innovation & Creativity 25% | UX & Solution Design 10%.
- Special awards (USD 2,000 each, no published criteria): Best use of Google Cloud AI tools, Most Impactful Solution, Social Choice, Best UI/UX.
- Required: Gemini/Gemma; deployed on Cloud Run or Firebase; working public link (end-to-end); public GitHub repo; PDF deck; demo video; brief description explaining use of Firebase, Firestore, Cloud Run and Gemini.
- Fresh-work rule: only code written during the hackathon; open-source libraries, pretrained models and public datasets are fine with attribution.

## The problem
- People buy skincare on claims and influencer advice and can't tell if it worked. Drive Research (1,004 women worldwide): 90% frustrated finding products that work; only 15% think their wrinkle products work very well; 62% worry about ineffective results.
- Waste: UK homes hold >GBP 1 billion of unused skincare (The Body Shop, n=2,000); Hong Kong: ~50% stockpiled unused skincare for >1 year (Consumer Council); US: 33% regret overspending on beauty, 52% of Gen Z (LendingTree).
- Willingness to pay for proof: 85% would pay more for beauty products with proven efficacy (Euromonitor, Top Global Consumer Trends 2024).
- Retailers see purchases, not outcomes. Routines mix brands, so no single brand sees the whole picture. A multi-brand retailer can.
- Market: global skincare estimates range USD 122-179B (2025) depending on scope (Fortune Business Insights; Precedence Research), Asia-Pacific ~51%. Quote the range.

## Users
1. **Shopper** (primary app user): wants to know if a routine works, which product to keep, what to try next, and whether products clash.
2. **Multi-brand retailer** (business customer: Nykaa, Sephora, Myntra, Olive Young, Amazon Beauty, etc.): wants outcome-based personalization, assortment performance, gaps, and fewer returns/higher repeat purchase.
3. **Brand** (secondary integration): consented, aggregate real-world efficacy evidence for its own products.

## Core loop
Capture (standardized) -> Measure (CV, calibrated) -> Compare to your own noise floor (MDC) -> Explain (Gemini) -> Act (keep/stop/swap, compatible routine, multi-store links) -> Learn (aggregate outcomes re-rank recommendations; retailer insights).

## MVP features (priority order)
1. Guided capture: calibrated RAW mode (DNG + color card) and uncalibrated selfie mode ("trend only").
2. Engine analysis: 11 parameters in 7 groups (see `METRICS.md`), quality gates, MDC-based "real change" verdicts.
3. Report: grouped metrics, confidence chips, verdict badges, overlays, Gemini explanation, disclaimer.
4. Timeline/compare: metric series with noise band, before/after slider, treated vs control.
5. Routine: Gemini label scan of product photos, routine list, Gemini compatibility check (clashes, duplicates, gaps).
6. Advisor chat: Gemini with function calling over the catalog + the user's metrics; every product with multi-store links.
7. Retailer dashboard: BigQuery + in-app view with a Gemini "ask this data" assistant (synthetic cohort clearly labeled). Looker Studio dropped Oct 13 (cut list item 5): one link for judges, and the in-app view answers questions.
8. Judge mode: seeded real journey, sample photos, try-your-own selfie.

## Non-goals (say no if asked)
Diagnosis or disease names; skin age; hydration measurement; UV spots/porphyrins; model training; native mobile app; Vertex AI Search; scraping reviews as efficacy; ranking people by lightness.

## Positioning and ethics
- Global, all skin tones (Monk 1-10 / Fitzpatrick I-VI). Every metric relative to the person's own baseline.
- Skin tone is descriptive only. No "brightening = improvement" defaults. No "bad skin" language.
- Honest uncertainty: show "within noise" when that's the truth. This honesty is the differentiator.
- Cosmetic appearance tracking, not a medical device.

## Business model (for the deck)
- Retailers: SaaS for outcome insights + recommendation API; white-label "proof" widget inside their app.
- Affiliate/commission on multi-store links (user still chooses the store; ranking never sold).
- Brands: aggregate efficacy evidence reports (consented, anonymized).

## Why we win (rubric mapping)
- **Tech & Gen AI (40%):** real calibrated imaging pipeline + Gemini doing six distinct jobs (region labelling, grounded explanations with number validation, label OCR, routine compatibility reasoning, function-calling advisor, retailer questions over aggregates with validated charts). Cloud Run x2, Firestore, Firebase Hosting/Auth, Vertex AI, BigQuery.
- **Impact (25%):** ends guesswork for shoppers; gives retailers outcome data nobody else has.
- **Innovation (25%):** personal noise-floor change detection on consumer phones; "CV measures, Gemini explains" so numbers are never invented.
- **UX (10%):** guided capture with live quality checks, calm inclusive copy, signal-vs-noise visuals.
- **Social Choice:** "#DoesItWork 24-hour split-arm challenge" reel, forearm only (privacy-safe), shareable result card.

## Competitor lessons
Neutrogena dropped its USD 50 scanner hardware for selfies (friction kills adoption) -> our attachment is a paper cone. Selfie apps' scores jump with lighting -> our quality gates + MDC. Brand-locked upsell feels like a scam -> brand-neutral catalog, multi-store links. LLM "skin scanners" invent numbers -> Gemini never measures. Bias on darker skin -> tone-relative thresholds + fairness report.
