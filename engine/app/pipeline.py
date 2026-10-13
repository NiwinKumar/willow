"""One analysis request end to end (forearm sites, M1)."""

import json
import time
from pathlib import Path

import numpy as np
from jsonschema import validate

from app import config
from app.aggregate import summarize
from app.color import linear_srgb_to_lab, white_balance
from app.decode import decode_dng_srgb, linear_to_srgb8, load_photo_srgb8, srgb_to_linear
from app.markers import find_dot_squares, paper_pixels
from app.metrics.redness import redness
from app.metrics.tone import tone_ita
from app.quality import FrameQuality, check_frame
from app.roi import Box, skin_mask

SCHEMA = Path(__file__).resolve().parents[2] / "schemas" / "analysis_result.schema.json"
FOREARM_SITES = {"forearm_treated", "forearm_control"}
METRIC_INFO = {  # id -> (group, label, unit)
    "tone_ita": ("tone_pigment", "Skin tone (ITA)", "deg"),
    "redness": ("redness", "Redness", "a_star"),
}


def capture_mode_for(files: list[str]) -> str:
    """All DNG -> calibrated_raw; all normal photos -> uncalibrated. No mixing in one session."""
    is_dng = {Path(f).suffix.lower() == ".dng" for f in files}
    if len(is_dng) > 1:
        raise ValueError("mix of DNG and normal photos in one session")
    return "calibrated_raw" if is_dng.pop() else "uncalibrated"


def _load(path: str) -> tuple[np.ndarray, np.ndarray]:
    """-> (linear sRGB float 0..1, 8-bit sRGB) for DNG or normal photos."""
    if Path(path).suffix.lower() == ".dng":
        linear = decode_dng_srgb(path)
        return linear, linear_to_srgb8(linear)
    srgb8, _ = load_photo_srgb8(path)
    return srgb_to_linear(srgb8), srgb8


def _frame_metrics(
    path: str, roi: Box | None, white: Box | None, auto_white: bool = True, square: int = 0
) -> tuple[dict, dict, FrameQuality, tuple, Box, bool]:
    """Metrics for one photo.

    roi=None -> find pen-dot squares (square=0: the only one; 1/2: top/bottom of a pair);
    white=None -> find the paper beside the skin box.
    """
    linear, srgb8 = _load(path)
    if roi is None:
        squares = find_dot_squares(srgb8, 1 if square == 0 else 2)
        roi = squares[max(square, 1) - 1][0]
    white_px = white.crop(linear) if white is not None else None
    if white_px is None and auto_white:
        try:
            white_px = paper_pixels(linear, srgb8, near=roi)
        except ValueError:
            white_px = None  # reported as a warning below
    # judge exposure on the photo as the camera took it: the paper correction can brighten
    # very light skin to 1.0, which is not the camera's fault and must not fail the photo
    quality = check_frame(roi.crop(linear), roi.crop(srgb8))
    if white_px is not None:
        linear = white_balance(linear, white_px)
    skin_lin = roi.crop(linear)
    lab = linear_srgb_to_lab(skin_lin)
    mask = skin_mask(lab)
    ita, ita_extras = tone_ita(lab, mask)
    a_star, red_extras = redness(lab, skin_lin, mask)
    values = {"tone_ita": ita, "redness": a_star}
    extras = {"tone_ita": ita_extras, "redness": red_extras}
    return values, extras, quality, srgb8.shape, roi, white_px is not None


def analyze_forearm(
    files: list[str],
    site: str,
    rois: list[Box | None],
    whites: list[Box | None],
    auto_white: bool = True,
    square: int = 0,
    session_id: str = "s_local",
    user_id: str = "local",
    baseline: dict | None = None,
) -> dict:
    """Analyze one taped forearm square from normal photos (uncalibrated) or DNGs.

    DNGs have no colour card (team decision Oct 13): reported as calibrated_raw with
    card_detected=false and a warning; normal photos are uncalibrated and 'indicative'.
    """
    if site not in FOREARM_SITES:
        raise ValueError(f"M1 supports {sorted(FOREARM_SITES)} only, got {site!r}")
    t0 = time.perf_counter()
    mode = capture_mode_for(files)
    confidence = "measured" if mode == "calibrated_raw" else "indicative"
    per_frame, passed_values, passed_extras, shape = [], [], [], None
    used_rois, white_ok = [], []
    for i, (path, roi, white) in enumerate(zip(files, rois, whites, strict=True)):
        values, extras, q, frame_shape, used_roi, balanced = _frame_metrics(
            path, roi, white, auto_white, square
        )
        shape = shape or frame_shape
        used_rois.append(used_roi)
        white_ok.append(balanced)
        per_frame.append({"index": i, "passed": q.passed, "reasons": q.reasons, "_q": q})
        if q.passed:
            passed_values.append(values)
            passed_extras.append(extras)

    metrics = []
    for metric_id, (group, label, unit) in METRIC_INFO.items():
        base = (baseline or {}).get(metric_id)
        if passed_values:
            summary = summarize([v[metric_id] for v in passed_values], base)
            extras = passed_extras[0][metric_id]  # extras of the first good frame
        else:
            summary = {
                "value": None,
                "within_session_sd": None,
                "mdc95": None,
                "delta": None,
                "verdict": "low_quality",
                "direction": "none",
            }
            extras = {}
        metrics.append(
            {
                "id": metric_id,
                "group": group,
                "label": label,
                "unit": unit,
                "confidence": confidence,
                **summary,
                "extras": extras,
            }
        )

    qs = [f.pop("_q") for f in per_frame]
    reasons = sorted({r for f in per_frame for r in f["reasons"]})
    if not passed_values:
        reasons.append("too_few_frames")
    if mode == "uncalibrated":
        warnings = ["uncalibrated photo: results are a trend only, not a measurement"]
    else:
        warnings = ["no colour card: colours corrected with the white paper only"]
    if not all(white_ok):
        warnings.append("no white reference found in some photos: lamp colour not corrected")

    result = {
        "schema_version": "1.0",
        "engine_version": config.ENGINE_VERSION,
        "session_id": session_id,
        "user_id": user_id,
        "site": site,
        "capture_mode": mode,
        "frames_used": len(passed_values),
        "quality": {
            "passed": bool(passed_values),
            "card_detected": False,
            "card_delta_e_mean": None,
            "sharpness": round(float(np.mean([q.sharpness for q in qs])), 1),
            "clipped_pct": round(float(np.mean([q.clipped_pct for q in qs])), 2),
            "pose": None,
            "per_frame": per_frame,
            "reasons": reasons,
        },
        "metrics": metrics,
        "candidates": [],
        "overlays": [],
        "rois": [{"name": "forearm_square", "polygon": used_rois[0].polygon()}],
        "image_size": {"width": int(shape[1]), "height": int(shape[0])},
        "timings_ms": {"total": round((time.perf_counter() - t0) * 1000, 1)},
        "warnings": warnings,
    }
    validate(result, json.loads(SCHEMA.read_text()))
    return result
