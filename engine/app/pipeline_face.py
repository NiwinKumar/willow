"""face_full analysis (M2): landmarks -> ROIs -> white paper -> Lab -> A-tier face metrics."""

import json
import time

import numpy as np
from jsonschema import validate

from app import config
from app.aggregate import summarize
from app.color import linear_srgb_to_lab, white_balance
from app.errors import EngineError
from app.landmarks import CHEEKS, Face, FaceNotFound, detect_face, polygon_mask, refine_skin
from app.markers import paper_pixels
from app.metrics.evenness import tone_evenness
from app.metrics.pigment import pigment_spots
from app.metrics.redness import erythema_index
from app.metrics.tone import ita_band, ita_degrees
from app.pipeline import SCHEMA, _load, _mean_extras, capture_mode_for
from app.quality import FrameQuality, check_frame
from app.roi import Box

METRIC_INFO = {  # id -> (group, label, unit), docs/CONTRACT.md 2.5
    "tone_ita": ("tone_pigment", "Skin tone (ITA)", "deg"),
    "pigment_spots": ("tone_pigment", "Dark spots", "pct_area"),
    "tone_evenness": ("tone_pigment", "Tone evenness", "index"),
    "redness": ("redness", "Redness", "a_star"),
}
EVENNESS_ROIS = ("forehead", "right_cheek", "left_cheek", "nose", "chin")
REDNESS_ROIS = ("right_cheek", "left_cheek", "nose")
# Dark spots stay on these flatter ROIs until the round-dot detector lands: over the whole
# face the current detector mistakes shadows beside the nose and eye sockets for spots.
SPOT_ROIS = ("forehead", "right_cheek", "left_cheek")


def _bbox(polygons: list[np.ndarray], shape: tuple[int, int]) -> Box:
    pts = np.vstack(polygons)
    x0, y0 = np.floor(pts.min(axis=0)).astype(int)
    x1, y1 = np.ceil(pts.max(axis=0)).astype(int)
    h, w = shape
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w), min(y1, h)
    return Box(int(x0), int(y0), int(x1 - x0), int(y1 - y0))


def _pose_ok(face: Face) -> bool:
    return (
        abs(face.yaw) <= config.MAX_ABS_YAW
        and abs(face.pitch) <= config.MAX_ABS_PITCH
        and abs(face.roll) <= config.MAX_ABS_ROLL
    )


def _frame(path: str, auto_white: bool) -> dict:
    """Everything measured on one photo; raises FaceNotFound."""
    linear, srgb8 = _load(path)
    face = detect_face(srgb8)
    polys = face.roi_polygons()
    face_mask_full = face.skin_mask(srgb8.shape[:2])
    ys, xs = np.nonzero(face_mask_full)
    face_outline = np.array([[xs.min(), ys.min()], [xs.max() + 1, ys.max() + 1]], float)
    box = _bbox([*polys.values(), face_outline], srgb8.shape[:2])  # face area only
    cheek_box = _bbox([polys[c] for c in CHEEKS], srgb8.shape[:2])

    masks = {n: box.crop(polygon_mask(srgb8.shape[:2], p)) for n, p in polys.items()}
    # sharpness/exposure on the cheek area (2-D patch the Laplacian needs)
    quality: FrameQuality = check_frame(
        cheek_box.crop(linear), cheek_box.crop(srgb8), px_per_mm=face.px_per_mm
    )
    if not _pose_ok(face):
        quality.reasons.append("pose_out_of_range")

    white_px = None
    if auto_white:
        try:
            # paper must be held beside the face, level with the cheeks; never use a wall
            # or a shirt (the biggest white thing in a selfie) as the white reference
            white_px = paper_pixels(
                linear,
                srgb8,
                near=cheek_box,
                require_near=True,
                max_gap=config.PAPER_MAX_GAP_FACE_WIDTHS * cheek_box.w,
            )
            paper_lab = linear_srgb_to_lab(np.median(white_px, axis=0))
            if np.hypot(paper_lab[1], paper_lab[2]) > config.PAPER_MAX_CHROMA:
                white_px = None  # beige wall / coloured fabric, not white paper
        except ValueError:
            white_px = None
    lin = box.crop(linear)
    if white_px is not None:
        lin = white_balance(lin, white_px)
    lab = linear_srgb_to_lab(lin)

    skin = {n: m & _skin_tails(lab[..., 0], m) for n, m in masks.items()}
    cheek_skin = skin["right_cheek"] | skin["left_cheek"]
    l_star = float(np.median(lab[..., 0][cheek_skin]))
    b_star = float(np.median(lab[..., 2][cheek_skin]))
    red_skin = np.logical_or.reduce([skin[n] for n in REDNESS_ROIS])
    px_per_mm = face.eye_distance_px / config.EYE_DISTANCE_MM

    evenness, _ = tone_evenness(
        {n: (lab[..., 0], lin[..., 0], skin[n]) for n in EVENNESS_ROIS}, px_per_mm
    )
    # whole-face skin (outline minus eyes, lids, brows, nostrils, lips, hair); used by
    # blemishes next. Dark spots still use the flatter ROIs (see SPOT_ROIS).
    zones = {k: box.crop(v) for k, v in face.feature_zones(srgb8.shape[:2]).items()}
    face_skin = refine_skin(lab[..., 0], box.crop(face_mask_full), zones, px_per_mm)
    spots_pct, spot_extras = pigment_spots(
        {n: (lin[..., 0], skin[n]) for n in SPOT_ROIS}, px_per_mm
    )

    values = {
        "tone_ita": ita_degrees(l_star, b_star),
        "pigment_spots": spots_pct,
        "tone_evenness": evenness,
        "redness": float(np.mean(lab[..., 1][red_skin])),
    }
    extras = {
        "tone_ita": {"l_star": l_star, "b_star": b_star},
        "pigment_spots": spot_extras,
        "tone_evenness": {},
        "redness": {"erythema_index": erythema_index(lin, red_skin)},
    }
    return {
        "values": values,
        "extras": extras,
        "quality": quality,
        "face": face,
        "polygons": polys,
        "shape": srgb8.shape,
        "white_ok": white_px is not None,
        "face_skin": (box, face_skin),
    }


