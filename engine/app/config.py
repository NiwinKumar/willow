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
SHARPNESS_PX_PER_MM = 4.0  # larger faces are shrunk to this; smaller ones are measured as they are
# A face fails when it is blurred by more than about 0.25 mm: a 1 mm spot (the smallest
# counted) still keeps 86% of its contrast. The same blur in mm scores higher on a
# low-resolution face, so the threshold depends on px per mm. Oct 14: median score of 3
# sharp face photos resampled to each scale and blurred by 0.25 mm. (The old fixed 15 at
# 4 px/mm meant about 0.18 mm, and failed usable webcam selfies at 3.2 px/mm.)
FACE_SHARPNESS_AT = ((2.0, 41.0), (2.5, 19.0), (2.8, 12.7), (3.2, 7.8), (3.5, 5.7), (4.0, 3.6))
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
WHITE_REF_MAX_CLIPPED = 0.05  # share of paper pixels at the clip level; more -> unusable

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
MIN_FRAMES_FOR_BAND = 3  # fewer passed photos: SD reported, no noise band (no verdicts)
# Floor on the photo-to-photo SD per metric (same units as the metric). A session whose photos
# all gave the same value is not noise-free: counts move by whole marks and webcams by a few
# tenths of a* between frames. Without a floor its band is 0 and any later change is "real".
MIN_SD = {
    "tone_ita": 0.5,  # degrees
    "redness": 0.2,  # a*
    "tone_evenness": 0.1,
    "pigment_spots": 0.05,  # % of skin area
    "blemishes": 0.5,  # marks
    "dark_circles": 0.3,  # delta L*
    "shine": 0.02,  # % of T-zone (Oct 14: SD 0.017-0.023 on two sessions)
    "glow": 1.0,  # index (Oct 14: SD 1.8-2.7, mostly lighting)
    "lines": 0.3,  # mm per cm2 (Oct 15: SD 0.27 on a 6-photo session of a young face)
    "pores": 2.0,  # per cm2 (one or two pores more or less in a ~1 cm2 field)
    "texture": 0.05,  # index
}
ROI_MIN_SKIN_FRAC = 0.5  # a region keeps its hair-free skin only if at least this much is left
UNDER_EYE_MIN_MM2 = 20.0  # less visible under-eye skin (hair, glasses): no dark-circles reading

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
MAX_ABS_PITCH = 15.0  # laptop / webcam selfies sit at 8-12° (camera above the screen); ROIs stay on
# the same skin up to 15° (canonical-mesh test in tests/test_pose.py), same as SIDE_MAX_PITCH
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
SPOT_TUNE_L = 60.0  # skin L* the L*-step thresholds were tuned on (Oct 13 photos)
SPOT_TONE_MIN_SCALE = 0.4  # deepest skin: thresholds go no lower than 40%
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
BLEMISH_HAIR_GAP_MM2 = 2.0  # holes this small in the skin mask are hair gaps, not an edge
BLEMISH_EDGE_MM = 0.5  # ignore spots right on the mask edge (feature borders)
BLEMISH_MERGE_MM = 2.0  # detections closer than this are one blemish
NOSTRIL_GUARD_MM = 1.5  # extra band around nostrils skipped for blemishes (red crease)
BLEMISH_LIP_GUARD_MM = 1.5  # band around the lips skipped for blemishes (red lip edge)
# ...widened to this where the skin is between beard hairs: Oct 14 a moustache over the lip
# gave 3 of 10 blemish candidates on a laptop selfie
BLEMISH_MOUSTACHE_GUARD_MM = 5.0
# Candidate crops for Gemini, sized on the face: the tight crop is 4x the mark's diameter
# and at least 6 mm (pixel sizes covered 20 mm at 3.2 px/mm and half the face in the
# context crop); the context crop is 3x that. Small crops are upscaled to 128 px.
CROP_SPOT_FACTOR = 4.0
CROP_MIN_MM = 6.0
CROP_MIN_OUT_PX = 128
CROP_CONTEXT = 3  # context crop is 3x the candidate crop

