# Team split: who does what

Team: **Niwin** (product: web, api, Gemini, cloud, data, deck) and **Harshini** (engine: capture + image pipeline + science). Deadline **Sun Oct 18, 2026** (target: submit Sat Oct 17 night IST).

Rule of thumb: **Harshini owns everything that touches pixels. Niwin owns everything else.** You meet at `docs/CONTRACT.md`. Neither of you waits on the other: Niwin builds against `fixtures/analysis_result.sample.json`; Harshini tests the engine from the CLI on her own photos.

## Product decisions (updated Oct 13)
- **Primary customer for the business side: multi-brand retailers** (Nykaa, Sephora, Myntra, Olive Young, etc.); individual brands can integrate too. Retailer dashboard answers: what does this customer need next, which products in our assortment actually help customers like this, how are our brands/categories performing on measured outcomes, where are the assortment gaps.
- **Routine compatibility check** (Gemini over ingredient lists): clashes, duplicated actives, likely cancel-outs.
- **Multi-store links** on every recommended product; the user picks where to buy.
- Catalog holds facts (ingredients, concerns, price, store links). Efficacy evidence comes only from what SkinProof measures (team data + clearly labeled synthetic cohort). No scraping reviews as "efficacy".
- Global positioning, all skin tones.

## Responsibilities

| Area | Harshini (engine) | Niwin (product) |
|---|---|---|
| Code | `engine/` | `api/`, `web/`, `infra/` |
| Cloud | engine container builds | GCP project, billing, Firebase, IAM, deploys, budgets |
| Data | all captures, capture log, DHA test, repeatability sets, volunteer captures + consent | product catalog (40-60 SKUs, store links), synthetic cohort, BigQuery, seeded demo accounts |
| AI | none (pure CV) | all Gemini features |
| Submission | science/validation slide, capture section of video | deck, video edit, written description, README polish, social posts |
| Shared | contract, daily syncs, final QA, demo recording | same |

## Prerequisites

