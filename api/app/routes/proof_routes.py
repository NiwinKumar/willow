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
import time
from collections import Counter
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app import (
    catalog,
    limits,
    proof_ai,
    proof_orgs,
    proof_research,
    retail_intel,
    retailer,
    retailer_ask,
    safety,
)
from app.auth import AuthUser, current_user
from app.proof_orgs import Member, member_of
from app.routes import retailer_routes
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


# -- the connected range (item file) ------------------------------------------------------------
#
# A retailer connects its range once (research/finals/06 section 6.3): the web reads the item file
# (CSV), matches each row to the catalog and PUTs the rows with their match. The server keeps them
# per organisation and checks every match is a catalog product. A brand's range arrives from the
# retailer's item file, filtered to its own brands; a brand cannot write one.

RangeStatus = Literal["measured", "collecting", "no_users", "not_measured", "unrecognised"]
MAX_RANGE_ROWS = 500


class RangeRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    line: int = Field(ge=1, le=100_000)
    gtin: str = Field(default="", max_length=32)
    product_id: str = Field(default="", max_length=120)  # as written in the file
    brand: str = Field(default="", max_length=120)
    name: str = Field(default="", max_length=300)
    category: str = Field(default="", max_length=80)
    price: str = Field(default="", max_length=32)
    facings: str = Field(default="", max_length=32)
    match: str | None = Field(default=None, max_length=120)  # the catalog product it matched
    status: RangeStatus


class RangeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filename: str = Field(min_length=1, max_length=200)
    source: Literal["file", "catalog"] = "file"
    rows: list[RangeRow] = Field(min_length=1, max_length=MAX_RANGE_ROWS)


def _range_view(doc: Doc, rows: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "filename": doc["filename"],
        "source": doc.get("source", "file"),
        "rows": doc["rows"] if rows is None else rows,
        "uploaded_at": iso(doc.get("uploaded_at")),
        "by_role": doc.get("by_role"),
    }


