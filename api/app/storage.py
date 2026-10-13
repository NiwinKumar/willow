"""Signed upload URLs and object metadata in the captures bucket."""

from dataclasses import dataclass
from datetime import timedelta

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


def signed_put_url(object_name: str, content_type: str, ttl_seconds: int) -> str:
    blob = gcp.storage_client().bucket(get_settings().bucket).blob(object_name)
    return blob.generate_signed_url(
        version="v4",
        expiration=timedelta(seconds=ttl_seconds),
        method="PUT",
        content_type=content_type,
    )


def object_info(object_name: str) -> ObjectInfo:
    blob = gcp.storage_client().bucket(get_settings().bucket).get_blob(object_name)
    if blob is None:
        return ObjectInfo(object_uri(object_name), False, None, None, None)
    return ObjectInfo(object_uri(object_name), True, blob.size, blob.md5_hash, blob.content_type)
