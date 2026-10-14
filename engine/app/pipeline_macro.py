"""Close-up sites (docs/METRICS.md A5, A6, B2): a phone photo taken close to one part of the
face. When enough of the face is in view (a nose close-up shows an eye), face landmarks give
the region (cheek or nose; brows, eyes, lips and nostrils left out) and the
iris (CLOSEUP_IRIS_MM across) gives the scale. A pure macro shot with no face in view falls
back to skin by colour over the whole photo and the assumed MACRO_FIELD_WIDTH_MM (measured
once with scripts/macro_scale.py).

cheek_macro   : tone_ita, pigment_spots, redness, blemishes, pores, texture
nose_macro    : blemishes, pores
"""

import dataclasses
import json
import time
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
from jsonschema import validate
from scipy.ndimage import binary_fill_holes

from app import config
from app.aggregate import summarize
from app.color import linear_srgb_to_lab
from app.decode import load_photo_srgb8
from app.errors import EngineError
from app.io import save_preview
from app.landmarks import EYE_OUTER, Face, FaceNotFound, detect_face, polygon_mask, skin_colour
from app.metrics.blemish import find_blemishes
from app.metrics.pigment import find_spots, pigment_spots
from app.metrics.pores import find_pores, pores_per_cm2
from app.metrics.redness import erythema_index
from app.metrics.texture import texture
from app.metrics.tone import ita_band, ita_degrees
from app.pipeline import SCHEMA, _load, _mean_extras, capture_mode_for
from app.pipeline_face import _candidates
from app.quality import check_frame, laplacian_variance
from app.roi import Box

REGIONS = {
    "cheek_macro": "cheek",
    "nose_macro": "nose",
}
MACRO_SITES = set(REGIONS)
# face mesh points the close-up regions are cut along
LOWER_LIDS = (145, 374)  # right, left
MOUTH_CORNERS = (61, 291)
NOSE_WINGS = (129, 358)  # right, left
NO_LANDMARKS = np.full((478, 2), np.nan)
IRIS = ([468, 469, 470, 471, 472], [473, 474, 475, 476, 477])  # centre, then 4 edge points
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


def _edges(shape: tuple[int, int]) -> np.ndarray:
    """All but MACRO_EDGE_FRAC of each photo edge (vignetting, cone rim)."""
    h, w = shape
    e = round(config.MACRO_EDGE_FRAC * min(h, w))
    inner = np.zeros((h, w), bool)
    inner[e : h - e, e : w - e] = True
    return inner


def _skin(lab: np.ndarray, px_per_mm: float) -> np.ndarray:
    """No face in view: skin by colour, judged against the middle of the photo (where the
    close-up points): drops hair, background, the cone rim and glare; keeps marks and pores
    (small holes are refilled)."""
    h, w = lab.shape[:2]
    ref = np.zeros((h, w), bool)
    ref[int(0.3 * h) : int(0.7 * h), int(0.3 * w) : int(0.7 * w)] = True
    return skin_colour(lab, _edges((h, w)), ref, px_per_mm)


def _region_skin(
    lab: np.ndarray, region: np.ndarray, px_per_mm: float, pieces: int = 1, nose: bool = False
) -> np.ndarray:
    """Skin of a landmark region: drops hair (darker AND grey), nostril openings (far darker,
    nose only) and clipped glare. Lit and shaded skin stay (a
    close-up's light falls off across the face), and small dark holes (dark pores, marks,
    moles) are refilled. Keeps the `pieces` largest parts big enough to measure (cheeks: both
    cheeks; a nose's other bits are hair or background)."""
    L = lab[..., 0]
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    med, c_med = float(np.median(L[region])), float(np.median(chroma[region]))
    hair = (L < med - config.CLOSEUP_DARKER_L) & (chroma < config.CLOSEUP_HAIR_CHROMA * c_med)
    keep = region & ~hair & (L <= config.CLOSEUP_CLIPPED_L)
    if nose:  # nostril openings (elsewhere a far darker patch is shaded skin: it keeps colour)
        keep &= L >= med - config.CLOSEUP_NOSTRIL_L
    holes = binary_fill_holes(keep) & ~keep & region
    n, labels, stats, _ = cv2.connectedComponentsWithStats(holes.astype(np.uint8), connectivity=8)
    small = [k for k in range(1, n) if stats[k, cv2.CC_STAT_AREA] < 2.0 * px_per_mm**2]
    keep |= np.isin(labels, small)
    r = max(round(0.3 * px_per_mm), 1)  # loose hair strands
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    keep = cv2.morphologyEx(keep.astype(np.uint8), cv2.MORPH_OPEN, kernel)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(keep, connectivity=8)
    min_px = config.MACRO_MIN_SKIN_CM2 * 100.0 * px_per_mm**2
    big = sorted(range(1, n), key=lambda k: -stats[k, cv2.CC_STAT_AREA])[:pieces]
    big = [k for k in big if stats[k, cv2.CC_STAT_AREA] >= min_px]
    return np.isin(labels, big) & region


