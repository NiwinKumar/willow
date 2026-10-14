"""pigment_spots (docs/METRICS.md A4): small round spots darker than this person's own skin
nearby (brown marks, freckles, grey-violet post-acne marks on deep skin). Shadows are kept
out by guard zones and by the round test (a shadow edge is dark on one side). Thresholds
are contrasts against the person's own skin nearby, never an absolute L*."""

from dataclasses import dataclass

import cv2
import numpy as np
from scipy import ndimage
from skimage.feature import blob_log

from app import config
from app.metrics.blemish import _local_mean, robust_spread, working_scale


@dataclass
class Spot:
    x: float
    y: float
    radius: float
    score: float  # darkness below nearby skin, in units of this person's skin variation
    l_star_contrast: float  # L* relative to nearby skin (negative = darker)
    chroma_change: float  # colourfulness relative to nearby skin (shadows go negative)
    area_px: int


def tone_scale(l_skin: float) -> float:
    """Factor for L*-step thresholds at this skin lightness: (L* + 16) / (L*_tune + 16), at
    most 1 (the thresholds were tuned on mid-tone skin and are kept there and above)."""
    return min(1.0, max(config.SPOT_TONE_MIN_SCALE, (l_skin + 16) / (config.SPOT_TUNE_L + 16)))


def strand_map(l_star: np.ndarray, skin: np.ndarray, px_per_mm: float) -> np.ndarray:
    """Hair-thin pixels much darker than the skin within ~0.5 mm (full resolution: strands
    are 1-2 px wide and vanish when the photo is shrunk)."""
    fine = cv2.GaussianBlur(
        l_star.astype(np.float32), (0, 0), config.FACIAL_HAIR_FINE_MM * px_per_mm
    )
    return skin & (l_star < fine - config.FACIAL_HAIR_DELTA_L)


def _ring_contrast(
    l_star: np.ndarray,
    skin: np.ndarray,
    x: int,
    y: int,
    r: float,
    px_per_mm: float,
    holes: np.ndarray | None = None,
) -> float:
    """How much lighter the skin just around a spot is than its centre, on nearly every
    side: sector means of L* in a ring just outside the spot (SPOT_RING_SECTORS sectors),
    leaving out the SPOT_RING_DARK_SECTORS darkest, minus the mean L* of the centre.
    A side mostly on a feature cut-out (`holes`: eye, lips, nostril) counts as dark; a
    side off the face (jaw edge, hairline) is left out. At least half the sides must be
    on skin."""
    r_in = max(1.5 * r, r + 0.3 * px_per_mm)
    r_out = r_in + config.SPOT_RING_MM * px_per_mm
    h, w = l_star.shape
    x0, x1 = max(int(x - r_out) - 1, 0), min(int(x + r_out) + 2, w)
    y0, y1 = max(int(y - r_out) - 1, 0), min(int(y + r_out) + 2, h)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    d = np.hypot(yy - y, xx - x)
    patch, sk = l_star[y0:y1, x0:x1], skin[y0:y1, x0:x1]
    centre = sk & (d <= max(r * 0.7, 1.0))
    ring_all = (d >= r_in) & (d <= r_out)
    ring = sk & ring_all
    if not centre.any() or not ring.any():
        return 0.0
    n = config.SPOT_RING_SECTORS
    sector = ((np.arctan2(yy - y, xx - x) + np.pi) / (2 * np.pi) * n).astype(int) % n
    hl = holes[y0:y1, x0:x1] if holes is not None else np.zeros_like(sk)
    means = []
    for k in range(n):
        side = ring_all & (sector == k)
        on_skin = ring & (sector == k)
        if on_skin.sum() >= 0.5 * max(side.sum(), 1):
            means.append(patch[on_skin].mean())
        elif (hl & side).sum() >= (side & ~sk).sum() / 2:
            means.append(-np.inf)  # beside an eye / the lips: cannot vouch for the spot
    if len(means) < n / 2:
        return -np.inf  # mostly off the face
    # skip the SPOT_RING_DARK_SECTORS darkest sides: a neighbouring mark in a cluster is
    # allowed there; a shadow edge darkens about half the ring and still fails
    k = min(int(config.SPOT_RING_DARK_SECTORS), len(means) - 1)
    return float(sorted(means)[k] - patch[centre].mean())


