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
