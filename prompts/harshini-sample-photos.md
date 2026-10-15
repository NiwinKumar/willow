# Sample photos for the judge tour (Oct 15)

Harshini: this is a photo job, not a code job. The judge tour (`/judge`) is live, but two of its five stops have nothing real to show:

- **Stop 1, "Measure real photos"** runs the pipeline on a hosted sample. The only sample is one forearm photo with no pen dots and no white paper, so the engine (correctly) answers "these photos could not be measured". A judge's first tap ends in a failure.
- **Stop 2, "See how Willow proves a change"** should replay our own four-day self-tanner test. Nothing was ever seeded, so it shows the illustrative data.

Please take the photos below, check them with the engine, and hand the folders to Niwin. He publishes them with `api/scripts/seed_demo.py`; no deploy is needed. Use only photos of people who agreed (yourself, or someone with a written consent note); every sample shows a credit line such as "Harshini, consent on file".

**Order of priority** (feature freeze is Sat Oct 17, 12:00):
1. Set A1 (dotted forearm sample) today. It fixes stop 1.
2. Set B (self-tanner test) starting today, so the +48 h photos land on Sat morning.
3. Sets A2 and A3 (face and close-up samples) and the daily face selfies (B4) when you can.

---

## What every forearm photo needs (the engine is strict about this)

- **Four pen dots** on the corners of a **4 x 4 cm square** on the inner forearm. Each dot is about **2-3 mm**, made with a fine black permanent marker (on deep skin a white paint marker shows better). The dots must be clearly darker (or lighter) than anything else nearby: pick a patch without moles, freckles or dark hair inside or right next to the square. Re-draw faded dots the same size before each session.
- **One square per photo.** Photograph the treated and control squares separately: through the app the engine looks for exactly one square.
- **Plain white paper** (ordinary printer paper, not glossy, not cream) lying flat on the table **right next to the arm**, at the same level as the skin and in the same light. At least a quarter of an A4 sheet in view, not in shadow, and not blown out to pure white (lower the exposure if the paper has no texture left).
- **Distance:** phone straight above the square, about **25-40 cm** away, so the square is a small part of the photo (3-20% of the photo's width). Closer than about 20 cm and the dots are no longer found as a square.
- **Same lamp, same spot on the table, same phone settings** every time. Lift the arm off the table and put it back between photos (that movement is what the noise band measures; burst mode makes the band too narrow).
- **RAW:** Lightroom Mobile, Professional mode, DNG, settings locked (ISO 100-200, shutter 1/60-1/125, fixed white balance such as 5000 K, manual focus), 1x lens. The colour card is optional; paper is what the engine uses.

## What every face photo needs

- Phone (not laptop), front camera at eye level, arm's length, facing a window or lamp so both cheeks are lit. Hair back, glasses off, no makeup, neutral face, hands away from the face. Lower the phone and line up again between photos.
- **Close-ups:** the phone about **10 cm** (a hand's width) from the cheek, with **one eye still in the photo** (the iris sets the scale). The camera app is fine (front or back camera). Keep the EXIF (don't screenshot or send through WhatsApp).
- **JPEG, not HEIC:** the publishing script only takes `.jpg` and `.dng` and silently skips HEIC. On iPhone set Settings > Camera > Formats > Most Compatible before shooting, or export the photos as JPEG.

---

## Set A: hosted samples for stop 1

Each set is one folder in `data/demo_samples/<sample_id>/` (the `data/` folder is git-ignored; never commit photos).

| Folder | Site | Photos | Notes |
|---|---|---|---|
| `forearm_dotted_raw` | forearm_control | **3 DNG**, one square, paper in view | **The important one.** Title: "Forearm, three RAW photos" |
| `face_selfies` | face_full | **5 JPEG** phone selfies | Title: "Face, five phone selfies" |
| `cheek_closeup` | cheek_macro | **3 JPEG** close-ups, one eye in view | Title: "Cheek close-up, three phone photos" |

Keep the old dot-less forearm sample; Niwin will retitle it "Forearm without pen dots: what Willow says when it cannot measure" and list it last, as an honest-failure example.

## Set B: the four-day self-tanner test for stop 2

Same plan as `docs/DEMO_PLAN.md`, now with pen dots: the treated square on the left forearm, the control square on the right. Apply about 0.5 ml of an over-the-counter DHA self-tanner to the treated square only (gloves; let it dry; no washing for 8 h). Test a small spot first; stop if the skin reacts.

| When (IST) | Treated square | Control square | Face (optional, B4) |
|---|---|---|---|
| Baseline, today before applying | **5 DNG** (repositioned between photos) | **5 DNG** | 5 selfies |
| +1 h | 3 DNG | 3 DNG | |
| +4 h | 3 DNG | 3 DNG | |
| +24 h (Fri morning) | 3 DNG | 3 DNG | 5 selfies |
| +48 h (Sat morning, before 11:00) | 3 DNG | 3 DNG | 5 selfies |

**Folders:** one per session in `data/demo_journey/`, named `YYYYMMDD_HHMM_<site>` with the **IST** time the photos were taken (Niwin converts to UTC when seeding), and `_quick` at the end for phone JPEG sessions:

```
data/demo_journey/20261015_1830_forearm_treated/   (5 DNG)
data/demo_journey/20261015_1835_forearm_control/   (5 DNG)
data/demo_journey/20261015_1840_face_full_quick/   (5 selfies)
data/demo_journey/20261015_1930_forearm_treated/   (3 DNG)
...
```

The first session of each site becomes its baseline, so the 5-photo baseline folders must have the earliest times.

**B4, daily face selfies:** a 5-photo face session each day (same place, same light, ideally someone with a visible spot or mark) also feeds the new spot diary, which follows each spot across days.

---

## Check each set before handing it over (2 minutes per folder)

From `engine/`:

```
uv run python -m app.cli analyze --site forearm_control ../data/demo_samples/forearm_dotted_raw/*.dng
uv run python -m app.cli analyze --site face_full ../data/demo_samples/face_selfies/*
uv run python -m app.cli analyze --site cheek_macro ../data/demo_samples/cheek_closeup/*
```

You want:
- **Forearm:** quality passed, every photo's square found, no "pen-dot square not found" or white-paper warning, and tone_ita and redness with confidence `measured`. If the square is not found: check the dots (size, darkness, nothing similar inside the square) and the distance.
- **Face:** at least 3 of 5 photos used; no `blurry` or `pose_out_of_range` on most.
- **Close-up:** quality passed, pores with a value, and `scale_from: iris` in the pores extras. If you get "pores need a closer photo", move closer.

For Set B, check the baseline folders the same way right after taking them, so a problem is caught before you apply the self-tanner.

## Hand-over

Zip `data/demo_samples/` and `data/demo_journey/` and send them to Niwin (Drive or AirDrop, not git), with one line per set: whose photos, and that consent is on file. Niwin runs:

```
uv run python scripts/seed_demo.py sample forearm_dotted_raw --site forearm_control --mode calibrated_raw \
    --title "Forearm, three RAW photos" --credit "Harshini, consent on file" ../data/demo_samples/forearm_dotted_raw/*.dng
uv run python scripts/seed_demo.py journey ../data/demo_journey --reset
```

and checks the judge tour end to end. The journey can be re-seeded as new days arrive (`--reset` rebuilds it).
