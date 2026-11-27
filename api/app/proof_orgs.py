"""Proof by Willow organisations: instances, orgs, memberships and roles (option A of
research/finals/06 section 6.2: seeded organisations with real membership).

- **Instance**: one retailer's Proof deployment (name, accent, domains). Seeded in
  `api/seed/proof_instances.json`; an unknown host falls back to the default instance (`willow`,
  every catalog brand: today's behaviour).
- **Org**: the retailer org (every brand in its range) or a brand org (owns brand names, verified
  by the retailer's supplier list). Seeded; org ids are unique across instances.
- **Membership**: `proof_members/{instance}__{org}__{uid}` {instance, org_id, uid, role, demo,
  joined_at, active_at}. Roles admin > analyst > viewer. In a demo instance anyone signed in
  (anonymous guests included) can "Try as" any org: that membership is `demo: true`. Real
  memberships (`demo: false`) are never created through the api in this version.

`member_of(need)` is the FastAPI dependency the Proof routes use: the caller's membership of the
`{org}` in the path, at least `need`, or 404 (unknown org) / 403 (not a member, or role too low).
"""

import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import cache
from pathlib import Path
from typing import Any

from fastapi import Depends, HTTPException

from app import catalog
from app.auth import AuthUser, current_user
from app.store import Doc, Store, get_store, iso

SEED = Path(__file__).resolve().parent.parent / "seed" / "proof_instances.json"
ROLES = ("viewer", "analyst", "admin")  # ascending: each role can do what the ones before can
RANK = {r: i for i, r in enumerate(ROLES)}


def slug_of(name: str) -> str:
    """The web's slugOf (features/retail/ui/format.ts): "La Roche-Posay" -> "la-roche-posay"."""
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower().replace("&", "and")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def _all_brands() -> list[str]:
    return sorted({p["brand"] for p in catalog.products()})


@cache
def _seed() -> dict[str, Any]:
    """Instances with their orgs expanded (brands "*" -> every catalog brand; catalog brand orgs
    generated). Fails loudly on a brand that is not in the catalog or a duplicate org id."""
    raw = json.loads(SEED.read_text())
    brands = _all_brands()
    known = set(brands)
    instances: dict[str, dict[str, Any]] = {}
    orgs: dict[str, dict[str, Any]] = {}
    for inst in raw["instances"]:
        rows = list(inst["orgs"])
        if inst.get("brand_orgs_from_catalog"):
            rows += [
                {"id": f"{inst['id']}-{slug_of(b)}", "name": b, "kind": "brand", "brands": [b]}
                for b in brands
            ]
        out = []
        for o in rows:
            all_brands = o["brands"] == "*"
            names = brands if all_brands else list(o["brands"])
            if unknown := set(names) - known:
                raise ValueError(f"proof org {o['id']}: brands not in the catalog: {unknown}")
            if o["id"] in orgs:
                raise ValueError(f"proof org id {o['id']} is used twice")
            org = {
                "id": o["id"],
                "name": o["name"],
                "kind": o["kind"],
                "brands": names,
                "all_brands": all_brands,
                # a brand org is vouched for by the retailer's supplier list (when it has one)
                "verified": inst.get("verified_basis") if o["kind"] == "brand" else None,
                "instance": inst["id"],
            }
            orgs[org["id"]] = org
            out.append(org)
        instances[inst["id"]] = {
            "id": inst["id"],
            "name": inst["name"],
            "accent": inst["accent"],
            "domains": [d.lower() for d in inst["domains"]],
            "demo": bool(inst.get("demo")),
            "orgs": out,
        }
    return {"default": raw["default"], "instances": instances, "orgs": orgs}


def instance(instance_id: str) -> dict[str, Any] | None:
    return _seed()["instances"].get(instance_id)


def org(org_id: str) -> dict[str, Any] | None:
    return _seed()["orgs"].get(org_id)


def resolve(host: str | None = None, slug: str | None = None) -> dict[str, Any]:
    """The instance for a slug (an instance id), else for a hostname (port ignored), else the
    default instance."""
    seed = _seed()
    if slug and slug in seed["instances"]:
        return seed["instances"][slug]
    name = (host or "").strip().lower().split(":")[0]
    for inst in seed["instances"].values():
        if name and name in inst["domains"]:
            return inst
    return seed["instances"][seed["default"]]


def org_view(o: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": o["id"],
        "name": o["name"],
        "kind": o["kind"],
        "brands": o["brands"],
        "all_brands": o["all_brands"],
        "verified": o["verified"],
    }


