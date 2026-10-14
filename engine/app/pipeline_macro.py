"""Close-up sites (cheek_macro, nose_macro; docs/METRICS.md A5, A6, B2): a phone macro shot of
one patch of skin, no face landmarks. Skin is found by colour; scale comes from the width of
skin a close-up covers (MACRO_FIELD_WIDTH_MM, measured once with scripts/macro_scale.py).

cheek_macro: tone_ita, pigment_spots, redness, blemishes, pores, texture
nose_macro : blemishes (extras: blackheads), pores
"""

import dataclasses
import json
import time
from types import SimpleNamespace

import cv2
import numpy as np
from jsonschema import validate

from app import config
from app.aggregate import summarize
from app.color import linear_srgb_to_lab
from app.errors import EngineError
from app.io import save_preview
from app.landmarks import skin_colour
from app.metrics.blemish import find_blemishes
from app.metrics.pigment import find_spots, pigment_spots
from app.metrics.pores import blackheads, find_pores, pores_per_cm2
from app.metrics.redness import erythema_index
from app.metrics.texture import texture
from app.metrics.tone import ita_band, ita_degrees
from app.pipeline import SCHEMA, _load, _mean_extras, capture_mode_for
from app.pipeline_face import _candidates
from app.quality import check_frame, laplacian_variance
from app.roi import Box

MACRO_SITES = {"cheek_macro", "nose_macro"}
METRIC_INFO = {  # id -> (group, label, unit), docs/CONTRACT.md 2.5
    "tone_ita": ("tone_pigment", "Skin tone (ITA)", "deg"),
    "pigment_spots": ("tone_pigment", "Dark spots", "pct_area"),
    "redness": ("redness", "Redness", "a_star"),
    "blemishes": ("clarity", "Blemishes", "count"),
    "pores": ("texture_pores", "Pores", "per_cm2"),
    "texture": ("texture_pores", "Texture", "index"),
}
SITE_METRICS = {
    "cheek_macro": ("tone_ita", "pigment_spots", "redness", "blemishes", "pores", "texture"),
    "nose_macro": ("blemishes", "pores"),
}
SCALE_METRICS = {"pores", "texture"}  # need the mm scale; measured only once it is calibrated


def _skin(lab: np.ndarray, px_per_mm: float) -> np.ndarray:
    """Skin by colour, judged against the middle of the photo (where the close-up points):
    drops hair, background, the cone rim and glare; keeps marks and pores (small holes
    are refilled)."""
    h, w = lab.shape[:2]
    e = round(config.MACRO_EDGE_FRAC * min(h, w))
    inner = np.zeros((h, w), bool)
    inner[e : h - e, e : w - e] = True
    ref = np.zeros_like(inner)
    ref[int(0.3 * h) : int(0.7 * h), int(0.3 * w) : int(0.7 * w)] = True
    return skin_colour(lab, inner, ref, px_per_mm)


def _scaled(mark, back: float):
    """A blemish / spot found at the working scale, in full-photo pixels."""
    return dataclasses.replace(
        mark,
        x=mark.x * back,
        y=mark.y * back,
        radius=mark.radius * back,
        area_px=round(mark.area_px * back * back),
    )


def _frame(path: str, site: str) -> dict:
    linear, srgb8 = _load(path)
    h, w = srgb8.shape[:2]
    px_full = max(h, w) / config.MACRO_FIELD_WIDTH_MM
    scale = min(config.MACRO_WORK_PX_PER_MM / px_full, 1.0)
    size = (max(round(w * scale), 1), max(round(h * scale), 1))
    lin = cv2.resize(linear.astype(np.float32), size, interpolation=cv2.INTER_AREA)
    s8 = cv2.resize(srgb8, size, interpolation=cv2.INTER_AREA)
    px, back = px_full * scale, 1.0 / scale
    lab = linear_srgb_to_lab(lin)
    skin = _skin(lab, px)

    quality = check_frame(lin, s8, None, skin)  # exposure on the skin
    quality.reasons = [r for r in quality.reasons if r != "blurry"]
    grey = cv2.cvtColor(s8, cv2.COLOR_RGB2GRAY).astype(np.float32)
    quality.sharpness = laplacian_variance(grey)  # at the working scale (pores need detail)
    if quality.sharpness < config.MACRO_SHARPNESS_MIN:
        quality.reasons.append("blurry")
    if skin.sum() / px**2 / 100.0 < config.MACRO_MIN_SKIN_CM2:
        quality.reasons.append("occlusion_suspected")  # too little skin in the close-up

    blems_w = find_blemishes(lab, skin, px)
    spots_w = find_spots(lab, skin, skin, px) if site == "cheek_macro" else []
    # pores and texture need detail the photo may not have (an internet-sized crop)
    detailed = px_full >= config.MACRO_MIN_PX_PER_MM
    pores = find_pores(lab, skin, px, [*blems_w, *spots_w]) if detailed else []
    pores_val, pores_extras = pores_per_cm2(pores, int(skin.sum()), px) if detailed else (None, {})
    blems = [_scaled(b, back) for b in blems_w]
    values, extras = {}, {}
    if site == "cheek_macro":
        spots = [_scaled(s, back) for s in spots_w]
        l_star = float(np.median(lab[..., 0][skin])) if skin.any() else 0.0
        b_star = float(np.median(lab[..., 2][skin])) if skin.any() else 0.0
        spot_pct, spot_extras = pigment_spots(spots, round(int(skin.sum()) * back * back))
        values.update(
            tone_ita=ita_degrees(l_star, b_star),
            pigment_spots=spot_pct,
            redness=float(np.median(lab[..., 1][skin])) if skin.any() else None,
            texture=texture(lab, skin, px) if detailed else None,
        )
        extras.update(
            tone_ita={"l_star": l_star, "b_star": b_star},
            pigment_spots=spot_extras,
            redness={"erythema_index": erythema_index(lin, skin)},
            texture={},
        )
    else:
        spots = []
    values.update(blemishes=float(len(blems)), pores=pores_val)
    extras.update(
        blemishes={"blackheads": blackheads(pores)} if site == "nose_macro" else {},
        pores=pores_extras,
    )
    contour = max(
        cv2.findContours(skin.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0],
        key=cv2.contourArea,
        default=None,
    )
    return {
        "values": values,
        "extras": extras,
        "quality": quality,
        "srgb8": srgb8,
        "shape": srgb8.shape,
        "box": Box(0, 0, w, h),
        "face": SimpleNamespace(px_per_mm=px_full),  # what _candidates reads
        "blemishes": blems,
        "spots": spots,
        "skin_outline": None if contour is None else contour.reshape(-1, 2) * back,
        "detailed": detailed,
    }


