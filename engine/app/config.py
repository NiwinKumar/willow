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
FACE_OVAL_SHRINK = 0.97  # pull the face outline in 3% so the jaw edge / background stay out
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
HAIR_BACKGROUND_MM = 4.0  # "nearby skin" for hair darkness (Gaussian sigma)
HAIR_MAX_WIDTH_MM = 1.0  # ...and no thicker than this (an under-eye shadow is long but wide)
HAIR_MIN_LENGTH_MM = 3.0  # thin dark shapes longer than this are hair strands, not marks  # also drop skin within 1 mm of detected hair (fine strands)
FOREHEAD_BAND = (0.25, 0.70)  # fraction of the way from hairline to brows: top, bottom
FOREHEAD_WIDTH = 0.70  # keep the central 70% of the forehead width (temples carry hair)
MAX_ABS_YAW = 8.0
MAX_ABS_PITCH = 8.0
MAX_ABS_ROLL = 6.0
EYE_DISTANCE_MM = 63.0  # adult average outer-eye distance, for a rough px-per-mm scale

# pigment_spots (docs/METRICS.md A4): round dots darker than nearby skin that keep their
# colour. Tuned Oct 13 on 2 normal iPhone photos with no brown marks: texture peaked at
# 2.9, shadows by the eyes/nose/lips scored 4-7 but lost colour (chroma -1.7 to -9.7).
SPOT_MIN_SCORE = 3.5
SPOT_MIN_CHROMA_CHANGE = -1.0  # shadows go greyer as they darken; pigment does not
SPOT_DIAMETER_MM = (1.0, 5.0)
SPOT_BACKGROUND_MM = 3.0  # "nearby skin" (Gaussian sigma)
SPOT_EDGE_MM = 2.0  # stay this far from eyes, brows, lips, nostrils, hairline
SHADOW_GUARD_MM = 2.0  # margin around nose sides / under-nose / under-eye guard zones
SPOT_MAX_DIAMETER_MM = 10.0
EVENNESS_SMOOTH_MM = 1.0  # smooth before the within-ROI SD: blotches, not camera grain

# Spot/blemish searches run at this scale (1 mm spots are still 6 px across); faster.
DETECT_PX_PER_MM = 6.0

# blemishes (docs/METRICS.md B2). Tuned Oct 13 on 2 normal iPhone face photos: the 3 real
# spots (2 pimples, 1 red mark) scored 3.8-5.5 in both; skin texture/noise stayed <= 3.4.
BLEMISH_MIN_SCORE = 3.5  # redness above nearby skin, in units of this person's skin spread
BLEMISH_DIAMETER_MM = (1.0, 5.0)
BLEMISH_BACKGROUND_MM = 3.0  # "nearby skin" (Gaussian sigma)
BLEMISH_EDGE_MM = 0.5  # ignore spots right on the mask edge (feature borders)
BLEMISH_MERGE_MM = 2.0  # detections closer than this are one blemish
NOSTRIL_GUARD_MM = 1.5  # extra band around nostrils skipped for blemishes (red crease)
CROP_SIZE_PX = (64, 128)  # candidate crop side, clamped to this range
CROP_CONTEXT = 3  # context crop is 3x the candidate crop
