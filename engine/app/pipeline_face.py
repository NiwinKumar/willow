"""face_full analysis (M2): landmarks -> ROIs + face skin mask -> Lab -> A-tier face metrics."""

import dataclasses
import json
import logging
import time

import cv2
import numpy as np
from jsonschema import validate
from scipy import ndimage

from app import config, facemap
from app.aggregate import summarize
from app.align import residual_px, similarity, transform
from app.color import linear_srgb_to_lab
from app.errors import EngineError
from app.io import save_jpegs, save_png, save_preview
from app.landmarks import (
    LEFT_BROW,
    LEFT_EYE,
    RIGHT_BROW,
    RIGHT_EYE,
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
from app.metrics.glow import glow
from app.metrics.lines import lines
from app.metrics.pigment import find_spots, pigment_spots
from app.metrics.redness import erythema_index
from app.metrics.shine import shine
from app.metrics.tone import ita_band, ita_degrees
from app.overlay import redness_rgba, to_preview
from app.pipeline import SCHEMA, _load, _mean_extras, capture_mode_for
from app.quality import FrameQuality, check_frame, region_reasons
from app.roi import Box

log = logging.getLogger("willow.face")

METRIC_INFO = {  # id -> (group, label, unit), docs/CONTRACT.md 2.5
    "tone_ita": ("tone_pigment", "Skin tone (ITA)", "deg"),
    "pigment_spots": ("tone_pigment", "Dark spots", "pct_area"),
    "tone_evenness": ("tone_pigment", "Tone evenness", "index"),
    "redness": ("redness", "Redness", "a_star"),
    "blemishes": ("clarity", "Blemishes", "count"),
    "dark_circles": ("eye_area", "Dark circles", "delta_l_star"),
    "shine": ("oil_glow", "Shine", "pct_area"),
    "glow": ("oil_glow", "Glow", "index"),
    "lines": ("lines", "Lines", "index"),
}
ALWAYS_INDICATIVE = {"blemishes", "shine", "glow", "lines"}  # docs/CONTRACT.md 2.5
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


def _frame(path: str, overlays: bool = False) -> dict:
    """Everything measured on one photo; raises FaceNotFound. overlays: also keep the
    photo's a* on the preview grid for the redness overlay."""
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
    masks, raw, covered = {}, {}, False
    for n, p in polys.items():
        m = raw[n] = box.crop(polygon_mask(srgb8.shape[:2], p))
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
    # where on the face each failed check is (says where, not whether: never fails a photo)
    try:
        regions = region_reasons(quality.reasons, raw, lin, box.crop(srgb8), face.px_per_mm, hand)
    except (ValueError, IndexError, cv2.error) as exc:
        log.warning("quality regions not attributed: %s", exc)
        regions = []

    skin = {n: m & _skin_tails(lab[..., 0], m) for n, m in masks.items()}
    cheek_skin = np.logical_or.reduce([skin[c] for c in face.cheeks])
    px_per_mm = face.px_per_mm
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
    t_map = time.perf_counter()
    # the redness metric's own a* and skin, on the preview grid (drawn for the reference photo)
    redness_map = (
        to_preview(lab[..., 1], red_skin, srgb8.shape[:2], origin=(box.x, box.y))
        if overlays
        else None
    )
    map_ms = (time.perf_counter() - t_map) * 1000
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
    # a turned face's lip landmarks run short of a pursed or turned lip (Oct 15: a "blemish"
    # on the lower lip below them): side views keep a wider band around the lips
    side_lips = np.zeros_like(face_skin)
    if face.view != "front":
        side_lips = box.crop(face.lip_band(srgb8.shape[:2], config.SIDE_LIP_GUARD_MM))
    lip_edge = side_lips | _lip_guard(
        box.crop(face.lip_band(srgb8.shape[:2], config.BLEMISH_LIP_GUARD_MM)),
        box.crop(face.lip_band(srgb8.shape[:2], config.BLEMISH_MOUSTACHE_GUARD_MM)),
        beard_skin,
    )
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
    spot_edge = box.crop(face.edge_guard(srgb8.shape[:2])) | spot_band | side_lips
    shadows = box.crop(face.shadow_guard(srgb8.shape[:2]))
    search = face_skin & ~spot_edge & ~shadows
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
        and not (face.view != "front" and _reaches(sp, shadows))
    ]
    glow_idx, glow_extras = glow(lab, lin, cheek_skin, px_per_mm)
    # lines: landmarks in the crop's pixels. Blemishes and large dark marks (a bindi, a mole)
    # are left out, their edges curve; small dark spots are not: on a lined face many
    # "spots" are pieces of the lines, and small round marks fail the line shape test anyway
    crop_face = dataclasses.replace(face, points=face.points - [box.x, box.y])
    big = [sp for sp in spots if 2 * sp.radius >= config.LINES_MARK_MIN_MM * px_per_mm]
    lines_val, lines_extras = lines(
        lab,
        crop_face,
        _line_skin(lab, face_full & ~hand, zones.get("lower_face", np.zeros_like(face_skin))),
        px_per_mm,
        [*blemishes, *big],
    )
    spots_pct, spot_extras = pigment_spots(spots, int(face_skin.sum()))

    values = {
        "tone_ita": ita_degrees(l_star, b_star),
        "pigment_spots": spots_pct,
        "tone_evenness": evenness,
        "redness": redness_a,
        "blemishes": float(len(blemishes)),
        "dark_circles": float(np.mean([c[0] for c in circles])) if circles else None,
        "shine": shine_pct,
        "glow": glow_idx,
        "lines": lines_val,
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
        "shine": shine_extras,
        "glow": glow_extras,
        "lines": lines_extras,
    }
    zone_label = _zone_labels(face, box, face_skin)
    return {
        "values": values,
        "extras": extras,
        "quality": quality,
        "face": face,
        "view": face.view,
        "polygons": polys,
        # the "Areas" outlines are drawn for the reference photos only: worked out on demand (_areas)
        "zone_label": zone_label,
        # which zone each mark sits in, and each zone's skin (px): a session with side photos
        # takes each zone from the photo that faces it (_combine_views)
        "mark_zones": _mark_zones(zone_label, [*blemishes, *spots]),
        "mark_depth_mm": _mark_depth_mm(face_skin, [*blemishes, *spots], face.px_per_mm),
        "zone_px": (
            {n: int((zone_label == c).sum()) for c, n in enumerate(facemap.ZONES, start=1)}
            if zone_label is not None
            else {}
        ),
        "shape": srgb8.shape,
        "face_skin": (box, face_skin),
        "blemishes": blemishes,
        "spots": spots,
        "box": box,
        "srgb8": srgb8,
        "regions": regions,
        "redness_map": redness_map,
        "map_ms": map_ms,
    }


