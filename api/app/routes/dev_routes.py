"""Local end-to-end runs only: registered when AUTH_MODE=dev and DEV_UPLOADS=true, never in prod.

The web uploads to these routes instead of a signed GCS URL; the bytes still land in the real
bucket under uploads/, so the engine, Firestore and the rest of the pipeline are the real ones.
"""

from fastapi import APIRouter, HTTPException, Query, Request, Response

from app import gcp, storage
from app.settings import get_settings

router = APIRouter(prefix="/v1/dev", tags=["dev"])


@router.put("/upload")
async def dev_upload(
    request: Request, name: str = Query(), content_type: str = Query()
) -> Response:
    if not name.startswith("uploads/") or ".." in name:
        raise HTTPException(400, {"code": "bad_request", "message": "uploads/ only"})
    storage.put_bytes(name, await request.body(), content_type)
    return Response(status_code=200)


@router.get("/object")
def dev_object(name: str = Query()) -> Response:
    if not name.startswith(("uploads/", "results/")) or ".." in name:
        raise HTTPException(400, {"code": "bad_request", "message": "uploads/ or results/ only"})
    blob = gcp.storage_client().bucket(get_settings().bucket).get_blob(name)
    if blob is None:
        raise HTTPException(404, {"code": "not_found", "message": "no such object"})
    return Response(blob.download_as_bytes(), media_type=blob.content_type)
