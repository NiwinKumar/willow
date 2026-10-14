"""face_full analysis (M2): landmarks -> ROIs + face skin mask -> Lab -> A-tier face metrics."""

import json
import time

import cv2
import numpy as np
from jsonschema import validate

from app import config
from app.aggregate import summarize
from app.align import residual_px, similarity, transform
from app.color import linear_srgb_to_lab
from app.errors import EngineError
from app.io import save_jpeg
from app.landmarks import (
    Face,
    FaceNotFound,
    detect_face,
    edge_hair,
    polygon_mask,
    refine_skin,
    skin_colour,
)
from app.metrics.blemish import find_blemishes
from app.metrics.evenness import tone_evenness
from app.metrics.glow import glow
from app.metrics.lines import lines
from app.metrics.pigment import find_spots, pigment_spots
from app.metrics.redness import erythema_index
from app.metrics.shine import shine
from app.metrics.tone import ita_band, ita_degrees
from app.pipeline import SCHEMA, _load, _mean_extras, capture_mode_for
from app.quality import FrameQuality, check_frame
from app.roi import Box

METRIC_INFO = {  # id -> (group, label, unit), docs/CONTRACT.md 2.5
    "tone_ita": ("tone_pigment", "Skin tone (ITA)", "deg"),
    "pigment_spots": ("tone_pigment", "Dark spots", "pct_area"),
    "tone_evenness": ("tone_pigment", "Tone evenness", "index"),
    "redness": ("redness", "Redness", "a_star"),
    "blemishes": ("clarity", "Blemishes", "count"),
    "shine": ("oil_glow", "Shine", "pct_area"),
    "lines": ("lines", "Lines", "index"),
    "glow": ("oil_glow", "Glow", "index"),
}
ALWAYS_INDICATIVE = {"blemishes", "shine", "lines", "glow"}  # docs/CONTRACT.md 2.5
EVENNESS_ROIS = ("forehead", "right_cheek", "left_cheek", "nose", "chin")
REDNESS_ROIS = ("right_cheek", "left_cheek", "nose")


def _bbox(polygons: list[np.ndarray], shape: tuple[int, int]) -> Box:
    pts = np.vstack(polygons)
    x0, y0 = np.floor(pts.min(axis=0)).astype(int)
    x1, y1 = np.ceil(pts.max(axis=0)).astype(int)
    h, w = shape
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w), min(y1, h)
    return Box(int(x0), int(y0), int(x1 - x0), int(y1 - y0))


def _pose_ok(face: Face) -> bool:
    if face.view == "front":
        return abs(face.pitch) <= config.MAX_ABS_PITCH and abs(face.roll) <= config.MAX_ABS_ROLL
    return (  # side / three-quarter view: the visible half is analysed
        abs(face.yaw) <= config.SIDE_MAX_YAW
        and abs(face.pitch) <= config.SIDE_MAX_PITCH
        and abs(face.roll) <= config.SIDE_MAX_ROLL
    )


def _rois(face: Face, names: tuple[str, ...]) -> tuple[str, ...]:
    """The ROIs of `names` this view shows (side views: the cheek facing the camera)."""
    return names if face.view == "front" else face.cheeks


