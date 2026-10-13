# Engine task: write an aligned preview JPEG next to the overlays (proposal 1b)

Paste everything below the line into your Claude Code session once the pipeline writes overlays (step 8 in your build order), or queue it right after the forearm metrics if that is sooner. It needs no change to `schemas/` or `docs/CONTRACT.md`.

---

Read `docs/CONTRACT_CHANGES.md`, proposal 1b (and the plain-words note above it). Implement it in the engine.

What to build:
1. After alignment, take the aligned reference frame (the one that `rois`, `candidates[].bbox` and the overlay PNGs are expressed in), convert it from linear corrected RGB to sRGB with the standard gamma, and encode it as a JPEG at quality 85. Keep it at exactly `image_size` (width x height), or at an integer downscale if the full frame would exceed 1600 px on the long edge; in that case the api reads the JPEG's own dimensions and scales everything by `preview_width / image_size.width`, so no field is needed.
2. Write it to `{output_prefix}preview.jpg` for API requests (next to `overlays/` and `crops/`), and to `{out_dir}/preview.jpg` for the CLI. Use the same GCS writer as the overlays. Do not add anything to the JSON response.
3. In `uncalibrated` mode, do the same from the decoded JPEG/HEIC after alignment.
4. If no frame passed decoding, skip the file; the api handles its absence.
5. Add a test with a synthetic frame that checks: the file exists, it decodes as a JPEG, its aspect ratio equals `image_size`, and a mid-grey patch comes out near (128,128,128) after the sRGB conversion.
6. Mention the file in `engine/README.md` under outputs.

Rules that still apply: no change to `schemas/` or `docs/CONTRACT.md`; never commit images; the JPEG is a view of the aligned frame, not a new measurement; keep the function small with a one-line comment on the sRGB conversion. Run `ruff` and `pytest`, then propose a commit message that starts with `engine:`.
