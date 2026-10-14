"""Fetch input frames (gs:// or, for local dev/tests, file paths) into a temp folder."""

import os
from pathlib import Path

from app.errors import EngineError

SUPPORTED = {".dng", ".jpg", ".jpeg", ".heic", ".heif"}
LOCAL_ENV = "ENGINE_ALLOW_LOCAL_FILES"  # set to 1 for local dev and tests only


def parse_gs_uri(uri: str) -> tuple[str, str]:
    """gs://bucket/path/to/file -> (bucket, path/to/file)."""
    if not uri.startswith("gs://") or "/" not in uri[5:]:
        raise EngineError("bad_request", f"not a gs:// object URI: {uri}")
    bucket, _, name = uri[5:].partition("/")
    return bucket, name


def _check_format(name: str) -> None:
    if Path(name).suffix.lower() not in SUPPORTED:
        raise EngineError("unsupported_format", f"{name}: expected one of {sorted(SUPPORTED)}")


def fetch_frames(uris: list[str], workdir: Path) -> list[str]:
    """Download every frame to workdir; returns local paths in the same order."""
    for uri in uris:
        _check_format(uri)
    paths = []
    client = None
    for i, uri in enumerate(uris):
        if not uri.startswith("gs://"):
            if os.environ.get(LOCAL_ENV) != "1":
                raise EngineError("bad_request", f"frames must be gs:// URIs, got {uri}")
            if not Path(uri).is_file():
                raise EngineError("frame_unreadable", f"no such file: {uri}")
            paths.append(uri)
            continue
        if client is None:
            from google.cloud import storage  # imported lazily: tests run without GCP

            client = storage.Client()  # Application Default Credentials / Cloud Run SA
        bucket, name = parse_gs_uri(uri)
        dest = workdir / f"frame_{i}{Path(name).suffix.lower()}"
        try:
            client.bucket(bucket).blob(name).download_to_filename(str(dest))
        except Exception as exc:  # map GCS failures to contract error codes
            kind = type(exc).__name__
            if kind in {"Forbidden", "Unauthorized"}:
                raise EngineError("gcs_access_denied", f"{uri}: {exc}") from exc
            if kind == "NotFound":
                raise EngineError("frame_unreadable", f"{uri}: not found") from exc
            raise EngineError("internal", f"{uri}: {kind}: {exc}") from exc
        paths.append(str(dest))
    return paths


def save_jpeg(srgb8, dest: str, quality: int = 90) -> str:
    """Write an 8-bit sRGB array as JPEG to a gs:// URI or a local path; returns dest."""
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(srgb8).save(buf, format="JPEG", quality=quality)
    if dest.startswith("gs://"):
        from google.cloud import storage

        bucket, name = parse_gs_uri(dest)
        try:
            blob = storage.Client().bucket(bucket).blob(name)
            blob.upload_from_string(buf.getvalue(), content_type="image/jpeg")
        except Exception as exc:
            code = (
                "gcs_access_denied"
                if type(exc).__name__ in {"Forbidden", "Unauthorized"}
                else "internal"
            )
            raise EngineError(code, f"{dest}: {type(exc).__name__}: {exc}") from exc
    else:
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        Path(dest).write_bytes(buf.getvalue())
    return dest