def _lip_guard(lip_band: np.ndarray, wide_band: np.ndarray, beard_skin: np.ndarray) -> np.ndarray:
    """Skin around the lips the blemish search skips: the lip band everywhere, and the wider
    band where the skin is between beard hairs (a moustache over the red lip edge: the skin
    showing between hairs next to the lip reads as a red bump)."""
    return lip_band | (wide_band & beard_skin)


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
        f["confirmed"] = seen
        n_b = len(f["blemishes"])
        f["values"]["blemishes"] = float(sum(seen[:n_b]))
        spots = [s for s, ok in zip(f["spots"], seen[n_b:], strict=True) if ok]
        pct, extras = pigment_spots(spots, int(f["face_skin"][1].sum()))
        f["values"]["pigment_spots"], f["extras"]["pigment_spots"] = pct, extras


# Which view's photo measures each face-map zone in a session with side photos (docs/CAPTURE:
# front, left cheek, right cheek): each cheek and jaw from the photo that faces it, the rest
# from the front. A side with no photo of its own is measured on the front.
SIDE_ZONES = {"right": {"right_cheek", "right_jaw"}, "left": {"left_cheek", "left_jaw"}}
VIEW_CODE = {"front": 0.0, "right": 1.0, "left": 2.0}  # candidate feature `view` (numbers only)


def _owns(view: str, zone: str | None, sides: set[str]) -> bool:
    """Whether a mark in `zone` found on a `view` photo is counted (each zone once a session)."""
    if view in SIDE_ZONES:
        return zone in SIDE_ZONES[view]
    taken = set().union(*(SIDE_ZONES[v] for v in sides)) if sides else set()
    return zone not in taken  # front: everything a side photo does not measure (and unzoned)