def _find_face(srgb8: np.ndarray) -> Face | None:
    """Face landmarks on a close-up. The landmarker needs most of a face in view, so a
    close-up is also tried shrunk onto a plain canvas (CLOSEUP_SHRINK), landmarks mapped
    back (they may then run off the photo)."""
    h, w = srgb8.shape[:2]
    for k in (1.0, *config.CLOSEUP_SHRINK):
        if k == 1.0:
            canvas, x0, y0 = srgb8, 0, 0
        else:
            small = cv2.resize(srgb8, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA)
            canvas = np.empty_like(srgb8)
            canvas[:] = np.median(srgb8.reshape(-1, 3), axis=0).astype(np.uint8)
            y0, x0 = (h - small.shape[0]) // 2, (w - small.shape[1]) // 2
            canvas[y0 : y0 + small.shape[0], x0 : x0 + small.shape[1]] = small
        try:
            face = detect_face(canvas)
        except FaceNotFound:
            continue
        return dataclasses.replace(face, points=(face.points - [x0, y0]) / k)
    return None


def _iris_px_per_mm(face: Face, shape: tuple[int, int]) -> float | None:
    """Scale from the iris nearer the camera (the larger one), if it lies inside the photo."""
    h, w = shape
    best = 0.0
    for idx in IRIS:
        pts = face.points[idx]
        r = float(np.mean(np.hypot(*(pts[1:] - pts[0]).T)))
        x, y = pts[0]
        if r <= x < w - r and r <= y < h - r:
            best = max(best, 2 * r)
    return best / config.CLOSEUP_IRIS_MM if best else None


def _axes(face: Face) -> tuple[np.ndarray, np.ndarray]:
    """Unit vectors in the photo: across the face (right eye -> left eye) and up (chin ->
    forehead)."""
    across = face.points[EYE_OUTER[1]] - face.points[EYE_OUTER[0]]
    up = face.points[10] - face.points[152]
    return across / np.linalg.norm(across), up / np.linalg.norm(up)


def _region(face: Face, region: str, shape: tuple[int, int]) -> np.ndarray:
    """The site's region of the face, without eyes, lids, lips, brows (and their margins)."""
    if region == "nose":  # nostril openings are cut by colour (too dark for skin)
        area = face.nose_mask(shape)
    else:  # cheek: a wide area of the face outline, cut along face lines
        across, up = _axes(face)
        yy, xx = np.mgrid[: shape[0], : shape[1]].astype(np.float32)
        origin = face.points[1]  # nose tip
        s_px = (xx - origin[0]) * across[0] + (yy - origin[1]) * across[1]  # toward left eye
        t_px = (xx - origin[0]) * up[0] + (yy - origin[1]) * up[1]  # toward the forehead

        def s_of(i):
            return float((face.points[i] - origin) @ across)

        def t_of(*idx):
            return float(np.mean([(face.points[i] - origin) @ up for i in idx]))

        # lower lids to mouth corners, side of the nose wing to the face edge
        band = (t_px < t_of(*LOWER_LIDS)) & (t_px > t_of(*MOUTH_CORNERS))
        sides = np.zeros(shape, bool)
        if "right_cheek" in face.cheeks:
            sides |= s_px < s_of(NOSE_WINGS[0])
        if "left_cheek" in face.cheeks:
            sides |= s_px > s_of(NOSE_WINGS[1])
        area = polygon_mask(shape, face.outline()) & band & sides & ~face.nose_mask(shape)
    guard = face.brow_guard(shape) | face.eye_corner_guard(shape)
    return area & face.skin_mask(shape) & ~guard & _edges(shape)


def _scaled(mark, back: float):
    """A blemish / spot found at the working scale, in full-photo pixels."""
    return dataclasses.replace(
        mark,
        x=mark.x * back,
        y=mark.y * back,
        radius=mark.radius * back,
        area_px=round(mark.area_px * back * back),
    )


