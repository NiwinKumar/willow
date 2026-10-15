#!/usr/bin/env bash
# One-time GCP + Firebase setup for Willow. Owner: Niwin.
# Review each block before running. Run blocks one at a time if anything fails.
set -euo pipefail

# ---- fill these in ----
PROJECT_ID="${PROJECT_ID:-willow-511508}"      # must be globally unique
BUDGET_AMOUNT="${BUDGET_AMOUNT:-2000INR}"      # monthly budget, e.g. 2000INR or 20USD
BILLING_ACCOUNT="${BILLING_ACCOUNT:-XXXXXX-XXXXXX-XXXXXX}"  # gcloud billing accounts list
REGION="us-central1"
HARSHINI_EMAIL="${HARSHINI_EMAIL:-harshini@example.com}"
# ------------------------

BUCKET="gs://${PROJECT_ID}-captures"

echo ">> Project + billing"
gcloud projects create "$PROJECT_ID" --name="Willow" || true
gcloud config set project "$PROJECT_ID"
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"

echo ">> Budget: ${BUDGET_AMOUNT}/month with alerts at 5%, 25%, 100% of actual spend (credits excluded)"
gcloud services enable billingbudgets.googleapis.com || true
gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
  --display-name="willow-budget" --budget-amount="$BUDGET_AMOUNT" \
  --filter-projects="projects/${PROJECT_ID}" \
  --filter-credit-types-treatment=exclude-all-credits \
  --threshold-rule=percent=0.05 --threshold-rule=percent=0.25 --threshold-rule=percent=1.0 \
  || echo "   (budget step skipped or already exists; create it in the console if needed)"

echo ">> APIs"
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  storage.googleapis.com firestore.googleapis.com aiplatform.googleapis.com \
  bigquery.googleapis.com iamcredentials.googleapis.com \
  firebase.googleapis.com identitytoolkit.googleapis.com firebasehosting.googleapis.com

echo ">> Artifact Registry"
gcloud artifacts repositories create willow --repository-format=docker --location="$REGION" || true

echo ">> Firestore (default database, native mode)"
gcloud firestore databases create --location="$REGION" || true

echo ">> Bucket + lifecycle + CORS"
gcloud storage buckets create "$BUCKET" --location="$REGION" --uniform-bucket-level-access || true
cat > /tmp/lifecycle.json << 'JSON'
{"rule": [{"action": {"type": "Delete"}, "condition": {"age": 30, "matchesPrefix": ["uploads/", "results/"]}}]}
JSON
gcloud storage buckets update "$BUCKET" --lifecycle-file=/tmp/lifecycle.json
cat > /tmp/cors.json << 'JSON'
[{"origin": ["*"], "method": ["PUT", "GET", "HEAD"], "responseHeader": ["Content-Type"], "maxAgeSeconds": 3600}]
JSON
gcloud storage buckets update "$BUCKET" --cors-file=/tmp/cors.json
# Tighten "origin" to the Firebase Hosting domains once known.

echo ">> BigQuery dataset"
bq --location="$REGION" mk --dataset "${PROJECT_ID}:willow_insights" || true

echo ">> Service accounts"
gcloud iam service-accounts create sa-engine --display-name="Willow engine" || true
gcloud iam service-accounts create sa-api --display-name="Willow api" || true
ENGINE_SA="sa-engine@${PROJECT_ID}.iam.gserviceaccount.com"
API_SA="sa-api@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud storage buckets add-iam-policy-binding "$BUCKET" --member="serviceAccount:${ENGINE_SA}" --role="roles/storage.objectAdmin"
gcloud storage buckets add-iam-policy-binding "$BUCKET" --member="serviceAccount:${API_SA}" --role="roles/storage.objectAdmin"
for ROLE in roles/datastore.user roles/aiplatform.user roles/bigquery.dataEditor roles/bigquery.jobUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${API_SA}" --role="$ROLE" --condition=None
done
# api signs upload URLs with its own identity (no key file)
gcloud iam service-accounts add-iam-policy-binding "$API_SA" \
  --member="serviceAccount:${API_SA}" --role="roles/iam.serviceAccountTokenCreator"

echo ">> Teammate access"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="user:${HARSHINI_EMAIL}" --role="roles/editor" --condition=None

