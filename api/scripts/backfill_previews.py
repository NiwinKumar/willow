"""Write the small WebP preview (app/previews.py) for sessions analysed before the api made one.

New analyses write it themselves; this fills in older sessions from their saved preview.jpg (the
engine is not called, nothing else changes). Dry run by default; the demo account unless --uid.

    uv run python scripts/backfill_previews.py [--uid <uid> ...] [--apply]

Needs Application Default Credentials that may read and write the captures bucket (BUCKET as in
infra/api-env.yaml).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import previews, storage, views  # noqa: E402
from app.settings import get_settings  # noqa: E402


def main() -> int:
    apply = "--apply" in sys.argv
    uids = [sys.argv[i + 1] for i, a in enumerate(sys.argv[:-1]) if a == "--uid"]
    for uid in uids or [get_settings().demo_user_id]:
        names = storage.list_names(views.results_prefix(uid), ("**/preview.jpg",))
        for jpeg in sorted(n for n in names if n.count("/") == 3):  # results/uid/sid/preview.jpg
            if not apply:
                print(f"{jpeg}: would write {previews.webp_name(jpeg)}")
                continue
            name = previews.publish(jpeg)
            size = storage.object_info(name).size if name else None
            print(f"{jpeg}: {f'{name} ({size} bytes)' if name else 'failed'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
