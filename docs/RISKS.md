# Known risks and pitfalls

| Risk | Mitigation |
|---|---|
| iOS converts DNG to JPEG/HEIC on upload | Pick the file from **Files** (not Photos) in Safari; api checks content type and magic bytes; verify byte-identical upload on day 1 |
| rawpy can't read the capture app's DNG variant | Day-1 smoke test; switch Lightroom/Halide format setting; worst case use 48 MP ProRAW and note processing |
| Lightroom Pro mode lens switching or no flash | Lock lens; test macro; LED inside the cone if no flash |
| Color card arrives late | Grey/white card fallback, sessions marked `semi_calibrated`; engine supports white-balance-only correction |
| MediaPipe wheel / Python 3.12 issues | Fall back to Python 3.11 in the engine image |
| Engine image too big / slow cold start | slim base, headless OpenCV, model downloaded at build; during judging (Oct 17 to Nov 6) run `--min-instances 1` on both services. Worst-case idle cost at the documented request-based idle rates ($0.0000025 per vCPU-s and per GiB-s): engine 2 vCPU + 4 GiB about $1.30/day, api 1 vCPU + 1 GiB about $0.45/day, roughly $37 (about ₹3,100) for 21 days, paid from the ₹28,796 trial credit. The ₹2,000 budget alert excludes credits, so it will fire; that is expected, not a charge. Verify the current rate on the Cloud Run pricing page before Oct 17 |
| Signed URL CORS errors | bucket CORS file in `infra/setup.sh`; tighten origins later |
| Gemini returns invalid JSON or invented numbers | response schemas + validator + single retry + template fallback |
| DHA change smaller than noise on deeper skin | Report honestly; tan-line control still shows signal; repeatability chart still proves the method |
| Scope creep | Tiers A/B/C, cut order in `SPLIT.md`, feature freeze Sat 12:00 |
| Face photos in a public repo | `.gitignore` blocks images; data only in GCS; check history before making the repo public |
| Medical-claim perception | cosmetic wording, disclaimer on every report, no disease names |
| Costs | ₹2,000/month budget with alerts at 5/25/100% (credits excluded), max instances 3, lifecycle deletes, Flash model, cached Gemini outputs |
| Gemini capacity during judging | Checked Oct 13 via the Service Usage API: `gemini-3.8-flash` has no per-project requests-per-minute bucket on this project and token quota is unlimited, i.e. Vertex dynamic shared quota (pooled capacity, nothing to request). A 429 means the shared pool is momentarily exhausted: retry once with backoff, then fall back to the template explanation. Cache explanations per session |
| Merge conflicts | strict folder ownership, contract changes only by agreement |