def _clean_marks(marks: list, skin: np.ndarray, px_per_mm: float) -> list:
    """Drop marks within CLOSEUP_MARK_EDGE_MM of the skin's edge (hairline, ear, lid, lip and
    jaw shadows) and merge overlapping ones (one patch found as several): biggest kept."""
    inside = cv2.distanceTransform(skin.astype(np.uint8), cv2.DIST_L2, 5) / px_per_mm
    h, w = skin.shape
    kept = []
    for m in sorted(marks, key=lambda m: -m.radius):
        y, x = min(int(m.y), h - 1), min(int(m.x), w - 1)
        if inside[y, x] < config.CLOSEUP_MARK_EDGE_MM:
            continue
        if any(np.hypot(m.x - k.x, m.y - k.y) < m.radius + k.radius for k in kept):
            continue
        kept.append(m)
    return kept


def _no_face(srgb8: np.ndarray, site: str) -> dict:
    """A frame that fails as face_not_found: nothing is measured on it."""
    h, w = srgb8.shape[:2]
    quality = SimpleNamespace(
        passed=False, reasons=["face_not_found"], sharpness=0.0, clipped_pct=0.0
    )
    return {
        "values": {m: None for m in SITE_METRICS[site]},
        "extras": {m: {} for m in SITE_METRICS[site]},
        "quality": quality,
        "srgb8": srgb8,
        "shape": srgb8.shape,
        "box": Box(0, 0, w, h),
        "face": SimpleNamespace(px_per_mm=1.0, points=NO_LANDMARKS),
        "blemishes": [],
        "spots": [],
        "skin_outlines": [],
        "detailed": False,
        "textured": False,
        "face_found": False,
        "enough_skin": False,
        "scale_from": "unknown",
        "px_per_mm": 0.0,
    }


def _front_camera(path: str) -> bool:
    """A selfie-camera photo (from its lens EXIF): it cannot be a macro shot."""
    if Path(path).suffix.lower() == ".dng":
        return False
    return "front" in (load_photo_srgb8(path)[1].lens or "").lower()  # already decoded once


