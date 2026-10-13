"""Signed upload URLs and object metadata in the captures bucket."""

import time
from dataclasses import dataclass
from datetime import timedelta
from urllib.parse import urlencode

from app import gcp
from app.settings import get_settings


@dataclass(frozen=True)
class ObjectInfo:
    object_uri: str
    exists: bool
    size: int | None
    md5_base64: str | None
    content_type: str | None


def object_uri(object_name: str) -> str:
    return f"gs://{get_settings().bucket}/{object_name}"


def dev_uploads_enabled() -> bool:
    s = get_settings()
    return s.auth_mode == "dev" and s.dev_uploads


def signed_put_url(object_name: str, content_type: str, ttl_seconds: int) -> str:
    if dev_uploads_enabled():
        query = urlencode({"name": object_name, "content_type": content_type})
        return f"{get_settings().dev_public_url.rstrip('/')}/v1/dev/upload?{query}"
    blob = gcp.storage_client().bucket(get_settings().bucket).blob(object_name)
    return blob.generate_signed_url(
        version="v4",
        expiration=timedelta(seconds=ttl_seconds),
        method="PUT",
        content_type=content_type,
        credentials=gcp.signing_credentials(),
    )


def put_bytes(object_name: str, data: bytes, content_type: str) -> None:
    blob = gcp.storage_client().bucket(get_settings().bucket).blob(object_name)
    blob.upload_from_string(data, content_type=content_type)


def object_info(object_name: str) -> ObjectInfo:
    blob = gcp.storage_client().bucket(get_settings().bucket).get_blob(object_name)
    if blob is None:
        return ObjectInfo(object_uri(object_name), False, None, None, None)
    return ObjectInfo(object_uri(object_name), True, blob.size, blob.md5_hash, blob.content_type)


_GET_TTL_SECONDS = 3600
_REUSE_MARGIN_SECONDS = 600
_signed_get_cache: dict[str, tuple[str, float]] = {}


def name_from_uri(uri: str) -> str | None:
    prefix = f"gs://{get_settings().bucket}/"
    return uri.removeprefix(prefix) if uri.startswith(prefix) else None


def signed_get_url(object_name: str) -> str:
    """V4 GET URL valid for an hour. Each signature is an IAM signBlob call; reuse recent ones."""
    now = time.time()
    hit = _signed_get_cache.get(object_name)
    if hit and hit[1] - now > _REUSE_MARGIN_SECONDS:
        return hit[0]
    blob = gcp.storage_client().bucket(get_settings().bucket).blob(object_name)
    if dev_uploads_enabled():
        return f"{get_settings().dev_public_url.rstrip('/')}/v1/dev/object?" + urlencode(
            {"name": object_name}
        )
    url = blob.generate_signed_url(
        version="v4",
        expiration=timedelta(seconds=_GET_TTL_SECONDS),
        method="GET",
        credentials=gcp.signing_credentials(),
    )
    _signed_get_cache[object_name] = (url, now + _GET_TTL_SECONDS)
    return url


def list_names(prefix: str) -> set[str]:
    client = gcp.storage_client()
    return {b.name for b in client.list_blobs(get_settings().bucket, prefix=prefix)}


def delete_prefix(prefix: str) -> int:
    client = gcp.storage_client()
    blobs = list(client.list_blobs(get_settings().bucket, prefix=prefix))
    for blob in blobs:
        blob.delete()
    return len(blobs)


def copy_object(source_name: str, dest_name: str) -> None:
    """Server-side copy inside the captures bucket (sample photos into a person's session)."""
    bucket = gcp.storage_client().bucket(get_settings().bucket)
    bucket.copy_blob(bucket.blob(source_name), bucket, dest_name)


def read_text(object_name: str) -> str | None:
    blob = gcp.storage_client().bucket(get_settings().bucket).get_blob(object_name)
    return blob.download_as_text() if blob is not None else None


def read_bytes(object_name: str) -> bytes:
    return gcp.storage_client().bucket(get_settings().bucket).blob(object_name).download_as_bytes()
