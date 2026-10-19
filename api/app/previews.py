"""A small WebP of each session's preview for the web (the api's own display copy).

The engine writes `{output_prefix}preview.jpg` (CONTRACT_CHANGES proposal 1b): about 900 x 1200
and 130-190 KB. Pages show it at most about 600 CSS px tall, so the api keeps `preview.webp` next
to it: the same photo and aspect ratio, PREVIEW_HEIGHT tall, 35-55 KB, and cacheable for a year
(a check-in's photo never changes; measuring again writes it again). `SessionView.session.preview`
signs it when present (same `{url, width, height}`, width and height stay `image_size`, so
overlays and rings line up as before); sessions without one still get the JPEG.
"""

import io
import logging

from app import storage

log = logging.getLogger("willow.previews")

PREVIEW_HEIGHT = 960  # 600 CSS px at 1.6x; a phone shows it at about 400
PREVIEW_QUALITY = 75
# private: these are people's faces, never kept by a shared cache; immutable: no revalidation
CACHE_CONTROL = "private, max-age=31536000, immutable"


def webp_name(jpeg_name: str) -> str:
    return jpeg_name.removesuffix(".jpg") + ".webp"


def to_webp(jpeg: bytes) -> bytes:
    """The photo at PREVIEW_HEIGHT tall (never enlarged), as WebP."""
    from PIL import Image

    with Image.open(io.BytesIO(jpeg)) as im:
        im = im.convert("RGB")
        if im.height > PREVIEW_HEIGHT:
            width = round(im.width * PREVIEW_HEIGHT / im.height)
            im = im.resize((width, PREVIEW_HEIGHT), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        im.save(out, format="WEBP", quality=PREVIEW_QUALITY, method=6)
    return out.getvalue()


def publish(jpeg_name: str) -> str | None:
    """Write the WebP of one preview.jpg; returns its name, or None (no JPEG, or it failed).
    Best effort: the page falls back to the JPEG, so this never fails an analysis."""
    try:
        jpeg = storage.read_bytes(jpeg_name)
    except Exception as exc:
        if type(exc).__name__ not in {"NotFound", "FileNotFoundError"}:
            log.warning("could not read %s: %s", jpeg_name, exc)
        return None
    try:
        name = webp_name(jpeg_name)
        storage.put_bytes(name, to_webp(jpeg), "image/webp", cache_control=CACHE_CONTROL)
        return name
    except Exception:
        log.exception("could not write the WebP of %s", jpeg_name)
        return None
