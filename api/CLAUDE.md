# api/ rules (owner: Niwin)
- FastAPI on Cloud Run, Python 3.12, `uv`.
- Owns Firestore, signed URLs, engine calls, all Gemini calls, BigQuery exports.
- Gemini via Vertex AI (`google-genai`, `vertexai=True`, `us-central1`); structured output only; validate; never let Gemini produce numbers.
- `ENGINE_MODE=fixture` must keep working for local dev and tests.
