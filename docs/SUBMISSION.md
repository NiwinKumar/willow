# Submission checklist and materials (owner: Niwin, science slide: Harshini)

## Checklist (target Sat Oct 17 night IST)
- [ ] Live link works on a fresh phone and laptop (judge mode, no login needed for the demo journey)
- [ ] Public GitHub repo (history checked: no images, no secrets), README with architecture + setup + attribution
- [ ] Deck (PDF) on the prescribed template
- [ ] Demo video on YouTube/Vimeo/Drive (public/unlisted link). Length: organizer emails (Oct 12) say 3 to 4 minutes, the public FAQ says under 3; confirm in the dashboard's submission section
- [ ] Live link to submit: https://willow-511508.web.app/judge (guided tour, guest account, no sign-in)
- [ ] Brief description (below) pasted into the form
- [ ] Category: Retail & Commerce: Intelligent Customer and Business Experiences
- [ ] Services stay up until judging ends (Nov 6); budget alerts on
- [ ] Submission day: `--min-instances 1` on `willow-api` and `willow-engine` (cost in `docs/RISKS.md`), then run the judge flow once on a phone and a laptop
- [ ] After the face/macro engine deploy: `api/scripts/remeasure.py --apply` so saved face photos become baselines

## Brief description (draft, ~220 words; update numbers after validation)
> **Willow, the proof engine for skincare.** Most people never learn whether their skincare works, and retailers only see purchases, not results. Willow turns standardized phone photos into calibrated skin measurements and an honest verdict. Users capture RAW (DNG) photos with a pocket color card, or a quick selfie in "trend only" mode, in our **Firebase**-hosted web app (Firebase Hosting, Firebase Authentication, Cloud Storage). A Python engine on **Cloud Run** decodes RAW, corrects colors against the card, aligns the face with MediaPipe landmarks and computes 11 cosmetic parameters (tone, dark spots, evenness, redness, blemishes, pores, texture, lines, under-eye, shine, glow), testing each change against the person's own measured noise floor so the app says "real change" only when it is real. Sessions, baselines, routines and the product catalog live in **Firestore**. **Gemini on Vertex AI** never estimates numbers: it labels regions the engine found, explains results with every number validated against the measurements, reads ingredient labels, checks routines for clashing actives, and acts as a shopping advisor through function calling with links to multiple stores. Anonymized outcomes load into **BigQuery**; a retailer view shows multi-brand retailers which products actually produce measured change for which customers, and Gemini answers retailers' questions from those aggregates with every number checked (demo cohort labeled synthetic). Demo: a 72-hour self-tanner split-forearm test against a control arm. Cosmetic tool, not a medical diagnosis.

## Deck outline (10-12 slides)
1. Title + one line  2. Problem (stats)  3. Insight: outcomes, not purchases  4. Product walkthrough (screens)  5. How measurement works (card, RAW, MDC)  6. Proof: DHA split arm + repeatability (Harshini)  7. Gemini: five jobs, never measures  8. Retailer value (dashboard)  9. Architecture (Firebase, Firestore, Cloud Run x2, Vertex AI Gemini, BigQuery)  10. Inclusivity + privacy + fairness numbers  11. Business model + roadmap  12. Team + links

## Video script (about 3:00 until the length rule is confirmed)
0:00 hook "Did your serum actually work?" | 0:15 capture (RAW, card, cone) | 0:40 proof (split arm, noise band, numbers) | 1:25 Gemini (explanation, label scan, routine clash, advisor with store links) | 1:55 retailer dashboard | 2:20 architecture | 2:40 close.

## Social Choice plan
"#DoesItWork 24-hour split-arm challenge": 30-second vertical reel (forearm only), shareable result card from the app, posts on Day 0 / +4 h / +24 h on Instagram and LinkedIn, ask friends to try quick-selfie mode. Mechanism of the award is unconfirmed; low effort only.

## Attribution (README)
MediaPipe (Apache-2.0), OpenCV, rawpy/LibRaw, scikit-image, colour-science, colour-checker-detection, FastAPI, React, Vite, Tailwind, Firebase SDKs, google-genai. Any dataset used for testing: name + license; never redistributed.
