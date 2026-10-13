"""Willow product API (Cloud Run service `willow-api`). Contract: docs/CONTRACT.md section 3."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__, storage
from app.routes.demo_routes import router as demo_router
from app.routes.me_routes import router as me_router
from app.routes.products_routes import router as products_router
from app.routes.retailer_routes import router as retailer_router
from app.routes.sessions_routes import router as sessions_router
from app.settings import get_settings

settings = get_settings()

app = FastAPI(title="Willow api", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Dev-Uid"],
)
app.include_router(sessions_router)
app.include_router(me_router)
app.include_router(products_router)
app.include_router(retailer_router)
app.include_router(demo_router)
if storage.dev_uploads_enabled():
    from app.routes.dev_routes import router as dev_router

    app.include_router(dev_router)


@app.exception_handler(RequestValidationError)
def _readable_422(_: Request, exc: RequestValidationError) -> JSONResponse:
    """One plain sentence instead of pydantic's error list (the web shows it to people)."""
    first = exc.errors()[0] if exc.errors() else {}
    message = str(first.get("msg", "Invalid request")).removeprefix("Value error, ")
    field = ".".join(str(p) for p in first.get("loc", ()) if p != "body")
    return JSONResponse(
        status_code=422,
        content={"detail": {"code": "bad_request", "message": message, "field": field or None}},
    )


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
