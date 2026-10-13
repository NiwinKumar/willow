"""Command line: python -m app.cli analyze --site forearm_control photo1.dng photo2.dng ...

Mode is picked from the files: .dng -> calibrated_raw, .heic/.jpg -> uncalibrated.

Forearm: the skin square is found from 4 pen dots and the white paper automatically.
Face: no markers or paper; the face is found by landmarks.
--roi / --white override that: give once (same box for every photo) or once per photo, in order.
"""

import argparse
import json
from pathlib import Path

from app.pipeline import analyze_forearm
from app.pipeline_face import analyze_face
from app.roi import Box


def _per_frame(boxes: list[str] | None, n: int, name: str) -> list[Box | None]:
    if not boxes:
        return [None] * n
    if len(boxes) not in (1, n):
        raise SystemExit(f"--{name}: give it once or once per photo ({n}), got {len(boxes)}")
    parsed = [Box.parse(b) for b in boxes]
    return parsed * n if len(parsed) == 1 else parsed


def _fmt(v: float | None) -> str:
    return "-" if v is None else f"{v:.2f}"


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="app.cli")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze", help="analyze 1-5 photos of one forearm square")
    a.add_argument("files", nargs="+")
    a.add_argument(
        "--site", required=True, choices=["forearm_treated", "forearm_control", "face_full"]
    )
    a.add_argument("--roi", action="append", help="skin square x,y,w,h (default: find 4 pen dots)")
    a.add_argument(
        "--white", action="append", help="forearm only: white paper x,y,w,h (default: find paper)"
    )
    a.add_argument(
        "--square",
        type=int,
        choices=[1, 2],
        help="two dotted squares in the photo: 1 = upper one, 2 = lower one",
    )
    a.add_argument(
        "--no-white", action="store_true", help="forearm only: skip white-paper correction"
    )
    a.add_argument("--baseline", help="baseline.json: {metric_id: {mean, mdc95}}")
    a.add_argument("--out", help="directory for result.json")
    args = p.parse_args(argv)

    if not 1 <= len(args.files) <= 5:
        raise SystemExit("give 1-5 photos")
    n = len(args.files)
    baseline = json.loads(Path(args.baseline).read_text()) if args.baseline else None
    if args.site == "face_full":
        result = analyze_face(args.files, baseline=baseline)
    else:
        result = analyze_forearm(
            args.files,
            args.site,
            _per_frame(args.roi, n, "roi"),
            _per_frame(args.white, n, "white"),
            auto_white=not args.no_white,
            square=args.square or 0,
            baseline=baseline,
        )

    q = result["quality"]
    print(f"{args.site}: {result['frames_used']}/{n} photos passed quality checks")
    for f in q["per_frame"]:
        print(f"  photo {f['index'] + 1}: {'ok' if f['passed'] else ', '.join(f['reasons'])}")
    print(f"{'metric':<10}{'value':>9}{'SD':>8}{'MDC95':>8}  extras")
    for m in result["metrics"]:
        print(
            f"{m['id']:<10}{_fmt(m['value']):>9}{_fmt(m['within_session_sd']):>8}"
            f"{_fmt(m['mdc95']):>8}  {m['extras']}"
        )
    for w in result["warnings"]:
        print(f"note: {w}")
    if args.out:
        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        (out / f"{args.site}_result.json").write_text(json.dumps(result, indent=2))
        print(f"saved {out / f'{args.site}_result.json'}")


if __name__ == "__main__":
    main()