def instance_view(inst: dict[str, Any]) -> dict[str, Any]:
    return {
        "instance": {k: inst[k] for k in ("id", "name", "accent", "domains", "demo")},
        "orgs": [org_view(o) for o in inst["orgs"]],
    }


def retailer_of(instance_id: str) -> dict[str, Any] | None:
    inst = instance(instance_id) or {}
    return next((o for o in inst.get("orgs", []) if o["kind"] == "retailer"), None)


def owns_brand(o: dict[str, Any], brand: str) -> bool:
    """A retailer org covers every brand in its range; a brand org only its own brand names."""
    return brand in o["brands"]


# -- memberships ------------------------------------------------------------------------------


@dataclass(frozen=True)
class Member:
    uid: str
    org: dict[str, Any]
    role: str
    demo: bool

    @property
    def org_id(self) -> str:
        return self.org["id"]

    @property
    def instance(self) -> str:
        return self.org["instance"]

    def at_least(self, need: str) -> bool:
        return RANK[self.role] >= RANK[need]


def memberships(store: Store, uid: str, instance_id: str | None = None) -> list[Doc]:
    """This person's memberships of orgs that still exist, newest use first."""
    rows = [
        m
        for m in store.proof_members_of_user(uid)
        if org(m["org_id"]) and (instance_id is None or m["instance"] == instance_id)
    ]
    return sorted(rows, key=lambda m: iso(m.get("active_at")) or "", reverse=True)


def member_view(m: Doc) -> dict[str, Any]:
    return {
        "org_id": m["org_id"],
        "instance": m["instance"],
        "role": m["role"],
        "demo": bool(m.get("demo")),
        "joined_at": iso(m.get("joined_at")),
    }


def membership(store: Store, uid: str, org_id: str) -> Member | None:
    o = org(org_id)
    if o is None:
        return None
    doc = store.proof_member_get(o["instance"], org_id, uid)
    if doc is None or doc.get("role") not in RANK:
        return None
    return Member(uid=uid, org=o, role=doc["role"], demo=bool(doc.get("demo")))


def has_real_membership(store: Store, uid: str) -> bool:
    return any(not m.get("demo") for m in memberships(store, uid))


def join(store: Store, uid: str, instance_id: str, org_id: str, role: str) -> Doc:
    """'Try as' an org of a demo instance: a demo membership with the chosen role. Joining again
    changes the role and makes it the current org (active_at). A real membership is never
    downgraded to a demo one."""
    inst = instance(instance_id)
    if inst is None:
        raise HTTPException(404, {"code": "not_found", "message": "No such Proof instance."})
    o = org(org_id)
    if o is None or o["instance"] != instance_id:
        raise HTTPException(404, {"code": "not_found", "message": "No such organisation."})
    if not inst["demo"]:
        raise HTTPException(
            403, {"code": "not_demo", "message": "Ask an admin of this organisation to invite you."}
        )
    if role not in RANK:
        raise HTTPException(
            422, {"code": "bad_request", "message": "Unknown role.", "field": "role"}
        )
    at = datetime.now(UTC)
    had = store.proof_member_get(instance_id, org_id, uid)
    if had and not had.get("demo"):
        doc = {**had, "active_at": at}
    else:
        doc = {
            "instance": instance_id,
            "org_id": org_id,
            "uid": uid,
            "role": role,
            "demo": True,
            "joined_at": (had or {}).get("joined_at") or at,
            "active_at": at,
        }
    store.proof_member_set(instance_id, org_id, uid, doc)
    return doc


def forbidden(message: str) -> HTTPException:
    return HTTPException(403, {"code": "forbidden", "message": message})


def require(store: Store, uid: str, org_id: str, need: str = "viewer") -> Member:
    if org(org_id) is None:
        raise HTTPException(404, {"code": "not_found", "message": "No such organisation."})
    m = membership(store, uid, org_id)
    if m is None:
        raise forbidden("You are not a member of this organisation.")
    if not m.at_least(need):
        raise forbidden(f"This needs the {need} role or higher.")
    return m


def member_of(need: str = "viewer"):
    """FastAPI dependency: the caller's membership of the `{org}` path parameter, at least
    `need` (403 otherwise; 404 for an unknown org)."""

    def dep(
        org: str, user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
    ) -> Member:
        return require(store, user.uid, org, need)

    return dep
