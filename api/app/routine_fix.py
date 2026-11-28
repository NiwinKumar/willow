"""Routine fixes (Nov 29): when the routine check flags two products used together that a
different time or day would keep apart, Gemini proposes the concrete change (which product moves
to which time, or which nights each one gets) and the app offers it as one-tap "Apply".

Gemini only picks from fixed choices (time of day, a schedule kind, weekday names); the dates and
the routine update are built in code. Every proposal is checked against the rule table before it
is shown: applied to a copy of the routine, it must clear the flagged conflict and add no new
conflict, duplicate or gap, move only the two products in that conflict, never put a retinoid in
the morning, and its reason may quote only numbers from the input (no banned words, at most 140
characters). A proposal that fails is dropped; when none pass (or Gemini is down) the check shows
what it showed before: the rule's own suggestion and, for alternate-night fixes, "Alternate these".
"""

import copy
import hashlib
import json
import re
import threading
import time
from datetime import date, timedelta
from typing import Any, Literal

from pydantic import BaseModel, Field

from app import gemini, numbers, routine_check
from app.explain import BANNED, SAFE

Entry = dict[str, Any]
Day = Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAYS: tuple[str, ...] = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
REASON_MAX = 140


class Change(BaseModel):
    product: str = Field(max_length=64)
    slots: list[Literal["am", "pm"]] | None = Field(default=None, min_length=1, max_length=2)
    schedule: Literal[
        "keep", "every_day", "alternate_from_tonight", "alternate_from_tomorrow", "weekdays"
    ] = "keep"
    weekdays: list[Day] = Field(default_factory=list, max_length=6)


class Proposal(BaseModel):
    conflict: str = Field(max_length=8)
    changes: list[Change] = Field(min_length=1, max_length=2)
    reason: str = Field(max_length=200)


class Proposals(BaseModel):
    fixes: list[Proposal] = Field(default_factory=list, max_length=4)


INSTRUCTIONS = """A skincare routine has conflicts: two products used at the same time that
should be kept apart. For each conflict id, propose one schedule change using only the two
products in that conflict. In "changes", "product" is the product's id exactly as given
(for example r_1). Each change sets:
- "slots": move a product to the morning ("am"), the evening ("pm") or both; or
- "schedule": "alternate_from_tonight" / "alternate_from_tomorrow" (every other day; give the
  two products opposite starts so they never meet), "weekdays" with day names, "every_day", or
  "keep".
Prefer the smallest change: keep retinoids in the evening and sunscreen in the morning. "reason":
one short, calm sentence (under 140 characters) naming products by brand and name, never by id,
and no numbers. Cosmetic language only. British spelling. Skip a conflict you cannot fix."""


def _active(entries: list[Entry]) -> list[Entry]:
    return [e for e in entries if not e.get("ended_at")]


def _schedule(change: Change, today: date) -> dict[str, Any] | None | str:
    """The stored schedule for a choice: a dict, None (every day), or "keep"."""
    if change.schedule == "keep":
        return "keep"
    if change.schedule == "every_day":
        return None
    if change.schedule == "alternate_from_tonight":
        return {"kind": "alternate", "anchor": today.isoformat()}
    if change.schedule == "alternate_from_tomorrow":
        return {"kind": "alternate", "anchor": (today + timedelta(days=1)).isoformat()}
    days = sorted({DAYS.index(d) for d in change.weekdays})
    if not days:
        return "keep"
    return {"kind": "days", "days": days, "anchor": today.isoformat()}


def _apply(entries: list[Entry], patches: dict[str, dict[str, Any]]) -> list[Entry]:
    out = copy.deepcopy(entries)
    for e in out:
        e.update(patches.get(e["id"], {}))
    return out


def _keys(result: dict[str, Any]) -> set[tuple]:
    """Every finding as a comparable key: conflicts, duplicates and gaps."""
    return (
        {("c", frozenset(c["products"]), c["issue"]) for c in result["conflicts"]}
        | {("d", d["active"], frozenset(d["products"])) for d in result["duplicates"]}
        | {("g", g["need"]) for g in result["gaps"]}
    )


def _conflict_key(c: dict[str, Any]) -> tuple:
    return ("c", frozenset(c["products"]), c["issue"])


def fixable(entries: list[Entry], profile: dict[str, Any] | None, today: date) -> list[dict]:
    """The rule conflicts between two products that a schedule change can clear (tried in code:
    the two alternating). Over-exfoliation and profile cautions are not schedule problems."""
    result = routine_check.findings_for(entries, profile)
    out = []
    for c in result["conflicts"]:
        if c["source"] != "rule" or len(c["products"]) != 2:
            continue
        a, b = c["products"]
        tomorrow = today + timedelta(days=1)
        trial = _apply(
            entries,
            {
                a: {"schedule": {"kind": "alternate", "anchor": today.isoformat()}},
                b: {"schedule": {"kind": "alternate", "anchor": tomorrow.isoformat()}},
            },
        )
        if _conflict_key(c) not in _keys(routine_check.findings_for(trial, profile)):
            out.append(c)
    return out