def find_spots(
    lab: np.ndarray,
    skin: np.ndarray,
    search: np.ndarray,
    px_per_mm: float,
    strict: np.ndarray | None = None,
    outline: np.ndarray | None = None,
) -> list[Spot]:
    """Dark spots whose centre lies in `search` (skin minus shadow guards), strongest first.
    `skin` is used for the local background so guarded skin still counts as 'nearby'.
    In `strict` (e.g. just inside the hairline) a spot must score SPOT_STRICT_SCORE.
    `outline` is the face outline: non-skin inside it (eyes, lips, nostrils, hair) is a
    feature, non-skin outside it is off the face (default: holes in `skin`).
    Coordinates and areas are in the input's pixels."""
    strands = strand_map(lab[..., 0], skin, px_per_mm).astype(np.float32)
    if strict is None:
        strict = np.zeros(skin.shape, bool)
    if outline is None:
        outline = ndimage.binary_fill_holes(skin)
    lab, (skin, search, strict, outline), px_per_mm, back = working_scale(
        lab, [skin, search, strict, outline], px_per_mm
    )
    if back != 1.0:  # share of strand pixels per working pixel
        strands = cv2.resize(strands, skin.shape[::-1], interpolation=cv2.INTER_AREA)
    smooth = max(0.15 * px_per_mm, 0.5)
    l_star = lab[..., 0]
    # skin texture: L* against the skin within ~1 mm, from the lighter half (marks only
    # add to the dark side). Broad shading and big marks do not raise this person's bar.
    fine = cv2.GaussianBlur(
        np.where(
            skin, _local_mean(l_star, skin, config.SPOT_TEXTURE_MM * px_per_mm) - l_star, 0
        ).astype(np.float32),
        (0, 0),
        smooth,
    )
    spread = robust_spread(fine[skin])
    # nearby skin, two passes: the second leaves out pixels clearly darker than the first,
    # so a 3-10 mm mark does not drag its own background down and flatten itself
    sigma_bg = config.SPOT_BACKGROUND_MM * px_per_mm
    l_bg = _local_mean(l_star, skin, sigma_bg)
    plain = skin & (l_bg - l_star < config.SPOT_BACKGROUND_EXCLUDE * spread)
    l_bg = _local_mean(l_star, plain, sigma_bg)
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    c_bg = _local_mean(chroma, plain, sigma_bg)
    darker = cv2.GaussianBlur(np.where(skin, l_bg - l_star, 0).astype(np.float32), (0, 0), smooth)
    z = np.clip(darker / spread, 0, None)

    r_min, r_max = (d * px_per_mm / 2 for d in config.SPOT_DIAMETER_MM)
    blobs = blob_log(
        z / 10,
        min_sigma=r_min / 1.414,
        max_sigma=r_max / 1.414,
        num_sigma=8,
        threshold=0.05,
        overlap=0.3,
    )
    edge = max(round(config.SPOT_EDGE_MM * px_per_mm), 1)
    inner = ndimage.binary_erosion(search, iterations=edge)  # away from eyes, brows, lips
    # Fair at every tone: a mark that reflects the same share less light is a smaller L* step
    # on deep skin (dL* ~ (L* + 16) / 3 * dlnY), so the L* thresholds shrink with this
    # person's own skin lightness below the tone they were tuned on (never grow above it).
    tone = tone_scale(float(np.median(l_star[skin])) if skin.any() else config.SPOT_TUNE_L)
    yy, xx = np.ogrid[: skin.shape[0], : skin.shape[1]]
    min_area = np.pi * (config.SPOT_MIN_CORE_MM / 2 * px_per_mm) ** 2
    holes = outline & ~skin  # eyes, lips, nostrils, brows, hair
    found = []
    for y, x, s in blobs:
        y, x = int(y), int(x)
        if not inner[y, x]:
            continue
        r = s * 1.414
        disk = ((yy - y) ** 2 + (xx - x) ** 2 <= r * r) & skin
        score = float(z[disk].mean())
        dc = float((chroma - c_bg)[disk].mean())
        dl = float((l_bg - lab[..., 0])[disk].mean())  # L* darker than nearby skin
        min_dl = tone * config.SPOT_MIN_DL * max(1.0, 2 * r / px_per_mm / config.SPOT_LARGE_MM)
        min_score = config.SPOT_STRICT_SCORE if strict[y, x] else config.SPOT_MIN_SCORE
        # (no colour test: on deep skin post-acne marks go grey-violet just like shading;
        # shadows are kept out by the guard zones and the round test below)
        if dl < min_dl or score < min_score:
            continue  # not visibly darker, or camera grain
        # true size: pixels at least half as dark as the spot's peak (the blob search blurs
        # a 0.4 mm speck, e.g. a stray lash, up to its smallest scale)
        # (peak of the lightly smoothed map: one noisy pixel would make a soft mark look tiny)
        near = ((yy - y) ** 2 + (xx - x) ** 2 <= (2 * r) ** 2) & skin
        peak = darker[near].max()
        if np.count_nonzero(near & (darker >= peak / 2)) < min_area:
            continue
        # round: lighter skin on EVERY side. A shadow edge (lips, jaw) or a hair strand
        # crossing the skin is as dark as the centre on at least one side.
        ring_dl = _ring_contrast(lab[..., 0], skin, x, y, r, px_per_mm, holes)
        diam_mm = 2 * r / px_per_mm
        min_ring = tone * max(config.SPOT_MIN_RING_DL, config.SPOT_LARGE_RING_PER_MM * diam_mm)
        if diam_mm <= config.SPOT_LARGE_MM:
            min_ring = tone * config.SPOT_MIN_RING_DL
        if ring_dl < min_ring:
            continue
        # hair around it (baby hairs at the hairline, brow strands): not a mark
        d2 = (yy - y) ** 2 + (xx - x) ** 2
        r0, r1 = (r + m * px_per_mm for m in config.SPOT_HAIR_RING_MM)
        ring = (d2 >= r0 * r0) & (d2 <= r1 * r1) & skin
        hair_ring = float(strands[ring].mean()) if ring.any() else 0.0
        if hair_ring > config.SPOT_HAIR_DENSITY:
            continue
        found.append(
            Spot(
                x=float(x * back),  # plain floats: numpy float32 is not JSON-serialisable
                y=float(y * back),
                radius=float(r * back),
                score=score,
                l_star_contrast=-dl,
                chroma_change=dc,
                area_px=round(disk.sum() * back * back),
            )
        )
    # a bigger spot that passed every test is the whole mark; small blobs inside it are
    # its darker cores, so bigger spots go first (then the stronger)
    found.sort(key=lambda s: (-round(s.radius / (px_per_mm * back), 1), -s.score))
    kept: list[Spot] = []
    gap = config.BLEMISH_MERGE_MM * px_per_mm * back
    for s in found:  # one spot found at two sizes counts once
        if all(np.hypot(s.x - k.x, s.y - k.y) > max(gap, s.radius + k.radius) for k in kept):
            kept.append(s)
    return kept


def pigment_spots(spots: list[Spot], skin_px: int) -> tuple[float, dict]:
    """Value = % of face skin covered by spots; extras count and mean darkness (L*)."""
    pct = 100.0 * sum(s.area_px for s in spots) / max(skin_px, 1)
    extras = {
        "count": len(spots),
        "mean_contrast": round(float(np.mean([-s.l_star_contrast for s in spots])), 2)
        if spots
        else 0.0,
    }
    return pct, extras