def analyze_macro(
    files: list[str],
    site: str,
    session_id: str = "s_local",
    user_id: str = "local",
    baseline: dict | None = None,
    output_prefix: str | None = None,
    max_candidates: int = 40,
) -> dict:
    """Analyze 1-5 close-ups of the same patch of skin (site cheek_macro or nose_macro)."""
    if site not in MACRO_SITES:
        raise EngineError("bad_request", f"macro pipeline got site {site!r}")
    t0 = time.perf_counter()
    try:
        mode = capture_mode_for(files)
    except ValueError as exc:
        raise EngineError("bad_request", str(exc)) from exc

    frames, per_frame = [], []
    for i, path in enumerate(files):
        f = _frame(path, site)
        f["index"] = i
        frames.append(f)
        per_frame.append(
            {"index": i, "passed": f["quality"].passed, "reasons": f["quality"].reasons}
        )
    good = sorted((f for f in frames if f["quality"].passed), key=lambda f: -f["quality"].sharpness)

    metrics = []
    for metric_id in SITE_METRICS[site]:
        group, label, unit = METRIC_INFO[metric_id]
        base = (baseline or {}).get(metric_id)
        have = [f for f in good if f["values"].get(metric_id) is not None]
        if have:
            summary = summarize(
                [f["values"][metric_id] for f in have], base, config.MIN_SD.get(metric_id, 0.0)
            )
            extras = _mean_extras([f["extras"][metric_id] for f in have])
            if metric_id == "tone_ita":
                extras["ita_band"] = ita_band(summary["value"])
            for k in ("count", "blackheads"):
                if k in extras:
                    extras[k] = round(extras[k])
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
        # colours: no colour reference in a close-up (as faces); blemishes are always
        # indicative; pores and texture are measured once the mm scale is calibrated, and
        # texture drops to indicative when its noise band is over 25% of its value
        measured = metric_id in SCALE_METRICS and config.MACRO_SCALE_CALIBRATED
        if metric_id == "texture" and summary["mdc95"] is not None and summary["value"]:
            measured &= summary["mdc95"] <= config.TEXTURE_MAX_MDC_FRAC * abs(summary["value"])
        metrics.append(
            {
                "id": metric_id,
                "group": group,
                "label": label,
                "unit": unit,
                "confidence": "measured" if measured else "indicative",
                **summary,
                "extras": extras,
            }
        )

    reasons = sorted({r for f in per_frame for r in f["reasons"]})
    if not good:
        reasons.append("too_few_frames")
    warnings = [
        "uncalibrated photo: results are a trend only, not a measurement"
        if mode == "uncalibrated"
        else "no colour card: colours as captured by the camera"
    ]
    if not config.MACRO_SCALE_CALIBRATED:
        warnings.append(
            "close-up scale assumed, not measured: pore density, pore size and texture are "
            "comparable between your own sessions taken the same way, not as absolute values"
        )
    if frames and not any(f["detailed"] for f in frames):
        warnings.append(
            "pores and texture need a sharper, closer photo: use the phone's macro mode about "
            "2-3 cm from the skin"
        )
    ref = good[0] if good else (frames[0] if frames else None)
    if ref and output_prefix:
        save_preview(ref["srgb8"], output_prefix)
    candidates = _candidates(good[0], output_prefix, max_candidates) if good else []
    qs = [f["quality"] for f in frames]
    result = {
        "schema_version": "1.0",
        "engine_version": config.ENGINE_VERSION,
        "session_id": session_id,
        "user_id": user_id,
        "site": site,
        "capture_mode": mode,
        "frames_used": len(good),
        "quality": {
            "passed": bool(good),
            "card_detected": False,
            "card_delta_e_mean": None,
            "sharpness": round(float(np.mean([q.sharpness for q in qs])), 1) if qs else None,
            "clipped_pct": round(float(np.mean([q.clipped_pct for q in qs])), 2) if qs else None,
            "pose": None,
            "per_frame": per_frame,
            "reasons": reasons,
        },
        "metrics": metrics,
        "candidates": candidates,
        "overlays": [],
        "rois": (
            [{"name": "skin", "polygon": np.round(ref["skin_outline"], 1).tolist()}]
            if ref is not None and ref["skin_outline"] is not None
            else []
        ),
        "timings_ms": {"total": round((time.perf_counter() - t0) * 1000, 1)},
        "warnings": warnings,
    }
    if ref:
        result["image_size"] = {"width": int(ref["shape"][1]), "height": int(ref["shape"][0])}
    for f in frames:
        f.pop("srgb8", None)
    validate(result, json.loads(SCHEMA.read_text()))
    return result
