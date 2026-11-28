"""N people press "Measure" at the same moment: the load test (infra/README.md "Scale").

Each person does what the web's check-in does (web/src/features/checkin/useAnalysis.ts): read the
session, POST /analyze with the web's 150 s limit, read the session every 2 s meanwhile (the live
stage, "queued" with a place when the line is on), and on a 409 conflict read again and ask again.
A person "fails" when they would see an error screen: any other error, or no answer in 150 s.

Writes one JSON summary (end-to-end p50/p95/p99, errors by kind, asks per person, places in line,
poll latency) plus the engine pool's per-analysis times (engine_pool.py --log).

    cd api && uv run python scripts/loadtest/drive.py --people 200 --api http://localhost:8116 \
        --pool-log /tmp/engine_pool.jsonl --label with-line --out results/with-line.json
"""

import argparse
import asyncio
import contextlib
import json
import statistics
import time
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

import httpx

ANALYZE_TIMEOUT_S = 150.0  # web/src/lib/api.ts ANALYZE_TIMEOUT_MS
POLL_S = 2.0  # useAnalysis.ts STAGE_POLL_MS
GIVE_UP_S = 90 * 60  # the whole run


def pct(values: list[float], p: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    return round(s[min(len(s) - 1, max(0, round(p / 100 * len(s) + 0.5) - 1))], 1)


async def person(i: int, client: httpx.AsyncClient, t0: float, polls: list[float]) -> dict:
    uid, sid = f"lt_{i:04d}", f"s_20261128_{i:08x}"
    h = {"X-Dev-Uid": uid}
    out = {"asks": 0, "max_position": None, "saw_queued": False}
    done = asyncio.Event()

    async def watch() -> None:
        while not done.is_set():
            await asyncio.sleep(POLL_S)
            if done.is_set():
                return
            t = time.monotonic()
            try:
                r = await client.get(f"/v1/sessions/{sid}", headers=h, timeout=30)
                polls.append(time.monotonic() - t)
                s = r.json()["session"]
                if s.get("stage") == "queued":
                    out["saw_queued"] = True
                    pos = (s.get("queue") or {}).get("position")
                    if pos:
                        out["max_position"] = max(out["max_position"] or 0, pos)
            except (httpx.HTTPError, ValueError, KeyError):
                polls.append(time.monotonic() - t)

    watcher = asyncio.create_task(watch())
    try:
        while time.monotonic() - t0 < GIVE_UP_S:
            out["asks"] += 1
            try:
                r = await client.post(
                    f"/v1/sessions/{sid}/analyze", headers=h, timeout=ANALYZE_TIMEOUT_S
                )
            except httpx.TimeoutException:
                return {
                    **out,
                    "ok": False,
                    "code": "client_timeout_150s",
                    "e2e_s": time.monotonic() - t0,
                }
            except httpx.HTTPError as exc:
                return {
                    **out,
                    "ok": False,
                    "code": f"network:{type(exc).__name__}",
                    "e2e_s": time.monotonic() - t0,
                }
            if r.status_code == 200:
                return {
                    **out,
                    "ok": True,
                    "code": None,
                    "e2e_s": time.monotonic() - t0,
                    "measured": r.json()["session"].get("measured"),
                }
            try:
                detail = r.json().get("detail") or {}
            except ValueError:
                detail = {}
            if r.status_code == 409 and detail.get("code") == "conflict":
                if detail.get("position"):
                    out["max_position"] = max(out["max_position"] or 0, detail["position"])
                # the web's re-read failing just means it asks again
                with contextlib.suppress(httpx.HTTPError):
                    await client.get(f"/v1/sessions/{sid}", headers=h, timeout=30)
                continue
            return {
                **out,
                "ok": False,
                "code": f"{r.status_code}:{detail.get('code')}",
                "e2e_s": time.monotonic() - t0,
            }
        return {**out, "ok": False, "code": "gave_up", "e2e_s": time.monotonic() - t0}
    finally:
        done.set()
        watcher.cancel()


def pool_summary(path: Path, since: float) -> dict:
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    rows = [r for r in rows if r["t"] >= since]
    ran = [r for r in rows if r.get("worker") and r["status"] == 200]
    secs = [r["engine_s"] for r in ran]
    per_worker = Counter(r["worker"] for r in ran)
    return {
        "analyses": len(ran),
        "engine_s_p50": pct(secs, 50),
        "engine_s_p95": pct(secs, 95),
        "engine_s_mean": round(statistics.mean(secs), 2) if secs else None,
        "answered_429": sum(1 for r in rows if r["status"] == 429),
        "engine_errors": sum(1 for r in rows if r.get("worker") and r["status"] != 200),
        "per_worker": dict(sorted(per_worker.items())),
    }


async def run(a: argparse.Namespace) -> dict:
    polls: list[float] = []
    # connections are kept and reused, as a browser does with Cloud Run's front end: a new one per
    # request overflows macOS's listen backlog (kern.ipc.somaxconn 128) when 200 polls land at once.
    # httpx drops a connection idle 5 s; the api keeps one 75 s (run_api.py), so none goes stale.
    limits = httpx.Limits(max_connections=a.people * 2 + 10, max_keepalive_connections=a.people * 2)
    started_wall = time.time()
    async with httpx.AsyncClient(base_url=a.api, limits=limits) as client:
        t0 = time.monotonic()
        people = await asyncio.gather(
            *(person(i, client, t0, polls) for i in range(1, a.people + 1))
        )
        wall = time.monotonic() - t0
    ok = [p for p in people if p["ok"]]
    e2e = [p["e2e_s"] for p in ok]
    positions = [p["max_position"] for p in people if p["max_position"]]
    summary = {
        "label": a.label,
        "date": datetime.now(UTC).date().isoformat(),
        "people": a.people,
        "succeeded": len(ok),
        "failed": len(people) - len(ok),
        "errors": dict(Counter(p["code"] for p in people if not p["ok"])),
        "e2e_s": {
            "p50": pct(e2e, 50),
            "p95": pct(e2e, 95),
            "p99": pct(e2e, 99),
            "max": round(max(e2e), 1) if e2e else None,
        },
        "wall_s": round(wall, 1),
        "throughput_per_min": round(len(ok) / wall * 60, 2) if wall else None,
        "asks_per_person": {
            "mean": round(statistics.mean(p["asks"] for p in people), 2),
            "max": max(p["asks"] for p in people),
        },
        "saw_in_line": sum(1 for p in people if p["saw_queued"] or p["max_position"]),
        "max_place_in_line": max(positions) if positions else None,
        "poll_latency_s": {
            "n": len(polls),
            "p50": pct(polls, 50),
            "p95": pct(polls, 95),
            "max": round(max(polls), 2) if polls else None,
        },
    }
    if a.pool_log:
        summary["engine"] = pool_summary(a.pool_log, started_wall)
    return summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--people", type=int, default=200)
    ap.add_argument("--api", default="http://localhost:8116")
    ap.add_argument("--pool-log", type=Path)
    ap.add_argument("--label", default="run")
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()
    summary = asyncio.run(run(a))
    text = json.dumps(summary, indent=2)
    print(text)
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(text + "\n")


if __name__ == "__main__":
    main()