echo ">> Firebase (manual: the CLI cannot add Firebase until the terms are accepted in the console)"
echo "  1. Open https://console.firebase.google.com and 'Add project' -> choose existing project ${PROJECT_ID}."
echo "     Accept the Firebase terms. The project is already on Blaze via the linked billing account; do NOT click Upgrade."
echo "  2. Authentication > Sign-in method: enable Google and Anonymous."
echo "  3. Add a Web app; copy the config into web/.env.local (not committed)."
echo "  4. Then: firebase use ${PROJECT_ID} && firebase deploy --only firestore:rules"

echo ">> After the engine is deployed (Thu), allow api to invoke it:"
echo "  gcloud run services add-iam-policy-binding willow-engine --region=$REGION --member=serviceAccount:${API_SA} --role=roles/run.invoker"
echo "Done."

# ---- Check-in reminders: Web Push keys + Cloud Scheduler (Oct 15, api/app/reminders.py) ----
# Not run by this script: copy the block into a shell from the repo root once willow-api exists.
# Every step is safe to re-run (existing keys, accounts, bindings and the job are kept or updated).
# Without it the api keeps working with push off (reminders by calendar only).
#
# PROJECT_ID=willow-511508; REGION=us-central1
# API_URL="$(gcloud run services describe willow-api --region=$REGION --format='value(status.url)')"
# API_SA="sa-api@${PROJECT_ID}.iam.gserviceaccount.com"
# SCHED_SA="sa-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
# gcloud services enable secretmanager.googleapis.com cloudscheduler.googleapis.com
#
# # 1. VAPID key pair, generated locally (never written to the repo), stored only in Secret Manager.
# if ! gcloud secrets describe willow-vapid-private >/dev/null 2>&1; then
#   KEYS="$(cd api && uv run python -c 'import base64; from cryptography.hazmat.primitives import serialization as s; from cryptography.hazmat.primitives.asymmetric import ec; k = ec.generate_private_key(ec.SECP256R1()); b = lambda x: base64.urlsafe_b64encode(x).rstrip(b"=").decode(); print(b(k.private_numbers().private_value.to_bytes(32, "big"))); print(b(k.public_key().public_bytes(s.Encoding.X962, s.PublicFormat.UncompressedPoint)))')"
#   printf %s "$(sed -n 1p <<<"$KEYS")" | gcloud secrets create willow-vapid-private --replication-policy=user-managed --locations="$REGION" --data-file=-
#   printf %s "$(sed -n 2p <<<"$KEYS")" | gcloud secrets create willow-vapid-public --replication-policy=user-managed --locations="$REGION" --data-file=-
#   unset KEYS
# fi
#
# # 2. The api reads both secrets.
# for S in willow-vapid-private willow-vapid-public; do
#   gcloud secrets add-iam-policy-binding "$S" --member="serviceAccount:${API_SA}" --role=roles/secretmanager.secretAccessor
# done
#
# # 3. Mount them on willow-api (VAPID_SUBJECT and REMINDERS_AUDIENCE are in infra/api-env.yaml).
# gcloud run services update willow-api --region="$REGION" \
#   --update-secrets=VAPID_PRIVATE_KEY=willow-vapid-private:latest,VAPID_PUBLIC_KEY=willow-vapid-public:latest
#
# # 4. A service account for the scheduler, allowed to invoke willow-api.
# gcloud iam service-accounts describe "$SCHED_SA" >/dev/null 2>&1 || \
#   gcloud iam service-accounts create sa-scheduler --display-name="Willow reminder scheduler"
# gcloud run services add-iam-policy-binding willow-api --region="$REGION" \
#   --member="serviceAccount:${SCHED_SA}" --role=roles/run.invoker
#
# # 5. Every 15 minutes, POST /v1/internal/reminders with an OIDC token for that account. The api checks
# #    the token's audience (REMINDERS_AUDIENCE) and email (SCHEDULER_SERVICE_ACCOUNT, default sa-scheduler).
# JOB_ARGS=(--location="$REGION" --schedule="*/15 * * * *" --time-zone=Etc/UTC
#   --uri="${API_URL}/v1/internal/reminders" --http-method=POST
#   --oidc-service-account-email="$SCHED_SA" --oidc-token-audience="${API_URL}/v1/internal/reminders"
#   --attempt-deadline=120s)
# gcloud scheduler jobs create http willow-reminders "${JOB_ARGS[@]}" 2>/dev/null || \
#   gcloud scheduler jobs update http willow-reminders "${JOB_ARGS[@]}"
#
# # Check: run it now and read the api's answer in the logs ("reminders run: {...}").
# gcloud scheduler jobs run willow-reminders --location="$REGION"
