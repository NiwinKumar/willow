"""Publish judge-mode data (docs/DEMO_PLAN.md). Only consented captures (CAPTURE_PROTOCOL.md).

Sample photos for "Run the pipeline on sample photos" (no deploy needed; the api re-reads the
manifest within 5 minutes):

    uv run python scripts/seed_demo.py sample forearm_baseline --site forearm_treated \\
        --mode calibrated_raw --title "Forearm, baseline" --credit "Harshini, consent on file" \\
        path/frame_1.dng path/frame_2.dng ...
    uv run python scripts/seed_demo.py sample-from-session <uid> <session_id> <sample_id> ...
    uv run python scripts/seed_demo.py remove-sample <sample_id>
    uv run python scripts/seed_demo.py list

The real journey for "Explore a real journey": one folder per session named
YYYYMMDD_HHMM_<site>[_quick] holding its frames, analysed oldest first into the demo account
(so the first one per site becomes the baseline, exactly as for anyone):

    uv run python scripts/seed_demo.py journey path/to/journey [--reset]

The demo account's photos and results carry a temporary hold, so the bucket's 30-day lifecycle
leaves them for judging (everyone else's still go at 30 days). `journey` takes the hold off before
--reset and puts it back on everything when done. Anything else that rewrites them (remeasure.py,
backfill_previews.py) needs `hold --release` first and `hold` after. Release once judging ends;
the lifecycle then deletes them within a day.

    uv run python scripts/seed_demo.py hold [--release]
"""

import argparse
import json
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import analysis, demo, sessions, storage  # noqa: E402
from app.models import CONTENT_TYPES  # noqa: E402
from app.settings import get_settings  # noqa: E402
from app.store import FirestoreStore  # noqa: E402

SITES = ("face_full", "cheek_macro", "nose_macro", "forearm_treated", "forearm_control")


def _manifest() -> dict:
    raw = storage.read_text(demo.MANIFEST)
    return json.loads(raw) if raw else {"samples": []}


def _save_manifest(m: dict) -> None:
    storage.put_bytes(demo.MANIFEST, json.dumps(m, indent=2).encode(), "application/json")


def _upsert(entry: dict) -> None:
    demo.Sample.model_validate(entry)
    m = _manifest()
    m["samples"] = [s for s in m["samples"] if s["id"] != entry["id"]] + [entry]
    _save_manifest(m)
    print(f"sample {entry['id']}: {len(entry['frames'])} frames published")


def _publish_preview(sample_id: str, first_frame: Path) -> None:
    """A RAW frame cannot be shown in a browser: store a JPEG of frame 1 (macOS sips) that sample
    sessions copy as their preview. Same pixel grid as the engine's image_size, scaled down."""
    if first_frame.suffix.lower() != ".dng":
        return
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "preview.jpg"
        subprocess.run(
            ["sips", "-s", "format", "jpeg", "-Z", "1600", str(first_frame), "--out", str(out)],
            check=True,
            capture_output=True,
        )
        name = f"{demo.SAMPLES_PREFIX}{sample_id}/preview.jpg"
        storage.put_bytes(name, out.read_bytes(), "image/jpeg")
        print(f"preview {name}")


def _ext(path: str) -> str:
    ext = path.rsplit(".", 1)[-1].lower()
    return "jpg" if ext == "jpeg" else ext


def cmd_sample(a) -> None:
    frames = []
    for i, f in enumerate(a.files, start=1):
        name = f"frame_{i}.{_ext(f)}"
        ct = demo.EXT_CONTENT_TYPE[_ext(f)]
        storage.put_bytes(f"{demo.SAMPLES_PREFIX}{a.id}/{name}", Path(f).read_bytes(), ct)
        frames.append(name)
    _publish_preview(a.id, Path(a.files[0]))
    _upsert(_entry(a, frames))


def cmd_sample_from_session(a) -> None:
    doc = FirestoreStore().session_get(a.uid, a.session_id)
    if doc is None:
        raise SystemExit("session not found")
    frames = []
    for i, uri in enumerate(doc["frame_uris"], start=1):
        name = f"frame_{i}.{_ext(uri)}"
        storage.copy_object(storage.name_from_uri(uri), f"{demo.SAMPLES_PREFIX}{a.id}/{name}")
        frames.append(name)
    first = storage.name_from_uri(doc["frame_uris"][0])
    with tempfile.TemporaryDirectory() as tmp:
        local = Path(tmp) / Path(first).name
        local.write_bytes(storage.read_bytes(first))
        _publish_preview(a.id, local)
    a.site = a.site or doc["site"]
    a.mode = a.mode or doc["capture_mode"]
    _upsert(_entry(a, frames))


