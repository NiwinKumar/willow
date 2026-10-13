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

# api
gcloud run deploy willow-api --source api --region us-central1 \
  --service-account sa-api@$PROJECT_ID.iam.gserviceaccount.com \
  --allow-unauthenticated --cpu 1 --memory 1Gi --min-instances 0 --max-instances 3 \
  --set-env-vars PROJECT_ID=$PROJECT_ID,BUCKET=$PROJECT_ID-captures,ENGINE_URL=<engine-url>,GEMINI_MODEL=<model-id>,VERTEX_LOCATION=us-central1

# web
cd web && npm run build && firebase deploy --only hosting
```

During judging (Oct 19 - Nov 6) consider `--min-instances 1` on `willow-api` only if cold starts hurt the demo; it costs a little.
