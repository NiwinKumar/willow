# Known risks and pitfalls

| Risk | Mitigation |
|---|---|
| iOS converts DNG to JPEG/HEIC on upload | Pick the file from **Files** (not Photos) in Safari; api checks content type and magic bytes; verify byte-identical upload on day 1 |
| rawpy can't read the capture app's DNG variant | Day-1 smoke test; switch Lightroom/Halide format setting; worst case use 48 MP ProRAW and note processing |
| Lightroom Pro mode lens switching or no flash | Lock lens; test macro; LED inside the cone if no flash |
| Color card arrives late | Grey/white card fallback, sessions marked `semi_calibrated`; engine supports white-balance-only correction |
| MediaPipe wheel / Python 3.12 issues | Fall back to Python 3.11 in the engine image |
| Engine image too big / slow cold start | slim base, headless OpenCV, model downloaded at build; `min-instances` only during judging if needed |
| Signed URL CORS errors | bucket CORS file in `infra/setup.sh`; tighten origins later |
| Gemini returns invalid JSON or invented numbers | response schemas + validator + single retry + template fallback |
| DHA change smaller than noise on deeper skin | Report honestly; tan-line control still shows signal; repeatability chart still proves the method |
| Scope creep | Tiers A/B/C, cut order in `SPLIT.md`, feature freeze Sat 12:00 |
| Face photos in a public repo | `.gitignore` blocks images; data only in GCS; check history before making the repo public |
| Medical-claim perception | cosmetic wording, disclaimer on every report, no disease names |
| Costs | budget alerts $1/$5/$20, max instances 3, lifecycle deletes |
| Merge conflicts | strict folder ownership, contract changes only by agreement |