def _keeps(f: dict, sides: set[str]) -> list[bool]:
    """Per mark (blemishes then spots): in a zone this photo measures. On a side photo the mark
    must also sit SIDE_MARK_DEPTH_MM inside the face skin: at the jaw edge, hairline and lid
    corners a turned face throws shadows that read as marks."""
    side = f["view"] in SIDE_ZONES
    return [
        _owns(f["view"], z, sides) and (not side or d >= config.SIDE_MARK_DEPTH_MM)
        for z, d in zip(f["mark_zones"], f["mark_depth_mm"], strict=True)
    ]


def _owned_marks(f: dict, sides: set[str]) -> list[bool]:
    """_keeps, and confirmed by another photo of the same view when there was one."""
    confirmed = f.get("confirmed") or [True] * len(f["mark_zones"])
    return [ok and k for ok, k in zip(confirmed, _keeps(f, sides), strict=True)]


def _combine_views(front: list[dict], side_refs: dict[str, dict]) -> None:
    """A session with front and side photos: each front photo's blemish count and dark-spot area
    become its own zones' plus the side photos' cheeks and jaws, so the noise band still comes
    from the front photos' spread. Dark-spot area is in mm2 (the photos differ in scale)."""
    sides = set(side_refs)

    def part(f: dict) -> tuple[int, list, float, float]:
        own = _owned_marks(f, sides)
        n_b, mm2 = len(f["blemishes"]), f["face"].px_per_mm ** 2
        blem = sum(own[:n_b])
        kept = [s for s, ok in zip(f["spots"], own[n_b:], strict=True) if ok]
        spot_mm2 = sum(s.area_px for s in kept) / mm2
        zones = SIDE_ZONES.get(f["view"])
        skin = sum(
            px
            for z, px in f["zone_px"].items()
            if (z in zones if zones else _owns("front", z, sides))
        )
        return blem, kept, spot_mm2, skin / mm2

    extra = [part(r) for r in side_refs.values()]
    for f in front:
        b, kept, spot, skin = part(f)
        b += sum(e[0] for e in extra)
        kept = [*kept, *(s for e in extra for s in e[1])]
        spot += sum(e[2] for e in extra)
        skin += sum(e[3] for e in extra)
        f["values"]["blemishes"] = float(b)
        f["values"]["pigment_spots"] = 100.0 * spot / skin if skin else 0.0
        # count and mean darkness of the spots kept across the views (the % is the mm2 one above)
        f["extras"]["pigment_spots"] = {
            **f["extras"]["pigment_spots"],
            **pigment_spots(kept, 1)[1],
        }


def _candidates(
    frame: dict,
    output_prefix: str | None,
    limit: int,
    seen: list[float] | None = None,
    keep: list[bool] | None = None,
    start: int = 1,
    frames: int = 1,
) -> list[dict]:
    """Contract candidates (docs/CONTRACT.md 2.6), blemishes then dark spots of one photo:
    bbox in photo pixels, plus a crop and a 3x context crop for Gemini to label. frames: the
    photos of this photo's view, which seen_in_fraction is a share of."""
    box, srgb8 = frame["box"], frame["srgb8"]
    px_per_mm = frame["face"].px_per_mm
    found = [("blemish", b) for b in frame["blemishes"]] + [("spot", s) for s in frame["spots"]]
    seen_all = seen
    if keep is not None:  # only the marks of zones this photo measures (_owns)
        idx = [i for i, ok in enumerate(keep) if ok]
        found = [found[i] for i in idx]
        seen_all = [seen[i] for i in idx] if seen else None
    found = found[:limit]
    seen = seen_all
    # where each mark sits on the canonical face, so the api can follow it across sessions
    places = facemap.locate(frame["face"].points, [(box.x + b.x, box.y + b.y) for _, b in found])
    out, uploads = [], []
    for i, (kind, b) in enumerate(found, start=1):
        cid = f"c_{start + i - 1:03d}"
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
                    # which photo of the session the bbox is in, and its view (VIEW_CODE)
                    "frame_index": float(frame["index"]),
                    # (a close-up has no face view: 0, like a front photo)
                    "view": VIEW_CODE.get(frame.get("view", "front"), 0.0),
                    "frames_in_view": float(frames),
                    **_place_features(places[i - 1], b.radius),
                },
            }
        )
    save_jpegs(uploads)  # all crops in parallel (network-bound)
    return out


