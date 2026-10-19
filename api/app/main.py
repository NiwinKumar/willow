"""Willow product API (Cloud Run service `willow-api`). Contract: docs/CONTRACT.md section 3."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app import __version__, storage
from app.routes.autopilot_routes import router as autopilot_router
from app.routes.campaign_routes import router as campaign_router
from app.routes.demo_routes import router as demo_router
from app.routes.me_routes import router as me_router
from app.routes.product_requests_routes import router as product_requests_router
from app.routes.product_tests_routes import router as product_tests_router
from app.routes.products_routes import router as products_router
from app.routes.reminders_routes import router as reminders_router
from app.routes.retailer_routes import router as retailer_router
from app.routes.sessions_routes import router as sessions_router
from app.routes.shelf_routes import router as shelf_router
from app.settings import get_settings

settings = get_settings()

app = FastAPI(title="Willow api", version=__version__)
log = logging.getLogger("willow.api")
if not logging.getLogger().handlers:
    # Uvicorn configures only its own loggers; without this the app's info lines are dropped.
    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")


@app.on_event("startup")
def _dev_seed() -> None:
    """DEV_STORE=memory (with AUTH_MODE=dev): three demo campaigns with history, in memory only."""
    if settings.auth_mode == "dev" and settings.dev_store == "memory":
        from app import dev_seed
        from app.store import get_store

        dev_seed.seed_demo_campaigns(get_store())


@app.on_event("startup")
def _warm() -> None:
    """Production: load the rows, status and kept Gemini answers before serving (app/warm.py)."""
    if settings.auth_mode != "dev":
        from app import warm

        warm.run()


# Registered before CORS, so it sits inside it: an unexpected error still reaches the browser as
# JSON with CORS headers ("Something went wrong") instead of a bare 500 the web reads as offline.
@app.middleware("http")
async def json_errors(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception:
        log.exception("unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={"detail": {"code": "internal", "message": "Something went wrong. Try again."}},
        )


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Dev-Uid"],
    # Browsers re-ask the preflight once per URL; cache it (Chrome caps this at 2 hours).
    max_age=7200,
)
# Session lists carry region polygons and the insights are ~15 KB: compress anything sizeable.
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Public, identical for everyone: let browsers reuse them briefly.
PUBLIC_CACHE = {
    "/v1/retailer/insights": "public, max-age=300",
    "/v1/demo/samples": "public, max-age=300",
    "/v1/demo/journey": "public, max-age=120",
    "/v1/demo/status": "public, max-age=30",
}


@app.middleware("http")
async def public_cache_headers(request: Request, call_next):
    response = await call_next(request)
    rule = PUBLIC_CACHE.get(request.url.path)
    if rule and request.method == "GET" and response.status_code == 200:
        response.headers["Cache-Control"] = rule
    return response


app.include_router(sessions_router)
app.include_router(me_router)
app.include_router(products_router)
app.include_router(retailer_router)
app.include_router(demo_router)
app.include_router(product_tests_router)
app.include_router(reminders_router)
app.include_router(campaign_router)
app.include_router(shelf_router)
app.include_router(autopilot_router)
app.include_router(product_requests_router)
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
