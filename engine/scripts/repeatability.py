"""Repeatability for the science slide (docs/METRICS.md "Validation"): run one session of
repositioned captures of the same skin and report, per metric, the mean, the
within-session SD and MDC95 (the smallest change the engine can call real).

Usage (from engine/):
  uv run python -m scripts.repeatability face ../data/<session>/*.dng
  uv run python -m scripts.repeatability forearm ../data/<session>/*.dng [--square 1]
  add --json out.json to save the table.

Photos stay local; nothing is uploaded.
"""

import argparse
import json
import sys
from pathlib import Path

from app.pipeline import analyze_forearm
from app.pipeline_face import analyze_face


def run(site: str, files: list[str], square: int = 0) -> dict:
    if site == "face":
        result = analyze_face(files)
    else:
        n = len(files)
        result = analyze_forearm(files, "forearm_treated", [None] * n, [None] * n, square=square)
    rows = []
    for m in result["metrics"]:
        value, mdc = m["value"], m["mdc95"]
        rows.append(
            {
                "metric": m["id"],
                "unit": m["unit"],
                "mean": value,
                "sd": m["within_session_sd"],
                "mdc95": mdc,
                "mdc_pct_of_mean": (
                    round(100 * mdc / abs(value), 1) if value and mdc is not None else None
                ),
            }
        )
    return {
        "site": site,
        "photos": len(files),
        "photos_used": result["frames_used"],
        "per_photo": result["quality"]["per_frame"],
        "metrics": rows,
    }


def _fmt(v) -> str:
    return "-" if v is None else f"{v:.3g}"


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="scripts.repeatability")
    p.add_argument("site", choices=["face", "forearm"])
    p.add_argument("files", nargs="+")
    p.add_argument("--square", type=int, choices=[1, 2], default=0)
    p.add_argument("--json", help="save the table here")
    args = p.parse_args(argv)
    if len(args.files) < 2:
        sys.exit("give at least 2 repositioned photos (5 recommended)")
    out = run(args.site, args.files, args.square)
    print(f"{out['site']}: {out['photos_used']}/{out['photos']} photos passed quality checks")
    print(f"{'metric':<15}{'unit':<14}{'mean':>9}{'SD':>9}{'MDC95':>9}{'MDC % mean':>12}")
    for r in out["metrics"]:
        print(
            f"{r['metric']:<15}{r['unit']:<14}{_fmt(r['mean']):>9}{_fmt(r['sd']):>9}"
            f"{_fmt(r['mdc95']):>9}{_fmt(r['mdc_pct_of_mean']):>12}"
        )
    if args.json:
        Path(args.json).write_text(json.dumps(out, indent=2))
        print(f"saved {args.json}")


if __name__ == "__main__":
    main()
