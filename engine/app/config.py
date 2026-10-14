"""All engine thresholds and constants in one place (tunable, see docs/CONTRACT.md 2.3)."""

from app import __version__

ENGINE_VERSION = __version__  # single source of truth: app/__init__.py

# Quality gates (docs/CONTRACT.md 2.3)
# Variance of Laplacian on the skin ROI (0-255 grey). Contract default was 100, but smooth
# forearm skin in sharp 12 MP iPhone DNGs scores 38-54 and a 1 px blur drops it to ~4
# (measured Oct 13 on 6 photos), so 15 separates sharp from blurry.
SHARPNESS_MIN = 15.0
# Faces: sharpness at a fixed 4 px per mm of face. Measured Oct 13: sharp DNG and HEIC face
# photos score 71-100, the same photos blurred by 0.3 mm score 1-2.
SHARPNESS_PX_PER_MM = 4.0
FACE_SHARPNESS_MIN = 15.0
CLIPPED_PCT_MAX = 2.0  # % of skin-ROI pixels at pure white
DARK_PCT_MAX = 2.0  # % of skin-ROI pixels at pure black
CLIP_LEVEL = 0.999  # linear value counted as clipped
DARK_LEVEL = 0.002  # linear value counted as crushed black

# Skin mask: drop the brightest/darkest tails inside the ROI (specular shine, shadows)
SKIN_LOW_PCT = 1.0
SKIN_HIGH_PCT = 99.0

# White reference (paper) must be bright but not clipped to be usable for white balance
WHITE_REF_MIN_LINEAR = 0.15
WHITE_REF_TARGET = 0.85  # paper is mapped to this linear value (office paper reflects ~85%)

# ITA bands in degrees (docs/METRICS.md A1). Descriptive only, never a score.
ITA_BANDS = [
    (55.0, "very_light"),
    (41.0, "light"),
    (28.0, "intermediate"),
    (10.0, "tan"),
    (-30.0, "brown"),
    (float("-inf"), "dark"),
]

MDC_Z = 1.96  # 95% two-sided

# Face (docs/CONTRACT.md 2.3 pose gates; docs/METRICS.md pipeline steps 5-6)
LANDMARK_MAX_SIDE = 1280  # downscale before MediaPipe; landmarks are mapped back to full res
FACE_ROI_SHRINK = 0.85  # pull ROI hulls 15% toward their centre to stay off edges
FACE_OVAL_SHRINK = 1.0  # the mesh outline itself (0.97 cut jawline marks; the jaw band and
# the round test keep the jaw edge / background out)
EYE_MARGIN_MM = 3.5  # lashes and the pink lower-lid rim (2.5 mm still caught the rim, Oct 13)
LIP_MARGIN_MM = 0.8  # lip edge
BROW_ZONE_MM = 3.0  # search this far around the brow outline for stray brow hairs
BROW_DELTA_L = 8.0  # a brow hair is this much darker than the skin around it
NOSTRIL_DELTA_L = 10.0  # a nostril opening is this much darker than the skin around it
FEATURE_EDGE_MM = 0.5  # small safety edge around cut brows / nostrils
FOREHEAD_LIFT = 2.0  # push the top outline past the hairline (2 x mesh top -> glabella); hair is trimmed by colour
# Hair inside the face mask: much darker than this person's own skin nearby (spots are
# a few L* darker, hair 20-40). Relative to the person, so it holds at every skin tone.
HAIR_DELTA_L = 15.0
HAIR_DELTA_L_GLOBAL = 25.0  # or this much darker than the face median (big hair patches)
HAIR_MARGIN_MM = 1.0
# ...or this much darker than the face median AND below this share of its chroma (black
# hair / braids are nearly grey). Oct 14 braids on deep skin: L* 17-23 vs face 42, chroma
# 3-6 vs 30; skin and marks keep most of their colour.
HAIR_GREY_DELTA_L = 12.0
HAIR_GREY_CHROMA = 0.35
HAIR_BACKGROUND_MM = 4.0  # "nearby skin" for hair darkness (Gaussian sigma)
HAIR_MAX_WIDTH_MM = 1.0  # ...and no thicker than this (an under-eye shadow is long but wide)
HAIR_MIN_LENGTH_MM = 3.0
# Facial hair: share of "strand" pixels (much darker than the skin within ~1 mm) in a
# 4 mm window. Hair is stripy; shadows are smooth and spots are single small patches.
FACIAL_HAIR_FINE_MM = 0.5
FACIAL_HAIR_DELTA_L = 6.0
FACIAL_HAIR_WINDOW_MM = 4.0
FACIAL_HAIR_DENSITY = 0.12  # thin dark shapes longer than this are hair strands, not marks  # also drop skin within 1 mm of detected hair (fine strands)
FACIAL_HAIR_MIN_AREA_MM2 = 60.0  # beard/stubble patches are bigger; a cluster of marks is not
STUBBLE_DELTA_L = 4.0  # stubble dot: this much darker than the skin within ~0.5 mm
STUBBLE_WINDOW_MM = 8.0
STUBBLE_DENSITY = 0.05  # share of stubble dots; beard ~0.11, freckles / acne <= 0.02
FOREHEAD_BAND = (0.25, 0.70)  # fraction of the way from hairline to brows: top, bottom
FOREHEAD_WIDTH = 0.70  # keep the central 70% of the forehead width (temples carry hair)
MAX_ABS_YAW = 15.0  # front view up to this turn; beyond it, a side view. Oct 14: a 9° turn
# as a side view lost half the face; the full outline still fits at 15°
# Side / three-quarter views (face_full): only the half of the face toward the camera is
# analysed. Rotation does not matter for spots, so pitch and roll limits are looser.
SIDE_MAX_YAW = 65.0
SIDE_MAX_PITCH = 15.0
SIDE_MAX_ROLL = 40.0  # head tilt; every spot test works in any direction (IMG_2545: 34)
# Scale on a turned head: eye distance shrinks with the turn, the height from the nose
# bridge (mesh 168) to the chin (152) does not. 74.9 = median on 11 front-view photos with
# the 63 mm eye scale (SD 2.6 mm), Oct 13.
FACE_HEIGHT_MM = 74.9
# Side-view skin colour test, relative to this person's visible cheek: hair (dark, grey),
# background and shine (bright, grey) drop out; marks keep enough colour to stay.
SIDE_MIN_CHROMA_FRAC = 0.5
SIDE_MAX_HUE_DEG = 25.0
SIDE_MAX_RED_SHIFT_DEG = (
    50.0  # toward red; Oct 14 inflamed cheek 28-32° redder than the clear cheek
)
SIDE_MAX_BRIGHTER_L = 15.0
SIDE_MAX_DARKER_L = 30.0
SIDE_FILL_HOLES_MM2 = 80.0
# Side-view hair at the face edge (sideburns, temples): fine texture this many times the
# skin's median AND chroma below this share of the cheek's, over a 4 mm window. Oct 13
# side views: sideburn texture 1.8-4.4x vs cheek 1.0-1.1x, chroma 17-25 vs cheek 24-29.
SIDE_HAIR_WINDOW_MM = 4.0
SIDE_HAIR_TEXTURE = 1.4
SIDE_HAIR_CHROMA = 0.9  # fill smaller holes (a 10 mm mark that lost colour stays skin)
MAX_ABS_PITCH = 8.0
MAX_ABS_ROLL = 6.0
EYE_DISTANCE_MM = 63.0  # adult average outer-eye distance, for a rough px-per-mm scale

