# infra (owner: Niwin)

- `setup.sh`: one-time project, billing, budget, APIs, bucket, Firestore, BigQuery, service accounts, IAM, Firebase.
- Deploy commands (fill in once services exist):

```bash
# engine (from repo root; image needs schemas/ and fixtures/); tag with the commit
gcloud builds submit --config infra/cloudbuild.engine.yaml --substitutions=_TAG=$(git rev-parse --short HEAD) .
gcloud run deploy willow-engine --image us-central1-docker.pkg.dev/$PROJECT_ID/willow/engine:<tag> --region us-central1 \
  --service-account sa-engine@$PROJECT_ID.iam.gserviceaccount.com \
  --no-allow-unauthenticated --cpu 2 --memory 4Gi --concurrency 1 \
  --min-instances 0 --max-instances 8 --timeout 300 --cpu-boost
# max 8: a check-in sends its places at once (cheek + face = 2 requests), so 3 instances made a
# second person wait or fail. 8 x 2 vCPU + the api's 3 x 1 vCPU fits the region's 20 vCPU / 40 GiB
# Cloud Run quota (4 vCPU x 20 was refused). Idle instances above the minimum cost nothing.

# api (env vars go in a file: ALLOWED_ORIGINS has commas and the service account has an @)
gcloud run deploy willow-api --source api --region us-central1 \
  --service-account sa-api@$PROJECT_ID.iam.gserviceaccount.com \
  --allow-unauthenticated --cpu 1 --memory 1Gi --min-instances 0 --max-instances 3 --timeout 300 \
  --env-vars-file infra/api-env.yaml
# once the reminders block of setup.sh has run, add (secrets mounted as env vars, not in the yaml):
#   --update-secrets=VAPID_PRIVATE_KEY=willow-vapid-private:latest,VAPID_PUBLIC_KEY=willow-vapid-public:latest

# Proof's daily prebuild (Nov 28): just after midnight UTC every cached Proof number is for a new day; this
# rebuilds them before anyone visits (POST /v1/retailer/internal/warm, the reminder job's OIDC check: same
# service account and audience). Free tier.
gcloud scheduler jobs create http willow-proof-warm --location us-central1 --schedule "2 0 * * *" --time-zone Etc/UTC \
  --http-method POST --uri https://willow-api-hrlt7lqdwa-uc.a.run.app/v1/retailer/internal/warm \
  --oidc-service-account-email sa-scheduler@$PROJECT_ID.iam.gserviceaccount.com \
  --oidc-token-audience https://willow-api-hrlt7lqdwa-uc.a.run.app/v1/internal/reminders --attempt-deadline 300s

# web (VITE_API_URL is the api's Cloud Run URL). The Firebase web config (VITE_FIREBASE_*) is not in the repo:
# put web/.env.local (from the team) in place first, or the build ships without it and sign-in fails
# (auth/invalid-api-key, the app stuck on "Opening Willow"). App routes are served no-cache (firebase.json),
# so a new deploy reaches everyone on their next load; hashed /assets are cached for a year.
cd web && VITE_API_URL=https://willow-api-hrlt7lqdwa-uc.a.run.app npm run build && cd .. && firebase deploy --only hosting
```

Deployed Oct 13 (M1):

| Service | URL | Notes |
|---|---|---|
| willow-api | https://willow-api-hrlt7lqdwa-uc.a.run.app | public; health at `/v1/health`; every other route needs a Firebase ID token |
| willow-engine | https://willow-engine-hrlt7lqdwa-uc.a.run.app | private; `sa-api` has `roles/run.invoker` (granted Oct 13); real pipeline since Oct 13 (`engine:26f53f7`): forearm sites measured, face and macro sites return the fixture marked `-placeholder`; health at `/v1/health` |
| web | https://meetwillow.web.app (and https://willow-511508.web.app, same build) | Firebase Hosting, two sites in `firebase.json`; `firebase deploy --only hosting` updates both. A new site's address must also be added to Firebase Auth > Authorized domains and to `ALLOWED_ORIGINS` |
| willow-reminders | Cloud Scheduler, us-central1, every 15 min | `POST /v1/internal/reminders` with an OIDC token for `sa-scheduler` (audience = that URL); setup in `setup.sh` "Check-in reminders" |

Gotcha: `GET /healthz` on any `*.run.app` host is answered by Google's frontend with a 404 before it reaches the container (seen on both services). Use another path for health checks; the api uses `/v1/health`.

Local signed URLs: the api impersonates `sa-api` to sign. Project Owner does not include that permission, so grant your user once:
`gcloud iam service-accounts add-iam-policy-binding sa-api@$PROJECT_ID.iam.gserviceaccount.com --member=user:<you> --role=roles/iam.serviceAccountTokenCreator`

