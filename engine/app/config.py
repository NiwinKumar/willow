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