def _frame(path: str, site: str) -> dict:
    linear, srgb8 = _load(path)
    h, w = srgb8.shape[:2]
    face = _find_face(srgb8)
    iris = _iris_px_per_mm(face, (h, w)) if face is not None else None
    if iris is not None:
        px_full, scale_from = iris, "iris"
    elif face is not None:
        px_full, scale_from = face.px_per_mm, "face"  # eyes out of view: the mesh's size
    elif _front_camera(path):  # no face and no macro: neither the region nor the scale known
        return _no_face(srgb8, site)
    else:
        px_full, scale_from = max(h, w) / config.MACRO_FIELD_WIDTH_MM, "assumed"
    scale = min(config.MACRO_WORK_PX_PER_MM / px_full, 1.0)
    size = (max(round(w * scale), 1), max(round(h * scale), 1))
    lin = cv2.resize(linear.astype(np.float32), size, interpolation=cv2.INTER_AREA)
    s8 = cv2.resize(srgb8, size, interpolation=cv2.INTER_AREA)
    px, back = px_full * scale, 1.0 / scale
    lab = linear_srgb_to_lab(lin)
    if face is not None:  # the site's region; hair, nostrils and background cut by colour
        region = _region(
            dataclasses.replace(face, points=face.points * scale), REGIONS[site], lab.shape[:2]
        )
        pieces = 4 if REGIONS[site] == "cheek" else 1  # cheeks: both, even if split by a crease
        nose = REGIONS[site] == "nose"
        skin = _region_skin(lab, region, px, pieces, nose) if region.any() else region
    else:
        skin = _skin(lab, px)

    quality = check_frame(lin, s8, None, skin)  # exposure on the skin
    quality.reasons = [r for r in quality.reasons if r != "blurry"]
    grey = cv2.cvtColor(s8, cv2.COLOR_RGB2GRAY).astype(np.float32)
    quality.sharpness = laplacian_variance(grey)  # at the working scale (pores need detail)
    if quality.sharpness < config.MACRO_SHARPNESS_MIN:
        quality.reasons.append("blurry")
    enough = skin.sum() / px**2 / 100.0 >= config.MACRO_MIN_SKIN_CM2
    if not enough:  # too little skin (or none of the site's region) in the close-up
        quality.reasons.append("occlusion_suspected")
        skin = np.zeros_like(skin)  # the photo fails; nothing is measured on it

    blems_w = _clean_marks(find_blemishes(lab, skin, px), skin, px) if enough else []
    spots_w = (
        _clean_marks(find_spots(lab, skin, skin, px), skin, px)
        if site == "cheek_macro" and enough
        else []
    )
    # pores need detail the photo may not have (taken too far away); texture, at a coarser
    # scale, much less. A guessed scale may be far off for a photo that is not a real macro
    # shot: stricter
    assumed = scale_from == "assumed"
    min_px = config.MACRO_MIN_PX_ASSUMED if assumed else config.MACRO_MIN_PX_PER_MM
    detailed = enough and px_full >= min_px
    min_tex = config.MACRO_MIN_PX_ASSUMED if assumed else config.TEXTURE_MIN_PX_PER_MM
    textured = enough and px_full >= min_tex
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
            tone_ita=ita_degrees(l_star, b_star) if enough else None,
            pigment_spots=spot_pct if enough else None,
            redness=float(np.median(lab[..., 1][skin])) if skin.any() else None,
            texture=texture(lab, skin, px) if textured else None,
        )
        extras.update(
            tone_ita={"l_star": l_star, "b_star": b_star},
            pigment_spots=spot_extras,
            redness={"erythema_index": erythema_index(lin, skin)} if enough else {},
            texture={},
        )
    else:
        spots = []
        if "texture" in SITE_METRICS[site]:
            values["texture"] = texture(lab, skin, px) if textured else None
            extras["texture"] = {}
    values.update(blemishes=float(len(blems)), pores=pores_val)
    extras.update(
        blemishes={},
        pores=pores_extras,
    )
    contours = cv2.findContours(skin.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[
        0
    ]
    min_px = config.MACRO_MIN_SKIN_CM2 * 100.0 * px**2  # each measured piece (both cheeks)
    outlines = [c.reshape(-1, 2) * back for c in contours if cv2.contourArea(c) >= min_px]
    return {
        "values": values,
        "extras": extras,
        "quality": quality,
        "srgb8": srgb8,
        "shape": srgb8.shape,
        "box": Box(0, 0, w, h),
        # what _candidates reads: the scale, and landmarks to place marks on the face map
        # (none in a pure macro shot: NaN points place nothing)
        "face": SimpleNamespace(
            px_per_mm=px_full, points=face.points if face is not None else NO_LANDMARKS
        ),
        "blemishes": blems,
        "spots": spots,
        "skin_outlines": outlines,
        "detailed": detailed,
        "textured": textured,
        "face_found": face is not None,
        "enough_skin": enough,
        "scale_from": scale_from,
        "px_per_mm": px_full,
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
            for k in ("count",):
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
        if metric_id in SCALE_METRICS and have:
            extras["px_per_mm"] = round(have[0]["px_per_mm"], 1)
            extras["scale_from"] = have[0]["scale_from"]
        # colours: no colour reference in a close-up (as faces); blemishes are always
        # indicative; pores and texture are measured when the mm scale is (the iris, or a
        # calibrated close-up), and texture drops to indicative when its noise band is over
        # 25% of its value
        measured = metric_id in SCALE_METRICS and bool(have) and _scale_known(have[0])
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
    if any(not _scale_known(f) for f in good):
        warnings.append(
            "close-up scale assumed, not measured: pore density, pore size and texture are "
            "comparable between your own sessions taken the same way, not as absolute values"
        )
    if any(f["enough_skin"] for f in frames) and not any(f["detailed"] for f in frames):
        what = "pores need" if any(f["textured"] for f in frames) else "pores and texture need"
        warnings.append(
            f"{what} a closer photo: hold the phone about a hand's width from your face, or closer"
        )
    if frames and all(f["scale_from"] == "unknown" for f in frames):
        warnings.append(
            "face not found in the selfie close-up: keep your nose and at least one eye in the "
            "photo so the area and its size can be measured"
        )
    if frames and all(f["face_found"] and not f["enough_skin"] for f in frames):
        warnings.append(f"no {REGIONS[site]} skin found in the photos")
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
        "rois": [
            {"name": REGIONS[site], "polygon": np.round(outline, 1).tolist()}
            for outline in (ref["skin_outlines"] if ref is not None else [])
        ],
        "timings_ms": {"total": round((time.perf_counter() - t0) * 1000, 1)},
        "warnings": warnings,
    }
    if ref:
        result["image_size"] = {"width": int(ref["shape"][1]), "height": int(ref["shape"][0])}
    for f in frames:
        f.pop("srgb8", None)
    validate(result, json.loads(SCHEMA.read_text()))
    return result


def _scale_known(frame: dict) -> bool:
    return frame["scale_from"] == "iris" or (
        frame["scale_from"] == "assumed" and config.MACRO_SCALE_CALIBRATED
    )
