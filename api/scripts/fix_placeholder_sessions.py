"""One-off (Oct 13): sessions analysed before the api learned to ignore engine placeholders.

Marks those sessions `measured: false, is_baseline: false` and removes any baseline built from
one. Dry run by default; pass --apply to write.

    uv run python scripts/fix_placeholder_sessions.py [--apply]
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import engine, gcp  # noqa: E402


def main() -> int:
    apply = "--apply" in sys.argv
    db = gcp.firestore_client()
    for user in db.collection("users").list_documents():
        bad: set[str] = set()
        for snap in user.collection("sessions").stream():
            doc = snap.to_dict()
            if doc.get("result_json") and "measured" not in doc:
                if engine.is_placeholder(json.loads(doc["result_json"])):
                    bad.add(snap.id)
                    print(f"{user.id}/{snap.id}: placeholder result -> measured=false")
                    if apply:
                        snap.reference.update({"measured": False, "is_baseline": False})
                elif apply:
                    snap.reference.update({"measured": True})
        for base in user.collection("baselines").stream():
            if base.to_dict().get("session_id") in bad:
                print(f"{user.id}/baselines/{base.id}: built from a placeholder -> delete")
                if apply:
                    base.reference.delete()
    print("applied" if apply else "dry run (pass --apply to write)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