def _shares(slots: int, wants: list[int]) -> list[int]:
    """Candidate slots per cheek view: `slots` split evenly, each view at most what it `wants`
    (its marks, in its own ranking); a view that needs fewer passes the rest on."""
    out = [0] * len(wants)
    while slots > 0 and any(o < w for o, w in zip(out, wants, strict=True)):
        for i, w in enumerate(wants):
            if slots > 0 and out[i] < w:
                out[i] += 1
                slots -= 1
    return out


def _place_features(place: dict | None, radius_px: float) -> dict:
    """Face-map features of one mark (numbers only, as the contract's features are)."""
    if place is None:
        return {}
    return {
        "face_x_mm": place["face_x_mm"],
        "face_y_mm": place["face_y_mm"],
        "zone": float(facemap.ZONES.index(place["zone"]) + 1),
        "diameter_mm": round(2 * radius_px * place["mm_per_px"], 1),
    }


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


def _reaches(spot, guard: np.ndarray) -> bool:
    """A spot whose disk reaches SIDE_SPOT_GUARD_OVERLAP of the way into a shadow guard: on a
    turned face a 10 mm "spot" centred just outside the nose guard was the shadow where the
    nose meets the cheek (Oct 15)."""
    h, w = guard.shape
    r = max(int(spot.radius), 1)
    x0, x1 = max(int(spot.x) - r, 0), min(int(spot.x) + r + 1, w)
    y0, y1 = max(int(spot.y) - r, 0), min(int(spot.y) + r + 1, h)
    yy, xx = np.ogrid[y0:y1, x0:x1]
    disk = (yy - spot.y) ** 2 + (xx - spot.x) ** 2 <= r * r
    return bool(disk.any()) and guard[y0:y1, x0:x1][disk].mean() > config.SIDE_SPOT_GUARD_OVERLAP


def _session_lines(good: list[dict]) -> None:
    """lines per photo on the session's own most lined zones. Scoring each photo on its own
    top LINES_TOP_ZONES let a zone flip in and out of the top two between photos (one 5 mm
    segment found or not moves a small zone 0 <-> ~2 mm/cm2): 5 laptop selfies of one
    session read 1.1-2.7. The zones are picked once, by their median across the photos, and
    every photo is scored on those, so the spread is the photos' own, not the zone choice's.
    The zones skipped for expression in any photo are kept in the extras."""
    frames = [f for f in good if f["values"].get("lines") is not None]
    if not frames:
        return
    suffix = "_mm_per_cm2"
    zones = {k for f in frames for k, v in f["extras"]["lines"].items() if k.endswith(suffix)}
    medians = {}
    for z in zones:
        vals = [f["extras"]["lines"].get(z) for f in frames]
        vals = [v for v in vals if v is not None]
        # measured in at least half the photos: a zone seen once (skipped for expression or
        # cut as beard in the rest) cannot lead the session
        if vals and 2 * len(vals) >= len(frames):
            medians[z] = float(np.median(vals))
    top = sorted(medians, key=lambda z: (-medians[z], z))[: config.LINES_TOP_ZONES]
    skipped = sorted(
        {z for f in frames for z in f["extras"]["lines"].get("skipped_for_expression") or []}
    )
    for f in frames:
        vals = [f["extras"]["lines"].get(z) for z in top]
        vals = [v for v in vals if v is not None]
        f["values"]["lines"] = float(np.mean(vals)) if vals else None
        f["extras"]["lines"] = {
            **{k: v for k, v in f["extras"]["lines"].items() if k != "skipped_for_expression"},
            "px_per_mm": round(float(f["face"].px_per_mm), 2),
        }
    for f in frames:
        f["extras"]["lines"]["top_zones"] = top
        f["extras"]["lines"]["skipped_for_expression"] = skipped


