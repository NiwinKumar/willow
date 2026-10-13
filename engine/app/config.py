"""All engine thresholds and constants in one place (tunable, see docs/CONTRACT.md 2.3)."""

from app import __version__

ENGINE_VERSION = __version__  # single source of truth: app/__init__.py

# Quality gates (docs/CONTRACT.md 2.3)
# Variance of Laplacian on the skin ROI (0-255 grey). Contract default was 100, but smooth
# forearm skin in sharp 12 MP iPhone DNGs scores 38-54 and a 1 px blur drops it to ~4
# (measured Oct 13 on 6 photos), so 15 separates sharp from blurry.
SHARPNESS_MIN = 15.0
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
MAX_ABS_YAW = 8.0
MAX_ABS_PITCH = 8.0
MAX_ABS_ROLL = 6.0
EYE_DISTANCE_MM = 63.0  # adult average outer-eye distance, for a rough px-per-mm scale

# pigment_spots (docs/METRICS.md A4): tone-relative threshold on the melanin proxy
SPOT_K_MAD = 3.0  # spot = melanin proxy above ROI median + k * MAD of this person's skin
SPOT_MIN_CONTRAST_MI = 2.0  # and at least ~4.5% less red light than the skin around it
SPOT_MIN_DIAMETER_MM = 1.0
SPOT_MAX_DIAMETER_MM = 10.0
EVENNESS_SMOOTH_MM = 1.0  # smooth before the within-ROI SD: blotches, not camera grain
