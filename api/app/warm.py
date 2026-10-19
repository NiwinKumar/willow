"""Warm a new api instance before it serves (main.py startup, production only).

In-memory state starts empty on every deploy and scale-out: the BigQuery rows, the live status,
and the kept Gemini answers. Without this the first judge to open Proof, tap a suggested
question or watch the brand journey pays for all of it (5-30 s). Everything runs at once and
startup waits at most WARM_BUDGET_S; anything slower finishes in the background, and a failure
only means that piece is computed on first use as before."""

import logging
import time
from concurrent.futures import ThreadPoolExecutor, wait

log = logging.getLogger("willow.warm")

WARM_BUDGET_S = 45

# The Ask panel's suggestions (web/src/features/retail/AskAggregates.tsx SUGGESTIONS) and the
# brand journey's typed rule (web/src/features/journey/brandSegments.ts RULE_WORDS).
ASK_SUGGESTIONS = (
    "Which redness products work in the budget tier?",
    "Where is demand growing fastest?",
    "How do outcomes compare with non-users?",
    "Which products do people say are working, and is it measured?",
    "Which users changed the most?",
)
JOURNEY_RULE = (
    "When a product becomes Proven for dark spots, promote it to oily and combination skin "
    "for 14 days",
    "The Derma Co",
)


def _rows() -> str:
    from app import retailer

    retailer.insights()
    return "rows"


def _status() -> str:
    from app import demo

    demo.status()
    return "status"


def _ask(question: str) -> str:
    from app.routes import retailer_routes

    return f"ask kept={retailer_routes.warm_answer(question)}"


def _rule() -> str:
    from app.routes import autopilot_routes

    return f"rule kept={autopilot_routes.warm_reading(*JOURNEY_RULE)}"


def run(budget_s: float = WARM_BUDGET_S) -> None:
    started = time.monotonic()
    pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="warm")
    rows = pool.submit(_rows)
    jobs = [rows, pool.submit(_status), pool.submit(_rule)]
    # Answers read the rows, so they start once the rows are in (or failed).
    jobs += [pool.submit(lambda q=q: (rows.exception(), _ask(q))[1]) for q in ASK_SUGGESTIONS]
    done, pending = wait(jobs, timeout=budget_s)
    for job in done:
        if job.exception():
            log.warning("warm-up step failed: %s", job.exception())
        else:
            log.info("warm-up: %s", job.result())
    log.info(
        "warm-up took %.1f s (%d done, %d still running)",
        time.monotonic() - started,
        len(done),
        len(pending),
    )
    pool.shutdown(wait=False)
