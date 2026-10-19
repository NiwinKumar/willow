# willow-engine on Cloud Run. Build from the REPO ROOT so schemas/ and fixtures/ are included:
#   gcloud builds submit --config infra/cloudbuild.engine.yaml .
# Dependencies come from engine/uv.lock. rawpy and pillow-heif ship manylinux wheels with
# LibRaw and libheif inside; MediaPipe needs only the GL libraries installed below.
FROM python:3.12-slim
# MediaPipe's face landmarker links the GLES / EGL libraries even when it runs on CPU.
RUN apt-get update && apt-get install -y --no-install-recommends libgles2 libegl1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.12.15 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/srv/.venv
# 2 CPUs: the engine measures 2 photos at once (threads) and OpenCV uses 2 threads per call
# (app/config.py); BLAS / OpenMP pools on top of that would only oversubscribe the CPUs
ENV OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
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
# MediaPipe hand model: hands resting on the face are cut from the skin (same checks).
RUN python -c "import hashlib, urllib.request, pathlib; \
p = pathlib.Path('/srv/engine/models/hand_landmarker.task'); \
urllib.request.urlretrieve('https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', p); \
h = hashlib.sha256(p.read_bytes()).hexdigest(); \
assert h == 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1', h"
RUN useradd -m appuser && chown -R appuser /srv
USER appuser
ENV PATH="/srv/.venv/bin:$PATH"
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