def _line_skin(lab: np.ndarray, face_area: np.ndarray, lower_face: np.ndarray) -> np.ndarray:
    """Skin for the lines metric: the face outline minus eyes, lids and lips (`face_area`),
    without hair (far darker AND greyer than this face's skin; below the nose, where a
    beard or moustache grows, a little darker and greyer). Not face_skin: its stubble and
    colour cuts take creases beside the mouth and shaded skin (Oct 15: a marionette zone
    27% skin, one side none), the very places lines are. A crease is a shadow and keeps the
    skin's colour (cut 0-0.4% of mouth zones on 4 lined faces, 17-33% on 2 bearded)."""
    if not face_area.any():
        return face_area
    L = lab[..., 0]
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    med_l, med_c = float(np.median(L[face_area])), float(np.median(chroma[face_area]))
    hair = (L < med_l - config.LINES_HAIR_DARKER_L) & (chroma < config.LINES_HAIR_CHROMA * med_c)
    beard = (L < med_l - config.LINES_BEARD_DARKER_L) & (chroma < config.LINES_BEARD_CHROMA * med_c)
    # a beard: lines below the nose cannot be told from its hairs, so that part is left out.
    # Judged by clear hair (the stricter test): bearded faces 25-29% of the lower face,
    # 13 others 0-2.5% (Oct 15); the looser test also takes jaw shadow (up to 13%)
    lower = face_area & lower_face
    if lower.any() and (hair & lower).sum() > config.LINES_BEARD_FRAC * lower.sum():
        hair |= lower_face
    hair |= beard & lower_face  # moustache / stubble hairs on an otherwise clear lip
    hair = cv2.dilate(hair.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    return face_area & ~hair


def _zone_labels(face: Face, box: Box, face_skin: np.ndarray) -> np.ndarray | None:
    """Per pixel of the face crop: 1-based index into FACE_ZONES (0 = not face skin), the whole
    face skin in the face map's zones (skin past the mesh joins its nearest zone). None without
    the face model or when no zone reaches the skin."""
    zones = facemap.zone_map(face.points - [box.x, box.y], face_skin.shape)
    if zones is None or not face_skin.any():
        return None
    covered = zones > 0
    if not covered.any():
        return None
    _, (iy, ix) = ndimage.distance_transform_edt(~covered, return_indices=True)
    return np.where(face_skin, zones[iy, ix], 0).astype(np.uint8)


def _mark_depth_mm(face_skin: np.ndarray, marks: list, px_per_mm: float) -> list[float]:
    """How far inside the face skin each mark's rim is (mm, crop pixels in)."""
    if not marks:
        return []
    depth = ndimage.distance_transform_edt(face_skin)
    h, w = depth.shape
    return [
        (float(depth[min(max(int(m.y), 0), h - 1), min(max(int(m.x), 0), w - 1)]) - m.radius)
        / px_per_mm
        for m in marks
    ]


def _mark_zones(label: np.ndarray | None, marks: list) -> list[str | None]:
    """The zone of each mark's centre (crop pixels), None without zones."""
    if label is None:
        return [None] * len(marks)
    h, w = label.shape
    out = []
    for m in marks:
        code = int(label[min(max(int(m.y), 0), h - 1), min(max(int(m.x), 0), w - 1)])
        out.append(facemap.ZONES[code - 1] if code else None)
    return out


def _area_outlines(
    face: Face, box: Box, label: np.ndarray | None, polys: dict[str, np.ndarray]
) -> dict[str, np.ndarray]:
    """What the app's "Areas" view draws (result.rois): the whole measured face skin split into the
    face map's zones (config.FACE_ZONES, the same rule that places marks), one outline each in
    photo pixels, then the under-eye patches (dark circles are read only there). The small ROI
    patches alone showed a fifth of the face, though spots, blemishes, lines and shine are searched
    over all of it. Skin past the mesh (hairline, jaw edge) joins its nearest zone. Without the face
    model: the ROI patches, as before."""
    if label is None:
        return dict(polys)
    label = label.copy()
    # each eye with its brow cut out, so a cheek outline stops under the eye instead of wrapping
    # round it up to the brow (an outline cannot have a hole: the eye looked measured)
    for eye, brow in ((RIGHT_EYE, RIGHT_BROW), (LEFT_EYE, LEFT_BROW)):
        pts = (face.points[eye + brow] - [box.x, box.y]).astype(np.float32)
        label[polygon_mask(label.shape, cv2.convexHull(pts).reshape(-1, 2))] = 0
    r = max(round(config.AREA_SMOOTH_MM * face.px_per_mm), 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    eps = config.AREA_OUTLINE_MM * face.px_per_mm
    min_px = config.AREA_MIN_MM2 * face.px_per_mm**2
    out: dict[str, np.ndarray] = {}
    for code, name in enumerate(facemap.ZONES, start=1):
        # smoothed: zone edges follow the mesh's triangles and looked jagged
        mask = cv2.morphologyEx((label == code).astype(np.uint8), cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        big = max(contours, key=cv2.contourArea)  # one outline per zone: its main piece
        if cv2.contourArea(big) < min_px:
            continue
        outline = cv2.approxPolyDP(big, eps, True).reshape(-1, 2).astype(np.float64)
        if len(outline) >= 3:
            out[name] = outline + [box.x, box.y]
    if not out:  # no zone found any skin (landmarks off the face mesh): the ROI patches
        return dict(polys)
    for name in ("right_under_eye", "left_under_eye"):
        if name in polys:
            out[name] = polys[name]
    return out


def _areas(f: dict) -> dict[str, np.ndarray]:
    """A photo's area outlines (_area_outlines), worked out once, only for the photos drawn."""
    if "areas" not in f:
        f["areas"] = _area_outlines(f["face"], f["box"], f["zone_label"], f["polygons"])
    return f["areas"]


def _views(refs: list[dict], sides: set[str], output_prefix: str | None) -> list[dict]:
    """result.views: per view of the session (front, right, left), its reference photo (index,
    size, a preview and redness map when output_prefix is given) and the areas it measures. The
    top-level preview / rois / image_size stay the front's, for apps that show one photo."""
    out = []
    for f in refs:
        v = f["view"]
        preview = redness = None
        if output_prefix:
            preview = save_preview(f["srgb8"], output_prefix, name=f"views/{v}.jpg")
            if f.get("redness_map") is not None:
                rgba = redness_rgba(f["redness_map"], f["face"].px_per_mm)
                if rgba is not None:
                    dest = f"{output_prefix.rstrip('/')}/overlays/redness_{v}.png"
                    redness = save_png(rgba, dest)
        rois = [
            {"name": n, "polygon": np.round(p, 1).tolist()}
            for n, p in _areas(f).items()
            if _owns(v, n, sides)  # the under-eye patches go with the front
        ]
        out.append(
            {
                "view": v,
                "frame_index": f["index"],
                "image_size": {"width": int(f["shape"][1]), "height": int(f["shape"][0])},
                "preview_uri": preview,
                "redness_uri": redness,
                "rois": rois,
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
    compute_overlays: bool = True,
) -> dict:
    """Analyze 1-5 front-on face photos of one session (site face_full).

    Blemish candidates (with crops when output_prefix is given) come from the first photo
    that passed the quality checks. With output_prefix and compute_overlays, the redness
    overlay of the reference photo is written to overlays/redness.png.
    """
    t0 = time.perf_counter()
    try:
        mode = capture_mode_for(files)
    except ValueError as exc:
        raise EngineError("bad_request", str(exc)) from exc
    # "measured" needs a colour reference in the photo; faces never detect one (no card,
    # no white paper), so a RAW face is as indicative as a JPEG selfie
    confidence = "indicative"
    draw = compute_overlays and bool(output_prefix)  # overlays need somewhere to go

    per_frame, frames, warnings = [], [], []
    for i, path in enumerate(files):
        try:
            f = _frame(path, overlays=draw)
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
        per_frame.append(
            {"index": i, "passed": q.passed, "reasons": q.reasons, "regions": f["regions"]}
        )
    passed = [f for f in frames if f["quality"].passed]
    passed.sort(key=lambda f: -f["quality"].sharpness)  # the sharpest of each view leads it
    # the measurements come from the front photos (they give the noise band); a session with only
    # side views is measured on those (each measures different skin: not averaged together)
    good = [f for f in passed if f["view"] == "front"] or passed
    # a session with front AND side photos (front, left cheek, right cheek): each cheek and jaw
    # is counted on the photo that faces it, everything else on the front
    side_groups = (
        {v: [f for f in passed if f["view"] == v] for v in ("right", "left")}
        if good and good[0]["view"] == "front"
        else {}
    )
    side_groups = {v: g for v, g in side_groups.items() if g}
    _count_confirmed(good)
    for group in side_groups.values():
        _count_confirmed(group)
    side_refs = {v: g[0] for v, g in side_groups.items()}
    if side_refs:
        _combine_views(good, side_refs)

    metrics = []
    _session_lines(good)
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
            if metric_id == "lines":  # the lists _mean_extras drops (_session_lines)
                for k in ("top_zones", "skipped_for_expression"):
                    extras[k] = have[0]["extras"]["lines"].get(k, [])
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
    if side_refs:
        warnings.append(
            "cheeks and jaw from the "
            + " and ".join(f"{v} cheek photo" for v in sorted(side_refs))
            + "; forehead, nose and chin from the front: compare with check-ins taken the same way"
        )
    elif len(good) < len(passed):
        warnings.append("side views were left out: front-view photos in the same session")
    ref = good[0] if good else (frames[0] if frames else None)
    if ref and output_prefix:  # the photo rois, candidate bboxes and image_size describe
        save_preview(ref["srgb8"], output_prefix)
    overlays, overlay_ms = [], sum(f["map_ms"] for f in frames)
    if good and good[0]["redness_map"] is not None:  # same photo as preview.jpg, same size
        t_o = time.perf_counter()
        rgba = redness_rgba(good[0]["redness_map"], good[0]["face"].px_per_mm)
        if rgba is not None:
            dest = f"{output_prefix.rstrip('/')}/overlays/redness.png"
            overlays.append({"metric_id": "redness", "uri": save_png(rgba, dest)})
        overlay_ms += (time.perf_counter() - t_o) * 1000
    candidates, views = [], []
    if good:
        mapped, align_warnings = _align(good[0], good[1:])
        warnings.extend(align_warnings)
        seen = _seen_in(good[0], mapped) if len(good) > 1 else None
        sides = set(side_refs)
        keep = _keeps(good[0], sides) if sides else None
        candidates = _candidates(
            good[0], output_prefix, max_candidates, seen, keep, frames=len(good)
        )
        # max_candidates is the session's: the front's marks first, the rest shared by the cheeks
        keeps = {v: _keeps(side_refs[v], sides) for v in side_groups}
        shares = _shares(max_candidates - len(candidates), [sum(k) for k in keeps.values()])
        for (v, group), limit in zip(side_groups.items(), shares, strict=True):
            ref_v = group[0]
            m_v, w_v = _align(ref_v, group[1:])
            warnings.extend(w_v)
            seen_v = _seen_in(ref_v, m_v) if len(group) > 1 else None
            candidates += _candidates(
                ref_v,
                output_prefix,
                limit,
                seen_v,
                keeps[v],
                start=len(candidates) + 1,
                frames=len(group),
            )
        # views: only a session with cheek photos (or only side photos, which the api tells
        # apart by its views); a front-only session is one photo, as before views
        if side_refs or good[0]["view"] != "front":
            views = _views([good[0], *side_refs.values()], sides, output_prefix)
    for f in frames:
        f.pop("srgb8", None)  # free the full-size photos
        f.pop("redness_map", None)
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
        "overlays": overlays,
        **({"views": views} if views else {}),
        # the reference photo's areas: the whole face in zones, plus the under-eye patches
        "rois": (
            [{"name": n, "polygon": np.round(p, 1).tolist()} for n, p in _areas(ref).items()]
            if ref
            else []
        ),
        "timings_ms": {
            "total": round((time.perf_counter() - t0) * 1000, 1),
            **({"overlay": round(overlay_ms, 1)} if draw else {}),
        },
        "warnings": warnings,
    }
    if ref:
        result["image_size"] = {"width": int(ref["shape"][1]), "height": int(ref["shape"][0])}
    validate(result, json.loads(SCHEMA.read_text()))
    return result
