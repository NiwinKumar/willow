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
RUN useradd -m appuser && chown -R appuser /srv
USER appuser
ENV PATH="/srv/.venv/bin:$PATH"
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
