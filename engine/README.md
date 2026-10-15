# engine (owner: Harshini)

Stateless CV service. Contract: `docs/CONTRACT.md`. Metrics: `docs/METRICS.md`. Kickoff: `prompts/claude-code-engine.md`.

Right now `app/main.py` is a **placeholder** that returns the fixture, so the api can integrate from day 1.

```bash
cd engine
uv sync
uv run pytest
uv run uvicorn app.main:app --reload --port 8081
```

Files written next to the JSON (under the request's `output_prefix`, or the CLI's `--out`):
- `preview.jpg`: the reference photo that `rois`, `candidates[].bbox` and `image_size` describe (face: the first passed front photo; forearm: the first photo whose pen-dot square was found), as an sRGB JPEG, shrunk by a whole factor if its long edge is over 1600 px.
- `crops/c_NNN.jpg`, `crops/c_NNN_ctx.jpg`: each face candidate and its context, for Gemini.
- `overlays/redness.png` (face and cheek close-up, unless `options.compute_overlays` is false): RGBA, the same size as `preview.jpg`, showing where on the measured skin the camera sees more red than the person's own skin median (`app/overlay.py`, docs/CONTRACT.md 2.2).

Models (git-ignored; the Dockerfile and CI download them and check their hashes): `models/face_landmarker.task` (required for face sites) and `models/hand_landmarker.task` (hands resting on the face; without it hands are not looked for), from Google's MediaPipe model storage.

Deploy (from repo root, because the image needs `schemas/` and `fixtures/`):
```bash
gcloud builds submit --config infra/cloudbuild.engine.yaml .
# then gcloud run deploy ... (see infra/README.md)
```