def _frame(path: str) -> dict:
    """Everything measured on one photo; raises FaceNotFound."""
    linear, srgb8 = _load(path)
    face = detect_face(srgb8)
    polys = face.roi_polygons()
    face_mask_full = face.skin_mask(srgb8.shape[:2])
    ys, xs = np.nonzero(face_mask_full)
    face_outline = np.array([[xs.min(), ys.min()], [xs.max() + 1, ys.max() + 1]], float)
    box = _bbox([*polys.values(), face_outline], srgb8.shape[:2])  # face area only
    cheek_box = _bbox([polys[c] for c in face.cheeks], srgb8.shape[:2])

    masks = {n: box.crop(polygon_mask(srgb8.shape[:2], p)) for n, p in polys.items()}
    # sharpness/exposure on the cheek area (2-D patch the Laplacian needs)
    cheek_mask = cheek_box.crop(
        np.logical_or.reduce([polygon_mask(srgb8.shape[:2], polys[c]) for c in face.cheeks])
    )
    quality: FrameQuality = check_frame(
        cheek_box.crop(linear), cheek_box.crop(srgb8), px_per_mm=face.px_per_mm, skin=cheek_mask
    )
    if not _pose_ok(face):
        quality.reasons.append("pose_out_of_range")

    # colours as the phone captured them: users do not hold a white reference
    lin = box.crop(linear)
    lab = linear_srgb_to_lab(lin)

    skin = {n: m & _skin_tails(lab[..., 0], m) for n, m in masks.items()}
    cheek_skin = np.logical_or.reduce([skin[c] for c in face.cheeks])
    l_star = float(np.median(lab[..., 0][cheek_skin]))
    b_star = float(np.median(lab[..., 2][cheek_skin]))
    red_skin = np.logical_or.reduce([skin[n] for n in _rois(face, REDNESS_ROIS)])
    px_per_mm = face.px_per_mm

    evenness, _ = tone_evenness(
        {n: (lab[..., 0], lin[..., 0], skin[n]) for n in _rois(face, EVENNESS_ROIS)}, px_per_mm
    )
    # whole-face skin (outline minus eyes, lids, brows, nostrils, lips, hair) for blemishes
    # and dark spots
    zones = {k: box.crop(v) for k, v in face.feature_zones(srgb8.shape[:2]).items()}
    face_skin = refine_skin(
        lab[..., 0], box.crop(face_mask_full), zones, px_per_mm, np.hypot(lab[..., 1], lab[..., 2])
    )
    # shine: highlights are bright and grey, so measure on skin before the side-view colour
    # cut (which drops shine); hair is already cut
    all_polys = face.all_roi_polygons()
    t_zone = box.crop(face.t_zone_mask(srgb8.shape[:2])) & face_skin
    u_zone = face_skin & np.logical_or.reduce(
        [
            box.crop(polygon_mask(srgb8.shape[:2], all_polys[c]))
            for c in ("right_cheek", "left_cheek")
        ]
    )
    shine_pct, shine_extras = shine(lab, lin, t_zone, u_zone, px_per_mm)
    if face.view != "front":  # hair, background and shine crowd a turned cheek
        face_skin = skin_colour(lab, face_skin, cheek_skin, px_per_mm)
        # sideburns and temple hair beside the ear (beards: the lower-face stubble test in
        # refine_skin). A dark-speck density test is not used here: dense acne marks on
        # deep skin look the same and were cut.
        ear = face.ear_side(face_skin.shape, (box.x, box.y))
        face_skin &= ~edge_hair(lab, face_skin, cheek_skin, px_per_mm, ear)
    # both searches skip the band where hair, jaw shadow or background meet skin and the
    # brows and eye corners; dark spots also skip the glabella, the lip / nostril edges and
    # mouth corners (shading; it is not red, so blemishes there still count). Full face skin is still "nearby skin".
    # eyes, lids, lips and nostrils cut from the skin: inside the face, not its edge
    face_full = box.crop(face_mask_full)
    outline = box.crop(polygon_mask(srgb8.shape[:2], face.outline()))
    features = (outline & ~face_full) | zones["nostril_zone"]
    # blemishes: band inside every outer edge, eye / lip cut-outs included (red lid and lip
    # rims reach there). Dark spots: band inside the hair / background edge only, so a dark
    # mark beside the nose or lips (a mole) is not cut off.
    band = face.border_band(face_skin, (box.x, box.y))
    spot_band = face.border_band(face_skin, (box.x, box.y), features=features)
    brows = box.crop(face.brow_guard(srgb8.shape[:2]))
    eye_corners = box.crop(face.eye_corner_guard(srgb8.shape[:2]))
    # a turned nose: shine and redness on its tip and wings are not blemishes
    side_nose = np.zeros_like(face_skin)
    if face.view != "front":
        side_nose = box.crop(face.nose_mask(srgb8.shape[:2]))
    lip_edge = box.crop(face.lip_band(srgb8.shape[:2], config.BLEMISH_LIP_GUARD_MM))
    # blemishes over the whole face skin, skipping a thin band around the nostrils, whose
    # red crease looks like a spot
    guard = cv2.dilate(
        zones["nostril_zone"].astype(np.uint8), face._disk(config.NOSTRIL_GUARD_MM)
    ).astype(bool)
    blemishes = find_blemishes(
        lab,
        face_skin,
        px_per_mm,
        search=face_skin & ~guard & ~band & ~brows & ~eye_corners & ~lip_edge & ~side_nose,
    )
    # dark spots over the whole face skin, away from shadow-prone areas and from spots
    # already counted as blemishes (a red-brown mark is one thing, not two)
    spot_edge = box.crop(face.edge_guard(srgb8.shape[:2])) | spot_band
    search = face_skin & ~spot_edge & ~box.crop(face.shadow_guard(srgb8.shape[:2]))
    # just inside the hairline, skin darkens toward the hair and fine hairs remain: a dark
    # spot there must stand out more (a real mark near the hairline still counts)
    strict = face.border_band(
        face_skin, (box.x, box.y), config.HAIRLINE_STRICT_MM, features=features
    )
    gap = config.BLEMISH_MERGE_MM * px_per_mm
    spots = [
        sp
        for sp in find_spots(lab, face_skin, search, px_per_mm, strict=strict, outline=outline)
        if all(np.hypot(sp.x - b.x, sp.y - b.y) > gap for b in blemishes)
    ]
    # lines: forehead band, crow's feet and nasolabial folds, on the face skin
    line_regions = {"forehead": all_polys["forehead"], **face.line_polygons()}
    line_masks = {
        n: box.crop(polygon_mask(srgb8.shape[:2], q)) & face_skin for n, q in line_regions.items()
    }
    glow_idx, glow_extras = glow(lab, lin, cheek_skin, px_per_mm)
    lines_idx, lines_extras = lines(
        lab, line_masks, [*blemishes, *spots], px_per_mm, face.expression
    )
    spots_pct, spot_extras = pigment_spots(spots, int(face_skin.sum()))

    values = {
        "tone_ita": ita_degrees(l_star, b_star),
        "pigment_spots": spots_pct,
        "tone_evenness": evenness,
        "redness": float(np.mean(lab[..., 1][red_skin])),
        "blemishes": float(len(blemishes)),
        "shine": shine_pct,
        "lines": lines_idx,
        "glow": glow_idx,
    }
    extras = {
        "tone_ita": {"l_star": l_star, "b_star": b_star},
        "pigment_spots": spot_extras,
        "tone_evenness": {},
        "redness": {"erythema_index": erythema_index(lin, red_skin)},
        "blemishes": {},
        "shine": shine_extras,
        "lines": lines_extras,
        "glow": glow_extras,
    }
    return {
        "values": values,
        "extras": extras,
        "quality": quality,
        "face": face,
        "view": face.view,
        "polygons": polys,
        "shape": srgb8.shape,
        "face_skin": (box, face_skin),
        "blemishes": blemishes,
        "spots": spots,
        "box": box,
        "srgb8": srgb8,
    }