def _entry(a, frames: list[str]) -> dict:
    return {
        "id": a.id,
        "title": a.title,
        "note": a.note,
        "site": a.site,
        "capture_mode": a.mode,
        "frames": frames,
        "credit": a.credit,
        "order": a.order,
    }


def cmd_remove(a) -> None:
    m = _manifest()
    m["samples"] = [s for s in m["samples"] if s["id"] != a.id]
    _save_manifest(m)
    storage.delete_prefix(f"{demo.SAMPLES_PREFIX}{a.id}/")
    print(f"sample {a.id} removed")


def cmd_list(_a) -> None:
    for s in _manifest()["samples"]:
        print(f"{s['id']}: {s['title']} ({s['site']}, {s['capture_mode']}, {len(s['frames'])})")


def _hold(uid: str, held: bool) -> None:
    n = sum(storage.set_temporary_hold(f"{p}/{uid}/", held) for p in ("uploads", "results"))
    print(f"{uid}: {n} objects {'held' if held else 'released'}")


def cmd_hold(a) -> None:
    _hold(get_settings().demo_user_id, not a.release)


def cmd_journey(a) -> None:
    store = FirestoreStore()
    uid = get_settings().demo_user_id
    if a.reset:
        _hold(uid, False)
        store.delete_user(uid)
        storage.delete_prefix(f"uploads/{uid}/")
        storage.delete_prefix(f"results/{uid}/")
        print(f"reset {uid}")
    folders = sorted(p for p in Path(a.folder).iterdir() if p.is_dir())
    for folder in folders:
        parts = folder.name.split("_")
        when = datetime.strptime("_".join(parts[:2]), "%Y%m%d_%H%M").replace(tzinfo=UTC)
        quick = parts[-1] == "quick"
        site = "_".join(parts[2:-1] if quick else parts[2:])
        if site not in SITES:
            raise SystemExit(f"{folder.name}: unknown site {site}")
        mode = "uncalibrated" if quick else "calibrated_raw"
        files = sorted(f for f in folder.iterdir() if f.suffix.lower() in (".dng", ".jpg", ".jpeg"))
        sid = sessions.new_session_id(when)
        uris, cts = [], []
        for i, f in enumerate(files[:5], start=1):
            ct = demo.EXT_CONTENT_TYPE[_ext(f.name)]
            name = sessions.frame_object_name(uid, sid, i, CONTENT_TYPES[mode][ct])
            storage.put_bytes(name, f.read_bytes(), ct)
            uris.append(storage.object_uri(name))
            cts.append(ct)
        doc = sessions.new_doc(
            {
                "site": site,
                "capture_mode": mode,
                "n_frames": len(uris),
                "frame_uris": uris,
                "content_types": cts,
            }
        )
        doc["created_at"] = when
        store.session_set(uid, sid, doc)
        done = analysis.run(store, get_settings().bucket, uid, sid, doc)
        state = "measured" if done.get("measured") else "not measured"
        print(f"{folder.name}: {state}{', baseline' if done.get('is_baseline') else ''}")
    _hold(uid, True)


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("sample", "sample-from-session"):
        p = sub.add_parser(name)
        if name == "sample-from-session":
            p.add_argument("uid")
            p.add_argument("session_id")
        p.add_argument("id")
        p.add_argument("--title", required=True)
        p.add_argument("--note", default="")
        p.add_argument("--credit", default="")
        p.add_argument("--site", choices=SITES, required=name == "sample")
        p.add_argument(
            "--mode", choices=("calibrated_raw", "uncalibrated"), required=name == "sample"
        )
        p.add_argument("--order", type=int, default=0)
        if name == "sample":
            p.add_argument("files", nargs="+")
    sub.add_parser("remove-sample").add_argument("id")
    sub.add_parser("list")
    j = sub.add_parser("journey")
    j.add_argument("folder")
    j.add_argument("--reset", action="store_true")
    sub.add_parser("hold").add_argument("--release", action="store_true")
    a = ap.parse_args()
    {
        "sample": cmd_sample,
        "sample-from-session": cmd_sample_from_session,
        "remove-sample": cmd_remove,
        "list": cmd_list,
        "journey": cmd_journey,
        "hold": cmd_hold,
    }[a.cmd](a)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
