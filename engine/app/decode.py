"""Decode photos into linear RGB arrays (float32, 0..1)."""

import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pillow_heif
import rawpy
from PIL import Image, ImageCms, ImageOps

pillow_heif.register_heif_opener()  # lets Pillow open iPhone .heic files

EXIF_IFD, TAG_MODEL, TAG_EXPOSURE, TAG_ISO = 0x8769, 0x0110, 0x829A, 0x8827


@dataclass
class RawInfo:
    """Sensor metadata we print in the smoke test and log later."""

    raw_type: str
    raw_shape: tuple[int, int]
    output_shape: tuple[int, int, int]
    color_desc: str
    black_levels: list[int]
    white_level: int
    camera_wb: list[float]


def decode_dng(path: str | Path) -> tuple[np.ndarray, RawInfo]:
    """DNG -> linear camera RGB, settings from docs/METRICS.md (pipeline step 1).

    gamma=(1,1) keeps values proportional to light; user_wb=[1,1,1,1] and no auto-bright
    mean no colour or exposure tweaks, so our own white-balance step sees the raw truth.
    """
    with rawpy.imread(str(path)) as raw:
        rgb = raw.postprocess(
            gamma=(1, 1),
            no_auto_bright=True,
            use_camera_wb=False,
            user_wb=[1.0, 1.0, 1.0, 1.0],
            output_color=rawpy.ColorSpace.raw,
            output_bps=16,
        )
        info = RawInfo(
            raw_type=raw.raw_type.name,
            raw_shape=tuple(raw.raw_image_visible.shape[:2]),
            output_shape=tuple(rgb.shape),
            color_desc=raw.color_desc.decode(),
            black_levels=[int(b) for b in raw.black_level_per_channel],
            white_level=int(raw.white_level),
            camera_wb=[float(w) for w in raw.camera_whitebalance],
        )
    return rgb.astype(np.float32) / 65535.0, info


def quicklook_dng(path: str | Path) -> np.ndarray:
    """Human-viewable 8-bit sRGB render (camera WB + normal gamma). For looking only, never
    for measuring: the phone-style processing changes the numbers."""
    with rawpy.imread(str(path)) as raw:
        return raw.postprocess(use_camera_wb=True, output_bps=8)


@dataclass
class PhotoInfo:
    """Basic facts about a normal phone photo (uncalibrated mode)."""

    format: str
    size: tuple[int, int]
    color_profile: str
    camera: str | None
    iso: int | None
    exposure_s: float | None


def load_photo_srgb8(path: str | Path) -> tuple[np.ndarray, PhotoInfo]:
    """JPEG/HEIC -> upright 8-bit sRGB array.

    iPhones save in the wider Display P3 colour space; converting to sRGB first means the
    same Lab maths works for every phone.
    """
    with Image.open(path) as img:
        fmt = img.format or "unknown"
        exif = img.getexif()
        icc = img.info.get("icc_profile")
        img = ImageOps.exif_transpose(img).convert("RGB")  # phones store rotation separately
        profile_name = "none (assumed sRGB)"
        if icc:
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            profile_name = ImageCms.getProfileDescription(src).strip()
            img = ImageCms.profileToProfile(img, src, ImageCms.createProfile("sRGB"))
        rgb8 = np.asarray(img, dtype=np.uint8)
    sub = exif.get_ifd(EXIF_IFD)
    iso = sub.get(TAG_ISO)
    exposure = sub.get(TAG_EXPOSURE)
    info = PhotoInfo(
        format=fmt,
        size=(rgb8.shape[1], rgb8.shape[0]),
        color_profile=profile_name,
        camera=exif.get(TAG_MODEL),
        iso=int(iso[0] if isinstance(iso, tuple) else iso) if iso else None,
        exposure_s=float(exposure) if exposure else None,
    )
    return rgb8, info


def srgb_to_linear(rgb8: np.ndarray) -> np.ndarray:
    """Undo the sRGB gamma curve so values are proportional to light again (IEC 61966-2-1)."""
    c = rgb8.astype(np.float32) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def decode_photo(path: str | Path) -> tuple[np.ndarray, PhotoInfo]:
    """JPEG/HEIC -> linear sRGB float32 0..1 (docs/METRICS.md pipeline step 1, uncalibrated)."""
    rgb8, info = load_photo_srgb8(path)
    return srgb_to_linear(rgb8), info
