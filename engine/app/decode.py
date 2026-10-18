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
TAG_LENS_MODEL = 0xA434
TAG_MAKER_NOTE, TAG_FOCAL_35MM = 0x927C, 0xA405
# Apple's MakerNote (undocumented; read as exiftool does): FocusPosition, the lens actuator's
# position (higher = closer; 255 is the closest it focuses), and AFConfidence (0 = not in focus)
APPLE_FOCUS_POSITION, APPLE_AF_CONFIDENCE = 0x002F, 0x003D


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
    lens: str | None = None  # e.g. "iPhone 17 Pro Max front camera 2.715mm f/1.9"
    focal_35mm: float | None = None  # ~13-14 on an iPhone ultra wide; more with digital zoom
    focus_position: int | None = None  # Apple only (MakerNote)
    af_confidence: int | None = None  # Apple only (MakerNote)


def apple_focus(note: bytes) -> tuple[int | None, int | None]:
    """(FocusPosition, AFConfidence) from an Apple MakerNote; (None, None) for anything else.
    Big-endian IFD after a 14-byte "Apple iOS" header; both tags fit in the entry itself."""
    out: dict[int, int] = {}
    try:
        if not note.startswith(b"Apple iOS"):
            return None, None
        count = int.from_bytes(note[14:16], "big")
        for i in range(count):
            entry = note[16 + 12 * i : 28 + 12 * i]
            tag, typ, n = (int.from_bytes(entry[a:b], "big") for a, b in ((0, 2), (2, 4), (4, 8)))
            if tag in (APPLE_FOCUS_POSITION, APPLE_AF_CONFIDENCE) and n == 1 and typ in (3, 4, 9):
                size = 2 if typ == 3 else 4
                out[tag] = int.from_bytes(entry[8 : 8 + size], "big", signed=typ == 9)
    except (IndexError, ValueError):
        return None, None
    return out.get(APPLE_FOCUS_POSITION), out.get(APPLE_AF_CONFIDENCE)


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
            # relative colorimetric: in-gamut colours (all skin) keep their exact values
            img = ImageCms.profileToProfile(
                img,
                src,
                ImageCms.createProfile("sRGB"),
                renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
            )
        rgb8 = np.asarray(img, dtype=np.uint8)
    sub = exif.get_ifd(EXIF_IFD)
    iso = sub.get(TAG_ISO)
    exposure = sub.get(TAG_EXPOSURE)
    note = sub.get(TAG_MAKER_NOTE)
    focus, af = apple_focus(note) if isinstance(note, bytes) else (None, None)
    focal = sub.get(TAG_FOCAL_35MM)
    info = PhotoInfo(
        format=fmt,
        size=(rgb8.shape[1], rgb8.shape[0]),
        color_profile=profile_name,
        camera=exif.get(TAG_MODEL),
        iso=int(iso[0] if isinstance(iso, tuple) else iso) if iso else None,
        exposure_s=float(exposure) if exposure else None,
        lens=sub.get(TAG_LENS_MODEL),
        focal_35mm=float(focal) if focal else None,
        focus_position=focus,
        af_confidence=af,
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


def decode_dng_srgb(path: str | Path) -> np.ndarray:
    """DNG -> linear sRGB float32 0..1, for DNGs shot without a colour card.

    With no card to fit our own colour matrix, we use the camera's own matrix and as-shot
    white balance stored in the DNG (fixed if WB is locked), then the white paper fixes
    what is left. Still no phone beautifying, no HDR, no smoothing.
    """
    with rawpy.imread(str(path)) as raw:
        rgb = raw.postprocess(
            gamma=(1, 1),
            no_auto_bright=True,
            use_camera_wb=True,
            output_color=rawpy.ColorSpace.sRGB,
            output_bps=16,
        )
    linear = rgb.astype(np.float32) / 65535.0
    # The DNG's BaselineExposure says how much brighter the camera means the image to be
    # (phones store +1 EV or more). Without it a phone DNG decodes about 2x too dark: paper and
    # pen dots fall below the detectors' thresholds and L* (so ITA) is far off. Oct 14: +1.15 EV.
    gain = 2.0 ** baseline_exposure(path)
    return np.clip(linear * gain, 0.0, 1.0) if gain != 1.0 else linear


def baseline_exposure(path: str | Path) -> float:
    """DNG tag 50730 (BaselineExposure) in EV; 0 when absent or unreadable."""
    try:
        with Image.open(path) as img:
            value = img.tag_v2.get(50730)  # TIFF/DNG IFD0
    except (OSError, ValueError, SyntaxError):  # Pillow cannot parse every DNG
        return 0.0
    try:
        ev = float(value) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0
    return ev if -4.0 <= ev <= 4.0 else 0.0  # a sane range; anything else is a broken tag


def linear_to_srgb8(linear: np.ndarray) -> np.ndarray:
    """Inverse of srgb_to_linear: linear 0..1 -> 8-bit sRGB (for previews and sharpness)."""
    c = np.clip(linear, 0.0, 1.0)
    encoded = np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
    return np.round(encoded * 255).astype(np.uint8)