# Close-up sites (cheek_macro, nose_macro). Scale: the width of skin a close-up covers, so
# it holds when the app shrinks the photo. MEASURE IT with scripts/macro_scale.py (a mm
# ruler shot at the usual close-up distance); until then MACRO_SCALE_CALIBRATED is False,
# pores/texture are indicative and the result says the scale is assumed. 30 mm is roughly
# an iPhone macro shot at 2-3 cm.
MACRO_FIELD_WIDTH_MM = 30.0
MACRO_SCALE_CALIBRATED = False
MACRO_WORK_PX_PER_MM = 50.0  # close-ups are analysed at this scale (0.05 mm pore = 2.5 px)
MACRO_MIN_SKIN_CM2 = 0.5  # skin needed for a value
MACRO_EDGE_FRAC = 0.03  # ignore this share of each photo edge (vignetting, cone rim)
# pores (docs/METRICS.md A5): dark round blobs PORE_DIAMETER_MM across, PORE_MIN_SCORE x this
# person's skin texture darker than the skin within PORE_BACKGROUND_MM
PORE_DIAMETER_MM = (0.05, 0.3)
PORE_BACKGROUND_MM = 0.5
PORE_MIN_SCORE = 3.0
# texture (docs/METRICS.md A6): Laplacian energy at this scale: bumps and enlarged pores.
# Oct 15, two selfies of the same skin at 16 and 18 px/mm: at 0.1 mm the values differed
# 33-54% (it measured the camera's sharpness), at 0.4 mm 2-8%. 0.4 mm is 4 px at 10 px/mm,
# so ordinary close selfies get texture; the pore count still needs MACRO_MIN_PX_PER_MM
TEXTURE_SIGMA_MM = 0.4
TEXTURE_MIN_PX_PER_MM = 10.0
TEXTURE_EDGE_MM = 1.5  # left out along a region's edge (creases, outline shading)
# Laplacian variance at the working scale. Oct 14 synthetic close-ups: sharp skin 8-18 (smooth
# or deep skin is lower), blurred by 0.05 mm or more under 1 (pore counts break at 0.2 mm).
# From synthetic photos only: check on real macro shots.
MACRO_SHARPNESS_MIN = 2.0
# Pores and texture need detail: not measured below this many px per mm. Oct 14 synthetic
# pores 0.12 / 0.2 mm: counts within 10% of the truth at 20-100 px/mm on light, medium and
# deep skin (sizes coarser below 40). The false "pores" on real 20-35 px/mm photos were
# hairs, brows and feature edges, now left out by the face region. A phone held a hand's
# width from the face gives ~25 px/mm; a macro shot ~130.
MACRO_MIN_PX_PER_MM = 20.0
# ...and this many when the scale is only the assumed MACRO_FIELD_WIDTH_MM (no face in view
# to measure it): an ordinary photo mistaken for a macro shot is then read at 2-3x its real
# detail (Oct 14: a 736 px cheek photo, really ~10 px/mm, read as 25 and gave pores)
MACRO_MIN_PX_ASSUMED = 40.0
# Close-ups with part of the face in view (a nose close-up shows an eye): the landmarker
# needs most of a face, so the photo is also tried shrunk to these sizes on a plain canvas
CLOSEUP_SHRINK = (0.5, 0.33)
CLOSEUP_IRIS_MM = 11.7  # visible iris diameter, nearly the same in all adults: the scale
# in a face region, hair = this much darker than the region's median AND under
# CLOSEUP_HAIR_CHROMA of its chroma (black hair is grey; shaded skin keeps its colour: one
# darkness cut alone took the shaded half of a chin and a cheek, IMG_2579); in the nose
# region, nostril openings = CLOSEUP_NOSTRIL_L darker
CLOSEUP_DARKER_L = 15.0
CLOSEUP_HAIR_CHROMA = 0.6
CLOSEUP_NOSTRIL_L = 35.0
CLOSEUP_CLIPPED_L = 97.0  # and this bright is clipped glare (lit skin is kept)
CLOSEUP_MARK_EDGE_MM = 2.0  # marks this close to a region's edge are edge shadows
PORE_MARK_GAP_MM = 0.3  # pores this close to a blemish / dark spot edge are its edge
PORE_EDGE_MM = 0.3  # ...or this close to the skin's edge (nostril rim, lid, hairline)
PORE_CHAIN_MM = 1.0  # a pore with PORE_CHAIN_MIN+ neighbours this close, all in a line...
PORE_CHAIN_MIN = 5  # 3 let 4 random pores that happened to line up drop a real one
PORE_CHAIN_ELONGATION = 4.0  # ...(long axis this many x the short) is a hair or crease
TEXTURE_MAX_MDC_FRAC = 0.25  # texture becomes indicative when MDC95 > 25% of the value