def _skin_tails(l_star: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Drop the ROI's own darkest 1% and brightest 1% (shadow, shine, stray hair)."""
    lo, hi = np.percentile(l_star[mask], [config.SKIN_LOW_PCT, config.SKIN_HIGH_PCT])
    return (l_star >= lo) & (l_star <= hi)


def analyze_face(
    files: list[str],
    session_id: str = "s_local",
    user_id: str = "local",
    baseline: dict | None = None,
    auto_white: bool = True,
) -> dict:
    """Analyze 1-5 front-on face photos of one session (site face_full)."""
    t0 = time.perf_counter()
    try:
        mode = capture_mode_for(files)
    except ValueError as exc:
        raise EngineError("bad_request", str(exc)) from exc
    confidence = "measured" if mode == "calibrated_raw" else "indicative"

    per_frame, frames, warnings = [], [], []
    for i, path in enumerate(files):
        try:
            f = _frame(path, auto_white)
        except FaceNotFound:
            per_frame.append({"index": i, "passed": False, "reasons": ["face_not_found"]})
            continue
        frames.append(f)
        q = f["quality"]
        per_frame.append({"index": i, "passed": q.passed, "reasons": q.reasons})
    good = [f for f in frames if f["quality"].passed]

    metrics = []
    for metric_id, (group, label, unit) in METRIC_INFO.items():
        base = (baseline or {}).get(metric_id)
        if good:
            summary = summarize([f["values"][metric_id] for f in good], base)
            extras = _mean_extras([f["extras"][metric_id] for f in good])
            if metric_id == "tone_ita":
                extras["ita_band"] = ita_band(summary["value"])
            if metric_id == "pigment_spots":
                extras["count"] = round(extras.get("count", 0))
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
    if not good:
        reasons.append("too_few_frames")
    if mode == "uncalibrated":
        warnings.insert(0, "uncalibrated photo: results are a trend only, not a measurement")
    else:
        warnings.insert(0, "no colour card: colours corrected with the white paper only")
    if frames and not all(f["white_ok"] for f in frames):
        warnings.append(
            "no white paper held beside the face in some photos: light colour not corrected"
        )

    ref = frames[0] if frames else None
    qs = [f["quality"] for f in frames]
    result = {
        "schema_version": "1.0",
        "engine_version": config.ENGINE_VERSION,
        "session_id": session_id,
        "user_id": user_id,
        "site": "face_full",
        "capture_mode": mode,
        "frames_used": len(good),
        "quality": {
            "passed": bool(good),
            "card_detected": False,
            "card_delta_e_mean": None,
            "sharpness": round(float(np.mean([q.sharpness for q in qs])), 1) if qs else None,
            "clipped_pct": round(float(np.mean([q.clipped_pct for q in qs])), 2) if qs else None,
            "pose": (
                {
                    k: round(float(np.mean([getattr(f["face"], k) for f in frames])), 1)
                    for k in ("yaw", "pitch", "roll")
                }
                if frames
                else None
            ),
            "per_frame": per_frame,
            "reasons": reasons,
        },
        "metrics": metrics,
        "candidates": [],
        "overlays": [],
        # ROIs of the first photo; cross-frame alignment comes with overlays
        "rois": (
            [{"name": n, "polygon": np.round(p, 1).tolist()} for n, p in ref["polygons"].items()]
            if ref
            else []
        ),
        "timings_ms": {"total": round((time.perf_counter() - t0) * 1000, 1)},
        "warnings": warnings,
    }
    if ref:
        result["image_size"] = {"width": int(ref["shape"][1]), "height": int(ref["shape"][0])}
    validate(result, json.loads(SCHEMA.read_text()))
    return result