### Harshini (before starting Claude Code)
- [ ] GitHub account; accept repo invite; `git` installed
- [ ] Python 3.12 + `uv` (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- [ ] Claude Code installed and logged in
- [ ] `gcloud` CLI installed; `gcloud auth login` and `gcloud auth application-default login` (after Niwin adds you to the project)
- [ ] Lightroom Mobile installed; Pro mode + DNG tested; a DNG transferred to the laptop
- [ ] Bought: DHA self-tanner, white + grey card, skin tape; color checker ordered (fastest delivery)
- [ ] Paper cone for macro made and sharp-focus distance measured
- [ ] Consent note agreed by anyone photographed

### Niwin (before starting Claude Code)
- [ ] GCP project created, $300 trial billing attached, budget alerts $1/$5/$20
- [ ] Firebase project on the same GCP project, Blaze plan
- [ ] APIs enabled (see `infra/setup.sh`)
- [ ] Harshini added as Editor (or Cloud Run Developer + Storage Admin + Artifact Registry Writer)
- [ ] GitHub repo created from this scaffold, branch protection on `main`, Harshini invited, CODEOWNERS usernames filled in
- [ ] Node 20+, Python 3.12 + `uv`, `gcloud`, `firebase-tools`, Claude Code
- [ ] Email to organizers sent (video length, cutoff time, credits)

## Milestones
| ID | When | Done when |
|---|---|---|
| M1 | Tue Oct 13, night | Engine CLI decodes a team DNG, finds the card, prints ITA and a* for the forearm. Product: hello-world api + web deployed; Firebase Auth works; signed-URL upload of a DNG to GCS works from the iPhone browser. DHA applied. |
| M2 | Wed Oct 14, night | Engine FastAPI `/v1/analyze` returns schema-valid JSON locally with A-tier metrics (tone, redness, evenness, spots) and quality gates + MDC. Product: Firestore model, session flow end-to-end with the engine mocked, results UI from the fixture, label scan working. |
| M3 | Thu Oct 15, 14:00 | **Integration:** engine on Cloud Run; real upload -> real analysis -> Firestore -> results page. Pores + texture done. |
| M4 | Fri Oct 16, night | Gemini labels + explanation + routine check + advisor; timeline/compare UI; retailer dashboard; judge mode with seeded data; B-tier metrics. |
| M5 | Sat Oct 17, 12:00 | Feature freeze. Afternoon: video, deck, README. Night: submit. |
| -- | Sun Oct 18 | Buffer only. |

## Day-by-day tasks

### Tue Oct 13
**Harshini**
1. Shopping (DHA self-tanner, white/grey card, tape); order color checker.
2. Lightroom Pro mode: lock settings, shoot DNG, AirDrop to laptop, confirm `rawpy` opens it (engine prompt step 1).
3. Baseline: 5 frames each of forearm squares, face, cheek macro. Tan-line pair.
4. Apply DHA (evening). Captures at +1 h, +4 h.
5. Claude Code (engine prompt): env setup, decode, card detection, color correction, ITA + a* on forearm via CLI. **= M1**

**Niwin**
1. `infra/setup.sh`: project, billing, budgets, APIs, bucket (+ lifecycle), Firestore (default DB), Artifact Registry, service accounts, IAM.
2. Create GitHub repo from this scaffold, invite Harshini, protect `main`, fill CODEOWNERS.
3. Claude Code (product prompt): deploy hello `api` + `engine` placeholder to Cloud Run, Firebase Hosting with React shell, Firebase Auth (Google + anonymous), signed-URL DNG upload from iPhone Safari. **= M1**
4. Send organizer email. Start the catalog sheet.

### Wed Oct 14
**Harshini:** landmarks + ROIs; tone evenness; pigment spots; quality gates; multi-frame aggregation + MDC; FastAPI `/v1/analyze` + schema validation tests; DHA +24 h. **= M2**
**Niwin:** Firestore model + rules; `/v1/sessions` + analyze flow with mocked engine; capture-guide UI + results page from fixture; Gemini label scan; catalog 40-60 SKUs with store links. **= M2**

### Thu Oct 15
**Harshini:** pores + texture (macro); Dockerfile; deploy engine with Niwin by 12:00; 5-frame repeatability for face and macro; dark circles; blemish candidates + crops; DHA +48 h.
**Niwin:** integration at 14:00 (**M3**); Gemini candidate labelling + explanation with number validator; routine compatibility check; advisor with function calling.

### Fri Oct 16
**Harshini:** C-tier metrics if time (lines, shine, glow); volunteer captures across skin tones; fairness numbers; seed demo data (consented) into `demo/`; DHA +72 h; science slide numbers.
**Niwin:** timeline + compare slider UI; retailer dashboard (BigQuery + Looker Studio, synthetic cohort labeled); judge mode and seeded accounts; polish. **= M4**

### Sat Oct 17
Both: 12:00 feature freeze. DHA +96 h. Record demo, edit video, deck, README, description. Final QA on a fresh phone and a laptop. Submit at night.

### Sun Oct 18
Fix only. No new features.

## Cut order if behind
1. glow  2. shine  3. lines (use Gemini "visible lines" label instead)  4. blackheads  5. Looker (use a static chart)  6. label scan
**Never cut:** calibration + MDC, tone/redness/evenness/spots, pores/texture, dark circles, DHA demo, Gemini labelling + explanation + advisor, judge mode.

## If Harshini is new to Python/OpenCV
Niwin takes color correction (steps 2-4 of the pipeline) and landmarks/ROIs on Tuesday night; Harshini owns captures, the CLI, and the A-tier metric functions that operate on Lab arrays + masks (simpler, well-specified). Revisit at the Wednesday morning sync.

## Communication
- Sync 10:00 and 21:30 IST, 10 minutes: done / next / blocked / contract changes.
- Contract changes: propose in `docs/CONTRACT_CHANGES.md`, both approve, bump `schema_version` minor.
- Blockers > 30 min: message the other immediately.
