"""Survey responses (app/survey.py) from Firestore: a count, a CSV, or a catch-up copy to the sheet.

    uv run python scripts/survey_sync.py count
    uv run python scripts/survey_sync.py csv [out.csv]     # every response, readable labels
    SURVEY_SHEET_ID=<id> uv run python scripts/survey_sync.py sheet   # rows the sheet missed

`sheet` appends every response not yet marked `sheet_synced` (and its contact), oldest first,
as the api service account (your gcloud user impersonates it, as for signed URLs).
"""

import argparse
import csv
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import survey_sheet  # noqa: E402
from app.store import FirestoreStore  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("count")
    out = sub.add_parser("csv")
    out.add_argument("path", nargs="?", default="survey_responses.csv")
    sub.add_parser("sheet")
    args = ap.parse_args()

    store = FirestoreStore()
    rows = sorted(store.survey_responses(), key=lambda r: r[1]["submitted_at"])

    if args.cmd == "count":
        print(f"{len(rows)} responses")
        print("by source:", dict(Counter(d["source"] for _, d in rows)))
        print("screened out:", sum(1 for _, d in rows if d.get("screened_out")))
        print("left an email:", sum(1 for _, d in rows if d.get("has_contact")))
        return 0

    if args.cmd == "csv":
        with open(args.path, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(survey_sheet.response_header())
            for rid, doc in rows:
                w.writerow(survey_sheet.response_row(rid, doc))
        print(f"wrote {len(rows)} responses to {args.path} (emails are not included)")
        return 0

    if not survey_sheet.enabled():
        print("Set SURVEY_SHEET_ID first.", file=sys.stderr)
        return 1
    copied = 0
    for rid, doc in rows:
        if doc.get("sheet_synced"):
            continue
        contact = store.survey_contact_get(rid) if doc.get("has_contact") else None
        if survey_sheet.copy(rid, doc, contact):
            store.survey_response_update(rid, {"sheet_synced": True})
            copied += 1
    print(f"copied {copied} responses to the sheet")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