# preview.jpg of the reference photo for the web (CONTRACT_CHANGES proposal 1b)
PREVIEW_MAX_SIDE = 1600  # long edge; larger photos are shrunk by a whole factor
PREVIEW_QUALITY = 85
UPLOAD_WORKERS = 8  # parallel GCS transfers (frames in, crops out)

# Hands on the face (MediaPipe hand landmarker; models/hand_landmarker.task). Oct 14 on 48
# test photos: at 0.2 confidence the only detections were a real hand and two specks a
# few px across; specks are dropped by the size rule. A hand on the chin is cut from the
# face skin; if it covers more than HAND_OCCLUSION_FRAC of the face skin the photo gets
# occlusion_suspected (contract reason code).
HAND_MIN_CONFIDENCE = 0.2
HAND_MIN_SPAN_EYES = 0.8  # a detected hand spans at least this x the outer-eye distance
HAND_MARGIN_MM = 10.0  # palm and finger edges beyond the landmarks
HAND_OCCLUSION_FRAC = 0.10

# shine (docs/METRICS.md C2): highlight = SHINE_DELTA_L brighter than the skin within
# a SHINE_WINDOW_MM local median AND below SHINE_CHROMA_FRAC of its chroma (or clipped). Oct 14 on 10
# faces: matte faces 0.5% of the T-zone (the nose-tip glint), shiny foreheads 2-27%.
SHINE_WINDOW_MM = 12.0  # local median window (a shiny patch up to ~half this wide counts whole)
SHINE_DELTA_L = 8.0
SHINE_CHROMA_FRAC = 0.8
SHINE_MIN_MM2 = 200.0  # T-zone skin needed for a value

