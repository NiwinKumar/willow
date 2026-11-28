/**
 * Where a person's data is kept and processed, in one place so the landing footer, You's privacy receipt, the
 * Terms and the judge FAQ (Judge.tsx) say the same thing. Every clause is true of the running system:
 * - stored and measured in us-central1: the captures bucket, Firestore and BigQuery are created there and both Cloud
 *   Run services run there (infra/setup.sh; api/app/retailer.py queries BigQuery in us-central1);
 * - what leaves it: Gemini runs on Vertex AI's global endpoint (api/app/settings.py vertex_location = "global") and
 *   receives spot close-ups (api/app/labeller.py), label and attached photos (label_scan.py, advisor.py) and text;
 *   live voice (api/app/live.py LOCATION) runs in us-central1; whole face photos are never sent to it by Willow;
 * - deletion: DELETE /v1/me (api/app/routes/me_routes.py) removes the records first, then the photos, results and
 *   pack photos; opted-in rows leave BigQuery at the next full export (api/scripts/export_bq.py replaces every table).
 */
export const DATA_LOCATION = {
  where: 'Your photos, results and records are stored and measured in Google Cloud’s us-central1 region (Iowa, USA), wherever you live.',
  leaves: 'Only small spot close-ups, photos you attach or scan, and text (typed questions, and the readings Gemini explains) go to Gemini through Google’s global endpoint, which may process them outside that region. Voice conversations stay in us-central1.',
  delete: 'Delete my data in You removes your photos, results and records at once.',
} as const

/** The three clauses as one paragraph. */
export const DATA_LOCATION_LINE = `${DATA_LOCATION.where} ${DATA_LOCATION.leaves} ${DATA_LOCATION.delete}`
