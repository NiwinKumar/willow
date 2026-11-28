"""Gemini working inside the routine without being asked (Nov 29): fix proposals for flagged
pairs (app/routine_fix.py) and a product note read into tags (app/note_tags.py)."""

from datetime import UTC, date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app import demo, limits, note_tags, routine_fix, safety
from app.auth import AuthUser, current_user
from app.routes.products_routes import _check_entry_id, _entry_view
from app.settings import get_settings
from app.store import Store, get_store

router = APIRouter(prefix="/v1", tags=["routine"])


def _today(today: str | None) -> date:
    try:
        return date.fromisoformat(today or "")
    except ValueError:
        return datetime.now(UTC).date()


@router.post("/routine/fixes")
def routine_fixes(
    today: str | None = Query(default=None, description="the person's own day, YYYY-MM-DD"),
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Validated schedule changes for the routine check's flagged pairs. Empty when nothing is
    fixable, past the daily cap, or Gemini failed (the check then shows its rule suggestion)."""
    day = _today(today)
    entries = [{"id": eid, **e} for eid, e in store.routine_list(user.uid)]
    profile = safety.profile_of(store.user_get(user.uid))
    hit = routine_fix.kept(entries, profile, day)
    if hit is not None:
        return {"fixes": hit}
    try:
        limits.take(store, user.uid, "routine_fix")
    except HTTPException:
        return {"fixes": []}
    fixes, complete = routine_fix.propose(entries, profile, day)
    if not complete:
        limits.refund(store, user.uid, "routine_fix")
    return {"fixes": fixes}


@router.get("/demo/routine/fixes")
def demo_routine_fixes(
    today: str | None = Query(default=None), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """The same for the demo journey's routine: one run an hour per day, shared by every judge."""
    uid = get_settings().demo_user_id
    day = _today(today)

    def run() -> dict[str, Any]:
        entries = [{"id": eid, **e} for eid, e in store.routine_list(uid)]
        return {"fixes": routine_fix.propose(entries, None, day)[0]}

    return demo._cached(f"routine-fixes:{uid}:{day}", routine_fix.KEEP_S, run)


class NoteIn(BaseModel):
    text: str = Field(max_length=note_tags.NOTE_MAX)


@router.put("/routine/{entry_id}/note")
def routine_note(
    entry_id: str,
    body: NoteIn,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """The person's one-line note on a product, read into fixed tags; an empty text clears it."""
    _check_entry_id(entry_id)
    doc = store.routine_get(user.uid, entry_id)
    if doc is None:
        raise HTTPException(404, {"code": "not_found", "message": "routine entry not found"})
    tags, source = note_tags.read(store, user.uid, body.text)
    note_tags.record(doc, body.text, tags, source)
    doc["updated_at"] = datetime.now(UTC)
    store.routine_set(user.uid, entry_id, doc)
    return _entry_view(entry_id, doc)