# pigment_spots (docs/METRICS.md A4): round dots darker than nearby skin that keep their
# colour. First tuned Oct 13 on 2 normal iPhone photos with no brown marks (texture peaked
# at 2.9, shadows by the eyes/nose/lips scored 4-7 but lost colour, chroma -1.7 to -9.7).
# Re-tuned Oct 13 evening on close-up photos WITH brown marks: the old 3 mm background
# sat inside 3-8 mm marks and flattened them, and the 5 mm size cap dropped bigger marks.
# A spot must be visibly darker than this person's own skin nearby: SPOT_MIN_DL L* (L* steps
# look alike at every skin tone). Oct 13: visible brown dots 2.7-10 L*; a clear 1.5 mm mark
# on IMG_2537 -6; false hits were mostly broad 5-9 mm shading at 2-4 L*, so marks wider
# than SPOT_LARGE_MM need proportionally more (8 mm -> 6 L*).
SPOT_MIN_DL = 3.0
SPOT_LARGE_MM = 4.0
# ...and stand out from camera grain: score (darkness / fine skin texture) at least this.
# Not the main test: texture depends on the camera (sharp HEIC 0.9 L*, soft JPEG 0.5).
SPOT_MIN_SCORE = 4.0
# Round: the ring just outside the spot (SPOT_RING_MM wide), split into SPOT_RING_SECTORS
# directions, must be at least SPOT_MIN_RING_DL L* lighter than the centre in EVERY
# direction. Shadow edges by the lips/jaw and hair strands fail on one side.
SPOT_RING_MM = 1.5
SPOT_RING_SECTORS = 8
SPOT_RING_DARK_SECTORS = 1  # side allowed to be dark (a neighbour in a cluster of marks;
# 2 let lip-corner shading through on IMG_2539)
# Spots wider than SPOT_LARGE_MM need a ring contrast of SPOT_LARGE_RING_PER_MM x diameter:
# Oct 13 real 7-9 mm marks 5.7-7.8; jaw-edge shading (6 mm) 3.0.
SPOT_LARGE_RING_PER_MM = 0.55
SPOT_MIN_RING_DL = 2.0  # Oct 13: real dots 2.4-7.2; faint texture by the brows 1.5-1.7
SPOT_MIN_CORE_MM = 0.7  # the darker-than-half-peak core must be at least this wide (lashes are not)
SPOT_MAX_DIAMETER_MM = 10.0
SPOT_DIAMETER_MM = (1.0, SPOT_MAX_DIAMETER_MM)
SPOT_BACKGROUND_MM = 5.0  # "nearby skin" (Gaussian sigma), 2 passes (see below)
SPOT_BACKGROUND_EXCLUDE = 2.0  # pass 2 leaves out pixels this many spreads darker (the mark)
SPOT_TEXTURE_MM = 1.0  # skin spread = texture at this scale (sigma), not broad shading
SPOT_EDGE_MM = 0.5  # stay this far inside the search area (2 mm hid marks by the features)
SHADOW_GUARD_MM = 0.5  # margin around nose sides / under-nose / under-eye guard zones
# Hair next to a candidate: share of strand pixels (see FACIAL_HAIR_*) in a ring around
# it. A mark sits on clean skin; a hairline or brow-edge "spot" is surrounded by strands.
SPOT_HAIR_RING_MM = (0.5, 3.0)  # ring from this far outside the spot edge to this far
SPOT_HAIR_DENSITY = 0.10
# Guard bands where hair, shadow and background meet skin (dark spots AND blemishes skip
# them). Baby hairs at the hairline are too fine for the colour-based hair trim.
HAIRLINE_GUARD_MM = 3.0  # band inside the skin's outer edge above the eyes: nothing found here
# ...and up to this far in, dark spots need a score of SPOT_STRICT_SCORE. Oct 13
# IMG_2537: temple pore specks by the hair scored 9-10, a real bump by the hairline 12.
HAIRLINE_STRICT_MM = 7.0
SPOT_STRICT_SCORE = 12.0
JAW_GUARD_MM = 1.5  # band inside the skin's outer edge below the eyes (jaw, neck, background)
BROW_GUARD_MM = 3.0  # around the brow outline (stray brow hairs, brow-ridge shading)
CANTHUS_GUARD_MM = 4.0  # around each eye corner and mouth corner (deep shadow, lid redness)
SPOT_LIP_GUARD_MM = 2.5  # band around the lips for dark spots (lip edge, crease above the chin)
SPOT_NOSTRIL_GUARD_MM = 2.0  # around the nostril area for dark spots (shadow under the nose)
# (the glabella between the inner brow ends is guarded too: brow-ridge shading)
EVENNESS_SMOOTH_MM = 1.0  # smooth before the within-ROI SD: blotches, not camera grain

