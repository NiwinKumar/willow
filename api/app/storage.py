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


def put_bytes(
    object_name: str, data: bytes, content_type: str, cache_control: str | None = None
) -> None:
    blob = gcp.storage_client().bucket(get_settings().bucket).blob(object_name)
    if cache_control:
        blob.cache_control = cache_control  # sent with the upload as object metadata
    blob.upload_from_string(data, content_type=content_type)


def object_info(object_name: str) -> ObjectInfo:
    blob = gcp.storage_client().bucket(get_settings().bucket).get_blob(object_name)
    if blob is None:
        return ObjectInfo(object_uri(object_name), False, None, None, None)
    return ObjectInfo(object_uri(object_name), True, blob.size, blob.md5_hash, blob.content_type)


_GET_TTL_SECONDS = 6 * 3600  # long enough for a judge to leave a tab open
_REUSE_MARGIN_SECONDS = 2 * 3600  # a reused link still has 2 h; caches add minutes
_signed_get_cache: dict[str, tuple[str, float]] = {}


def name_from_uri(uri: str) -> str | None:
    prefix = f"gs://{get_settings().bucket}/"
    return uri.removeprefix(prefix) if uri.startswith(prefix) else None


def signed_get_url(object_name: str) -> str:
    """V4 GET URL (valid _GET_TTL_SECONDS). Each signature is an IAM signBlob call; reuse recent
    ones."""
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


DISPLAYABLE = ("**/preview.jpg", "**/preview.webp", "**/overlays/*", "**/views/*")


def list_names(prefix: str, globs: tuple[str, ...] = DISPLAYABLE) -> set[str]:
    """The results under a prefix matching `globs`: by default previews and overlays only. Spot
    crops (dozens per session) are listed only where a page shows them (the spot diary)."""
    client = gcp.storage_client()
    bucket = get_settings().bucket
    return {
        b.name for glob in globs for b in client.list_blobs(bucket, prefix=prefix, match_glob=glob)
    }


def delete_object(object_name: str) -> None:
    """Delete one object; a missing object is fine (a removed frame that never uploaded)."""
    blob = gcp.storage_client().bucket(get_settings().bucket).get_blob(object_name)
    if blob is not None:
        blob.delete()


def list_md5s(prefix: str) -> dict[str, str]:
    """{object name: base64 MD5} of every object under a prefix (one list call; the duplicate
    check reads a person's earlier uploads this way)."""
    client = gcp.storage_client()
    return {
        b.name: b.md5_hash
        for b in client.list_blobs(get_settings().bucket, prefix=prefix)
        if b.md5_hash
    }


def delete_prefix(prefix: str) -> int:
    """Delete every object under a prefix, 100 per batched request."""
    client = gcp.storage_client()
    blobs = list(client.list_blobs(get_settings().bucket, prefix=prefix))
    for i in range(0, len(blobs), 100):
        with client.batch(raise_exception=False):
            for blob in blobs[i : i + 100]:
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
