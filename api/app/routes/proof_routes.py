"""Proof by Willow organisations: instance, membership, team, settings, decisions, evidence
requests, saved claims and the methodology page (/v1/proof/...).

Orgs, roles and the "Try as" demo membership live in app/proof_orgs.py; Firestore paths are in
the Store protocol's Finals block (app/store.py). Org-scoped routes take the caller's membership
of `{org}` through `proof_orgs.member_of(role)`: viewer reads, analyst decides / drafts / sends,
admin manages the team and the policy. An org only ever reads its own rows: a brand never sees
another organisation's decisions, requests or claims.
"""

import hashlib
import re
import secrets
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app import catalog, proof_ai, proof_orgs, proof_research, retail_intel, retailer
from app.auth import AuthUser, current_user
from app.proof_orgs import Member, member_of
from app.store import Doc, Store, get_store, iso

router = APIRouter(prefix="/v1", tags=["proof"])

Role = Literal["viewer", "analyst", "admin"]
DecisionStatus = Literal["open", "accepted", "dismissed", "snoozed", "done"]
# a decision key is the web's card id (e.g. "shelf:serum-x"): a Firestore-safe doc id
DECISION_KEY = re.compile(r"^(?!__)[A-Za-z0-9_.:-]{1,120}$")
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")
LOG_SHOWN = 100  # decision log rows returned, newest first
MAX_PENDING_INVITES = 50
MAX_CLAIMS = 200  # saved claims per org
MAX_OPEN_REQUESTS = 100  # open requests one org may have sent


def _now() -> datetime:
    return datetime.now(UTC)


def _not_found(what: str) -> HTTPException:
    return HTTPException(404, {"code": "not_found", "message": f"{what} not found."})


def _product(product_id: str) -> dict[str, Any]:
    p = catalog.by_id(product_id)
    if p is None:
        raise HTTPException(422, {"code": "bad_request", "message": "Unknown product."})
    return p


def _require_own_brand(m: Member, product: dict[str, Any]) -> None:
    if not proof_orgs.owns_brand(m.org, product["brand"]):
        raise proof_orgs.forbidden("A brand organisation can only act on its own brand's products.")


class Snapshot(BaseModel):
    """The numbers on the card when someone acted on it, kept with the log entry."""

    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    figure: str | None = Field(default=None, max_length=120)
    n: int | None = Field(default=None, ge=0)


# -- instance and membership ------------------------------------------------------------------


@router.get("/proof/instance")
def get_instance(
    host: str | None = Query(None, max_length=255),
    slug: str | None = Query(None, max_length=80),
) -> dict[str, Any]:
    """Which Proof deployment this is (public): by slug, else by hostname, else the default
    instance. Its orgs carry their brands and verified basis."""
    return proof_orgs.instance_view(proof_orgs.resolve(host, slug))


