# Decision log (latest wins)

| Date | Decision | Supersedes |
|---|---|---|
| Oct 13 | api stores `AnalysisResult` as a JSON string (`result_json`) on the session doc: Firestore cannot hold arrays of arrays (ROI polygons). Auto baseline = first calibrated session with quality passed and 5 usable frames; uncalibrated sessions get a baseline only when picked by hand (`POST /v1/baselines/{site}`). Until Thursday the api runs the fixture engine, which labels its output as a sample | CONTRACT section 4 `result (AnalysisResult)` as a map |
| Oct 13 | Design direction **"Lens"** (`docs/DESIGN.md` v2): the aligned photo is the canvas, metrics are layers on it, one scrubber replaces the Timeline and Compare screens, hold-to-flicker replaces the slider, the landing is a live Lens on seeded data; web-native (URL state, installable, offline demo, command palette). Visual base kept from v1: warm low-chroma paper, ink, sage, one signal accent, neutral grey stage, Atkinson Hyperlegible (no serif in the app shell), no dark mode | "Field notebook" v1 structure (kept as the degraded fallback), UX_SPEC screens 6-7 as separate screens |
| Oct 13 | Judges run "Try with sample photos" on hosted frames in `demo/` (server-side sample sessions), never a download-and-upload path | DEMO_PLAN "download a sample pack" |
| Oct 13 | Gemini model `gemini-3.8-flash` (latest GA Flash) via the Vertex AI **global** endpoint; all other resources stay in `us-central1` | "Gemini in us-central1" (3.x GA models are global-only; 2.5 Flash retires Oct 20) |
| Oct 13 | Web talks only to the api (Firebase SDK used for Auth only); Firestore client rules are deny-all, the api uses the Admin SDK | Browser reads of demo data via Firestore rules |
| Oct 13 | Budget ₹2,000/month, alerts 5/25/100% excluding credits; CODEOWNERS removed (ruleset: PR required, 0 approvals) | "$20 budget, $1/$5/$20 alerts", CODEOWNERS review |
| Oct 13 | Name: **Willow** (working; final check by Thu) | "SkinProof", earlier name lists |
| Oct 13 | Team of 2: Harshini = engine (pixels), Niwin = product (everything else) | 4-role plan in the original lock sheet |
| Oct 13 | Business customer = **multi-brand retailers**; brands as secondary integration | Brand-store integration |
| Oct 13 | Add routine compatibility check (Gemini) and multi-store links | -- |
| Oct 13 | Catalog = facts only; efficacy = our measurements (+ labeled synthetic cohort); no review scraping | "collect effectiveness data from real-world sources" |
| Oct 13 | Capture app: **Lightroom Mobile** (free) DNG; Halide optional | "Halide preferred" |
| Oct 13 | 11 parameters with A/B/C tiers; cut C first | -- |
| Oct 12 | Global positioning, all skin tones | India-first framing |
| Oct 12 | Classical CV computes all numbers; Gemini never measures; no training | YOLO acne model |
| Oct 12 | Region `us-central1`; Gemini via Vertex AI (not AI Studio free tier for user photos) | asia-south1 |
| Oct 12 | No Vertex AI Search, no native app, no MedGemma/Derm Foundation in MVP | earlier options |
| Oct 12 | Hero demo: DHA self-tanner split forearm + tan line + 5-frame repeatability | blush/irritation tests |
| Open | Organizer answers (video length, cutoff time, credits): later | -- |
