"""Warm a new api instance before it serves (main.py startup, production only).

In-memory state starts empty on every deploy and scale-out: the BigQuery rows, the live status,
the kept Gemini answers and Mei's demo journey (her check-ins with signed photos, routine, ticks,
routine check and Wisp history). Without this the first judge to open Proof, tap a suggested
question, watch the brand journey or open the demo journey pays for all of it (4-30 s).
Everything runs at once and startup waits at most WARM_BUDGET_S; anything slower finishes in the
background, and a failure only means that piece is computed on first use as before."""

import logging
import time
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import UTC, datetime, timedelta

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


def _proof_lists() -> str:
    """Proof's product and brand lists (every catalog product and brand: 3,000+ rows since the
    catalog grew), so the first judge to open Products or the brand picker doesn't wait."""
    from app.routes import retailer_routes

    retailer_routes.proof_products("mixed", "all")
    retailer_routes.proof_brands("mixed", "all")
    return "proof lists"


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


def _demo_days(now: datetime | None = None) -> list[str]:
    """The web asks for Mei's routine with the judge's own local day (and her ticks for that day
    and the day before). Every time zone's "today" is UTC yesterday, today or tomorrow."""
    today = (now or datetime.now(UTC)).date()
    return [(today + timedelta(days=d)).isoformat() for d in (-2, -1, 0, 1)]


def _demo() -> str:
    """Mei's journey views the judge flow opens (app/routes/demo_routes.py), into demo._cached:
    her check-ins (every photo URL signed), routine, ticks and Wisp history."""
    from app.routes import demo_routes
    from app.store import get_store

    store = get_store()
    days = _demo_days()
    demo_routes.journey(store=store)
    for day in days[1:]:
        demo_routes.journey_routine(today=day, store=store)
    for day in days:
        demo_routes.journey_routine_log(first=day, last=day, store=store)
    demo_routes.journey_advisor_history(store=store)
    return "demo journey"


def _demo_check() -> str:
    """Mei's routine check: one Gemini run an hour shared by every judge, made here once."""
    from app.routes import demo_routes
    from app.store import get_store

    demo_routes.journey_routine_check(store=get_store())
    return "demo routine check"


def run(budget_s: float = WARM_BUDGET_S) -> None:
    started = time.monotonic()
    pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="warm")
    rows = pool.submit(_rows)
    jobs = [rows, pool.submit(_status), pool.submit(_rule)]
    jobs += [pool.submit(_demo), pool.submit(_demo_check)]
    jobs += [pool.submit(lambda: (rows.exception(), _proof_lists())[1])]
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