def validate(
    proposal: Proposal,
    conflict: dict[str, Any],
    entries: list[Entry],
    profile: dict[str, Any] | None,
    today: date,
) -> dict[str, Any] | None:
    """The proposal as the app applies it, or None when any check fails."""
    by_id = {e["id"]: e for e in _active(entries)}
    pair = set(conflict["products"])
    # an id, or the product's full name when the model wrote that instead
    by_name = {routine_check._name(e).lower(): i for i, e in by_id.items()}
    ids = [c.product if c.product in by_id else by_name.get(c.product.lower(), "") for c in
           proposal.changes]  # fmt: skip
    if len(set(ids)) != len(ids) or not set(ids) <= pair:
        return None
    patches: dict[str, dict[str, Any]] = {}
    for product, change in zip(ids, proposal.changes, strict=True):
        entry = by_id[product]
        patch: dict[str, Any] = {}
        if change.slots is not None:
            slots = [s for s in ("am", "pm") if s in change.slots]
            if slots != [s for s in ("am", "pm") if s in (entry.get("slots") or [])]:
                patch["slots"] = slots
        sched = _schedule(change, today)
        if sched != "keep" and sched != entry.get("schedule"):
            patch["schedule"] = sched
        new_slots = patch.get("slots", entry.get("slots") or [])
        moved_to_am = "am" in new_slots and "am" not in (entry.get("slots") or [])
        if moved_to_am and "retinoid" in routine_check.classes_of(entry):
            return None  # retinoids stay in the evening
        if patch:
            patches[product] = patch
    if not patches:
        return None
    before = _keys(routine_check.findings_for(entries, profile))
    after = _keys(routine_check.findings_for(_apply(entries, patches), profile))
    if _conflict_key(conflict) in after or not after <= before:
        return None
    names = {e["id"]: routine_check._name(e) for e in by_id.values()}
    reason = routine_check._readable(proposal.reason.strip(), names)
    allowed = numbers.in_text(routine_check._listing(list(by_id.values())))
    if not reason or len(reason) > REASON_MAX or not numbers.only_known(reason, allowed):
        return None
    # the wording rules read the sentence without words from the product names ("CeraVe Acne
    # Foaming Cream Cleanser", often shortened by the model)
    named = {w.lower() for n in names.values() for w in re.findall(r"[A-Za-z]+", n)}
    words = re.sub(r"[A-Za-z]+", lambda m: "" if m[0].lower() in named else m[0], reason)
    if BANNED.search(words) or SAFE.search(words):
        return None
    return {
        "products": conflict["products"],
        "issue": conflict["issue"],
        "changes": [{"id": i, **p} for i, p in patches.items()],
        "reason": reason,
    }


# The same routine on the same day answers again at once for an hour (no new call).
KEEP_S = 3600
_answers: dict[str, tuple[float, list[dict]]] = {}
_lock = threading.Lock()


def clear() -> None:
    with _lock:
        _answers.clear()


def _prompt(entries: list[Entry], conflicts: list[dict]) -> str:
    listed = {f"c{i + 1}": {"products": c["products"], "issue": c["issue"]} for i, c in
              enumerate(conflicts)}  # fmt: skip
    return (
        f"Routine:\n{routine_check._listing(_active(entries))}\n\n"
        f"Conflicts:\n{json.dumps(listed, indent=1)}"
    )


def kept(entries: list[Entry], profile: dict[str, Any] | None, today: date) -> list[dict] | None:
    """The kept answer for this routine today, [] when nothing is fixable, else None."""
    conflicts = fixable(entries, profile, today)
    if not conflicts:
        return []
    key = hashlib.sha256(f"{today}|{profile}|{_prompt(entries, conflicts)}".encode()).hexdigest()
    with _lock:
        hit = _answers.get(key)
    return copy.deepcopy(hit[1]) if hit and time.time() - hit[0] < KEEP_S else None


def propose(
    entries: list[Entry], profile: dict[str, Any] | None, today: date
) -> tuple[list[dict], bool]:
    """(validated fixes, complete). complete is False when Gemini was wanted and failed."""
    conflicts = fixable(entries, profile, today)
    if not conflicts:
        return [], True
    prompt = _prompt(entries, conflicts)
    by_ref = {f"c{i + 1}": c for i, c in enumerate(conflicts)}

    def checked(out: Proposals) -> list[dict]:
        fixes, seen = [], set()
        for p in out.fixes:
            c = by_ref.get(p.conflict)
            if c is None or p.conflict in seen:
                continue
            fix = validate(p, c, entries, profile, today)
            if fix:
                seen.add(p.conflict)
                fixes.append(fix)
        return fixes

    try:
        out = gemini.generate_json(
            "routine_fix",
            [prompt],
            Proposals,
            instructions=INSTRUCTIONS,
            temperature=0.0,
            max_output_tokens=2048,
            # products only, nothing about the person; kept only when a proposal passes
            keep=lambda o: bool(checked(o)),
        )
    except gemini.GeminiError:
        return [], False
    fixes = checked(out)
    key = hashlib.sha256(f"{today}|{profile}|{prompt}".encode()).hexdigest()
    with _lock:
        if len(_answers) > 500:
            _answers.clear()
        _answers[key] = (time.time(), copy.deepcopy(fixes))
    return fixes, True
