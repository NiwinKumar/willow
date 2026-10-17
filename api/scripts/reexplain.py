"""Write the explanation again for saved sessions whose text no longer meets today's rules.

Explanations are written once, when a session is analysed, and saved with it. Sessions analysed
before the plain-words rules (no jargon, at most one number per item) keep their old text; this
rewrites them from their saved measurements (the engine is not called, no number changes).
Dry run by default.

    uv run python scripts/reexplain.py [--uid <uid>] [--session s_...] [--all] [--apply]

`--all` rewrites every measured session, not only those that fail the rules. It calls Gemini
(Vertex AI), so export the variables in infra/api-env.yaml first, as for scripts/remeasure.py.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import analysis, baselines, explain, gcp  # noqa: E402
from app.store import FirestoreStore  # noqa: E402


def _args(flag: str) -> set[str] | None:
    return {sys.argv[i + 1] for i, a in enumerate(sys.argv[:-1]) if a == flag} or None


def main() -> int:
    apply, every = "--apply" in sys.argv, "--all" in sys.argv
    uids, only = _args("--uid"), _args("--session")
    store = FirestoreStore()
    users = uids or {u.id for u in gcp.firestore_client().collection("users").list_documents()}
    changed = 0
    for uid in sorted(users):
        for sid, doc in sorted(store.sessions_list(uid), key=lambda x: str(x[1].get("created_at"))):
            if only and sid not in only:
                continue
            if doc.get("status") != "done" or not doc.get("measured") or not doc.get("result_json"):
                continue
            if not (every or only) and explain.plain_enough(doc.get("explanation")):
                continue
            result = json.loads(doc["result_json"])
            base = baselines.get(store, uid, doc["site"], doc["capture_mode"])
            context = analysis.explain_context(store, uid, doc, base, sid)
            exp, source = explain.generate(result, context)
            old = (doc.get("explanation") or {}).get("headline", "-")
            print(f"{uid} {sid} [{source}]\n  was: {old}\n  now: {exp['headline']}")
            for item in exp["items"][:3]:
                print(f"       {item['summary']}")
            if apply:
                store.session_update(uid, sid, {"explanation": exp, "explanation_source": source})
            changed += 1
    print(f"{changed} session(s) {'rewritten' if apply else 'to rewrite'}")
    print("applied" if apply else "dry run (pass --apply to write)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
