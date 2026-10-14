"""Measure saved sessions again once their site is measured (run right after an engine deploy).

Face and close-up photos taken before the engine measured those sites are stored with
`measured: false`. This re-runs them oldest first, so each person's earliest saved session becomes
their baseline and later ones are compared with it. Dry run by default.

    uv run python scripts/remeasure.py [--site face_full] [--session s_...] [--apply]

It writes to the real Firestore, so it must call the real engine: export the variables in
infra/api-env.yaml (ENGINE_MODE=http, ENGINE_URL, BUCKET, ...) and AUTH_MODE=dev (so the engine
call can use your gcloud identity token). With the default ENGINE_MODE=fixture it refuses to
apply: the contract fixture's sample numbers would be saved as measurements.

`--session` runs those sessions again even if they are already measured (after a fix).
`--all` runs every measured session again, oldest first (after an engine version change: the
baseline is measured first, so later sessions are compared with the new numbers).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import analysis, engine, gcp  # noqa: E402
from app.settings import get_settings  # noqa: E402
from app.store import FirestoreStore  # noqa: E402


def main() -> int:
    apply = "--apply" in sys.argv
    if apply and get_settings().engine_mode != "http":
        print("refusing to apply: ENGINE_MODE is not http (export infra/api-env.yaml first)")
        return 2
    if apply:
        try:  # an engine that does not answer would mark every session it touches failed
            print(f"engine {engine.health()['engine_version']} answers")
        except Exception as exc:
            print(f"refusing to apply: the engine does not answer ({exc})")
            return 2
    sites = {sys.argv[i + 1] for i, a in enumerate(sys.argv[:-1]) if a == "--site"} or None
    only = {sys.argv[i + 1] for i, a in enumerate(sys.argv[:-1]) if a == "--session"} or None
    store = FirestoreStore()
    bucket = get_settings().bucket
    every = "--all" in sys.argv
    for user in gcp.firestore_client().collection("users").list_documents():
        if every:
            only = {
                sid
                for sid, d in store.sessions_list(user.id)
                if d.get("status") == "done" and d.get("measured")
            } or None
            if only is None:
                continue
        for line in analysis.remeasure(store, bucket, user.id, sites, apply, only):
            print(line)
    print("applied" if apply else "dry run (pass --apply to write)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
