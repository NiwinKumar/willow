"""Fetch input frames (gs:// or, for local dev/tests, file paths) into a temp folder."""

import os
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

import numpy as np

from app import config
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


@lru_cache(maxsize=1)
def gcs_client():
    """One storage client per process (thread-safe). Building one per crop cost a credential
    lookup each time, for up to 80 crops per face session."""
    from google.cloud import storage  # imported lazily: tests run without GCP

    return storage.Client()  # Application Default Credentials / Cloud Run SA


def save_jpegs(jobs: list[tuple[np.ndarray, str]]) -> list[str]:
    """Write many JPEGs at once (GCS uploads are network-bound): same results as save_jpeg."""
    if len(jobs) <= 1:
        return [save_jpeg(img, dest) for img, dest in jobs]
    with ThreadPoolExecutor(max_workers=config.UPLOAD_WORKERS) as pool:
        return list(pool.map(lambda j: save_jpeg(*j), jobs))


def fetch_frames(uris: list[str], workdir: Path) -> list[str]:
    """Download every frame to workdir (in parallel); returns local paths in the same order."""
    for uri in uris:
        _check_format(uri)

    def one(item: tuple[int, str]) -> str:
        i, uri = item
        if not uri.startswith("gs://"):
            if os.environ.get(LOCAL_ENV) != "1":
                raise EngineError("bad_request", f"frames must be gs:// URIs, got {uri}")
            if not Path(uri).is_file():
                raise EngineError("frame_unreadable", f"no such file: {uri}")
            return uri
        bucket, name = parse_gs_uri(uri)
        dest = workdir / f"frame_{i}{Path(name).suffix.lower()}"
        try:
            gcs_client().bucket(bucket).blob(name).download_to_filename(str(dest))
        except Exception as exc:  # map GCS failures to contract error codes
            kind = type(exc).__name__
            if kind in {"Forbidden", "Unauthorized"}:
                raise EngineError("gcs_access_denied", f"{uri}: {exc}") from exc
            if kind == "NotFound":
                raise EngineError("frame_unreadable", f"{uri}: not found") from exc
            raise EngineError("internal", f"{uri}: {kind}: {exc}") from exc
        return str(dest)

    items = list(enumerate(uris))
    if len(items) <= 1:
        return [one(it) for it in items]
    with ThreadPoolExecutor(max_workers=min(len(items), config.UPLOAD_WORKERS)) as pool:
        return list(pool.map(one, items))


def preview_size(height: int, width: int) -> tuple[int, int]:
    """(width, height) of preview.jpg for a photo of this size: shrunk by a whole factor when
    the long edge is over PREVIEW_MAX_SIDE. Overlays use the same size, pixel for pixel."""
    import math

    k = math.ceil(max(height, width) / config.PREVIEW_MAX_SIDE)
    return (round(width / k), round(height / k)) if k > 1 else (width, height)


def save_preview(srgb8: np.ndarray, output_prefix: str) -> str:
    """{output_prefix}/preview.jpg: the reference photo that rois, candidate bboxes and
    image_size describe (CONTRACT_CHANGES proposal 1b). Browsers cannot show DNG or (outside
    Safari) HEIC. Shrunk by a whole factor when the long edge is over PREVIEW_MAX_SIDE."""
    import cv2

    h, w = srgb8.shape[:2]
    size = preview_size(h, w)
    if size != (w, h):
        srgb8 = cv2.resize(srgb8, size, interpolation=cv2.INTER_AREA)
    dest = f"{output_prefix.rstrip('/')}/preview.jpg"
    return save_jpeg(np.ascontiguousarray(srgb8), dest, quality=config.PREVIEW_QUALITY)


def save_jpeg(srgb8, dest: str, quality: int = 90) -> str:
    """Write an 8-bit sRGB array as JPEG to a gs:// URI or a local path; returns dest."""
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(srgb8).save(buf, format="JPEG", quality=quality)
    return _write(buf.getvalue(), dest, "image/jpeg")


def save_png(rgba: np.ndarray, dest: str) -> str:
    """Write an 8-bit RGBA array as PNG (alpha kept) to a gs:// URI or a local path."""
    import cv2

    ok, data = cv2.imencode(
        ".png",
        cv2.cvtColor(np.ascontiguousarray(rgba), cv2.COLOR_RGBA2BGRA),
        [cv2.IMWRITE_PNG_COMPRESSION, config.OVERLAY_PNG_COMPRESSION],
    )
    if not ok:
        raise EngineError("internal", f"{dest}: PNG encoding failed")
    return _write(data.tobytes(), dest, "image/png")


def _write(data: bytes, dest: str, content_type: str) -> str:
    if dest.startswith("gs://"):
        bucket, name = parse_gs_uri(dest)
        try:
            blob = gcs_client().bucket(bucket).blob(name)
            blob.upload_from_string(data, content_type=content_type)
        except Exception as exc:
            code = (
                "gcs_access_denied"
                if type(exc).__name__ in {"Forbidden", "Unauthorized"}
                else "internal"
            )
            raise EngineError(code, f"{dest}: {type(exc).__name__}: {exc}") from exc
    else:
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        Path(dest).write_bytes(data)
    return dest
