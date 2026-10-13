"""Measure saved sessions again once their site is measured (run right after an engine deploy).

Face and close-up photos taken before the engine measured those sites are stored with
`measured: false`. This re-runs them oldest first, so each person's earliest saved session becomes
their baseline and later ones are compared with it. Dry run by default.

    uv run python scripts/remeasure.py [--site face_full] [--apply]
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import analysis, gcp  # noqa: E402
from app.settings import get_settings  # noqa: E402
from app.store import FirestoreStore  # noqa: E402


def main() -> int:
    apply = "--apply" in sys.argv
    sites = {sys.argv[i + 1] for i, a in enumerate(sys.argv[:-1]) if a == "--site"} or None
    store = FirestoreStore()
    bucket = get_settings().bucket
    for user in gcp.firestore_client().collection("users").list_documents():
        for line in analysis.remeasure(store, bucket, user.id, sites, apply):
            print(line)
    print("applied" if apply else "dry run (pass --apply to write)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
