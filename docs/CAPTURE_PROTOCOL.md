# Capture protocol (owner: Harshini)

Goal: the same light, distance, angle and camera settings every time, so changes are in the skin, not the photo.

## Gear
- iPhone 17 Pro Max with **Lightroom Mobile** (free) camera in **Professional** mode, file format **DNG**. (Halide Process Zero is fine if already owned.)
- 24-patch color card (ColorChecker Classic / Mini / Passport). Until it arrives: white + 18% grey card (mark sessions `semi_calibrated` in the capture log).
- Light: one fixed lamp (or the same window at the same time of day), curtains closed, no overhead mixed lighting.
- Macro: built-in iPhone macro (move close until it switches to ultra-wide macro) + a paper/3D-printed cone (~2 cm) so distance is fixed. A small LED inside the cone if flash is unavailable in Pro mode.
- Skin-safe tape to mark forearm squares (4 x 4 cm).

## Camera settings (lock and write them down on day 1; never change after)
- Lens: 1x for face and forearm (about 35-40 cm away), macro for cheek/nose.
- ISO: lowest that gives a sharp shot (50-200). Shutter: 1/60-1/125. White balance: fixed Kelvin (e.g., 5000 K). Focus: manual, set once per site.
- No HDR, no Portrait mode, no filters, no beauty settings.

## Per session
1. Wash face, pat dry, wait 15 minutes, no makeup or products on the photographed area.
2. Card in frame next to the cheek (face) or next to the square (forearm), same plane as the skin, not shadowed.
3. Neutral expression, eyes open, hair off forehead, glasses off.
4. **Baseline sessions: 5 frames per site, fully reposition phone and body between frames.** Normal sessions: 3 frames.
5. Sites: `face_full`, `cheek_macro` (left cheek, same spot every time), `nose_macro` (optional), `forearm_treated`, `forearm_control`.
6. Transfer DNGs via AirDrop / Files to the laptop. Do not send via WhatsApp or Photos sharing (converts to JPEG).
7. Upload to `gs://<PROJECT_ID>-captures/team/{person}/{yyyymmdd_hhmm}_{site}/frame_{n}.dng` and add a row to the capture log.

## Capture log (Google Sheet or `data/capture_log.csv`, not committed)
`timestamp, person, site, mode (calibrated_raw/semi_calibrated/uncalibrated), n_frames, iso, shutter, wb_k, lens, notes (e.g. "DHA +4h")`

## Consent note (everyone photographed signs/agrees in writing, keep in Drive)
"I agree that my skin photos are used by the SkinProof hackathon team to build and demonstrate the app, stored in a private Google Cloud bucket, never committed to a public repository, and deleted after the hackathon unless I agree otherwise. I can withdraw at any time."
