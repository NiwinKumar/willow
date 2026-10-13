# Placeholder image: build from the REPO ROOT so schemas/ and fixtures/ are included:
#   docker build -f engine/Dockerfile .
# Claude Code will replace this with the real pipeline image (rawpy, OpenCV, MediaPipe model download).
FROM python:3.12-slim
WORKDIR /srv
RUN pip install --no-cache-dir fastapi "uvicorn[standard]" "pydantic>=2" jsonschema
COPY schemas/ schemas/
COPY fixtures/ fixtures/
COPY engine/app/ engine/app/
WORKDIR /srv/engine
RUN useradd -m appuser
USER appuser
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
