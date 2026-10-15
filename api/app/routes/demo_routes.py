"""Judge mode routes (docs/DEMO_PLAN.md "Judge flow"): sample runs, a ready routine, the seeded
journey and live status. Sample runs and the routine need a sign-in (a guest is enough) so every
judge works in an account of their own; the journey and status are public."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app import demo, limits
from app.auth import AuthUser, current_user
from app.routes.products_routes import RoutineEntryIn, add_routine_entry
from app.routes.sessions_routes import list_views
from app.settings import get_settings
from app.store import Store, get_store

router = APIRouter(prefix="/v1/demo", tags=["demo"])


@router.get("/samples")
def list_samples() -> dict[str, Any]:
    return {
        "samples": [
            {**s.model_dump(exclude={"frames", "order"}), "n_frames": len(s.frames)}
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
    added = 0
    if not store.routine_list(user.uid):
        for i, (product, slots) in enumerate(demo.judge_routine_entries(), start=1):
            # started yesterday (UTC): a judge west of UTC can tick their own "today" in the
            # evening, which is already tomorrow in UTC
            body = RoutineEntryIn(
                product_id=product["product_id"],
                slots=slots,
                source="catalog",
                started_at=datetime.now(UTC).date() - timedelta(days=1),
            )
            add_routine_entry(store, user.uid, body, entry_id=f"r_judge{i}")
            added += 1
    store.user_merge(user.uid, {"judge": True})
    return {"routine_added": added}


@router.get("/journey")
def journey(store: Store = Depends(get_store)) -> dict[str, Any]:
    """The seeded, read-only demo account: real analyses of the team's consented captures."""
    uid = get_settings().demo_user_id
    return {"sessions": demo._cached(f"journey:{uid}", 300, lambda: list_views(store, uid))}


@router.get("/status")
def status() -> dict[str, Any]:
    return demo.status()
