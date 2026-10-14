# engine (owner: Harshini)

Stateless CV service. Contract: `docs/CONTRACT.md`. Metrics: `docs/METRICS.md`. Kickoff: `prompts/claude-code-engine.md`.

Right now `app/main.py` is a **placeholder** that returns the fixture, so the api can integrate from day 1.

```bash
cd engine
uv sync
uv run pytest
uv run uvicorn app.main:app --reload --port 8081
```

Models (git-ignored; the Dockerfile and CI download them and check their hashes): `models/face_landmarker.task` (required for face sites) and `models/hand_landmarker.task` (hands resting on the face; without it hands are not looked for), from Google's MediaPipe model storage.

Deploy (from repo root, because the image needs `schemas/` and `fixtures/`):
```bash
gcloud builds submit --config infra/cloudbuild.engine.yaml .
# then gcloud run deploy ... (see infra/README.md)
```