def _brand_rows(org: dict[str, Any], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The retailer's rows that are this brand's: matched to one of its products, or (unmatched)
    written with its brand name."""
    own = {b.lower() for b in org["brands"]}

    def mine(r: dict[str, Any]) -> bool:
        p = catalog.by_id(r["match"]) if r.get("match") else None
        return (p["brand"].lower() if p else (r.get("brand") or "").strip().lower()) in own

    return [r for r in rows if mine(r)]


@router.get("/proof/orgs/{org}/range")
def get_range(
    m: Member = Depends(member_of("viewer")), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """The org's connected range (null when none). A brand reads the retailer's item file,
    filtered to its own products; `from` names whose file it is."""
    if m.org["kind"] == "retailer":
        doc = store.proof_range_get(m.org_id)
        return {"range": _range_view(doc) if doc else None, "from": None}
    ret = proof_orgs.retailer_of(m.instance)
    doc = store.proof_range_get(ret["id"]) if ret else None
    if not doc or not ret:
        return {"range": None, "from": None}
    return {
        "range": _range_view(doc, _brand_rows(m.org, doc["rows"])),
        "from": {"org_id": ret["id"], "name": ret["name"]},
    }


@router.put("/proof/orgs/{org}/range")
def put_range(
    body: RangeIn, m: Member = Depends(member_of("analyst")), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """Connect or replace the range (analyst or higher, retailer org). A match that is not a
    catalog product is dropped (the row becomes "unrecognised")."""
    if m.org["kind"] != "retailer":
        raise proof_orgs.forbidden(
            "The range is the retailer's item file; it reaches brands filtered to their products."
        )
    rows = []
    for r in body.rows:
        row = r.model_dump()
        if row["match"] and catalog.by_id(row["match"]) is None:
            row["match"] = None
        if row["match"] is None:
            row["status"] = "unrecognised"
        elif row["status"] == "unrecognised":
            row["status"] = "collecting"  # matched: the web re-reads the live status anyway
        rows.append(row)
    doc = {
        "filename": body.filename.strip(),
        "source": body.source,
        "rows": rows,
        "uploaded_at": _now(),
        "by_role": m.role,
        "demo": m.demo,
    }
    store.proof_range_set(m.org_id, doc)
    return {"range": _range_view(doc), "from": None}


@router.delete("/proof/orgs/{org}/range", status_code=204)
def delete_range(
    m: Member = Depends(member_of("analyst")), store: Store = Depends(get_store)
) -> Response:
    if m.org["kind"] != "retailer":
        raise proof_orgs.forbidden("The range is the retailer's item file.")
    store.proof_range_delete(m.org_id)
    return Response(status_code=204)


# -- Ask, scoped to the organisation --------------------------------------------------------------
#
# The same checked Ask as POST /v1/retailer/ask (app/retailer_ask.py), told whose question it is.
# A brand organisation asks about its own brand; unless the retailer's policy names competitors,
# Gemini sees other brands only as "Brand A"... and an answer naming one is rejected. The retailer
# may focus on a brand (`brand`, its "Viewing" lens) and always sees names.


class OrgAskIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=3, max_length=300)
    cohort: retailer.Cohort = "mixed"
    range: retailer.Range = "all"
    brand: str | None = Field(default=None, max_length=120)  # retailer only: the brand in focus


ASK_TTL_S = 3600
_answers: dict[tuple[Any, ...], tuple[float, dict[str, Any]]] = {}


@router.post("/proof/orgs/{org}/ask")
def org_ask(
    body: OrgAskIn, m: Member = Depends(member_of("viewer")), store: Store = Depends(get_store)
) -> dict[str, Any]:
    if m.org["kind"] == "brand":
        brand = m.org["brands"][0] if m.org["brands"] else None
        hide = not _policy(store, m.instance)["competitor_names"]
    else:
        brand = retail_intel.find_brand(body.brand) if body.brand else None
        hide = False
    scope = retailer_ask.scope_for(brand, hide)
    question = " ".join(body.question.lower().split())
    key = (question, body.cohort, body.range, brand, hide, retailer_routes._data_version())
    hit = _answers.get(key)
    if hit and time.time() - hit[0] < ASK_TTL_S:
        return hit[1]
    limits.take(store, m.uid, "retailer_ask")
    try:
        data = retailer_routes._ask_inputs(body.cohort, body.range)
    except Exception as exc:
        limits.refund(store, m.uid, "retailer_ask")
        raise HTTPException(503, retailer_routes.UNAVAILABLE) from exc
    try:
        answer = retailer_ask.ask(body.question, data, scope)
    except retailer_ask.Unavailable as exc:
        limits.refund(store, m.uid, "retailer_ask")
        raise HTTPException(
            503,
            {
                "code": "assistant_unavailable",
                "message": "The assistant is unavailable right now. Try again in a minute.",
            },
        ) from exc
    answer = {**answer, "scope": {"brand": brand, "names_hidden": scope.masked}}
    if not answer.get("refused"):
        _answers[key] = (time.time(), answer)
    return answer


# -- fit: what opted-in shoppers avoid and react to ----------------------------------------------
#
# Aggregates of the shopper app's safety profiles (users/{uid}.profile.safety: `avoid` ingredient
# groups, `avoid_products`) and reaction log (users/{uid}.reactions), counted in people, only for
# people who opted in to aggregate sharing (users/{uid}.consent.aggregate_insights_opt_in, the same
# flag the BigQuery export reads). Any count under the minimum group is left out. Never a person.

FIT_TTL_S = 600
_fit_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _fit_counts(store: Store) -> dict[str, Any]:
    hit = _fit_cache.get("all")
    if hit and time.time() - hit[0] < FIT_TTL_S:
        return hit[1]
    profiled = 0
    reacting = 0
    avoid: Counter[str] = Counter()
    avoided: Counter[str] = Counter()
    reacted: Counter[str] = Counter()
    stopped: Counter[str] = Counter()  # people with a reaction that was not mild
    for _, doc in store.users_list():
        doc = doc or {}
        if not (doc.get("consent") or {}).get("aggregate_insights_opt_in"):
            continue
        prof = ((doc.get("profile") or {}).get("safety")) or None
        if prof:
            profiled += 1
            avoid.update({a for a in prof.get("avoid") or [] if a in safety.AVOID_LABEL})
            avoided.update(set(prof.get("avoid_products") or []))
        rx = doc.get("reactions") or []
        if rx:
            reacting += 1
            reacted.update({r.get("product_id") for r in rx if r.get("product_id")})
            stopped.update(
                {
                    r.get("product_id")
                    for r in rx
                    if r.get("product_id") and r.get("level") != "mild"
                }
            )
    out = {
        "profiled": profiled,
        "reacting": reacting,
        "avoid": dict(avoid),
        "avoided": dict(avoided),
        "reacted": dict(reacted),
        "stopped": dict(stopped),
    }
    _fit_cache["all"] = (time.time(), out)
    return out


@router.get("/proof/orgs/{org}/fit")
def fit(
    m: Member = Depends(member_of("viewer")), store: Store = Depends(get_store)
) -> dict[str, Any]:
    """People who opted in to sharing: which ingredient groups they avoid, and which products they
    put on their avoid list or reported a reaction to (a brand: its own products only). Every
    count is people, 10 or more; smaller groups are left out and counted in `hidden`."""
    c = _fit_counts(store)
    floor = retailer.MIN_GROUP

    def shown(n: int) -> int | None:
        return n if n >= floor else None

    groups = [
        {"id": k, "label": safety.AVOID_LABEL[k], "people": c["avoid"][k]}
        for k in sorted(c["avoid"], key=lambda k: (-c["avoid"][k], k))
        if c["avoid"][k] >= floor and c["profiled"] >= floor
    ]
    ids = set(c["avoided"]) | set(c["reacted"])
    products, hidden = [], 0
    for pid in sorted(ids):
        p = catalog.by_id(pid)
        if p is None or not proof_orgs.owns_brand(m.org, p["brand"]):
            continue
        row = {
            "product_id": pid,
            "product": p["name"],
            "brand": p["brand"],
            "avoided": shown(c["avoided"].get(pid, 0)),
            "reacted": shown(c["reacted"].get(pid, 0)),
            "stopped": shown(c["stopped"].get(pid, 0)),
        }
        if row["avoided"] is None and row["reacted"] is None:
            hidden += 1
            continue
        products.append(row)
    products.sort(key=lambda r: (-(r["reacted"] or 0), -(r["avoided"] or 0), r["product"]))
    return {
        "min_group": floor,
        "profiled": shown(c["profiled"]),
        "reacting": shown(c["reacting"]),
        "avoid": groups,
        "products": products[:50],
        "hidden": hidden,
        "basis": "People who opted in to anonymised sharing; counts of people, groups under "
        f"{floor} left out. Self-reported in the Willow app.",
    }


# -- methodology ------------------------------------------------------------------------------


@router.get("/proof/research")
def research() -> dict[str, Any]:
    """How Proof measures (public): thresholds, suppression, holdout, cohort, metrics, consent
    and what each side sees, all read from the code."""
    return proof_research.research()
