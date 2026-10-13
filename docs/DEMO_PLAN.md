# Demo plan

## Hero test: DHA self-tanner split forearm (start Tue Oct 13)
1. Mark two 4 x 4 cm squares on the inner forearm(s) with tape corners. Left = treated, right = control (nothing, or the plain moisturizer if one is used).
2. Small test spot first; wait ~1 h for any irritation.
3. **Baseline:** 5 repositioned frames per square + 5 face + 5 cheek macro.
4. Apply a measured amount (~0.5 ml) of an over-the-counter DHA self-tanner to the treated square only. Gloves; let dry; don't wash for 8 h.
5. Capture both squares at +1 h, +4 h, +8 h (if awake), +24 h (Wed), +48 h (Thu), +72 h (Fri), +96 h (Sat).
6. Same lamp, same settings, card in frame every time.
7. Also on day 1: inner vs outer forearm (tan line) as an instant positive control.
Safety: forearm only, not face; avoid broken skin; stop on irritation; sunscreen outdoors for 24 h.

Expected: published data (mostly lighter skin, contact spectrophotometer) shows ΔE ~5 at 4 h and ~13 at 24 h. Expect smaller shifts on deeper skin and with a phone; measure, don't assume.

## Judge flow (deployed link)
Landing with three buttons:
1. **Explore a real journey** (seeded read-only demo account: DHA arm test timeline + team face/macro sessions).
2. **Try with sample photos** (one tap runs the live pipeline on hosted RAW sample sessions in `demo/`; a small download pack stays as a secondary link to show the upload UI).
3. **Try your own selfie** (browser camera, "Uncalibrated: trend only" badge).
Plus: routine check (label scan + compatibility), advisor chat with multi-store links, retailer dashboard (banner: "Synthetic demo cohort").

## Video (<= 2:50; confirm the length rule)
0:00-0:15 hook ("Did your serum actually work?") | 0:15-0:40 capture (RAW, card, cone) | 0:40-1:25 proof (split arm, noise band, numbers) | 1:25-1:55 Gemini: explanation, label scan, routine clash check, advisor with store links | 1:55-2:20 retailer dashboard | 2:20-2:40 architecture (Firebase, Firestore, Cloud Run, Gemini) | 2:40-2:50 close.
