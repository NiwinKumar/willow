"""A local stand-in for the willow-engine Cloud Run service (infra/README.md "Scale").

Starts K real engine processes (engine/app/main.py under uvicorn), each taking one analysis at a
time like Cloud Run's --concurrency 1, and a small front on --port that routes each request to a
free one. Like Cloud Run at max instances, a request that finds every instance taken is held up
to PENDING_S and then answered 429. Nothing here is Cloud Run: the instances are processes on
this machine, sharing its cores.

The api sends gs:// frame URIs and a gs:// output prefix; the front points them at the demo
sample photos in --frames (mei_face_week1/, mei_cheek_week1/: copies of the bucket's
demo/samples/, never committed) and at a local scratch folder, so nothing is read from or written
to the bucket. Every analysis is logged to --log (one JSON line: worker, seconds, site, status).

    cd api && uv run python scripts/loadtest/engine_pool.py --workers 4 --port 8126 \
        --frames /path/to/frames --log /tmp/engine_pool.jsonl
"""

import argparse
import asyncio
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

ENGINE_DIR = Path(__file__).resolve().parents[3] / "engine"
PENDING_S = 10.0  # Cloud Run holds a request this long for a free instance, then 429
SAMPLE_FOR_SITE = {"face_full": "mei_face_week1"}  # every other site: the cheek close-ups
FRAME = re.compile(r"frame_(\d+)\.\w+$")


def start_workers(n: int, base_port: int, threads: int) -> list[subprocess.Popen]:
    env = {
        **os.environ,
        "ENGINE_ALLOW_LOCAL_FILES": "1",
        # one instance = 2 vCPU in production: two photos at once, two OpenCV threads
        "ENGINE_FRAME_WORKERS": str(threads),
        "ENGINE_CV_THREADS": str(threads),
        "OMP_NUM_THREADS": "1",
        "OPENBLAS_NUM_THREADS": "1",
    }
    procs = []
    for i in range(n):
        procs.append(
            subprocess.Popen(
                [
                    str(ENGINE_DIR / ".venv/bin/uvicorn"),
                    "app.main:app",
                    "--port",
                    str(base_port + i),
                    "--log-level",
                    "warning",
                ],
                cwd=ENGINE_DIR,
                env=env,
            )
        )
    return procs


def local_request(body: dict, frames: Path, out_root: Path) -> dict:
    sample = SAMPLE_FOR_SITE.get(body["site"], "mei_cheek_week1")
    available = sorted(p.name for p in (frames / sample).glob("frame_*.jpg"))
    for f in body["frames"]:
        m = FRAME.search(f["uri"])
        i = int(m.group(1)) if m else 1
        f["uri"] = str(frames / sample / available[(i - 1) % len(available)])
        f["content_type"] = "image/jpeg"
    body["output_prefix"] = str(out_root / body["session_id"])
    return body


def build_app(ports: list[int], frames: Path, log_path: Path) -> Starlette:
    free: asyncio.Queue[int] = asyncio.Queue()
    for p in ports:
        free.put_nowait(p)
    out_root = Path(tempfile.mkdtemp(prefix="willow_pool_"))
    client = httpx.AsyncClient(timeout=600)
    log = log_path.open("a")

    async def analyze(request: Request) -> Response:
        body = local_request(await request.json(), frames, out_root)
        arrived = time.time()
        try:
            port = await asyncio.wait_for(free.get(), PENDING_S)
        except TimeoutError:
            log.write(json.dumps({"t": arrived, "status": 429, "site": body["site"]}) + "\n")
            log.flush()
            return JSONResponse({"error": "no available instance"}, status_code=429)
        started = time.time()
        try:
            res = await client.post(f"http://127.0.0.1:{port}/v1/analyze", json=body)
        finally:
            free.put_nowait(port)
        log.write(
            json.dumps(
                {
                    "t": arrived,
                    "worker": port,
                    "status": res.status_code,
                    "site": body["site"],
                    "frames": len(body["frames"]),
                    "pending_s": round(started - arrived, 2),
                    "engine_s": round(time.time() - started, 2),
                }
            )
            + "\n"
        )
        log.flush()
        return Response(res.content, status_code=res.status_code, media_type="application/json")

    async def health(_: Request) -> Response:
        return JSONResponse({"status": "ok", "engine_version": "local-pool", "free": free.qsize()})

    return Starlette(
        routes=[
            Route("/v1/analyze", analyze, methods=["POST"]),
            Route("/v1/health", health),
        ]
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--port", type=int, default=8126)
    ap.add_argument("--worker-base-port", type=int, default=18126)
    ap.add_argument("--threads", type=int, default=2, help="per worker (production: 2 vCPU)")
    ap.add_argument("--frames", type=Path, required=True)
    ap.add_argument("--log", type=Path, required=True)
    a = ap.parse_args()
    # a plain kill (SIGTERM) still stops the workers (finally below), never leaving them orphaned
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    procs = start_workers(a.workers, a.worker_base_port, a.threads)
    ports = [a.worker_base_port + i for i in range(a.workers)]
    try:
        for p in ports:  # wait until every worker has loaded its face models
            for _ in range(120):
                try:
                    if httpx.get(f"http://127.0.0.1:{p}/v1/health", timeout=2).status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(1)
            else:
                sys.exit(f"engine worker on {p} did not start")
        print(f"engine pool: {a.workers} workers on {ports}, front on {a.port}", flush=True)
        uvicorn.run(build_app(ports, a.frames, a.log), port=a.port, log_level="warning")
    finally:
        for p in procs:
            p.terminate()


if __name__ == "__main__":
    main()