# Spot/blemish searches run at this scale (1 mm spots are still 6 px across); faster.
DETECT_PX_PER_MM = 6.0

# blemishes (docs/METRICS.md B2). Tuned Oct 13 on 2 normal iPhone face photos: the 3 real
# spots (2 pimples, 1 red mark) scored 3.8-5.5 in both; skin texture/noise stayed <= 3.4.
BLEMISH_MIN_SCORE = 3.5  # redness above nearby skin, in units of this person's skin spread
# On deeper skin a pimple or fresh mark is often only a little redder but clearly darker.
# Score = redness z + BLEMISH_DARK_WEIGHT x darkness z, but the spot must still be at least
# BLEMISH_MIN_RED_Z redder (pure brown marks are dark spots, not blemishes).
BLEMISH_DARK_WEIGHT = 0.5
BLEMISH_MIN_RED_Z = 1.5
BLEMISH_MIN_A_CONTRAST = 1.0  # ...and at least this much a* above nearby skin (real ones: 2.5-4.8)
# Redder for how much darker: a* rise per L* drop. Oct 13 photos: pimples/red marks 0.41-2.0;
# brown freckles 0.14-0.28 and lid rim / brow hairs 0.13-0.21 (those go to dark spots or out).
BLEMISH_MIN_RED_RATIO = 0.35
BLEMISH_DIAMETER_MM = (1.0, 5.0)
BLEMISH_BACKGROUND_MM = 3.0  # "nearby skin" (Gaussian sigma)
BLEMISH_EDGE_MM = 0.5  # ignore spots right on the mask edge (feature borders)
BLEMISH_MERGE_MM = 2.0  # detections closer than this are one blemish
NOSTRIL_GUARD_MM = 1.5  # extra band around nostrils skipped for blemishes (red crease)
BLEMISH_LIP_GUARD_MM = 1.5  # band around the lips skipped for blemishes (red lip edge)
CROP_SIZE_PX = (64, 128)  # candidate crop side, clamped to this range
CROP_CONTEXT = 3  # context crop is 3x the candidate crop

# dark_circles (docs/METRICS.md B1): each side's under-eye and cheek need this much skin
DARK_CIRCLE_MIN_MM2 = 20.0

# Alignment across the photos of one session (docs/METRICS.md step 7)
ALIGN_MATCH_MM = 3.0  # a spot in another photo within 3 mm of this one is the same spot
ALIGN_WARN_MM = 3.0  # warn if a photo's rigid landmarks still differ by more than this
