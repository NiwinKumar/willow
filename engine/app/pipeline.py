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
from app.errors import EngineError
from app.io import save_preview
from app.markers import SpotNotFound, find_dot_squares, paper_pixels
from app.metrics.redness import redness
from app.metrics.tone import ita_band, tone_ita
from app.quality import FrameQuality, check_frame
from app.roi import Box, skin_mask

SCHEMA = Path(__file__).resolve().parents[2] / "schemas" / "analysis_result.schema.json"
FOREARM_SITES = {"forearm_treated", "forearm_control"}
METRIC_INFO = {  # id -> (group, label, unit)
    "tone_ita": ("tone_pigment", "Skin tone (ITA)", "deg"),
    "redness": ("redness", "Redness", "a_star"),
}


def _mean_extras(per_frame: list[dict]) -> dict:
    """Average numeric extras over the good frames (text extras are recomputed by the caller)."""
    out = {}
    for key, first in per_frame[0].items():
        if isinstance(first, (int, float)):
            out[key] = round(sum(e[key] for e in per_frame) / len(per_frame), 2)
    return out


def capture_mode_for(files: list[str]) -> str:
    """All DNG -> calibrated_raw; all normal photos -> uncalibrated. No mixing in one session."""
    is_dng = {Path(f).suffix.lower() == ".dng" for f in files}
    if len(is_dng) > 1:
        raise ValueError("mix of DNG and normal photos in one session")
    return "calibrated_raw" if is_dng.pop() else "uncalibrated"


def _load(path: str) -> tuple[np.ndarray, np.ndarray]:
    """-> (linear sRGB float 0..1, 8-bit sRGB) for DNG or normal photos."""
    try:
        if Path(path).suffix.lower() == ".dng":
            linear = decode_dng_srgb(path)
            return linear, linear_to_srgb8(linear)
        srgb8, _ = load_photo_srgb8(path)
    except Exception as exc:  # rawpy / Pillow raise many types for corrupt files
        raise EngineError("frame_unreadable", f"{Path(path).name}: {exc}") from exc
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
        try:
            linear = white_balance(linear, white_px)
        except ValueError:  # paper too dark or blown out: no reference, not a crash
            white_px = None
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
    output_prefix: str | None = None,
) -> dict:
    """Analyze one taped forearm square from normal photos (uncalibrated) or DNGs.

    DNGs have no colour card (team decision Oct 13): reported as calibrated_raw with
    card_detected=false and a warning; normal photos are uncalibrated and 'indicative'.
    """
    if site not in FOREARM_SITES:
        raise EngineError("bad_request", f"forearm pipeline got site {site!r}")
    t0 = time.perf_counter()
    try:
        mode = capture_mode_for(files)
    except ValueError as exc:
        raise EngineError("bad_request", str(exc)) from exc
    confidence = "measured" if mode == "calibrated_raw" else "indicative"
    per_frame, passed_values, passed_extras, shape, ref_path = [], [], [], None, None
    used_rois, white_ok, qs, warnings = [], [], [], []
    for i, (path, roi, white) in enumerate(zip(files, rois, whites, strict=True)):
        try:
            values, extras, q, frame_shape, used_roi, balanced = _frame_metrics(
                path, roi, white, auto_white, square
            )
        except SpotNotFound:
            # no contract reason code fits yet (see CONTRACT_CHANGES 'roi_not_found'):
            # fail the frame and say why in warnings
            per_frame.append({"index": i, "passed": False, "reasons": []})
            warnings.append(f"photo {i + 1}: pen-dot square not found")
            continue
        if shape is None:
            shape, ref_path = frame_shape, path  # first photo whose square was found
        used_rois.append(used_roi)
        white_ok.append(balanced)
        qs.append(q)
        per_frame.append({"index": i, "passed": q.passed, "reasons": q.reasons})
        if q.passed:
            passed_values.append(values)
            passed_extras.append(extras)

    # "Measured" needs a colour reference in every photo: without the paper, neither the lamp's
    # colour nor its brightness is corrected, so tone and redness are a trend, even from a DNG.
    if mode == "calibrated_raw" and not (white_ok and all(white_ok)):
        confidence = "indicative"
    metrics = []
    for metric_id, (group, label, unit) in METRIC_INFO.items():
        base = (baseline or {}).get(metric_id)
        if passed_values:
            summary = summarize([v[metric_id] for v in passed_values], base)
            extras = _mean_extras([e[metric_id] for e in passed_extras])
            if metric_id == "tone_ita":  # band must describe the reported (mean) value
                extras["ita_band"] = ita_band(summary["value"])
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

    reasons = sorted({r for f in per_frame for r in f["reasons"]})
    if not passed_values:
        reasons.append("too_few_frames")
    if mode == "uncalibrated":
        warnings.insert(0, "uncalibrated photo: results are a trend only, not a measurement")
    elif any(white_ok):
        warnings.insert(0, "no colour card: colours corrected with the white paper only")
    # (the web reads "no white reference found" and " in some photos")
    if white_ok and not any(white_ok):
        warnings.append(
            "no white reference found: lamp colour and brightness not corrected, so tone and "
            "redness are a trend"
        )
    elif not all(white_ok):
        warnings.append(
            "no white reference found in some photos: lamp colour and brightness not corrected"
        )

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
            "sharpness": round(float(np.mean([q.sharpness for q in qs])), 1) if qs else None,
            "clipped_pct": round(float(np.mean([q.clipped_pct for q in qs])), 2) if qs else None,
            "pose": None,
            "per_frame": per_frame,
            "reasons": reasons,
        },
        "metrics": metrics,
        "candidates": [],
        "overlays": [],
        "rois": [{"name": "forearm_square", "polygon": used_rois[0].polygon()}]
        if used_rois
        else [],
        "timings_ms": {"total": round((time.perf_counter() - t0) * 1000, 1)},
        "warnings": warnings,
    }
    if ref_path and output_prefix:  # the photo the forearm_square ROI describes
        save_preview(_load(ref_path)[1], output_prefix)
    if shape is not None:
        result["image_size"] = {"width": int(shape[1]), "height": int(shape[0])}
    validate(result, json.loads(SCHEMA.read_text()))
    return result
