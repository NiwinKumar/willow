"""Willow product API (Cloud Run service `willow-api`). Contract: docs/CONTRACT.md section 3."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.routes.sessions_routes import router as sessions_router
from app.settings import get_settings

settings = get_settings()

app = FastAPI(title="Willow api", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Dev-Uid"],
)
app.include_router(sessions_router)


# GET /healthz is answered by Google's frontend with a 404 on *.run.app (seen Oct 13 on both
# services), so the health route lives under /v1. It is the only unauthenticated route.
@app.get("/v1/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "willow-api",
        "version": __version__,
        "engine_mode": settings.engine_mode,
    }
