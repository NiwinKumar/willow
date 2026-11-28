"""Judge mode routes (docs/DEMO_PLAN.md "Judge flow"): sample runs, a ready routine, the seeded
journey and live status. Sample runs and the routine need a sign-in (a guest is enough) so every
judge works in an account of their own; the journey and status are public."""

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app import advisor, demo, limits, routine_check, translate
from app.auth import AuthUser, current_user
from app.routes.products_routes import (
    ChatRequest,
    RoutineEntryIn,
    _chat_answer,
    _chat_start,
    add_routine_entry,
    chat_stream,
    routine_entries,
    routine_log_days,
)
from app.routes.sessions_routes import list_views
from app.settings import get_settings
from app.store import Store, get_store

log = logging.getLogger("willow.demo")

router = APIRouter(prefix="/v1/demo", tags=["demo"])

ROUTINE_CHECK_KEEP_S = 3600  # a complete routine check (Gemini answered)
ROUTINE_CHECK_RETRY_S = 60  # the rules-only fallback: Gemini is asked again after this


@router.get("/samples")
def list_samples() -> dict[str, Any]:
    return {
        "samples": [
            {
                **s.model_dump(exclude={"frames", "order", "source_session"}),
                "n_frames": len(s.frames),
            }
            for s in demo.samples()
        ]
    }


