# willow-engine on Cloud Run. Build from the REPO ROOT so schemas/ and fixtures/ are included:
#   gcloud builds submit --config infra/cloudbuild.engine.yaml .
# Dependencies come from engine/uv.lock. rawpy and pillow-heif ship manylinux wheels with
# LibRaw and libheif inside, so no system packages are needed.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.15 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/srv/.venv
WORKDIR /srv/engine
COPY engine/pyproject.toml engine/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY schemas/ /srv/schemas/
COPY fixtures/ /srv/fixtures/
COPY engine/app/ /srv/engine/app/
# MediaPipe face model for face_full (git-ignored in the repo): Google's published file,
# checked against the hash of the copy the engine was tuned with.
RUN python -c "import hashlib, urllib.request, pathlib; \
p = pathlib.Path('/srv/engine/models/face_landmarker.task'); p.parent.mkdir(parents=True); \
urllib.request.urlretrieve('https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', p); \
h = hashlib.sha256(p.read_bytes()).hexdigest(); \
assert h == '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff', h"
RUN useradd -m appuser && chown -R appuser /srv
USER appuser
ENV PATH="/srv/.venv/bin:$PATH"
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
