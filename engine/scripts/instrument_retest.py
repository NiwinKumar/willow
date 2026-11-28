"""Instrument retest: how often the engine calls "changed beyond your normal range" when nothing
changed. Real face photos, simulated retakes (not people over weeks).

For each source photo the script makes "same skin, new photo" retakes that mimic someone taking
the photo again minutes later in another room: exposure, white balance, a small turn, scale and
shift, mild blur and sensor noise, a new JPEG. The light belongs to the room: each check-in draws
its own exposure and white balance (ROOM), and each photo in it adds a small wobble of its own
plus its own framing, blur, noise and JPEG (PHOTO). Then, as the app does:

  baseline   5 retakes in one check-in (the band needs at least 3 usable; api baselines.py)
  check-ins  TESTS further check-ins of 3 retakes each, compared with that baseline
             (engine aggregate.summarize: "real_change" when |delta| > the baseline's mdc95)

Only source photos the app accepts as taken are retaken (check_source; a head bent down tests
the pose gate, not the noise band), up to --per-person per person; the rest are counted. The
skin did not change, so every "real_change" is a false alarm. Quality-gate rejections
(retakes the engine refuses) are counted, not dropped. Tone band = the engine's own ITA band
of the baseline (fairness.py does the same); the dataset's MST label is kept alongside.

Ranges (ROOM, PHOTO) stay inside what the engine's quality gates accept for a careful retake
(app/config.py): roll well under MAX_ABS_ROLL (6 deg), blur well under the 0.25 mm the face
sharpness gate fails, exposure that keeps clipping under CLIPPED_PCT_MAX. A retake that still
trips a gate is rejected by the engine as it would be in the app.

Usage (from engine/; photos stay local, nothing is uploaded; docs/EVIDENCE.md has the full
command, and scripts/mste_fetch.py fetches the photos):
  uv run python -m scripts.instrument_retest <photo dir> --meta <details.csv> --json out.json \
      [--evidence ../web/src/data/evidence.json] [--workers 4] [--tests 2] [--seed 7]

<details.csv>: the MST-E file mst-e_image_details.csv (image_ID, subject_name, MST); optional.
--evidence writes the summary under the key `instrument_retest` (other keys are kept).
"""

import argparse
import csv
import json
import os
import statistics
import tempfile
import time
import zlib
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

LONG_EDGE = 2400  # sources resized to the size of the app's own sample photos (1792 x 2400)
BASELINE_PHOTOS = 5
CHECKIN_PHOTOS = 3  # a later face check-in (web checkin/model.ts neededFor)
COUNTS = ("blemishes", "pigment_spots")  # api baselines.CONFIRMED_COUNTS
# Each draw is uniform within these ranges. ROOM: once per check-in (the room's light after the
# phone's auto-exposure and auto white balance). PHOTO: once per photo of that check-in.
ROOM = {
    "exposure_ev": (-0.5, 0.5),  # stops, in linear light
    "wb_gain": (-0.06, 0.06),  # red and blue gains vs green (auto white balance off by up to 6%)
}
PHOTO = {
    "exposure_ev": (-0.1, 0.1),  # the phone re-metering between shots
    "wb_gain": (-0.01, 0.01),
    "roll_deg": (-3.0, 3.0),  # head tilt; the pose gate fails beyond 6
    "scale": (0.92, 1.08),  # a little nearer or further
    "shift_frac": (-0.03, 0.03),  # framing, of the image size
    "blur_px": (0.0, 0.6),  # Gaussian sigma at 2400 px (about 0.1 mm on these faces)
    "noise": (0.0, 2.0),  # sensor noise, SD in 8-bit levels
    "jpeg_quality": (80, 95),
}


def _srgb_to_linear(x: np.ndarray) -> np.ndarray:
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def _linear_to_srgb(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * x ** (1 / 2.4) - 0.055)


def draw_room(rng: np.random.Generator) -> dict:
    return {
        "exposure_ev": float(rng.uniform(*ROOM["exposure_ev"])),
        "wb_r": float(rng.uniform(*ROOM["wb_gain"])),
        "wb_b": float(rng.uniform(*ROOM["wb_gain"])),
    }


