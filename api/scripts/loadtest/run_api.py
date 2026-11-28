"""The real api, locally, for the load test (infra/README.md "Scale").

Real routes, real analysis flow, the real engine client (ENGINE_MODE=http) pointed at
engine_pool.py; fixture auth (X-Dev-Uid), an in-memory store, and N people each with one face
check-in already uploaded (uid lt_0001.., session s_20261128_00000001..). The bucket and Gemini are
stubbed: no object is read or written, and the explanation is the template (the Gemini step has
its own 35 s budget and scales on Vertex, not on the engine; it is not part of this test).

The line (app/engine_gate.py) follows the environment as in production: ENGINE_SLOTS,
ENGINE_QUEUE_WAIT_S, API_THREADS. One process here stands in for every api instance.

    cd api && ENGINE_SLOTS=4 API_THREADS=256 uv run python scripts/loadtest/run_api.py \
        --people 200 --port 8116 --engine http://localhost:8126
"""

import argparse
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--people", type=int, default=200)
    ap.add_argument("--port", type=int, default=8116)
    ap.add_argument("--engine", default="http://localhost:8126")
    ap.add_argument("--site", default="face_full")
    ap.add_argument("--frames", type=int, default=5)
    a = ap.parse_args()
    os.environ.update(
        AUTH_MODE="dev",
        DEV_STORE="memory",
        ENGINE_MODE="http",
        ENGINE_URL=a.engine,
        ALLOWED_ORIGINS="http://localhost:5216",
    )

    import logging

    import uvicorn

    logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per engine call otherwise

    from app import dev_seed, explain, labeller, previews, storage
    from app.store import get_store

    dev_seed.seed_demo_campaigns = lambda store: None  # no BigQuery reads
    storage.object_info = lambda name: storage.ObjectInfo(
        storage.object_uri(name), True, 900_000, f"md5:{name}", "image/jpeg"
    )
    storage.list_names = lambda prefix, globs=(): set()
    storage.signed_get_url = lambda name: f"http://localhost/{name}"
    storage.delete_prefix = lambda prefix: 0
    previews.publish = lambda name: None
    explain.generate = lambda result, context, deadline, keep=False: explain.fallback(
        result, context
    )
    labeller.label_candidates = lambda result, budget, keep=False: {}

    from app.main import app

    store = get_store()
    now = datetime.now(UTC)
    for i in range(1, a.people + 1):
        uid, sid = f"lt_{i:04d}", f"s_20261128_{i:08x}"
        store.session_set(
            uid,
            sid,
            {
                "site": a.site,
                "capture_mode": "uncalibrated",
                "n_frames": a.frames,
                "created_at": now,
                "status": "uploading",
                "is_baseline": False,
                "frame_uris": [
                    storage.object_uri(f"uploads/{uid}/{sid}/frame_{k}.jpg")
                    for k in range(1, a.frames + 1)
                ],
                "content_types": ["image/jpeg"] * a.frames,
            },
        )
    print(
        f"api: {a.people} people seeded; ENGINE_SLOTS={os.environ.get('ENGINE_SLOTS', '0')} "
        f"API_THREADS={os.environ.get('API_THREADS', 'default')}",
        flush=True,
    )
    # keep-alive past the test client's 5 s, as Cloud Run's front end keeps browser connections
    uvicorn.run(app, port=a.port, log_level="warning", timeout_keep_alive=75, backlog=2048)


if __name__ == "__main__":
    main()