@router.get("/proof/me")
def get_me(
    instance: str | None = Query(None, max_length=80),
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """The caller's memberships (of one instance when given); current = the one used last."""
    rows = proof_orgs.memberships(store, user.uid, instance)
    current = {"org_id": rows[0]["org_id"], "role": rows[0]["role"]} if rows else None
    return {"memberships": [proof_orgs.member_view(m) for m in rows], "current": current}


class JoinBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instance: str = Field(min_length=1, max_length=80)
    org_id: str = Field(min_length=1, max_length=80)
    role: Role = "admin"


@router.post("/proof/join")
def join(
    body: JoinBody, user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """'Try as': a demo membership of an org in a demo instance (it becomes the current one)."""
    doc = proof_orgs.join(store, user.uid, body.instance, body.org_id, body.role)
    return {"membership": proof_orgs.member_view(doc), "current": {"org_id": doc["org_id"]}}


# -- team ---------------------------------------------------------------------------------------


def _email_hint(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:1]}•••@{domain}"


@router.get("/proof/orgs/{org}/members")
def members(
    m: Member = Depends(member_of("viewer")), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """The team (a short uid hint, never the uid) and pending invites."""
    rows = sorted(store.proof_members_of_org(m.org_id), key=lambda d: iso(d.get("joined_at")) or "")
    invites = sorted(store.proof_invites_of(m.org_id), key=lambda r: iso(r[1].get("created_at")))
    return {
        "members": [
            {
                "uid_hint": f"{d['uid'][:4]}…",
                "role": d["role"],
                "demo": bool(d.get("demo")),
                "joined_at": iso(d.get("joined_at")),
                "you": d["uid"] == m.uid,
            }
            for d in rows
        ],
        "invites": [
            {"email_hint": d["email_hint"], "role": d["role"], "status": d["status"]}
            for _, d in invites
        ],
    }


class InviteBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=254)
    role: Role = "viewer"

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL.match(v):
            raise ValueError("Enter an email address")
        return v


@router.post("/proof/orgs/{org}/invites", status_code=201)
def invite(
    body: InviteBody, m: Member = Depends(member_of("admin")), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """A pending invite row (admin). No email is sent in this version; the address is kept only
    as a hash and a hint."""
    digest = hashlib.sha256(body.email.encode()).hexdigest()
    iid = f"{m.org_id}__{digest[:24]}"  # the same address twice is one invite
    pending = [i for i, d in store.proof_invites_of(m.org_id) if d.get("status") == "pending"]
    if iid not in pending and len(pending) >= MAX_PENDING_INVITES:
        raise HTTPException(
            409, {"code": "too_many", "message": "Too many pending invites. Remove one first."}
        )
    doc = {
        "org_id": m.org_id,
        "email_hash": digest,
        "email_hint": _email_hint(body.email),
        "role": body.role,
        "status": "pending",
        "demo": m.demo,
        "created_at": _now(),
    }
    store.proof_invite_set(iid, doc)
    return {"email_hint": doc["email_hint"], "role": body.role, "status": "pending"}


# -- settings -----------------------------------------------------------------------------------

PLAN = {
    "retailer": {
        "name": "Pilot",
        "billed": False,
        "includes": [
            "Outcomes for every product in your range",
            "Campaigns with a randomised holdout",
            "Evidence requests to your brands",
        ],
    },
    "brand": {
        "name": "Pilot",
        "billed": False,
        "includes": [
            "Outcomes for your own products",
            "Claim drafts from measured evidence",
            "Campaigns for your Proven products",
        ],
    },
}


def _policy(store: Store, instance_id: str) -> dict[str, Any]:
    """The data-sharing policy is the retailer's (research 06 section 4.2): competitor names off
    by default; the minimum group is the one the aggregates enforce (retailer.MIN_GROUP)."""
    ret = proof_orgs.retailer_of(instance_id)
    stored = (store.proof_org_get(ret["id"]) or {}).get("policy") or {} if ret else {}
    return {
        "competitor_names": bool(stored.get("competitor_names", False)),
        "min_group": retailer.MIN_GROUP,
        "set_by": ret["id"] if ret else None,
    }


def _settings(store: Store, m: Member) -> dict[str, Any]:
    return {
        "org": proof_orgs.org_view(m.org),
        "policy": _policy(store, m.instance),
        "plan": PLAN[m.org["kind"]],
        "editable": m.org["kind"] == "retailer" and m.at_least("admin"),
    }


@router.get("/proof/orgs/{org}/settings")
def get_settings_(
    m: Member = Depends(member_of("viewer")), store: Store = Depends(get_store)
) -> dict[str, Any]:
    return _settings(store, m)


class PolicyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    competitor_names: bool
    # shown for completeness; the aggregates enforce one floor for everyone in this version
    min_group: int | None = None
    set_by: str | None = None  # echoed back by a client that PUTs what it read; ignored

    @field_validator("min_group")
    @classmethod
    def _floor(cls, v: int | None) -> int | None:
        if v is not None and v != retailer.MIN_GROUP:
            raise ValueError(f"The minimum group is fixed at {retailer.MIN_GROUP} in this version")
        return v


class SettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    policy: PolicyIn


@router.put("/proof/orgs/{org}/settings")
def put_settings(
    body: SettingsIn,
    m: Member = Depends(member_of("admin")),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Admin of the retailer org only: the policy is the retailer's for every brand."""
    if m.org["kind"] != "retailer":
        raise proof_orgs.forbidden("The data-sharing policy is set by the retailer.")
    doc = store.proof_org_get(m.org_id) or {}
    policy = {"competitor_names": body.policy.competitor_names}
    store.proof_org_set(m.org_id, {**doc, "policy": policy, "updated_at": _now()})
    return _settings(store, m)


# -- decisions ----------------------------------------------------------------------------------


@router.get("/proof/orgs/{org}/decisions")
def decisions(
    m: Member = Depends(member_of("viewer")), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """Each card's current state, and the log of every change (newest first)."""
    items = {
        key: {
            "status": d["status"],
            "reason": d.get("reason"),
            "updated_at": iso(d.get("updated_at")),
            "by_role": d.get("by_role"),
        }
        for key, d in store.proof_decisions(m.org_id)
    }
    log = sorted(store.proof_decision_log(m.org_id), key=lambda d: iso(d["at"]), reverse=True)
    return {
        "items": items,
        "log": [
            {
                "key": d["key"],
                "status": d["status"],
                "reason": d.get("reason"),
                "at": iso(d["at"]),
                "by_role": d.get("by_role"),
                "snapshot": d.get("snapshot"),
            }
            for d in log[:LOG_SHOWN]
        ],
    }


class DecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: DecisionStatus
    reason: str | None = Field(default=None, max_length=300)
    snapshot: Snapshot | None = None


@router.put("/proof/orgs/{org}/decisions/{key}")
def put_decision(
    key: str,
    body: DecisionIn,
    m: Member = Depends(member_of("analyst")),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Set a card's state (analyst or higher); every change is also appended to the log with
    the numbers on the card at the time."""
    if not DECISION_KEY.match(key):
        raise HTTPException(422, {"code": "bad_request", "message": "Invalid decision key."})
    at = _now()
    reason = (body.reason or "").strip() or None
    store.proof_decision_set(
        m.org_id,
        key,
        {"status": body.status, "reason": reason, "updated_at": at, "by_role": m.role},
    )
    snapshot = body.snapshot.model_dump() if body.snapshot else None
    entry = {
        "org_id": m.org_id,
        "key": key,
        "status": body.status,
        "reason": reason,
        "at": at,
        "by_role": m.role,
        "demo": m.demo,
        "snapshot": snapshot,
    }
    store.proof_decision_log_add(f"d_{secrets.token_hex(8)}", entry)
    return {
        "key": key,
        "status": body.status,
        "reason": reason,
        "updated_at": iso(at),
        "by_role": m.role,
    }


# -- evidence requests ------------------------------------------------------------------------


def _request_view(rid: str, d: Doc) -> dict[str, Any]:
    p = catalog.by_id(d["product_id"]) or {}
    frm, to = proof_orgs.org(d["from_org"]) or {}, proof_orgs.org(d["to_org"]) or {}
    return {
        "id": rid,
        "from_org": d["from_org"],
        "from_name": frm.get("name"),
        "to_org": d["to_org"],
        "to_name": to.get("name"),
        "product_id": d["product_id"],
        "product": p.get("name"),
        "brand": p.get("brand"),
        "message": d["message"],
        "snapshot": d.get("snapshot"),
        "status": d["status"],
        "reply": d.get("reply"),
        "created_at": iso(d.get("created_at")),
        "updated_at": iso(d.get("updated_at")),
    }


class RequestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    to_org: str = Field(min_length=1, max_length=80)
    product_id: str = Field(min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=1000)
    snapshot: Snapshot | None = None


@router.post("/proof/orgs/{org}/requests", status_code=201)
def send_request(
    body: RequestIn, m: Member = Depends(member_of("analyst")), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """Ask another org in the same instance for evidence about a product (analyst or higher).
    To a brand: only about that brand's products. From a brand: only about its own."""
    to = proof_orgs.org(body.to_org)
    if to is None or to["instance"] != m.instance or to["id"] == m.org_id:
        raise HTTPException(422, {"code": "bad_request", "message": "Choose another organisation."})
    product = _product(body.product_id)
    if to["kind"] == "brand" and not proof_orgs.owns_brand(to, product["brand"]):
        raise HTTPException(
            422,
            {"code": "bad_request", "message": f"This product is not one of {to['name']}'s."},
        )
    if m.org["kind"] == "brand":
        _require_own_brand(m, product)
    open_sent = [r for r, d in store.proof_requests_from(m.org_id) if d["status"] == "open"]
    if len(open_sent) >= MAX_OPEN_REQUESTS:
        raise HTTPException(409, {"code": "too_many", "message": "Too many open requests."})
    at = _now()
    rid = f"r_{secrets.token_hex(8)}"
    doc = {
        "instance": m.instance,
        "from_org": m.org_id,
        "to_org": to["id"],
        "product_id": product["product_id"],
        "message": body.message.strip(),
        "snapshot": body.snapshot.model_dump() if body.snapshot else None,
        "status": "open",
        "reply": None,
        "demo": m.demo,
        "created_at": at,
        "updated_at": at,
    }
    store.proof_request_set(rid, doc)
    return _request_view(rid, doc)


@router.get("/proof/orgs/{org}/requests")
def requests(
    m: Member = Depends(member_of("viewer")), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """Requests this org received (inbox) and sent (outbox), newest first."""

    def rows(pairs: list[tuple[str, Doc]]) -> list[dict[str, Any]]:
        pairs = sorted(pairs, key=lambda r: iso(r[1].get("created_at")) or "", reverse=True)
        return [_request_view(rid, d) for rid, d in pairs]

    return {
        "inbox": rows(store.proof_requests_to(m.org_id)),
        "outbox": rows(store.proof_requests_from(m.org_id)),
    }


class RequestPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["answered", "declined"]
    reply: str | None = Field(default=None, max_length=1000)


@router.patch("/proof/orgs/{org}/requests/{rid}")
def answer_request(
    rid: str,
    body: RequestPatch,
    m: Member = Depends(member_of("analyst")),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Answer or decline a request in this org's inbox (analyst or higher). The sender cannot."""
    doc = store.proof_request_get(rid) if rid.startswith("r_") else None
    if doc is None or doc["to_org"] != m.org_id:
        raise _not_found("Request")
    reply = (body.reply or "").strip() or None
    if body.status == "answered" and not reply:
        raise HTTPException(
            422, {"code": "bad_request", "message": "Write a reply.", "field": "reply"}
        )
    fields = {"status": body.status, "reply": reply, "updated_at": _now()}
    store.proof_request_update(rid, fields)
    return _request_view(rid, doc | fields)


# -- saved claims -------------------------------------------------------------------------------


def _claim_view(cid: str, d: Doc) -> dict[str, Any]:
    p = catalog.by_id(d["product_id"]) or {}
    return {
        "id": cid,
        "product_id": d["product_id"],
        "product": p.get("name"),
        "brand": p.get("brand"),
        "text": d["text"],
        "statements": d.get("statements") or [],
        "cohort": d["cohort"],
        "n": d.get("n"),
        "window": d.get("window"),
        "method": d.get("method"),
        "caveat": d.get("caveat"),
        "observational": True,
        "exportable": bool(d.get("exportable")),
        "export_note": None if d.get("exportable") else proof_ai.EXPORT_REFUSED,
        "status": d["status"],
        "created_at": iso(d.get("created_at")),
        "updated_at": iso(d.get("updated_at")),
    }


def _evidence_view(product_id: str, cohort_: str) -> dict[str, Any] | None:
    """The product's Proof view for that cohort filter; None when the rows are unavailable."""
    try:
        return retail_intel.product(product_id, cohort_, "all")
    except Exception:  # BigQuery unavailable: the claim is saved, never exportable
        return None


class ClaimIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=600)
    statements: list[str] = Field(default_factory=list, max_length=6)  # evidence statement ids
    cohort: retailer.Cohort  # the cohort filter it was drafted under
    channel: proof_ai.Channel | None = None


@router.get("/proof/orgs/{org}/claims")
def claims(
    m: Member = Depends(member_of("viewer")), store: Store = Depends(get_store)
) -> dict[str, Any]:
    rows = sorted(
        store.proof_claims_of(m.org_id),
        key=lambda r: iso(r[1].get("created_at")) or "",
        reverse=True,
    )
    return {"claims": [_claim_view(cid, d) for cid, d in rows]}


@router.post("/proof/orgs/{org}/claims", status_code=201)
def save_claim(
    body: ClaimIn, m: Member = Depends(member_of("analyst")), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """Save a claim draft (analyst or higher; a brand only for its own products). Exportable
    only when the server confirms it rests on a real-only cohort: its statements are among the
    product's evidence in the real cohort (fail closed: simulated, mixed or unreadable -> not)."""
    product = _product(body.product_id)
    _require_own_brand(m, product)
    if len(store.proof_claims_of(m.org_id)) >= MAX_CLAIMS:
        raise HTTPException(409, {"code": "too_many", "message": "Too many saved claims."})
    view = _evidence_view(product["product_id"], body.cohort)
    who = proof_ai.cohort_of(view.get("cohort")) if view else None
    ids = {e["id"] for e in (view or {}).get("evidence") or []}
    exportable = bool(
        view
        and body.cohort == "real"
        and who["kind"] == "real"
        and body.statements
        and set(body.statements) <= ids
    )
    at = _now()
    cid = f"cl_{secrets.token_hex(8)}"
    doc = {
        "org_id": m.org_id,
        "product_id": product["product_id"],
        "text": body.text.strip(),
        "statements": list(dict.fromkeys(body.statements)),
        "channel": body.channel,
        # the filter it was drafted under, and what that filter held when it was saved
        "cohort": {"filter": body.cohort, **(who or {"kind": body.cohort})},
        "n": ((view or {}).get("product") or {}).get("n"),
        "window": retail_intel.WINDOW,
        "method": retail_intel.METHOD,
        "caveat": retail_intel.CAVEAT,
        "exportable": exportable,
        "status": "draft",
        "demo": m.demo,
        "created_at": at,
        "updated_at": at,
    }
    store.proof_claim_set(cid, doc)
    return _claim_view(cid, doc)


def _owned_claim(store: Store, m: Member, cid: str) -> Doc:
    doc = store.proof_claim_get(cid) if cid.startswith("cl_") else None
    if doc is None or doc["org_id"] != m.org_id:
        raise _not_found("Claim")
    return doc


class ClaimPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["draft", "approved"]


@router.patch("/proof/orgs/{org}/claims/{cid}")
def patch_claim(
    cid: str,
    body: ClaimPatch,
    m: Member = Depends(member_of("analyst")),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    doc = _owned_claim(store, m, cid)
    fields = {"status": body.status, "updated_at": _now()}
    store.proof_claim_update(cid, fields)
    return _claim_view(cid, doc | fields)


@router.get("/proof/orgs/{org}/claims/{cid}/export")
def export_claim(
    cid: str, m: Member = Depends(member_of("analyst")), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """The approved claim with its basis, for use outside Proof. Refused (403) for a claim from
    a simulated or mixed cohort, whatever its status."""
    doc = _owned_claim(store, m, cid)
    if not doc.get("exportable"):
        raise HTTPException(403, {"code": "not_exportable", "message": proof_ai.EXPORT_REFUSED})
    if doc["status"] != "approved":
        raise HTTPException(
            409, {"code": "not_approved", "message": "Approve the claim before exporting it."}
        )
    return {"claim": _claim_view(cid, doc), "exported_at": iso(_now())}


# -- methodology ------------------------------------------------------------------------------


@router.get("/proof/research")
def research() -> dict[str, Any]:
    """How Proof measures (public): thresholds, suppression, holdout, cohort, metrics, consent
    and what each side sees, all read from the code."""
    return proof_research.research()
