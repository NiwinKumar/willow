# Submission checklist and materials (owner: Niwin, science slide: Harshini)

## Checklist (target Sat Oct 17 night IST)
- [ ] Live link works on a fresh phone and laptop (judge mode, no login needed for the demo journey)
- [ ] Public GitHub repo (history checked: no images, no secrets), README with architecture + setup + attribution
- [ ] Deck (PDF) on the prescribed template
- [ ] Demo video on YouTube/Vimeo/Drive (public/unlisted link). Length: the dashboard's rules say "3 to 4 minute" and penalise going over, while the same form's field says "up to 3 minutes": make it exactly 3:00
- [ ] Deck on the template from the submission page ("Template: Download"), exported to PDF, 5 MB max
- [ ] Deadline: Oct 18, 11:59 PM IST. Submissions also get an "AI evaluation score", so the description and README must be explicit
- [ ] Live link to submit: https://willow-511508.web.app/judge (guided tour, guest account, no sign-in)
- [ ] Brief description (below) pasted into the form
- [ ] Category: Retail & Commerce: Intelligent Customer and Business Experiences
- [ ] Services stay up until judging ends (Nov 6); budget alerts on
- [ ] Submission day: `--min-instances 1` on `willow-api` and `willow-engine` (cost in `docs/RISKS.md`), then run the judge flow once on a phone and a laptop
- [ ] After the face/macro engine deploy: `api/scripts/remeasure.py --apply` so saved face photos become baselines

## Brief description (form limit 1024 characters; must name Firebase, Firestore, Cloud Run and Gemini; this one is 960)
> Willow is a proof engine for skincare. It tells people whether a product really changed their skin, and tells retailers which products produce measured results, not just sales. People take standardized phone photos (RAW with a white reference, or a quick selfie) in our web app on Firebase Hosting with Firebase Auth. A Python computer-vision engine on Cloud Run corrects colour and measures tone and redness against each person's own photo-to-photo noise, so a change is called real only when it is. Sessions, baselines and routines live in Firestore; photos in Cloud Storage. Gemini on Vertex AI never produces a measurement: it explains results, reads ingredient labels, checks routines for clashing actives, advises with function calling over a facts-only catalog, and answers retailers' questions from BigQuery aggregates. Every number Gemini writes is checked against the data. The retail cohort is synthetic and labelled. Cosmetic use only, not medical.

## Deck outline (10-12 slides)
1. Title + one line  2. Problem (stats)  3. Insight: outcomes, not purchases  4. Product walkthrough (screens)  5. How measurement works (card, RAW, MDC)  6. Proof: DHA split arm + repeatability (Harshini)  7. Gemini: five jobs, never measures  8. Retailer value (dashboard)  9. Architecture (Firebase, Firestore, Cloud Run x2, Vertex AI Gemini, BigQuery)  10. Inclusivity + privacy + fairness numbers  11. Business model + roadmap  12. Team + links

## Video script (about 3:00 until the length rule is confirmed)
0:00 hook "Did your serum actually work?" | 0:15 capture (RAW, card, cone) | 0:40 proof (split arm, noise band, numbers) | 1:25 Gemini (explanation, label scan, routine clash, advisor with store links) | 1:55 retailer dashboard | 2:20 architecture | 2:40 close.

## Social Choice plan
"#DoesItWork 24-hour split-arm challenge": 30-second vertical reel (forearm only), shareable result card from the app, posts on Day 0 / +4 h / +24 h on Instagram and LinkedIn, ask friends to try quick-selfie mode. Mechanism of the award is unconfirmed; low effort only.

## Attribution (README)
MediaPipe (Apache-2.0), OpenCV, rawpy/LibRaw, scikit-image, colour-science, colour-checker-detection, FastAPI, React, Vite, Tailwind, Firebase SDKs, google-genai. Any dataset used for testing: name + license; never redistributed.
