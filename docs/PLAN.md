# Plan summary (full version in Notion: "Willow: Technical Lock Sheet and Build Plan"; detailed specs in the other docs listed in CLAUDE.md)

- **What:** proof engine for skincare. Calibrated phone photos -> 11 cosmetic skin parameters -> change vs the person's own noise floor (MDC95) -> Gemini explains, labels regions, reads ingredient labels, checks routine compatibility, advises with multi-store links -> multi-brand retailer insights in BigQuery/Looker.
- **Theme:** Retail & Commerce: Intelligent Customer and Business Experiences.
- **Rubric:** Technical Merit & Gen AI 40%, Problem Alignment & Impact 25%, Innovation 25%, UX 10%. Special awards: Best use of Google Cloud AI tools, Most Impactful, Social Choice, Best UI/UX.
- **Required:** Gemini; deploy on Cloud Run or Firebase; live link; public GitHub; PDF deck; demo video (length rule to confirm: FAQ says < 3 min, an email says 3-4 min); brief description covering Firebase, Firestore, Cloud Run, Gemini.
- **Stack:** Firebase Hosting + Auth, Firestore (default DB), Cloud Storage, Cloud Run (`engine`, `api`), Gemini on Vertex AI (`gemini-3.8-flash` via the global endpoint; not AI Studio free tier for user photos), BigQuery (batch loads), Looker Studio. Region `us-central1`.
- **Non-goals:** diagnosis, skin age, hydration, UV spots, model training, native app, Vertex AI Search.
- **Demo:** DHA self-tanner split forearm + tan line + 5-frame repeatability + full-face report across skin tones.
- **Cost:** expected ₹0 out of pocket on the Google Cloud free-trial credit (₹28,796, valid to Jan 12, 2027); ₹2,000/month budget alerts on; keep the live link up until Nov 6.
