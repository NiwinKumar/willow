"""Fetch the MST-E photos that scripts/instrument_retest.py uses, without the 5.6 GB download.

MST-E (Monk Skin Tone Examples, Google with TONL; https://skintone.google/mste-dataset): 19
consenting adults across all ten Monk skin tones. Terms (the dataset's README): research or
human-annotator training only, not for training ML models; images by TONL, all rights reserved.
Keep the photos out of the repo (data/ or a scratch folder) and publish counts only.

The zip is read with HTTP range requests: its directory, then only the chosen photos. Chosen:
up to PER_PERSON photos per person that are well lit, front-facing and without a mask
(mst-e_image_details.csv: lighting well_lit, pose frontal or facing_camera, mask 0), frontal
first, then by file name.

Usage (from engine/):
  uv run python -m scripts.mste_fetch <out dir> [--per-person 8]
Writes <out dir>/img/*.jpg and <out dir>/mst-e_image_details.csv.
"""

import argparse
import csv
import io
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

ZIP_URL = "https://storage.googleapis.com/mste/mst-e_data.zip"
DETAILS = "mst-e_data/mst-e_image_details.csv"
PER_PERSON = 8  # the retest then uses up to 4 per person that the app accepts as taken


class RangeFile(io.RawIOBase):
    """A read-only, seekable view of a remote file, read with HTTP range requests."""

    def __init__(self, url: str):
        self.url, self.pos = url, 0
        head = urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60)
        self.size = int(head.headers["Content-Length"])

    def seekable(self) -> bool:
        return True

    def readable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, offset: int, whence: int = 0) -> int:
        base = {0: 0, 1: self.pos, 2: self.size}[whence]
        self.pos = base + offset
        return self.pos

    def readinto(self, b) -> int:
        if self.pos >= self.size or not len(b):
            return 0
        end = min(self.pos + len(b), self.size) - 1
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
        data = urllib.request.urlopen(req, timeout=120).read()
        b[: len(data)] = data
        self.pos += len(data)
        return len(data)


def choose(details: list[dict], per_person: int, available: set[str]) -> list[str]:
    """Image IDs in the zip: well lit, front-facing, no mask; frontal first; up to per_person
    each."""
    by_person: dict[str, list[dict]] = defaultdict(list)
    front = ("frontal", "facing_camera")
    for r in details:
        if r["image_ID"] in available and r["mask"] == "0" and r["lighting"] == "well_lit":
            by_person[r["subject_name"]] += [r] if r["pose"] in front else []
    out = []
    for rows in by_person.values():
        rows.sort(key=lambda r: (r["pose"] != "frontal", r["image_ID"]))
        out += [r["image_ID"] for r in rows[:per_person]]
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="scripts.mste_fetch")
    ap.add_argument("out")
    ap.add_argument("--per-person", type=int, default=PER_PERSON)
    a = ap.parse_args(argv)
    out = Path(a.out)
    (out / "img").mkdir(parents=True, exist_ok=True)
    z = zipfile.ZipFile(io.BufferedReader(RangeFile(ZIP_URL), buffer_size=1 << 20))
    details_csv = z.read(DETAILS)
    (out / "mst-e_image_details.csv").write_bytes(details_csv)
    details = list(csv.DictReader(io.StringIO(details_csv.decode())))
    members = {
        n.rsplit("/", 1)[-1]: n
        for n in z.namelist()
        if n.startswith("mst-e_data/subject_") and n.lower().endswith(".jpg")
    }
    wanted = choose(details, a.per_person, set(members))
    for i, image_id in enumerate(wanted, 1):
        name = members[image_id]
        dest = out / "img" / name.replace("/", "__")  # mst-e_data__subject_N__<image_ID>
        if not dest.exists():
            dest.write_bytes(z.read(name))
        print(f"{i}/{len(wanted)} {dest.name}", flush=True)


if __name__ == "__main__":
    main()