# glow (docs/METRICS.md C3), change only: median L* + median chroma - GLOW_TEXTURE_WEIGHT x
# fine-scale L* SD (texture below GLOW_TEXTURE_MM) on the visible cheeks, shine left out.
# Provisional weights: a 1 L* texture drop counts like a 5 L* brightness rise.
GLOW_TEXTURE_MM = 0.5
GLOW_TEXTURE_WEIGHT = 5.0
# lines (docs/METRICS.md C1): dark valleys in L* / local skin L*, in the direction each
# zone's lines run, at least LINES_MIN_LENGTH_MM long; value = mm of line per cm2 (top zones)
LINES_MIN_PX_PER_MM = 3.0  # a 1.2 mm crease is 3.6 px: below this, no value
LINES_WORK_PX_PER_MM = 10.0  # analysed at this scale
# prominent lines only (Harshini, Oct 15): fine lines come and go with the light. On 8 lined
# and 8 young faces, dropping the 0.3 mm scale and asking 2.5% depth and 5 mm length took
# every young face (and a 6-photo young session) to 0; lined faces 0-9.7
LINES_SIGMAS_MM = (0.6, 1.0)  # valley widths ~1.2-2 mm (deep lines to folds)
LINES_BACKGROUND_MM = 3.0  # local skin lightness the depth is relative to
LINES_MIN_DEPTH = 0.025  # scale-normalised curvature of L*/local L* (about 2.5% darker)
LINES_MIN_ANISOTROPY = 2.0  # across-curvature this many x the along one (pores curve both)
LINES_ANGLE_TOL_DEG = 25.0  # off the zone's direction by more: texture, hair
LINES_MIN_LENGTH_MM = 5.0
LINES_MAX_WIDTH_MM = 1.5  # mean width of a piece (area / length): wider is a blob
LINES_SKELETON_PX = 1.15  # mean length of one skeleton pixel (straight 1, diagonal 1.41)
LINES_EDGE_MM = 1.5  # left out along the skin's edge (hair, brow, lid edges)
LINES_MARK_GAP_MM = 1.0  # and around blemishes and dark marks at least LINES_MARK_MIN_MM across
LINES_MARK_MIN_MM = 2.0
LINES_MIN_ZONE_MM2 = 30.0
LINES_BROW_GAP_MM = 3.0  # forehead starts this far above the brows
LINES_GLABELLA_RISE_MM = 8.0  # frown-line zone: inner brow ends up this far
LINES_GLABELLA_WIDTH = 0.6  # share of the gap between the inner brow ends
LINES_CROW_GAP_MM = 4.0  # crow's feet zone: from this far past the outer eye corner...
LINES_CROW_LENGTH_MM = 10.0  # ...this far out...
LINES_CROW_HALF_HEIGHT_MM = 8.0  # ...this far above and below the eye's axis
LINES_FOLD_BAND_MM = (-2.0, 9.0)  # nasolabial zone: this far from the nose-wing-to-mouth line
LINES_FOLD_PAST_MOUTH_MM = 5.0  # and past the mouth corner
LINES_MARIONETTE_OUT_MM = 2.0  # marionette zone: from this far outside the mouth corner...
LINES_MARIONETTE_LENGTH_MM = 18.0  # ...this far down toward the jaw...
LINES_MARIONETTE_HALF_WIDTH_MM = 5.0  # ...this wide either side
LINES_LIP_GAP_MM = 1.0  # lip zones start this far from the lip edge (and the nose base)
LINES_LIP_BELOW_MM = 8.0  # band below the lower lip
LINES_PHILTRUM_HALF_MM = 5.0  # upper-lip strip either side of the midline left out
# per-zone overrides of LINES_SIGMAS_MM / MIN_DEPTH / EDGE_MM / MIN_LENGTH_MM.
# Lips: short (lip edge to nose), fine lines on narrow skin; young faces stayed at 0 down
# to depth 0.018 (Oct 15)
# Forehead: lines run long and shallow; 0.02 and 3 mm tripled what was found on 10 lined
# foreheads (median 0.9 -> 3.0), 10 young stayed <= 1.9 (Oct 15). Crow's feet: every
# looser setting tried put young faces at 3-6 and made a 6-photo session noisy
LINES_ZONE_SETTINGS = {
    "lips": {"sigmas_mm": (0.3, 0.6), "min_depth": 0.018, "edge_mm": 0.75, "min_length_mm": 2.5},
    "forehead": {"min_depth": 0.02, "min_length_mm": 3.0},
}
# value = mean of the most lined zones. Oct 15, 10 lined vs 10 young faces: mean of all
# zones AUC 0.96, top 2 1.00 (lined >= 2.6, young <= 2.5), 6-photo session SD 0.04
LINES_TOP_ZONES = 2
LINES_LIP_FAN_MM = 25.0  # lip lines fan from this far beyond the mouth (vertical mid-lip)
LINES_MAX_BROW_RAISE = 0.8  # browInnerUp: forehead skipped (raised brows crease it)
LINES_MAX_EXPRESSION = 0.6  # smile: crow's feet and folds skipped
LINES_MAX_FROWN = 0.8  # brows down: glabella skipped
LINES_GREY_HAIR_CHROMA = 0.5  # forehead pixels under this x the zone's median chroma: grey hair
LINES_HAIR_DARKER_L = 15.0  # line skin: hair is this much darker than the face's median L*...
LINES_HAIR_CHROMA = 0.6  # ...and under this x its median chroma (shaded skin keeps its colour)
LINES_BEARD_DARKER_L = 8.0  # below the nose (beard, moustache): this much darker...
LINES_BEARD_CHROMA = 0.75  # ...and under this x the median chroma
LINES_BEARD_FRAC = 0.1  # that much of the lower face: a beard, no lines measured below the nose
GLOW_MIN_MM2 = 100.0

# Face map (app/facemap.py, docs/METRICS.md "Face map"): each mark's position on MediaPipe's
# canonical face (mm, front view) and its zone, so the api can follow a mark across sessions.
# Zone codes in candidate features are 1-based indexes into FACE_ZONES (features are numbers).
FACE_ZONES = (
    "forehead",
    "nose",
    "right_cheek",
    "left_cheek",
    "around_mouth",
    "chin",
    "right_jaw",
    "left_jaw",
)
FOREHEAD_ZONE_BELOW_BROW_MM = 8.0  # the strip between the brows counts as forehead
MOUTH_ZONE_MARGIN_MM = 5.0  # around_mouth / chin reach this far past the mouth corners and lip
FACEMAP_MAX_OUTSIDE_MM = 5.0  # a mark off the mesh edge (hairline, jaw) by more: no position
FACEMAP_MAX_SCALE = 2.0  # a mark's mm-per-px at most this times the face's median (edge-on skin)

# Alignment across the photos of one session (docs/METRICS.md step 7)
ALIGN_MATCH_MM = 3.0  # a spot in another photo within 3 mm of this one is the same spot
ALIGN_WARN_MM = 3.0  # warn if a photo's rigid landmarks still differ by more than this
