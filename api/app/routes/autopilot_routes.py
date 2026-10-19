"""AutoCampaign (app/autopilot.py): standing campaign rules, their activity feed and the check that
runs them. Sign-in on every route (guest accounts included), as campaigns; the scheduler's run is
/v1/internal/autopilot (Cloud Scheduler's OIDC token only)."""

import time
from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app import autopilot, autopilot_agent, campaigns, catalog, gemini, limits
from app.auth import AuthUser, current_user
from app.retailer import CATEGORY_LABEL
from app.routes.me_routes import Goal
from app.settings import Settings, get_settings
from app.store import Store, get_store

router = APIRouter(prefix="/v1", tags=["autopilot"])

Category = Literal[
    "serum",
    "sunscreen",
    "treatment",
    "cleanser",
    "moisturizer",
    "toner",
    "exfoliant",
    "eye_care",
    "mask",
]
assert set(Category.__args__) == set(CATEGORY_LABEL)  # noqa: S101


class Scope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: Category | None = None  # null: every category
    product_ids: list[str] = Field(default_factory=list, max_length=20)  # []: every product


class Trigger(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["proven", "new_segment", "rising_demand", "unmet_need"]
    goals: list[Goal] = Field(default_factory=list, max_length=8)  # []: any goal
    # unmet_need: the share of a skin type x goal group with no visible change by week 8
    unmet_min: float = Field(default=autopilot.UNMET_MIN, ge=0.3, le=0.9)

    @field_validator("goals")
    @classmethod
    def _unique(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(v))


class Conditions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    in_store: bool = False  # only products listed in at least one store
    start_on: date | None = None
    stop_after: date | None = None
    monthly_cap: int | None = Field(default=None, ge=1, le=20)  # new campaigns a month

    @model_validator(mode="after")
    def _order(self) -> "Conditions":
        if self.start_on and self.stop_after and self.stop_after < self.start_on:
            raise ValueError("stop_after must not be before start_on")
        return self


class Action(BaseModel):
    model_config = ConfigDict(extra="forbid")
    days: Literal[7, 14, 30] = 14
    holdout_pct: float = Field(default=campaigns.HOLDOUT_PCT, ge=0.1, le=0.5)  # always a holdout
    max_running: int = Field(default=2, ge=1, le=campaigns.MAX_ACTIVE)


class RuleBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=60)
    workspace: str = Field(min_length=1, max_length=80)
    enabled: bool = True
    level: Literal["suggest", "auto", "autopilot"] = "suggest"
    scope: Scope = Field(default_factory=Scope)
    trigger: Trigger
    conditions: Conditions = Field(default_factory=Conditions)
    action: Action = Field(default_factory=Action)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is empty")
        return v


def _body_doc(body: RuleBody) -> dict[str, Any]:
    if body.workspace not in campaigns.workspaces():
        raise HTTPException(
            422, {"code": "bad_request", "message": "Unknown workspace.", "field": "workspace"}
        )
    unknown = [p for p in body.scope.product_ids if catalog.by_id(p) is None]
    if unknown:
        raise HTTPException(
            422,
            {
                "code": "bad_request",
                "message": f"Unknown product: {unknown[0]}.",
                "field": "scope.product_ids",
            },
        )
    doc = body.model_dump()
    for k in ("start_on", "stop_after"):
        v = doc["conditions"][k]
        doc["conditions"][k] = v.isoformat() if v else None
    return doc


def _owned(store: Store, uid: str, rid: str) -> dict[str, Any]:
    doc = store.rule_get(rid) if autopilot.RULE_ID.match(rid) else None
    if doc is None or doc.get("owner_uid") != uid:
        raise HTTPException(404, {"code": "not_found", "message": "rule not found"})
    return doc


def _views(store: Store, uid: str) -> list[dict[str, Any]]:
    feed = store.activities_of(uid)
    rows = sorted(store.rules_of(uid), key=lambda r: str(r[1].get("created_at") or ""))
    owned = store.campaigns_of(uid) if rows else []  # read once for every rule
    return [autopilot.rule_view(store, rid, d, feed, owned) for rid, d in rows]