Judging (Oct 19 - Nov 7) and the Grand Finale (Singapore, Dec 4): kept warm since Oct 19 with `--min-instances 2` on `willow-engine` (both places of one check-in start warm) and `--min-instances 1` on `willow-api`. Idle cost about $3.05/day (about ₹255/day). Nov 2: kept warm through the finale (about ₹8,200 more from Nov 2 to Dec 4, within the ₹10,000 the team set for it). If the team is not shortlisted, set both back to `--min-instances 0` that day (`gcloud run services update <service> --region us-central1 --min-instances 0`); otherwise do it on Dec 5.

Finale day (Dec 3-4), a little more headroom: `gcloud run services update willow-api --region us-central1 --min-instances 2` and `gcloud run services update willow-engine --region us-central1 --min-instances 3`; back to 1 and 2 after. Load test Nov 2: 20 people at once on every public judge page, no errors, every page under 2 s from India (about 0.35 s of it network), so the current maxima (api 3, engine 8) and the 20 vCPU quota are enough for browsing. That test did not measure check-ins; see "Scale" below for 200 at once.

## Finale caps (environment variables, no code change)

The daily caps in `api/app/limits.py` (`CAPS`) can be set per deploy. Cap counts reset at UTC midnight
(08:00 in Singapore), so a morning rehearsal and the afternoon session share one day's count.

| Variable | Sets | Default | Finale suggestion |
|---|---|---|---|
| `DEMO_WISP_DAILY_CAP` | Questions to Wisp on Mei's demo journey, one count shared by everyone on it | 300 | the team's call (e.g. `2000`) |
| `DAILY_CAP_<ACTION>` | One action's per-person cap, or `per/everyone`: e.g. `DAILY_CAP_ADVISOR=40`, `DAILY_CAP_SAMPLE_RUNS=30/1000` | `CAPS` | as needed |

`<ACTION>` is the `CAPS` key in capitals (`ADVISOR`, `ANALYZE`, `SAMPLE_RUNS`, `LABEL_SCAN`, `RETAILER_ASK`…).
A value without `/everyone` lifts everyone's cap to at least the new per-person cap. A value that is not a
positive whole number is ignored (logged as "ignoring cap override") and the default stands. Every raised
Gemini cap allows more paid calls; check the budget alert before raising it far.
To set one, add it to `infra/api-env.yaml` (or `--update-env-vars DEMO_WISP_DAILY_CAP=2000` on
`gcloud run services update willow-api --region us-central1`); this makes a new revision. Remove it on Dec 5.

## Scale: 200 check-ins at once (Nov 28)

Real settings (`gcloud run services describe`, Nov 28): **willow-engine** 2 vCPU / 4 GiB, `--concurrency 1`,
min 2, max 8, timeout 300 s; **willow-api** 1 vCPU / 2 GiB, `--concurrency 80`, min 1, max 3, timeout 300 s.
A face check-in holds one engine instance for 40.8 s (median of production runs, `api/scripts/cost_report.py`),
so 8 instances measure 8 at a time, about 700 an hour.

Before the line, check-in number 9 of a burst still went to the engine: Cloud Run held it a few seconds, answered
429, and the person read "The measurement took too long". The api had a second ceiling of its own: its sync routes
share anyio's 40 worker threads, so 40 check-ins waiting on the engine also held up every poll and page read on that
instance.

**The line** (`api/app/engine_gate.py`, off until the variables are set; nothing changes on deploy without them):
each api instance lets `ENGINE_SLOTS` analyses call the engine at once; the rest wait, oldest first, and their
session shows stage `queued` with `queue: {position, eta_s}`. One request waits at most `ENGINE_QUEUE_WAIT_S`
(the web gives analyze 150 s; the engine and Gemini need about 90 s of it). Past that the session is put back as
it was and the api answers 409 `conflict` with `queued: true`; the deployed web already re-reads and asks again on
that answer, and the session's `queue_since` keeps its place. An engine 429/503 (every instance taken) is asked
again every 3 s within the same wait. Nothing is marked failed and no daily analysis is spent while in line.

| Variable | Sets | Default | Finale suggestion |
|---|---|---|---|
| `ENGINE_SLOTS` | analyses one api instance sends the engine at once; 0 = no line | 0 | `3` (3 api instances x 3 = 9 for 8 engine instances; the 9th is retried on 429) |
| `ENGINE_QUEUE_WAIT_S` | longest wait inside one analyze request | 45 | 45 |
| `ENGINE_EXPECTED_S` | first estimate of one analysis, for "about N s" (then this instance's own runs) | 45 | 45 |
| `API_THREADS` | worker threads for the api's sync routes (anyio's default 40) | 40 | `100` (above `--concurrency 80`) |

