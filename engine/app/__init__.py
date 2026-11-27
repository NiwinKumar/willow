__version__ = "0.4.3"  # bump on every change that can move a number: baselines record it
# 0.4.3: extras.marks on blemishes and pigment_spots: every counted mark placed on its photo
# (candidates stop at max_candidates); no number moved, 0.4.x baselines compare
# 0.4.2: side photos measure the chin and around-mouth skin they see more squarely than the front
# (SIDE_FACING_MARGIN): a front + side session's blemish and dark-spot totals can move a little.
# The shift is within the noise band, so 0.4.x baselines still compare (a deliberate exception)
# 0.4.1: extras.by_zone (readings by area); no whole-face number moved, 0.4.x baselines compare
# 0.4.0: side views (#67) keep shiny/marked skin, light hair stays hair, lip and nose-fold shadows
# are not marks: side-view numbers moved, so 0.3.x baselines are not compared (measure them again)
# 0.3.4: redness overlay PNG + quality.per_frame[].regions; no number moved, so a 0.3.x
# baseline stays comparable (the api compares major.minor only)