@router.get("/retailer/autopilot")
def overview(
    user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """This person's rules (each with its sentence, running count and last action) and the
    activity feed, newest first."""
    return {"rules": _views(store, user.uid), "activity": autopilot.feed(store, user.uid)}


@router.post("/retailer/autopilot/rules", status_code=201)
def create_rule(
    body: RuleBody, user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    if len(store.rules_of(user.uid)) >= 20:
        raise HTTPException(
            429, {"code": "too_many_rules", "message": "20 rules is the limit. Delete one first."}
        )
    limits.take(store, user.uid, "campaign_create")
    at = campaigns.now()
    rid = autopilot.new_rule_id()
    doc = autopilot.rule_doc(user.uid, _body_doc(body), at)
    store.rule_set(rid, doc)
    return autopilot.rule_view(store, rid, doc, store.activities_of(user.uid))


@router.put("/retailer/autopilot/rules/{rid}")
def replace_rule(
    rid: str,
    body: RuleBody,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Edit a rule (its campaigns keep running; the next check uses the new settings)."""
    _owned(store, user.uid, rid)
    fields = _body_doc(body) | {"updated_at": campaigns.now()}
    store.rule_update(rid, fields)
    return autopilot.rule_view(store, rid, store.rule_get(rid), store.activities_of(user.uid))


class RulePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool


@router.patch("/retailer/autopilot/rules/{rid}")
def toggle_rule(
    rid: str,
    body: RulePatch,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Switch a rule on or off. Off: it starts and manages nothing; its campaigns keep running."""
    _owned(store, user.uid, rid)
    store.rule_update(rid, {"enabled": body.enabled, "updated_at": campaigns.now()})
    return autopilot.rule_view(store, rid, store.rule_get(rid), store.activities_of(user.uid))


@router.delete("/retailer/autopilot/rules/{rid}", status_code=204)
def delete_rule(
    rid: str, user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> Response:
    """Delete a rule. Its campaigns keep running as ordinary campaigns; its open proposals close."""
    _owned(store, user.uid, rid)
    store.rule_delete(rid)
    for aid, d in store.activities_of(user.uid):
        if d.get("rule_id") == rid and d.get("status") == "open":
            store.activity_update(aid, {"status": "dismissed"})
    return Response(status_code=204)


class ParseBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=3, max_length=600)
    workspace: str = Field(min_length=1, max_length=80)


class DraftTrigger(BaseModel):
    kind: Literal["proven", "new_segment", "rising_demand", "unmet_need"]
    goals: list[Goal] = Field(default_factory=list)
    unmet_min: float = autopilot.UNMET_MIN


class DraftConditions(BaseModel):
    in_store: bool = False
    start_on: str | None = None  # YYYY-MM-DD
    stop_after: str | None = None
    monthly_cap: int | None = None


class DraftAction(BaseModel):
    days: int = 14  # 7, 14 or 30 (checked by Action); Gemini's schema takes string enums only
    holdout_pct: float = campaigns.HOLDOUT_PCT
    max_running: int = 2


class DraftRule(BaseModel):
    """What Gemini fills from the typed words (checked against RuleBody before it is shown)."""

    name: str
    level: Literal["suggest", "auto", "autopilot"] = "suggest"
    category: Category | None = None
    trigger: DraftTrigger
    conditions: DraftConditions = Field(default_factory=DraftConditions)
    action: DraftAction = Field(default_factory=DraftAction)


class ParseOut(BaseModel):
    rule: DraftRule
    missed: list[str] = Field(default_factory=list, max_length=6)


# Gemini's reading of the same words for the same workspace is kept for an hour (only Gemini's;
# the fixed patterns are instant), so a repeated rule (the brand journey) reads at once. Nothing in
# it is personal: the words and the workspace only.
PARSE_TTL_S = 3600
_parsed: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}


@router.post("/retailer/autopilot/parse")
def parse_rule(
    body: ParseBody, user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """A rule typed in plain words, read into the form's fields by Gemini (nothing is saved):
    {rule, sentence, missed, source}. The draft must pass the form's own checks; without Gemini
    (or when its draft fails them) fixed word patterns read it (`source` "rules")."""
    key = (" ".join(body.text.lower().split()), body.workspace)
    hit = _parsed.get(key)
    if hit and time.time() - hit[0] < PARSE_TTL_S:
        return hit[1]
    fallback = autopilot.parse(body.text, body.workspace)
    try:
        limits.take(store, user.uid, "campaign_create")
        read = _gemini_read(body.text, body.workspace, fallback)
        _parsed[key] = (time.time(), read)
        return read
    except (gemini.GeminiError, ValueError, HTTPException):
        return fallback | {"source": "rules", "sentence": autopilot.describe(fallback["rule"])}


def _gemini_read(text: str, workspace: str, fallback: dict[str, Any]) -> dict[str, Any]:
    """Gemini's reading of a rule, checked by the form's own model (raises when it fails)."""
    out = autopilot_agent.parse(text, workspace, fallback["rule"], ParseOut)
    d = out["rule"]
    rule = RuleBody(
        name=(d["name"] or fallback["rule"]["name"])[:60],
        workspace=workspace,
        level=d["level"],
        scope=Scope(category=d["category"]),
        trigger=Trigger(**d["trigger"]),
        conditions=Conditions(**d["conditions"]),
        action=Action(**d["action"]),
    )
    doc = _body_doc(rule)
    missed = [m for m in out["missed"] if isinstance(m, str) and len(m) <= 120]
    return {"rule": doc, "missed": missed, "source": "gemini", "sentence": autopilot.describe(doc)}


def warm_reading(text: str, workspace: str) -> bool:
    """Read and keep a rule ahead of time (app/warm.py: the brand journey's typed rule)."""
    key = (" ".join(text.lower().split()), workspace)
    hit = _parsed.get(key)
    if hit and time.time() - hit[0] < PARSE_TTL_S:
        return True
    _parsed[key] = (time.time(), _gemini_read(text, workspace, autopilot.parse(text, workspace)))
    return True


def _run(fn, *args) -> dict[str, Any]:
    try:
        return fn(*args)
    except campaigns.Unavailable as exc:
        raise campaigns.unavailable() from exc


@router.post("/retailer/autopilot/run")
def run_now(
    if_stale: bool = Query(False),
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Run this person's rules now ("Run check now"); `if_stale`: only when the last check is over
    30 minutes old (the Campaigns page on open). Returns what it did, then the rules and feed."""
    if if_stale:
        result = _run(autopilot.run_if_stale, store, user.uid)
    else:
        limits.take(store, user.uid, "campaign_create")
        try:
            result = _run(autopilot.run, store, user.uid)
        except HTTPException:
            # the evidence could not be read: nothing ran, so the use goes back
            limits.refund(store, user.uid, "campaign_create")
            raise
    return {"result": result} | overview(user, store)


def _activity_call(fn, store: Store, uid: str, aid: str) -> dict[str, Any]:
    if not autopilot.ACTIVITY_ID.match(aid):
        raise HTTPException(404, {"code": "not_found", "message": "activity not found"})
    try:
        out = fn(store, uid, aid)
    except LookupError as exc:
        raise HTTPException(404, {"code": "not_found", "message": "activity not found"}) from exc
    except autopilot.Refused as exc:
        raise HTTPException(409, {"code": "refused", "message": str(exc)}) from exc
    except campaigns.Unavailable as exc:
        raise campaigns.unavailable() from exc
    return out or {}


@router.post("/retailer/autopilot/activity/{aid}/approve")
def approve(
    aid: str, user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """Carry out an open proposal, through the same checks as a new campaign."""
    limits.take(store, user.uid, "campaign_create")
    return _activity_call(autopilot.approve, store, user.uid, aid) | overview(user, store)


@router.post("/retailer/autopilot/activity/{aid}/dismiss")
def dismiss(
    aid: str, user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    return _activity_call(autopilot.dismiss, store, user.uid, aid) | overview(user, store)


@router.post("/retailer/autopilot/activity/{aid}/undo")
def undo(
    aid: str, user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """Undo a campaign a rule started (deleted if no shopper saw it yet, else ended)."""
    return _activity_call(autopilot.undo, store, user.uid, aid) | overview(user, store)


def _scheduler(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    """Only Cloud Scheduler's own OIDC token (audience and service account checked) may run this."""
    if settings.auth_mode == "dev":
        return
    if not settings.autopilot_audience:
        raise HTTPException(
            503, {"code": "unavailable", "message": "AutoCampaign runs are not configured."}
        )
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, {"code": "unauthenticated", "message": "Bearer token required"})
    from google.auth.transport import requests as g_requests
    from google.oauth2 import id_token

    try:
        claims = id_token.verify_oauth2_token(
            authorization.split(" ", 1)[1].strip(),
            g_requests.Request(),
            audience=settings.autopilot_audience,
        )
    except Exception as exc:
        raise HTTPException(401, {"code": "unauthenticated", "message": "Invalid token"}) from exc
    if claims.get("email") != settings.scheduler_service_account or not claims.get(
        "email_verified"
    ):
        raise HTTPException(403, {"code": "forbidden", "message": "Not the scheduler"})


@router.post("/internal/autopilot", dependencies=[Depends(_scheduler)])
def run_scheduled(store: Store = Depends(get_store)) -> dict[str, Any]:
    """Cloud Scheduler, nightly after the data refresh: every owner's enabled rules."""
    return _run(autopilot.run_all, store)
