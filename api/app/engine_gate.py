"""A line in front of the measurement engine (backpressure), one per api instance.

The engine measures one check-in per instance (Cloud Run concurrency 1, at most 8 instances;
infra/README.md "Scale"). Without a line, a burst larger than that still reaches the engine:
Cloud Run holds each extra request a few seconds, answers 429, and the person reads "The
measurement took too long". With ENGINE_SLOTS set, at most that many analyses of this api
instance call the engine at once; the others wait here, oldest first, and their session shows
stage "queued" with a place and an estimate ("In line, about N s").

"Oldest" is when the person first joined the line (`queue_since` on the session), kept when they
ask again, so asking again never loses a place to someone who came later.

One request waits at most ENGINE_QUEUE_WAIT_S: the web gives analyze 150 s, and the engine and
Gemini still need about 90 s of it. Past that the route puts the session back as it was and
answers 409 "in line"; the web already re-reads the session and asks again on a 409 conflict, so
it rejoins at its old place without a web change. An engine answering 429/503 (every instance
taken, for example by another api instance's line) is asked again after a short pause, within the
same wait.

ENGINE_SLOTS unset or 0: off, exactly the old behaviour.
"""

import bisect
import itertools
import logging
import math
import os
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from app.engine import EngineError

log = logging.getLogger("willow.engine_gate")

# A face check-in on the production engine: p50 41 s (engine logs, Nov 20-28, 2026, n=22). The
# estimate starts here and then follows this instance's own measured runs.
DEFAULT_EXPECTED_S = 45.0
DEFAULT_WAIT_S = 45.0
BUSY_RETRY_S = 3.0
# How often a waiting request rechecks its place (and writes it to the session when it moved).
RECHECK_S = 2.0
# A place older than this is not honoured (a check-in retried hours later starts at the back).
MAX_PLACE_AGE = timedelta(minutes=15)


class InLine(Exception):
    """This request's wait is over before its turn came: ask again (the place is kept)."""

    def __init__(self, position: int, eta_s: int) -> None:
        super().__init__(f"in line at {position}, about {eta_s} s")
        self.position = position
        self.eta_s = eta_s


class Gate:
    def __init__(self, slots: int, wait_s: float, expected_s: float) -> None:
        self.slots = slots
        self.wait_s = wait_s
        self.avg_s = expected_s
        self._cond = threading.Condition()
        self._running = 0
        self._line: list[tuple[float, int]] = []  # (joined at, tie-break), oldest first
        self._seq = itertools.count()

    def eta(self, position: int) -> int:
        """Seconds until a waiter at `position` (1 = next) starts: whole rounds of the slots."""
        return math.ceil(math.ceil(position / self.slots) * self.avg_s)

    def snapshot(self) -> dict[str, Any]:
        with self._cond:
            return {
                "slots": self.slots,
                "running": self._running,
                "waiting": len(self._line),
                "avg_s": round(self.avg_s, 1),
            }

    def _acquire(self, since: float, on_wait: Callable[[int, int], None]) -> float:
        """Wait for a slot (oldest `since` first). Returns the deadline; raises InLine."""
        ticket = (since, next(self._seq))
        deadline = time.monotonic() + self.wait_s
        reported = None
        with self._cond:
            bisect.insort(self._line, ticket)
        while True:
            with self._cond:
                pos = self._line.index(ticket) + 1
                if pos == 1 and self._running < self.slots:
                    self._line.pop(0)
                    self._running += 1
                    self._cond.notify_all()
                    return deadline
                left = deadline - time.monotonic()
                if left <= 0:
                    self._line.remove(ticket)
                    self._cond.notify_all()
                    raise InLine(pos, self.eta(pos))
                if pos == reported:
                    self._cond.wait(min(left, RECHECK_S))
                    continue
            reported = pos
            try:  # outside the lock: a Firestore write must not hold up the line
                on_wait(pos, self.eta(pos))
            except Exception:
                log.warning("could not show place %s in line", pos)

    def _release(self, took_s: float | None) -> None:
        with self._cond:
            self._running -= 1
            if took_s is not None:  # the estimate follows this instance's measured runs
                self.avg_s = 0.8 * self.avg_s + 0.2 * took_s
            self._cond.notify_all()

    def call[T](
        self,
        fn: Callable[[], T],
        since: float,
        on_wait: Callable[[int, int], None],
        on_start: Callable[[], None],
    ) -> T:
        """fn() once a slot is free; an engine busy everywhere is asked again within the wait."""
        deadline = self._acquire(since, on_wait)
        started = time.monotonic()
        took = None
        try:
            on_start()
            while True:
                try:
                    result = fn()
                    took = time.monotonic() - started
                    return result
                except EngineError as exc:
                    if not exc.busy:
                        raise
                    if time.monotonic() + BUSY_RETRY_S > deadline:
                        raise InLine(1, self.eta(1)) from exc
                    log.info("engine busy everywhere; asking again in %s s", BUSY_RETRY_S)
                    time.sleep(BUSY_RETRY_S)
        finally:
            self._release(took)


def _env_number(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    try:
        value = float(raw) if raw else default
    except ValueError:
        log.warning("ignoring %s=%r (not a number)", name, raw)
        return default
    return value if value >= 0 else default


_gate: Gate | None = None
_gate_lock = threading.Lock()


def current() -> Gate | None:
    """This instance's line, or None when ENGINE_SLOTS is unset or 0 (no line, as before)."""
    global _gate
    slots = int(_env_number("ENGINE_SLOTS", 0))
    if slots <= 0:
        return None
    with _gate_lock:
        if _gate is None or _gate.slots != slots:
            _gate = Gate(
                slots,
                _env_number("ENGINE_QUEUE_WAIT_S", DEFAULT_WAIT_S),
                _env_number("ENGINE_EXPECTED_S", DEFAULT_EXPECTED_S),
            )
        return _gate


def place_since(doc: dict[str, Any]) -> datetime:
    """When this session joined the line: kept from an earlier ask, unless it is too old."""
    since = doc.get("queue_since")
    now = datetime.now(UTC)
    if isinstance(since, datetime) and timedelta(0) <= now - since < MAX_PLACE_AGE:
        return since
    return now


async def threads_from_env() -> None:
    """API_THREADS: worker threads for the api's sync routes (anyio's default is 40), set at
    startup. Every check-in waiting for the engine, in line or not, holds one; past 40 the rest,
    and the polls that show "In line", wait for a thread. Cloud Run sends an instance at most 80
    requests (--concurrency 80), so 100 means a poll never waits behind the line. Unset: 40."""
    import anyio.to_thread

    n = int(_env_number("API_THREADS", 0))
    if n > 0:
        anyio.to_thread.current_default_thread_limiter().total_tokens = n
        log.info("api worker threads: %s", n)
