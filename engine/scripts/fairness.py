"""Fairness check for the detectors (feeds the fairness numbers / science slide).

Plants identical synthetic marks into real face photos and measures how many the engine
finds, per skin-tone band. Real marks differ between people; planted marks do not, so a
difference in the found rate between bands is the engine's, not the skin's.

  dark spot : a round 3 mm patch DL L* darker than the skin under it (colour kept)
  blemish   : a round 3 mm patch DA a* redder than the skin under it

Marks go on the visible cheeks, at least MIN_GAP_MM from each other and from anything the
engine already found. Skin tone band = the engine's own ITA band of the photo.

Usage (from engine/):
  uv run python -m scripts.fairness ../data/<folder>/*.jpg [--marks 10] [--json out.json]

Photos stay local; nothing is uploaded or written outside a temp folder.
"""

import argparse
import json
import tempfile
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from skimage.color import lab2rgb, rgb2lab

from app.landmarks import FaceNotFound, polygon_mask
from app.metrics.tone import ita_band
from app.pipeline_face import _frame

DIAMETER_MM = 3.0
MIN_GAP_MM = 6.0
FOUND_WITHIN_MM = 2.0
DARK_STEPS = (3.0, 5.0, 8.0)  # L* darker
RED_STEPS = (2.0, 4.0, 6.0)  # a* redder


def _places(frame: dict, k: int, rng: np.random.Generator) -> list[tuple[float, float]]:
    """Up to k photo-pixel centres on the visible cheeks' skin, spaced apart and away from
    marks the engine already found."""
    face, box, skin = frame["face"], frame["box"], frame["face_skin"][1]
    mm = face.px_per_mm
    shape = frame["srgb8"].shape[:2]
    cheeks = np.logical_or.reduce(
        [box.crop(polygon_mask(shape, frame["polygons"][c])) for c in face.cheeks]
    )
    r = max(round(0.5 * DIAMETER_MM * mm), 1)
    ok = cv2.erode((cheeks & skin).astype(np.uint8), np.ones((2 * r + 1, 2 * r + 1))) > 0
    taken = [(box.x + m.x, box.y + m.y) for m in (*frame["blemishes"], *frame["spots"])]
    ys, xs = np.nonzero(ok)
    out: list[tuple[float, float]] = []
    for i in rng.permutation(len(xs)):
        p = (box.x + xs[i], box.y + ys[i])
        if all(np.hypot(p[0] - q[0], p[1] - q[1]) >= MIN_GAP_MM * mm for q in taken + out):
            out.append(p)
            if len(out) == k:
                break
    return out


def _plant(srgb8: np.ndarray, places, mm: float, d_l: float, d_a: float) -> np.ndarray:
    """Soft-edged round marks shifting L* by -d_l and a* by +d_a (in CIE Lab)."""
    r = 0.5 * DIAMETER_MM * mm
    pad = int(2 * r) + 2
    out = srgb8.copy()
    for x, y in places:
        x0, y0 = int(x) - pad, int(y) - pad
        patch = out[y0 : y0 + 2 * pad, x0 : x0 + 2 * pad].astype(np.float64) / 255
        lab = rgb2lab(patch)
        yy, xx = np.mgrid[: 2 * pad, : 2 * pad]
        d = np.hypot(xx - (x - x0), yy - (y - y0))
        w = np.clip(1.0 - (d - r) / (0.25 * r), 0, 1)  # flat disk, short soft edge
        lab[..., 0] -= d_l * w
        lab[..., 1] += d_a * w
        out[y0 : y0 + 2 * pad, x0 : x0 + 2 * pad] = np.clip(lab2rgb(lab) * 255 + 0.5, 0, 255)
    return out


def _found(frame: dict, places, kind: str) -> int:
    box, mm = frame["box"], frame["face"].px_per_mm
    marks = frame["spots"] if kind == "dark_spot" else frame["blemishes"]
    pts = [(box.x + m.x, box.y + m.y) for m in marks]
    return sum(
        any(np.hypot(px - qx, py - qy) <= FOUND_WITHIN_MM * mm for qx, qy in pts)
        for px, py in places
    )


def run(files: list[str], n_marks: int = 10, seed: int = 0) -> dict:
    rng = np.random.default_rng(seed)
    per_photo = []
    with tempfile.TemporaryDirectory(prefix="willow_fair_") as tmp:
        for path in files:
            try:
                base = _frame(path)
            except FaceNotFound:
                per_photo.append({"photo": Path(path).name, "error": "face_not_found"})
                continue
            ita = base["values"]["tone_ita"]
            places = _places(base, n_marks, rng)
            row = {
                "photo": Path(path).name,
                "view": base["view"],
                "ita": round(ita, 1),
                "band": ita_band(ita),
                "px_per_mm": round(base["face"].px_per_mm, 1),
                "marks": len(places),
                "found": {},
            }
            if not places:
                row["error"] = "no room on the cheeks"
                per_photo.append(row)
                continue
            mm = base["face"].px_per_mm
            for kind, steps in (("dark_spot", DARK_STEPS), ("blemish", RED_STEPS)):
                for step in steps:
                    img = _plant(
                        base["srgb8"],
                        places,
                        mm,
                        d_l=step if kind == "dark_spot" else 0.0,
                        d_a=step if kind == "blemish" else 0.0,
                    )
                    p = Path(tmp) / f"planted_{kind}_{step}.png"
                    Image.fromarray(img).save(p)
                    row["found"][f"{kind}@{step:g}"] = _found(_frame(str(p)), places, kind)
            per_photo.append(row)
    by_band: dict = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for row in per_photo:
        for key, n in row.get("found", {}).items():
            by_band[row["band"]][key][0] += n
            by_band[row["band"]][key][1] += row["marks"]
    bands = {b: {k: round(100 * f / t, 1) for k, (f, t) in v.items()} for b, v in by_band.items()}
    return {"per_photo": per_photo, "found_pct_by_band": bands}


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="scripts.fairness")
    p.add_argument("files", nargs="+")
    p.add_argument("--marks", type=int, default=10, help="planted marks per photo")
    p.add_argument("--json", help="save the results here")
    args = p.parse_args(argv)
    out = run(args.files, args.marks)
    keys = [f"dark_spot@{s:g}" for s in DARK_STEPS] + [f"blemish@{s:g}" for s in RED_STEPS]
    print(f"{'photo':<22}{'band':<14}{'ITA':>6}  " + "  ".join(f"{k:>13}" for k in keys))
    for r in out["per_photo"]:
        if "error" in r:
            print(f"{r['photo']:<22}{r['error']}")
            continue
        cells = [f"{r['found'][k]}/{r['marks']}" for k in keys]
        print(
            f"{r['photo']:<22}{r['band']:<14}{r['ita']:>6}  " + "  ".join(f"{c:>13}" for c in cells)
        )
    print("\nfound % by skin-tone band (planted marks of the same strength):")
    for band, v in out["found_pct_by_band"].items():
        print(f"  {band:<14}" + "  ".join(f"{k} {v[k]:>5}%" for k in keys if k in v))
    if args.json:
        Path(args.json).write_text(json.dumps(out, indent=2))
        print(f"saved {args.json}")


if __name__ == "__main__":
    main()