def draw_retake(rng: np.random.Generator, room: dict) -> dict:
    p = {k: float(rng.uniform(*r)) for k, r in PHOTO.items() if k not in ("wb_gain", "shift_frac")}
    p["exposure_ev"] += room["exposure_ev"]
    p["wb_r"] = room["wb_r"] + float(rng.uniform(*PHOTO["wb_gain"]))
    p["wb_b"] = room["wb_b"] + float(rng.uniform(*PHOTO["wb_gain"]))
    p["shift_x"], p["shift_y"] = (float(rng.uniform(*PHOTO["shift_frac"])) for _ in range(2))
    p["jpeg_quality"] = round(p["jpeg_quality"])
    return p


def retake(srgb8: np.ndarray, p: dict, rng: np.random.Generator) -> np.ndarray:
    """One simulated retake of an 8-bit sRGB photo (same size out)."""
    lin = _srgb_to_linear(srgb8.astype(np.float32) / 255.0)
    gains = np.array([1 + p["wb_r"], 1.0, 1 + p["wb_b"]], np.float32) * 2 ** p["exposure_ev"]
    out = (_linear_to_srgb(lin * gains) * 255.0).astype(np.float32)
    h, w = out.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), p["roll_deg"], p["scale"])
    m[:, 2] += (p["shift_x"] * w, p["shift_y"] * h)
    out = cv2.warpAffine(out, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    if p["blur_px"] > 0.05:
        out = cv2.GaussianBlur(out, (0, 0), p["blur_px"])
    out = out + rng.normal(0.0, p["noise"], out.shape).astype(np.float32)
    return np.clip(np.round(out), 0, 255).astype(np.uint8)


def _baseline_map(result: dict) -> dict:
    """The api's baseline map (baselines.build + for_request) from a measured session."""
    return {
        m["id"]: {"mean": m["value"], "mdc95": m.get("mdc95"), "n_frames": result["frames_used"]}
        for m in result["metrics"]
        if m["value"] is not None and m["verdict"] != "low_quality"
    }


def _guard_counts(result: dict, base_frames: int) -> None:
    """api baselines.guard_counts: counts are not compared when only one side had 2+ photos."""
    if (base_frames >= 2) == (result["frames_used"] >= 2):
        return
    for m in result["metrics"]:
        if m["id"] in COUNTS and m.get("delta") is not None:
            m.update(delta=None, verdict="no_baseline", direction="none")


def _rejections(result: dict) -> list[str]:
    """One entry per retake the engine did not use: its first reason (or 'failed')."""
    return [
        (f["reasons"] or ["failed"])[0] for f in result["quality"]["per_frame"] if not f["passed"]
    ]


def _source(path: str) -> np.ndarray:
    """The source photo, upright sRGB, shrunk to LONG_EDGE (worker process)."""
    os.environ.setdefault("ENGINE_FRAME_WORKERS", "1")
    cv2.setNumThreads(1)
    from app.decode import load_photo_srgb8

    srgb8, _ = load_photo_srgb8(path)
    k = LONG_EDGE / max(srgb8.shape[:2])
    if k < 1:
        srgb8 = cv2.resize(srgb8, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    return srgb8


def check_source(path: str) -> list[str]:
    """Would the app take this photo as it is? [] when it passes, else the quality reasons.
    Only photos the app accepts are retaken: a photo of a head bent down tests the pose gate,
    not the noise band."""
    from app.pipeline_face import analyze_face

    with tempfile.TemporaryDirectory(prefix="retest_src_") as tmp:
        f = Path(tmp) / "source.jpg"
        Image.fromarray(_source(path)).save(f, quality=95)
        r = analyze_face([str(f)])
    return [] if r["quality"]["passed"] else (r["quality"]["reasons"] or ["failed"])


def run_source(job: tuple[str, dict, int, int]) -> dict:
    """Baseline + tests for one source photo, in a worker process."""
    path, meta, seed, tests = job
    from app.aggregate import mdc95
    from app.metrics.tone import ita_band
    from app.pipeline_face import analyze_face

    name = Path(path).name
    rng = np.random.default_rng([seed, zlib.crc32(name.encode())])  # own draws per photo
    srgb8 = _source(path)
    row = {"photo": name, **meta, "retakes": 0, "rejected": [], "checkins": []}
    with tempfile.TemporaryDirectory(prefix="retest_") as tmp:

        def photos(n: int, tag: str) -> list[str]:
            """One check-in: n retakes in one room."""
            room, files = draw_room(rng), []
            for i in range(n):
                p = draw_retake(rng, room)
                f = Path(tmp) / f"{tag}_{i}.jpg"
                Image.fromarray(retake(srgb8, p, rng)).save(f, quality=p["jpeg_quality"])
                files.append(str(f))
            row["retakes"] += n
            return files

        base = analyze_face(photos(BASELINE_PHOTOS, "base"))
        row["rejected"] += _rejections(base)
        row["baseline_frames"] = base["frames_used"]
        ita = next(m["value"] for m in base["metrics"] if m["id"] == "tone_ita")
        row["ita"] = None if ita is None else round(ita, 1)
        row["band"] = None if ita is None else ita_band(ita)
        if base["frames_used"] < 3:  # no normal range: the app gives no verdicts against it
            row["baseline_failed"] = True
            return row
        bmap = _baseline_map(base)
        row["mdc95"] = {k: v["mdc95"] for k, v in bmap.items()}
        # the band from the five photos' own spread, before any light floor (learn_floors)
        within = {
            m["id"]: mdc95(m["within_session_sd"], base["frames_used"])
            for m in base["metrics"]
            if m["within_session_sd"] is not None
        }
        for t in range(tests):
            res = analyze_face(photos(CHECKIN_PHOTOS, f"test{t}"), baseline=bmap)
            row["rejected"] += _rejections(res)
            _guard_counts(res, base["frames_used"])
            row["checkins"].append(
                {
                    "frames_used": res["frames_used"],
                    "metrics": {
                        m["id"]: {
                            "verdict": m["verdict"],
                            "delta": m["delta"],
                            "mdc95": bmap.get(m["id"], {}).get("mdc95"),
                            "within_band": within.get(m["id"]),
                        }
                        for m in res["metrics"]
                    },
                }
            )
    return row


MST_GROUPS = ("mst_1_3", "mst_4_7", "mst_8_10")


def _mst_group(mst: int | None) -> str | None:
    if mst is None:
        return None
    return "mst_1_3" if mst <= 3 else "mst_4_7" if mst <= 7 else "mst_8_10"


def summarize(rows: list[dict], sources: dict | None = None) -> dict:
    """Per metric and per ITA band: pairs with a verdict, false "changed" alarms, median
    |delta| / mdc95; plus every refusal on the way."""
    metric_ids = sorted({mid for r in rows for c in r["checkins"] for mid in c["metrics"]})
    cells: dict = defaultdict(
        lambda: {"pairs": 0, "false_change": 0, "ratios": [], "bands": [], "no_verdict": 0}
    )
    for r in rows:
        for c in r["checkins"]:
            for mid, m in c["metrics"].items():
                for key in ((mid, "all"), (mid, r["band"]), (mid, _mst_group(r.get("mst")))):
                    cell = cells[key]
                    if m["verdict"] in ("real_change", "within_noise"):
                        cell["pairs"] += 1
                        cell["false_change"] += m["verdict"] == "real_change"
                        if m["mdc95"]:
                            cell["ratios"].append(abs(m["delta"]) / m["mdc95"])
                            cell["bands"].append(m["mdc95"])
                    else:
                        cell["no_verdict"] += 1

    def out(cell: dict) -> dict:
        n = cell["pairs"]
        return {
            "pairs": n,
            "false_change": cell["false_change"],
            "false_change_pct": round(100 * cell["false_change"] / n, 1) if n else None,
            "median_delta_over_band": round(statistics.median(cell["ratios"]), 2)
            if cell["ratios"]
            else None,
            # how wide the normal range was: few false alarms from a very wide band is no feat
            "median_band": round(statistics.median(cell["bands"]), 3) if cell["bands"] else None,
            "no_verdict": cell["no_verdict"],
        }

    bands = [
        b
        for b in ("very_light", "light", "intermediate", "tan", "brown", "dark")
        if any(r["band"] == b for r in rows)
    ]
    by_band = {}
    for b in bands:
        rb = [r for r in rows if r["band"] == b]
        mst = sorted({r["mst"] for r in rb if r.get("mst") is not None})
        by_band[b] = {
            "photos": len(rb),
            "people": len({r.get("subject") for r in rb}),
            "mst": [mst[0], mst[-1]] if mst else None,
            "with_baseline": sum(not r.get("baseline_failed") for r in rb),
            "checkins": sum(len(r["checkins"]) for r in rb),
            "metrics": {mid: out(cells[(mid, b)]) for mid in metric_ids},
        }
    # the expert Monk label is the person's; the ITA group is the photo's (light moves it)
    by_mst = {}
    for g in MST_GROUPS:
        rg = [r for r in rows if _mst_group(r.get("mst")) == g]
        if rg:
            by_mst[g] = {
                "photos": len(rg),
                "people": len({r.get("subject") for r in rg}),
                "with_baseline": sum(not r.get("baseline_failed") for r in rg),
                "checkins": sum(len(r["checkins"]) for r in rg),
                "metrics": {mid: out(cells[(mid, g)]) for mid in metric_ids},
            }
    rejected = Counter(x for r in rows for x in r["rejected"])
    all_pairs = sum(cells[(mid, "all")]["pairs"] for mid in metric_ids)
    all_false = sum(cells[(mid, "all")]["false_change"] for mid in metric_ids)
    checkin_any = [
        any(m["verdict"] == "real_change" for m in c["metrics"].values())
        for r in rows
        for c in r["checkins"]
    ]
    return {
        # source photos looked at, and those the app would refuse as taken (not retaken)
        **(sources or {}),
        "photos": len(rows),
        "people": len({r.get("subject") for r in rows}),
        "photos_with_baseline": sum(not r.get("baseline_failed") for r in rows),
        "baselines_failed": sum(bool(r.get("baseline_failed")) for r in rows),
        "retakes": sum(r["retakes"] for r in rows),
        "retakes_rejected": sum(rejected.values()),
        "rejected_by_reason": dict(rejected.most_common()),
        "checkins": len(checkin_any),
        # every photo of the check-in refused by the quality checks: no reading, no verdict
        "checkins_refused": sum(not c["frames_used"] for r in rows for c in r["checkins"]),
        "checkins_with_any_false_change": sum(checkin_any),
        "pairs": all_pairs,
        "false_change": all_false,
        "false_change_pct": round(100 * all_false / all_pairs, 1) if all_pairs else None,
        "metrics": {mid: out(cells[(mid, "all")]) for mid in metric_ids},
        "by_band": by_band,
        "by_mst": by_mst,
    }


# Colour and light readings: they move with a room's light, not only with the skin. A floor on
# their normal range is learned from the run (learn_floors) and kept in app/config.py.
LIGHT_READINGS = ("tone_ita", "redness", "glow", "shine", "tone_evenness", "dark_circles")


def split_people(rows: list[dict], seed: int) -> set[str]:
    """Half of the people, fixed by the seed and balanced across Monk groups: the floors are
    learned on them and checked on the other half (no person is in both)."""
    import random

    by_group: dict = defaultdict(set)
    for r in rows:
        by_group[_mst_group(r.get("mst")) or ""].add(r.get("subject", r["photo"]))
    rng, learn = random.Random(seed), set()
    for g in sorted(by_group):
        people = sorted(by_group[g])
        rng.shuffle(people)
        learn |= set(people[::2])
    return learn


def _pairs(rows: list[dict], mid: str) -> list[tuple[float, float, dict]]:
    """(|delta|, within-session band of the baseline, row) for every compared check-in."""
    out = []
    for r in rows:
        for c in r["checkins"]:
            m = c["metrics"].get(mid) or {}
            if m.get("verdict") in ("real_change", "within_noise") and m.get("mdc95"):
                out.append((abs(m["delta"]), m.get("within_band", m["mdc95"]), r))
    return out


def _q95(x: list[float]) -> float:
    return float(np.percentile(x, 95)) if x else 0.0


def learn_floors(rows: list[dict], seed: int) -> dict:
    """Floors for the light readings, learned on one half of the people: the 95th percentile of
    how far a check-in in another room moved from its baseline when nothing changed. Checked on
    the other half: false "changed" calls with the within-session band alone (before) and with
    max(band, floor) (after), per reading and per Monk group; and what the floor costs, the
    smallest change it can now call, as a share of the old band."""
    learn = split_people(rows, seed)
    train = [r for r in rows if r.get("subject") in learn]
    test = [r for r in rows if r.get("subject") not in learn]
    floors = {mid: round(_q95([d for d, _, _ in _pairs(train, mid)]), 2) for mid in LIGHT_READINGS}

    def rates(rs: list[dict], mid: str) -> dict:
        pairs, floor = _pairs(rs, mid), floors.get(mid, 0.0)
        before = sum(d > b for d, b, _ in pairs)
        after = sum(d > max(b, floor) for d, b, _ in pairs)
        n = len(pairs)
        return {
            "pairs": n,
            "before": before,
            "after": after,
            "before_pct": round(100 * before / n, 1) if n else None,
            "after_pct": round(100 * after / n, 1) if n else None,
        }

    metric_ids = sorted({mid for r in rows for c in r["checkins"] for mid in c["metrics"]})
    all_bands = {mid: [b for _, b, _ in _pairs(rows, mid)] for mid in LIGHT_READINGS}
    return {
        "seed": seed,
        "learn_people": len(learn),
        "check_people": len({r.get("subject") for r in test}),
        "check_photos": len(test),
        "check_checkins": sum(len(r["checkins"]) for r in test),
        "floors": floors,
        # the cost: a change smaller than the floor is no longer called, however steady the
        # person's own photos are (median within-session band of the run for comparison)
        "median_band_before": {
            mid: round(statistics.median(b), 3) if b else None for mid, b in all_bands.items()
        },
        "metrics": {mid: rates(test, mid) for mid in metric_ids},
        "by_mst": {
            g: {
                mid: rates([r for r in test if _mst_group(r.get("mst")) == g], mid)
                for mid in metric_ids
            }
            for g in MST_GROUPS
            if any(_mst_group(r.get("mst")) == g for r in test)
        },
        "all": {
            k: sum(rates(test, mid)[k] for mid in metric_ids) for k in ("pairs", "before", "after")
        },
    }


def _meta(details: str | None) -> dict[str, dict]:
    if not details:
        return {}
    with open(details, newline="") as f:
        return {
            r["image_ID"]: {"subject": r["subject_name"], "mst": int(r["MST"])}
            for r in csv.DictReader(f)
        }


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="scripts.instrument_retest")
    ap.add_argument("photos", help="folder of source face photos (JPEG)")
    ap.add_argument("--meta", help="MST-E mst-e_image_details.csv")
    ap.add_argument("--json", required=True, help="full per-photo results")
    ap.add_argument("--evidence", help="web/src/data/evidence.json: write instrument_retest")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--tests", type=int, default=2, help="check-ins per baseline")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--source", default="", help="where the photos come from (one line)")
    ap.add_argument("--licence", default="", help="their terms (one line)")
    ap.add_argument("--per-person", type=int, default=4, help="photos per person retaken")
    ap.add_argument(
        "--learn-floors",
        action="store_true",
        help="with --summary-only: learn the light floors on half the people, check the rest",
    )
    ap.add_argument(
        "--summary-only",
        action="store_true",
        help="recompute the summary from the saved --json rows (no measuring)",
    )
    a = ap.parse_args(argv)
    if a.summary_only:  # the counts again from a finished run (a new grouping, say)
        saved = json.loads(Path(a.json).read_text())
        keep = {k: v for k, v in saved["summary"].items() if k not in SUMMARY_KEYS}
        summary = {**summarize(saved["rows"]), **keep}
        if a.learn_floors:
            summary["floor_check"] = learn_floors(saved["rows"], a.seed)
            print(json.dumps(summary["floor_check"]["floors"]))
        _write(a, summary, saved["rows"])
        return

    meta = _meta(a.meta)
    files = sorted(p for p in Path(a.photos).iterdir() if p.suffix.lower() in (".jpg", ".jpeg"))
    info = {f: meta.get(f.name.split("__")[-1], {}) for f in files}  # mst-e_data__subject_N__<ID>
    t0 = time.time()
    rows = []
    with ProcessPoolExecutor(max_workers=a.workers) as pool:
        # 1. which photos the app would accept as taken; up to --per-person of those per person
        refused = dict(zip(files, pool.map(check_source, [str(f) for f in files]), strict=True))
        taken: Counter = Counter()
        jobs = []
        for f in files:
            who = info[f].get("subject", f.name)
            if not refused[f] and taken[who] < a.per_person:
                taken[who] += 1
                jobs.append((str(f), info[f], a.seed, a.tests))
        reasons = Counter(r[0] for r in refused.values() if r)
        sources = {
            "source_photos_checked": len(files),
            "source_photos_refused": sum(bool(r) for r in refused.values()),
            "source_refused_by_reason": dict(reasons.most_common()),
            "people_checked": len({info[f].get("subject", f.name) for f in files}),
        }
        print(f"sources: {sources}; retaking {len(jobs)}", flush=True)
        # 2. baseline and check-ins for each
        for row in pool.map(run_source, jobs):
            rows.append(row)
            fa = sum(
                m["verdict"] == "real_change"
                for c in row["checkins"]
                for m in c["metrics"].values()
            )
            print(
                f"{len(rows):3d}/{len(jobs)} {row['photo'][-40:]:<40} band={row.get('band')} "
                f"base={row.get('baseline_frames')}/5 rejected={len(row['rejected'])} "
                f"false_changes={fa}",
                flush=True,
            )
    summary = summarize(rows, sources)
    from app import config

    summary.update(
        {
            "run_at": datetime.now(UTC).strftime("%Y-%m-%d"),
            "engine_version": config.ENGINE_VERSION,
            "source": a.source,
            "licence": a.licence,
            "baseline_photos": BASELINE_PHOTOS,
            "checkin_photos": CHECKIN_PHOTOS,
            "tests_per_baseline": a.tests,
            "per_person": a.per_person,
            "retake_ranges": {"room": ROOM, "photo": PHOTO},
            "long_edge_px": LONG_EDGE,
            "seed": a.seed,
            "minutes": round((time.time() - t0) / 60, 1),
        }
    )
    _write(a, summary, rows)


# what summarize() computes (the rest of a saved summary describes the run)
SUMMARY_KEYS = {
    "photos", "people", "photos_with_baseline", "baselines_failed", "retakes",
    "retakes_rejected", "rejected_by_reason", "checkins", "checkins_refused",
    "checkins_with_any_false_change", "pairs", "false_change", "false_change_pct", "metrics",
    "by_band", "by_mst", "floor_check",
}  # fmt: skip


def _write(a: argparse.Namespace, summary: dict, rows: list[dict]) -> None:
    Path(a.json).write_text(json.dumps({"summary": summary, "rows": rows}, indent=1))
    skip = ("by_band", "by_mst", "metrics", "retake_ranges")
    print(json.dumps({k: v for k, v in summary.items() if k not in skip}, indent=1))
    if a.evidence:
        path = Path(a.evidence)
        data = json.loads(path.read_text()) if path.exists() else {}  # read right before writing
        data["instrument_retest"] = summary
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote instrument_retest into {path}")


if __name__ == "__main__":
    main()
