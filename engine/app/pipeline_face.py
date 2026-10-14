"""face_full analysis (M2): landmarks -> ROIs + face skin mask -> Lab -> A-tier face metrics."""

import json
import logging
import time

import cv2
import numpy as np
from jsonschema import validate

from app import config
from app.aggregate import summarize
from app.align import residual_px, similarity, transform
from app.color import linear_srgb_to_lab
from app.errors import EngineError
from app.io import save_jpegs, save_preview
from app.landmarks import (
    Face,
    FaceNotFound,
    detect_face,
    detect_hands,
    edge_hair,
    hand_mask,
    polygon_mask,
    refine_skin,
    skin_colour,
)
from app.metrics.blemish import find_blemishes
from app.metrics.evenness import tone_evenness
from app.metrics.pigment import find_spots, pigment_spots
from app.metrics.redness import erythema_index
from app.metrics.tone import ita_band, ita_degrees
from app.pipeline import SCHEMA, _load, _mean_extras, capture_mode_for
from app.quality import FrameQuality, check_frame
from app.roi import Box

log = logging.getLogger("willow.face")

METRIC_INFO = {  # id -> (group, label, unit), docs/CONTRACT.md 2.5
    "tone_ita": ("tone_pigment", "Skin tone (ITA)", "deg"),
    "pigment_spots": ("tone_pigment", "Dark spots", "pct_area"),
    "tone_evenness": ("tone_pigment", "Tone evenness", "index"),
    "redness": ("redness", "Redness", "a_star"),
    "blemishes": ("clarity", "Blemishes", "count"),
    "dark_circles": ("eye_area", "Dark circles", "delta_l_star"),
}
ALWAYS_INDICATIVE = {"blemishes"}  # docs/CONTRACT.md 2.5
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
    if not face_mask_full.any():  # face at the very edge of the photo: nothing to measure
        raise FaceNotFound("no face skin inside the photo")
    ys, xs = np.nonzero(face_mask_full)
    face_outline = np.array([[xs.min(), ys.min()], [xs.max() + 1, ys.max() + 1]], float)
    box = _bbox([*polys.values(), face_outline], srgb8.shape[:2])  # face area only
    cheek_box = _bbox([polys[c] for c in face.cheeks], srgb8.shape[:2])

    # a hand resting on the face (chin, cheek) is skin but not face: cut it everywhere
    hands = detect_hands(srgb8, config.HAND_MIN_SPAN_EYES * face.eye_distance_px)
    hand = box.crop(hand_mask(srgb8.shape[:2], hands, config.HAND_MARGIN_MM * face.px_per_mm))
    masks, covered = {}, False
    for n, p in polys.items():
        m = box.crop(polygon_mask(srgb8.shape[:2], p))
        if (m & ~hand).sum() >= 0.5 * m.sum():
            masks[n] = m & ~hand
        elif n in face.cheeks or n == "nose":
            # tone and redness come from here: a hand over it fails the photo (below)
            masks[n], covered = m, True
        else:
            # chin or forehead under a hand resting on the face: measure what is left of it
            masks[n] = m & ~hand if (m & ~hand).any() else m
    # sharpness/exposure on the cheek area (2-D patch the Laplacian needs)
    cheek_mask = cheek_box.crop(
        np.logical_or.reduce([polygon_mask(srgb8.shape[:2], polys[c]) for c in face.cheeks])
    )
    quality: FrameQuality = check_frame(
        cheek_box.crop(linear), cheek_box.crop(srgb8), px_per_mm=face.px_per_mm, skin=cheek_mask
    )
    if not _pose_ok(face):
        quality.reasons.append("pose_out_of_range")
    face_area = box.crop(face_mask_full)
    # a hand over a measured region (a fingertip on the cheek feeds tone and redness) or over
    # a large part of the face fails the photo
    if covered or (face_area & hand).sum() > config.HAND_OCCLUSION_FRAC * max(face_area.sum(), 1):
        quality.reasons.append("occlusion_suspected")

    # colours as the phone captured them: users do not hold a white reference
    lin = box.crop(linear)
    lab = linear_srgb_to_lab(lin)

    skin = {n: m & _skin_tails(lab[..., 0], m) for n, m in masks.items()}
    cheek_skin = np.logical_or.reduce([skin[c] for c in face.cheeks])
    px_per_mm = face.px_per_mm
    # whole-face skin (outline minus eyes, lids, brows, nostrils, lips, hair) for blemishes
    # and dark spots
    zones = {k: box.crop(v) for k, v in face.feature_zones(srgb8.shape[:2]).items()}
    face_skin = refine_skin(
        lab[..., 0], box.crop(face_mask_full), zones, px_per_mm, np.hypot(lab[..., 1], lab[..., 2])
    )
    if face.view != "front":  # hair, background and shine crowd a turned cheek
        face_skin = skin_colour(lab, face_skin, cheek_skin, px_per_mm)
        # sideburns and temple hair beside the ear (beards: the lower-face stubble test in
        # refine_skin). A dark-speck density test is not used here: dense acne marks on
        # deep skin look the same and were cut.
        ear = face.ear_side(face_skin.shape, (box.x, box.y))
        face_skin &= ~edge_hair(lab, face_skin, cheek_skin, px_per_mm, ear)
    face_skin &= ~hand

    # Region skin without beard, stubble, brows or hair (face_skin), when enough is left;
    # a region that is mostly hair keeps its outline (its median is still skin-weighted).
    roi_skin = {}
    for n, m in skin.items():
        refined = m & face_skin
        roi_skin[n] = refined if refined.sum() >= config.ROI_MIN_SKIN_FRAC * max(m.sum(), 1) else m

    def med(channel: int, n: str) -> float:
        return float(np.median(lab[..., channel][roi_skin[n]]))

    # Tone: each cheek's own median, then their mean. Pooling both cheeks put the median in
    # the gap between a lit and a shaded cheek and swung ITA by 6 degrees between photos
    # (Oct 14); per cheek it was 1.9.
    l_star = float(np.mean([med(0, c) for c in face.cheeks]))
    b_star = float(np.mean([med(2, c) for c in face.cheeks]))
    # Redness: each region weighs the same (the nose is small and redder; pixel pooling let
    # its share of the pixels move the value)
    red_rois = _rois(face, REDNESS_ROIS)
    redness_a = float(np.mean([med(1, n) for n in red_rois]))
    red_skin = np.logical_or.reduce([roi_skin[n] for n in red_rois])
    evenness, _ = tone_evenness(
        {n: (lab[..., 0], lin[..., 0], roi_skin[n]) for n in _rois(face, EVENNESS_ROIS)}, px_per_mm
    )
    # Dark circles: under-eye skin minus the same side's cheek, in L* (docs/METRICS.md B1);
    # relative to the person's own cheek, so it works at every tone and cancels exposure.
    circles = [
        (
            med(0, f"{side}_under_eye") - med(0, f"{side}_cheek"),
            med(1, f"{side}_under_eye") - med(1, f"{side}_cheek"),
        )
        for side in ("right", "left")
        if f"{side}_under_eye" in roi_skin
        and f"{side}_cheek" in roi_skin
        and roi_skin[f"{side}_under_eye"].sum() >= config.UNDER_EYE_MIN_MM2 * px_per_mm**2
    ]
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
    # blemishes are found by redness and hair is not red, so they also search the skin
    # between beard hairs (lower face cut as stubble): a pimple in a beard still counts.
    # Dark spots do not (hair is dark).
    beard_skin = _beard_skin(
        lab[..., 0],
        face_full & zones.get("lower_face", np.zeros_like(face_skin)) & ~face_skin,
        px_per_mm,
    )
    blem_skin = face_skin | beard_skin
    band = face.border_band(blem_skin, (box.x, box.y))
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
        blem_skin,
        px_per_mm,
        search=blem_skin & ~guard & ~band & ~brows & ~eye_corners & ~lip_edge & ~side_nose,
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
    spots_pct, spot_extras = pigment_spots(spots, int(face_skin.sum()))

    values = {
        "tone_ita": ita_degrees(l_star, b_star),
        "pigment_spots": spots_pct,
        "tone_evenness": evenness,
        "redness": redness_a,
        "blemishes": float(len(blemishes)),
        "dark_circles": float(np.mean([c[0] for c in circles])) if circles else None,
    }
    extras = {
        "tone_ita": {"l_star": l_star, "b_star": b_star},
        "pigment_spots": spot_extras,
        "tone_evenness": {},
        "redness": {"erythema_index": erythema_index(lin, red_skin)},
        "blemishes": {},
        "dark_circles": {"delta_a_star": float(np.mean([c[1] for c in circles]))}
        if circles
        else {},
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


def _beard_skin(l_star: np.ndarray, beard: np.ndarray, px_per_mm: float) -> np.ndarray:
    """Skin pixels inside a beard / stubble area: not much darker than the skin within
    ~0.5 mm (that is a hair) and not far darker than the area's own median (dense hair)."""
    if not beard.any():
        return beard
    fine = cv2.GaussianBlur(l_star.astype(np.float32), (0, 0), 0.5 * px_per_mm)
    skin = beard & (l_star >= fine - config.STUBBLE_DELTA_L)
    skin &= l_star >= np.median(l_star[beard]) - config.HAIR_DELTA_L
    r = max(round(0.3 * px_per_mm), 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.morphologyEx(skin.astype(np.uint8), cv2.MORPH_OPEN, kernel).astype(bool)


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
            mapped.append(None)  # not lined up: no evidence about any mark either way
            warnings.append(
                f"photo {f['index'] + 1} could not be lined up with photo {ref['index'] + 1}"
            )
            continue
        if residual_px(f["face"].points, ref_pts, m) > config.ALIGN_WARN_MM * mm:
            warnings.append(
                f"photo {f['index'] + 1} lines up poorly with photo {ref['index'] + 1} (face moved or changed "
                "expression): spot matching across photos is less reliable"
            )
        mapped.append(transform(m, _marks(f)))
    return mapped, warnings


def _seen_in(ref: dict, mapped: list[np.ndarray]) -> list[float]:
    """For each mark of the reference photo, the share of the session's photos (itself
    included) with a blemish or spot within ALIGN_MATCH_MM of it. A real mark is in every
    photo; grain, glints and stray hairs usually are in one."""
    gap = config.ALIGN_MATCH_MM * ref["face"].px_per_mm
    lined_up = [o for o in mapped if o is not None]  # photos that could not be lined up say nothing
    out = []
    for p in _marks(ref):
        hits = 1 + sum(
            bool(len(o)) and float(np.min(np.hypot(*(o - p).T))) <= gap for o in lined_up
        )
        out.append(round(hits / (1 + len(lined_up)), 2))
    return out


def _count_confirmed(good: list[dict]) -> None:
    """With 2+ photos, blemishes and pigment_spots count only marks that another photo of
    the session also shows (within ALIGN_MATCH_MM after lining the photos up): one photo's
    grain, glint or stray hair should not move the number. Every mark stays a candidate.
    A photo that cannot be lined up keeps all its marks (no evidence either way)."""
    if len(good) < 2:
        return
    ref = good[0]
    mapped: list[np.ndarray | None] = []
    for f in good:
        try:
            m = np.eye(2, 3) if f is ref else similarity(f["face"].points, ref["face"].points)
            mapped.append(transform(m, _marks(f)))
        except ValueError:
            mapped.append(None)
    gap = config.ALIGN_MATCH_MM * ref["face"].px_per_mm
    for i, f in enumerate(good):
        if mapped[i] is None:
            continue
        partners = [o for j, o in enumerate(mapped) if j != i and o is not None]
        if not partners:  # its only partner could not be lined up: keep its own counts
            continue
        others = [o for o in partners if len(o)]
        seen = [any(float(np.min(np.hypot(*(o - p).T))) <= gap for o in others) for p in mapped[i]]
        n_b = len(f["blemishes"])
        f["values"]["blemishes"] = float(sum(seen[:n_b]))
        spots = [s for s, ok in zip(f["spots"], seen[n_b:], strict=True) if ok]
        pct, extras = pigment_spots(spots, int(f["face_skin"][1].sum()))
        f["values"]["pigment_spots"], f["extras"]["pigment_spots"] = pct, extras


def _candidates(
    frame: dict, output_prefix: str | None, limit: int, seen: list[float] | None = None
) -> list[dict]:
    """Contract candidates (docs/CONTRACT.md 2.6), blemishes then dark spots of one photo:
    bbox in photo pixels, plus a crop and a 3x context crop for Gemini to label."""
    box, srgb8 = frame["box"], frame["srgb8"]
    px_per_mm = frame["face"].px_per_mm
    found = [("blemish", b) for b in frame["blemishes"]] + [("spot", s) for s in frame["spots"]]
    out, uploads = [], []
    for i, (kind, b) in enumerate(found[:limit], start=1):
        cid = f"c_{i:03d}"
        cx, cy = box.x + b.x, box.y + b.y
        side = 2 * b.radius * 1.5
        bbox = [round(cx - side / 2, 1), round(cy - side / 2, 1), round(side, 1), round(side, 1)]
        # sized on the face, not in pixels: the same mm of skin at any photo resolution
        crop_side = max(config.CROP_SPOT_FACTOR * 2 * b.radius, config.CROP_MIN_MM * px_per_mm)
        crops = {}
        for key, size in (
            ("crop_uri", crop_side),
            ("context_crop_uri", crop_side * config.CROP_CONTEXT),
        ):
            patch = _centred_crop(srgb8, cx, cy, size)
            suffix = "" if key == "crop_uri" else "_ctx"
            dest = f"{output_prefix.rstrip('/')}/crops/{cid}{suffix}.jpg" if output_prefix else None
            crops[key] = dest
            if dest:
                uploads.append((patch, dest))
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
    save_jpegs(uploads)  # all crops in parallel (network-bound)
    return out


def _centred_crop(srgb8: np.ndarray, cx: float, cy: float, size: float) -> np.ndarray:
    """A size x size crop centred on (cx, cy); past the photo edge the edge pixels repeat
    (the spot stays at the centre, as the labeller tells Gemini). Upscaled to at least
    CROP_MIN_OUT_PX so a low-resolution face still gives the labeller enough pixels."""
    n = max(round(size), 1)
    x0, y0 = round(cx - n / 2), round(cy - n / 2)
    h, w = srgb8.shape[:2]
    pad = max(0, -x0, -y0, x0 + n - w, y0 + n - h)
    src = cv2.copyMakeBorder(srgb8, pad, pad, pad, pad, cv2.BORDER_REPLICATE) if pad else srgb8
    patch = src[y0 + pad : y0 + pad + n, x0 + pad : x0 + pad + n]
    if n < config.CROP_MIN_OUT_PX:
        out = config.CROP_MIN_OUT_PX
        patch = cv2.resize(patch, (out, out), interpolation=cv2.INTER_CUBIC)
    return np.ascontiguousarray(patch)


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
    # "measured" needs a colour reference in the photo; faces never detect one (no card,
    # no white paper), so a RAW face is as indicative as a JPEG selfie
    confidence = "indicative"

    per_frame, frames, warnings = [], [], []
    for i, path in enumerate(files):
        try:
            f = _frame(path)
        except FaceNotFound:
            per_frame.append({"index": i, "passed": False, "reasons": ["face_not_found"]})
            continue
        except (IndexError, ValueError) as exc:  # an empty region at the photo edge, etc.
            log.warning("face photo %d could not be measured: %s", i + 1, exc)
            per_frame.append({"index": i, "passed": False, "reasons": []})
            warnings.append(f"photo {i + 1} could not be measured")
            continue
        f["index"] = i
        frames.append(f)
        q = f["quality"]
        per_frame.append({"index": i, "passed": q.passed, "reasons": q.reasons})
    passed = [f for f in frames if f["quality"].passed]
    # one view per summary: front photos if any passed, else the side views (each measures
    # different skin, so they are not averaged together)
    good = [f for f in passed if f["view"] == "front"] or passed
    # the sharpest photo is the reference: spots, crops, regions and the preview come from it
    good.sort(key=lambda f: -f["quality"].sharpness)
    _count_confirmed(good)

    metrics = []
    for metric_id, (group, label, unit) in METRIC_INFO.items():
        base = (baseline or {}).get(metric_id)
        have = [f for f in good if f["values"][metric_id] is not None]
        if have:
            summary = summarize(
                [f["values"][metric_id] for f in have], base, config.MIN_SD.get(metric_id, 0.0)
            )
            extras = _mean_extras([f["extras"][metric_id] for f in have])
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
    if sides and baseline:
        # one cheek against a front-on baseline is a different measurement, not a change
        for m in metrics:
            if m["delta"] is not None:
                m.update(delta=None, verdict="no_baseline", direction="none")
        warnings.append("side view: not compared with your baseline, which is front-on")
    if sides:
        warnings.append(
            "side view: measured on the visible side of the face only ("
            + " and ".join(f"{v} cheek" for v in sides)
            + "); tone, redness and evenness come from that cheek"
        )
    if len(good) < len(passed):
        warnings.append("side views were left out: front-view photos in the same session")
    ref = good[0] if good else (frames[0] if frames else None)
    if ref and output_prefix:  # the photo rois, candidate bboxes and image_size describe
        save_preview(ref["srgb8"], output_prefix)
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