@router.post("/samples/{sample_id}/session")
def start_sample(
    sample_id: str,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Copy a hosted sample into a new session of this person; the web then calls analyze."""
    s = demo.sample(sample_id)
    if s is None:
        raise HTTPException(404, {"code": "not_found", "message": "sample not found"})
    if not demo.ready_to_run(store, user.uid, s):
        first = demo.sample(s.after or "")
        raise HTTPException(
            409,
            {
                "code": "run_first_sample",
                "message": f"Run “{first.title if first else 'the first sample'}” first: it "
                "becomes the baseline this one is compared with.",
            },
        )
    limits.take(store, user.uid, "sample_runs")
    try:
        session_id = demo.create_sample_session(store, user.uid, s)
    except Exception as exc:
        limits.refund(store, user.uid, "sample_runs")
        raise HTTPException(
            503, {"code": "sample_unavailable", "message": "Could not copy the sample. Try again."}
        ) from exc
    return {"session_id": session_id, "site": s.site, "n_frames": len(s.frames)}


@router.post("/judge-setup")
def judge_setup(
    user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """Give a judge's fresh guest account a small routine so the routine check and the advisor
    have something real to work with. Guest accounts only, and only when the routine is empty;
    fixed entry ids, so two tabs at once cannot add it twice."""
    if not user.is_anonymous and get_settings().auth_mode != "dev":
        return {"routine_added": 0}
    # the judge flag and the routine are independent writes: made at the same time
    with ThreadPoolExecutor(max_workers=1) as pool:
        flagged = pool.submit(store.user_merge, user.uid, {"judge": True})
        added = _starter_routine(store, user.uid)
        flagged.result()
    return {"routine_added": added}


@router.post("/guest-setup")
def guest_setup(
    user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """A new guest (Continue as a guest) starts with something to look at: the starter routine
    and Mei's first-week check-ins as samples. Guest accounts only, only into an empty account;
    an account made with Google or email starts fresh."""
    if not user.is_anonymous and get_settings().auth_mode != "dev":
        return {"routine_added": 0, "sessions_added": 0}
    routine_added = _starter_routine(store, user.uid)
    sessions_added = 0
    if not store.sessions_list(user.uid):
        try:
            sessions_added = demo.add_starter_sessions(store, user.uid)
        except Exception:
            log.exception("could not add the starter check-ins for %s", user.uid)
    return {"routine_added": routine_added, "sessions_added": sessions_added}


def _starter_routine(store: Store, uid: str) -> int:
    """The judge routine, into an empty routine only; fixed entry ids, so two tabs at once
    cannot add it twice."""
    if store.routine_list(uid):
        return 0
    # started yesterday (UTC): someone west of UTC can tick their own "today" in the evening,
    # which is already tomorrow in UTC
    started = datetime.now(UTC).date() - timedelta(days=1)
    bodies = [
        RoutineEntryIn(
            product_id=product["product_id"], slots=slots, source="catalog", started_at=started
        )
        for product, slots in demo.judge_routine_entries()
    ]
    if not bodies:
        return 0
    # One Firestore write per entry, all at once: in turn they made a judge wait for each
    # round trip (the setup is on the judge tour's critical path)
    with ThreadPoolExecutor(max_workers=len(bodies)) as pool:
        list(
            pool.map(
                lambda ib: add_routine_entry(
                    store, uid, ib[1], entry_id=f"r_judge{ib[0]}", sample=True
                ),
                enumerate(bodies, start=1),
            )
        )
    return len(bodies)


@router.get("/journey")
def journey(store: Store = Depends(get_store)) -> dict[str, Any]:
    """The seeded, read-only demo account: real analyses of the team's consented captures."""
    uid = get_settings().demo_user_id
    return {"sessions": demo._cached(f"journey:{uid}", 300, lambda: list_views(store, uid))}


@router.get("/routine")
def journey_routine(
    today: str | None = Query(default=None), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """The demo journey's routine, read-only: judges see Mei's products and recent use."""
    uid = get_settings().demo_user_id
    return demo._cached(f"routine:{uid}:{today}", 300, lambda: routine_entries(store, uid, today))


@router.get("/routine/log")
def journey_routine_log(
    first: str | None = Query(default=None, alias="from"),
    last: str | None = Query(default=None, alias="to"),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """The demo journey's ticks per day, read-only (ticks a judge adds stay in their browser)."""
    uid = get_settings().demo_user_id
    return demo._cached(
        f"routine-log:{uid}:{first}:{last}", 300, lambda: routine_log_days(store, uid, first, last)
    )


@router.get("/routine/check")
def journey_routine_check(store: Store = Depends(get_store)) -> dict[str, Any]:
    """The routine check on the demo journey's routine: one Gemini run an hour, shared by every
    judge, so the public demo never spends anyone's daily cap. Judges arriving together wait for
    the one run; a rules-only answer (Gemini failed) is kept only a minute, then Gemini is asked
    again."""
    uid = get_settings().demo_user_id

    def run() -> tuple[dict[str, Any], bool]:
        entries = [{"id": eid, **e} for eid, e in store.routine_list(uid)]
        return routine_check.run(entries)

    result, _ = demo._cached(
        f"routine-check:{uid}",
        ROUTINE_CHECK_KEEP_S,
        run,
        keep_for=lambda v: ROUTINE_CHECK_KEEP_S if v[1] else ROUTINE_CHECK_RETRY_S,
    )
    return result


@router.get("/advisor/history")
def journey_advisor_history(store: Store = Depends(get_store)) -> dict[str, Any]:
    """Mei's stored Wisp chat, read-only. Demo questions are never stored, so it only changes when
    the journey is seeded again; kept 5 minutes like the other journey reads (app/warm.py)."""
    uid = get_settings().demo_user_id
    messages = demo._cached(f"advisor-history:{uid}", 300, lambda: advisor.history(store, uid))
    return {"messages": messages, "keep": advisor.HISTORY_KEEP}


@router.post("/advisor/chat")
def journey_advisor_chat(
    body: ChatRequest,
    store: Store = Depends(get_store),
    lang: str = Depends(translate.lang_header),
) -> dict[str, Any]:
    """Ask Wisp about the demo journey: answered from Mei's data, never stored, one shared cap."""
    uid = get_settings().demo_user_id
    images, used = _chat_start(body, uid, store, "demo_advisor")
    return _chat_answer(
        body, uid, store, images, used, action="demo_advisor", keep=False, lang=lang
    )


@router.post("/advisor/chat/stream")
def journey_advisor_chat_stream(
    body: ChatRequest,
    store: Store = Depends(get_store),
    lang: str = Depends(translate.lang_header),
) -> StreamingResponse:
    """The streamed form of /advisor/chat (the same events as /v1/advisor/chat/stream)."""
    uid = get_settings().demo_user_id
    images, used = _chat_start(body, uid, store, "demo_advisor")
    return chat_stream(body, uid, store, images, used, action="demo_advisor", keep=False, lang=lang)


@router.get("/status")
def status() -> dict[str, Any]:
    return demo.status()