Limits, said plainly: the line lives in each api instance's memory and inside the person's request, so the order is
oldest-first per instance (roughly fair across 3 instances), and someone who closes the app while in line leaves the
check-in unmeasured (photos kept, status back to `uploading`). A durable queue (Cloud Tasks in front of the engine,
dispatch rate = engine instances) removes both; it needs a new queue, an internal route and IAM, so it is not built.
The check-in screen does not yet word the `queued` stage ("In line, about N s"); it shows its generic engine line.

Load test (`api/scripts/loadtest/`; photos: the bucket's `demo/samples/mei_face_week1` and `mei_cheek_week1`, copied
locally, never committed). One laptop, shared with other work: the face pair ran with 2 engine workers (a run with 4
beside other heavy jobs overloaded the machine, and 3 beside another benchmark kept the load average above 30). The
queue model is checked on those 2 local workers; the production rows apply it with production's own engine time, not
the laptop's.

```bash
cd api
uv run python scripts/loadtest/engine_pool.py --workers 2 --port 8126 --frames <dir with mei_face_week1/ and mei_cheek_week1/> --log /tmp/pool.jsonl &
ENGINE_SLOTS=2 API_THREADS=256 uv run python scripts/loadtest/run_api.py --people 200 --port 8116 &   # --site cheek_macro --frames 3 for close-ups
uv run python scripts/loadtest/drive.py --people 200 --pool-log /tmp/pool.jsonl --label "line on" --out scripts/loadtest/results/<day>-face-line.json
uv run python scripts/loadtest/report.py   # the tables below, and the Evidence page's "Scale" section
```

What it shows: as deployed, 186 of 200 people saw an error and every page read on the api waited about 30 s for a
thread; with the line, all 200 were measured, nobody saw an error, polls stayed under 1 s (p95), and the last person
was done when the queue model said (940 s predicted, 939 s measured). The wait itself is long: it is the engine's
throughput, which only more instances shorten (the projection below).

Measured locally on 2026-11-28: one laptop (Apple M5, 10 cores, shared with other work): the real api and 2 real engine processes, one analysis each at a time, standing in for Cloud Run instances; 200 people press Measure at once, the demo sample's five face photos (Mei, generated).

| Run | Succeeded | Errors | End to end p50 / p95 / p99 | Poll p95 | Engine s/analysis |
|---|---|---|---|---|---|
| no line (as deployed) | 14/200 | 186 504:engine_timeout | 50.5 / 68.4 / 68.4 s | 30.3 s | 9.4 |
| line on (ENGINE_SLOTS=2, API_THREADS=256) | 200/200 | none | 516.4 / 899.2 / 931.8 s | 0.9 s | 9.4 |
| no line (as deployed), the three cheek close-ups | 44/200 | 156 504:engine_timeout | 46.3 / 54.1 / 56.7 s | 30.1 s | 2.5 |

Model check: 2 local instances at 9.4 s each predict the last of 200 done at 940 s; measured 939.4 s.

Projection for production (not measured): 40.8 s per face check-in on the engine (median of 23 production runs), the same line, Gemini and cold starts left out. Engine cost per check-in $0.0024 at list price (whole check-in with Gemini $0.0253); it is the same at any instance count.

| Engine max instances | vCPU (with api) | 200 people: half done | 95% done | all done | Check-ins per hour | Engine cost of the burst |
|---|---|---|---|---|---|---|
| 8 (now) | 19 | 8.8 min | 16.3 min | 17.0 min | 706 | $0.47 |
| 25 | 53 (quota increase) | 2.7 min | 5.4 min | 5.4 min | 2206 | $0.47 |
| 50 | 103 (quota increase) | 82 s | 2.7 min | 2.7 min | 4412 | $0.47 |
| 100 | 203 (quota increase) | 41 s | 82 s | 82 s | 8824 | $0.47 |

Cost per use, medians of 30 days of production logs at list prices read on 2026-11-28 (idle minimum instances, storage, Firestore and BigQuery not included):

| Unit | US$ | Measured from |
|---|---|---|
| Face check-in | 0.0253 | 23 engine runs, median 40.8 s; explanation: 4 calls; candidate_labels x2: 13 calls |
| Wisp answer | 0.0047 | advisor_reply: 23 calls |
| Routine check | 0.0012 | routine_check: 9 calls |
| Reading story | 0.0013 | metric_story: 6 calls |
| Proof Ask answer | 0.1446 | retailer_ask: 106 calls |