def _marks(frame: dict) -> np.ndarray:
    """(N, 2) photo-pixel centres of a frame's blemishes then dark spots."""
    box = frame["box"]
    pts = [(box.x + m.x, box.y + m.y) for m in (*frame["blemishes"], *frame["spots"])]
    return np.array(pts, float).reshape(-1, 2)


def _align(ref: dict, others: list[dict]) -> tuple[list[np.ndarray], list[str]]:
    """Map each other photo of the session onto the reference photo (docs/METRICS.md step 7):
    a shift / rotation / scale fitted on rigid landmarks. Returns, per other photo, its
    marks in reference-photo pixels (empty when the photos could not be lined up), and
    warnings for photos whose landmarks still differ by more than ALIGN_WARN_MM."""
    mapped, warnings = [], []
    ref_pts, mm = ref["face"].points, ref["face"].px_per_mm
    for f in others:
        try:
            m = similarity(f["face"].points, ref_pts)
        except ValueError:
            mapped.append(np.empty((0, 2)))
            warnings.append(f"photo {f['index'] + 1} could not be lined up with photo 1")
            continue
        if residual_px(f["face"].points, ref_pts, m) > config.ALIGN_WARN_MM * mm:
            warnings.append(
                f"photo {f['index'] + 1} lines up poorly with photo 1 (face moved or changed "
                "expression): spot matching across photos is less reliable"
            )
        mapped.append(transform(m, _marks(f)))
    return mapped, warnings


def _seen_in(ref: dict, mapped: list[np.ndarray]) -> list[float]:
    """For each mark of the reference photo, the share of the session's photos (itself
    included) with a blemish or spot within ALIGN_MATCH_MM of it. A real mark is in every
    photo; grain, glints and stray hairs usually are in one."""
    gap = config.ALIGN_MATCH_MM * ref["face"].px_per_mm
    out = []
    for p in _marks(ref):
        hits = 1 + sum(bool(len(o)) and float(np.min(np.hypot(*(o - p).T))) <= gap for o in mapped)
        out.append(round(hits / (1 + len(mapped)), 2))
    return out


