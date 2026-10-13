# engine/ rules (owner: Harshini)
- Stateless. No Firestore, no Gemini, no network calls except GCS read/write.
- Return schema-valid `AnalysisResult` for every request; quality failures are 200 responses.
- Deterministic math only; document thresholds in `app/config.py`.
- Tone-relative thresholds; never rank or score lightness.
- Tests use synthetic arrays; real photos only from `data/` (git-ignored) or GCS.
