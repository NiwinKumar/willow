# infra (owner: Niwin)

- `setup.sh`: one-time project, billing, budget, APIs, bucket, Firestore, BigQuery, service accounts, IAM, Firebase.
- Deploy commands (fill in once services exist):

```bash
# engine (from repo root; image needs schemas/ and fixtures/)
gcloud builds submit --config infra/cloudbuild.engine.yaml .
gcloud run deploy willow-engine --image us-central1-docker.pkg.dev/$PROJECT_ID/willow/engine:latest --region us-central1 \
  --service-account sa-engine@$PROJECT_ID.iam.gserviceaccount.com \
  --no-allow-unauthenticated --cpu 2 --memory 4Gi --concurrency 1 \
  --min-instances 0 --max-instances 3 --timeout 120

# api (env vars go in a file: ALLOWED_ORIGINS has commas and the service account has an @)
gcloud run deploy willow-api --source api --region us-central1 \
  --service-account sa-api@$PROJECT_ID.iam.gserviceaccount.com \
  --allow-unauthenticated --cpu 1 --memory 1Gi --min-instances 0 --max-instances 3 --timeout 300 \
  --env-vars-file infra/api-env.yaml

# web (VITE_API_URL is the api's Cloud Run URL)
cd web && VITE_API_URL=https://willow-api-hrlt7lqdwa-uc.a.run.app npm run build && cd .. && firebase deploy --only hosting
```

Deployed Oct 13 (M1):

| Service | URL | Notes |
|---|---|---|
| willow-api | https://willow-api-hrlt7lqdwa-uc.a.run.app | public; health at `/v1/health`; every other route needs a Firebase ID token |
| willow-engine | https://willow-engine-hrlt7lqdwa-uc.a.run.app | private; `sa-api` has `roles/run.invoker` (granted Oct 13); placeholder image returns the fixture |
| web | https://willow-511508.web.app | Firebase Hosting |

Gotcha: `GET /healthz` on any `*.run.app` host is answered by Google's frontend with a 404 before it reaches the container (seen on both services). Use another path for health checks; the api uses `/v1/health`.

Local signed URLs: the api impersonates `sa-api` to sign. Project Owner does not include that permission, so grant your user once:
`gcloud iam service-accounts add-iam-policy-binding sa-api@$PROJECT_ID.iam.gserviceaccount.com --member=user:<you> --role=roles/iam.serviceAccountTokenCreator`

During judging (Oct 19 - Nov 6) consider `--min-instances 1` on `willow-api` only if cold starts hurt the demo; it costs a little.