def _candidates(
    frame: dict, output_prefix: str | None, limit: int, seen: list[float] | None = None
) -> list[dict]:
    """Contract candidates (docs/CONTRACT.md 2.6), blemishes then dark spots of one photo:
    bbox in photo pixels, plus a crop and a 3x context crop for Gemini to label."""
    box, srgb8 = frame["box"], frame["srgb8"]
    h, w = srgb8.shape[:2]
    found = [("blemish", b) for b in frame["blemishes"]] + [("spot", s) for s in frame["spots"]]
    out = []
    for i, (kind, b) in enumerate(found[:limit], start=1):
        cid = f"c_{i:03d}"
        cx, cy = box.x + b.x, box.y + b.y
        side = 2 * b.radius * 1.5
        bbox = [round(cx - side / 2, 1), round(cy - side / 2, 1), round(side, 1), round(side, 1)]
        crop_side = int(np.clip(side * 2, *config.CROP_SIZE_PX))
        crops = {}
        for key, size in (
            ("crop_uri", crop_side),
            ("context_crop_uri", crop_side * config.CROP_CONTEXT),
        ):
            x0, y0 = int(max(cx - size / 2, 0)), int(max(cy - size / 2, 0))
            patch = np.ascontiguousarray(srgb8[y0 : min(y0 + size, h), x0 : min(x0 + size, w)])
            suffix = "" if key == "crop_uri" else "_ctx"
            crops[key] = (
                save_jpeg(patch, f"{output_prefix.rstrip('/')}/crops/{cid}{suffix}.jpg")
                if output_prefix
                else None
            )
        out.append(
            {
                "id": cid,
                "kind": kind,
                "bbox": bbox,
                **crops,
                "features": {
                    **(
                        {"a_star_contrast": round(b.a_star_contrast, 2)}
                        if kind == "blemish"
                        else {"chroma_change": round(b.chroma_change, 2)}
                    ),
                    "l_star_contrast": round(b.l_star_contrast, 2),
                    "area_px": float(b.area_px),
                    "score": round(b.score, 2),
                    **({"seen_in_fraction": seen[i - 1]} if seen else {}),
                },
            }
        )
    return out


def _skin_tails(l_star: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Drop the ROI's own darkest 1% and brightest 1% (shadow, shine, stray hair)."""
    lo, hi = np.percentile(l_star[mask], [config.SKIN_LOW_PCT, config.SKIN_HIGH_PCT])
    return (l_star >= lo) & (l_star <= hi)


def analyze_face(
    files: list[str],
    session_id: str = "s_local",
    user_id: str = "local",
    baseline: dict | None = None,
    output_prefix: str | None = None,
    max_candidates: int = 40,
) -> dict:
    """Analyze 1-5 front-on face photos of one session (site face_full).

    Blemish candidates (with crops when output_prefix is given) come from the first photo
    that passed the quality checks.
    """
    t0 = time.perf_counter()
    try:
        mode = capture_mode_for(files)
    except ValueError as exc:
        raise EngineError("bad_request", str(exc)) from exc
    confidence = "measured" if mode == "calibrated_raw" else "indicative"

    per_frame, frames, warnings = [], [], []
    for i, path in enumerate(files):
        try:
            f = _frame(path)
        except FaceNotFound:
            per_frame.append({"index": i, "passed": False, "reasons": ["face_not_found"]})
            continue
        f["index"] = i
        frames.append(f)
        q = f["quality"]
        per_frame.append({"index": i, "passed": q.passed, "reasons": q.reasons})
    passed = [f for f in frames if f["quality"].passed]
    # one view per summary: front photos if any passed, else the side views (each measures
    # different skin, so they are not averaged together)
    good = [f for f in passed if f["view"] == "front"] or passed

    metrics = []
    for metric_id, (group, label, unit) in METRIC_INFO.items():
        base = (baseline or {}).get(metric_id)
        # photos that measured this metric (shine needs enough T-zone skin)
        has = [f for f in good if f["values"][metric_id] is not None]
        if has:
            summary = summarize([f["values"][metric_id] for f in has], base)
            extras = _mean_extras([f["extras"][metric_id] for f in has])
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
                "confidence": "indicative" if metric_id in ALWAYS_INDICATIVE else confidence,
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
        warnings.insert(0, "no colour card: colours as captured by the camera")

    sides = sorted({f["view"] for f in good if f["view"] != "front"})
    if sides:
        warnings.append(
            "side view: measured on the visible side of the face only ("
            + " and ".join(f"{v} cheek" for v in sides)
            + "); tone, redness and evenness come from that cheek"
        )
    if len(good) < len(passed):
        warnings.append("side views were left out: front-view photos in the same session")
    ref = good[0] if good else (frames[0] if frames else None)
    candidates = []
    if good:
        mapped, align_warnings = _align(good[0], good[1:])
        warnings.extend(align_warnings)
        seen = _seen_in(good[0], mapped) if len(good) > 1 else None
        candidates = _candidates(good[0], output_prefix, max_candidates, seen)
    for f in frames:
        f.pop("srgb8", None)  # free the full-size photos
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
        "candidates": candidates,
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
