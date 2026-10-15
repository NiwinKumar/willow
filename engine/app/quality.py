"""Per-frame quality checks on the skin ROI (docs/CONTRACT.md 2.3)."""

from dataclasses import dataclass, field

import cv2
import numpy as np

from app import config


@dataclass
class FrameQuality:
    sharpness: float
    clipped_pct: float
    dark_pct: float
    reasons: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.reasons


def laplacian_variance(grey: np.ndarray) -> float:
    """Sharpness: variance of the 4-neighbour Laplacian. Blur smooths edges -> low variance."""
    g = grey.astype(np.float64)
    lap = -4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    return float(lap.var())


def face_sharpness_min(px_per_mm: float) -> float:
    """Sharpness score a face needs at this scale (see FACE_SHARPNESS_AT): the score of a
    sharp face blurred by about 0.25 mm, interpolated on a log scale; clamped at the ends."""
    ppm, score = zip(*config.FACE_SHARPNESS_AT)
    return float(np.exp(np.interp(px_per_mm, ppm, np.log(score))))


def check_frame(
    linear_roi: np.ndarray,
    srgb8_roi: np.ndarray,
    px_per_mm: float | None = None,
    skin: np.ndarray | None = None,
) -> FrameQuality:
    """Exposure and sharpness gates. With px_per_mm (faces), sharpness is measured at a fixed
    scale so phones with different resolution and noise reduction are judged the same.
    With `skin` (a mask over the ROI), clipping and darkness count skin pixels only
    (docs/CONTRACT.md 2.3: "clipped pixels in skin ROI"), not background in the box."""
    peak = linear_roi.max(axis=-1)
    exposure = peak[skin] if skin is not None and skin.any() else peak
    grey = srgb8_roi.mean(axis=-1).astype(np.float32)
    threshold = config.SHARPNESS_MIN
    if px_per_mm:
        scale = min(config.SHARPNESS_PX_PER_MM / px_per_mm, 1.0)
        grey = cv2.resize(grey, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        threshold = face_sharpness_min(px_per_mm * scale)
    q = FrameQuality(
        sharpness=laplacian_variance(grey),
        clipped_pct=float(np.mean(exposure >= config.CLIP_LEVEL) * 100),
        dark_pct=float(np.mean(exposure <= config.DARK_LEVEL) * 100),
    )
    if q.sharpness < threshold:
        q.reasons.append("blurry")
    if q.clipped_pct > config.CLIPPED_PCT_MAX:
        q.reasons.append("overexposed")
    if q.dark_pct > config.DARK_PCT_MAX:
        q.reasons.append("underexposed")
    return q


# face ROI -> region name in quality.per_frame[].regions (docs/CONTRACT.md 2.3)
REGION_OF = {
    "forehead": "forehead",
    "left_cheek": "left_cheek",
    "right_cheek": "right_cheek",
    "nose": "nose",
    "chin": "chin",
    "right_under_eye": "under_eyes",
    "left_under_eye": "under_eyes",
}
REGION_ORDER = ("forehead", "left_cheek", "right_cheek", "nose", "chin", "under_eyes")


def region_reasons(
    reasons: list[str],
    masks: dict[str, np.ndarray],
    linear: np.ndarray,
    srgb8: np.ndarray,
    px_per_mm: float,
    hand: np.ndarray | None = None,
) -> list[dict]:
    """Which face regions explain this photo's failed checks: `[{reason, region}]`, one or
    more per attributable reason (overexposed, underexposed, blurry, occlusion_suspected).
    A region is named when its own test fails (config REGION_*); "whole" when every region
    fails it or none stands out. `masks`: ROI name -> mask over `linear` / `srgb8` (the face
    box), without the hand cut; `hand`: the hand mask over the same box. Says where, never
    changes whether: the photo's pass / fail is decided by check_frame alone."""
    groups: dict[str, np.ndarray] = {}
    for roi, m in masks.items():
        g = REGION_OF.get(roi)
        if g is not None and m.any():
            groups[g] = groups[g] | m if g in groups else m
    if not groups:
        return []
    out: list[dict] = []

    def name(reason: str, flagged: set[str]) -> None:
        if not flagged or len(flagged) == len(groups):
            out.append({"reason": reason, "region": "whole"})
        else:
            out.extend({"reason": reason, "region": r} for r in REGION_ORDER if r in flagged)

    for reason in ("overexposed", "underexposed"):
        if reason not in reasons:
            continue
        peak = linear.max(axis=-1)
        if reason == "overexposed":
            bad, limit = peak >= config.CLIP_LEVEL, config.CLIPPED_PCT_MAX
        else:
            bad, limit = peak <= config.DARK_LEVEL, config.DARK_PCT_MAX
        name(reason, {g for g, m in groups.items() if np.mean(bad[m]) * 100 > limit})
    if "blurry" in reasons:
        scale = min(config.SHARPNESS_PX_PER_MM / px_per_mm, 1.0)
        grey = srgb8.mean(axis=-1).astype(np.float32)
        grey = cv2.resize(grey, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        lap = cv2.Laplacian(grey, cv2.CV_32F, ksize=1)  # the 4-neighbour Laplacian
        threshold = face_sharpness_min(px_per_mm * scale)
        sharp = {}
        for g, m in groups.items():
            small = cv2.resize(
                m.astype(np.uint8), grey.shape[::-1], interpolation=cv2.INTER_NEAREST
            )
            small = cv2.erode(small, np.ones((3, 3), np.uint8)).astype(bool)  # no edge pixels
            if small.sum() >= 16:
                sharp[g] = float(lap[small].var())
        mid = float(np.median(list(sharp.values()))) if sharp else 0.0
        name(
            "blurry",
            {g for g, s in sharp.items() if s < threshold and s < config.REGION_BLUR_REL * mid},
        )
    if "occlusion_suspected" in reasons:
        flagged = set()
        if hand is not None and hand.any():
            flagged = {
                g
                for g, m in groups.items()
                if (m & hand).sum() >= config.REGION_HAND_FRAC * m.sum()
            }
        name("occlusion_suspected", flagged)
    return out
