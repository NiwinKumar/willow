"""Persistence for users/{uid}/** (CONTRACT.md section 4).

`FirestoreStore` is the real one; `MemoryStore` backs local dev without credentials and the tests.
Routes get the store through `Depends(get_store)`.

`result` is kept as a JSON string (`result_json`): Firestore cannot hold arrays of arrays, and ROI
polygons are exactly that.
"""

import copy
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any, Protocol

from app import gcp

Doc = dict[str, Any]


class Store(Protocol):
    def session_get(self, uid: str, sid: str) -> Doc | None: ...
    def session_set(self, uid: str, sid: str, doc: Doc) -> None: ...
    def session_update(self, uid: str, sid: str, fields: Doc) -> None: ...
    def sessions_list(self, uid: str) -> list[tuple[str, Doc]]: ...
    def session_claim(self, uid: str, sid: str, stale: timedelta) -> bool: ...
    def baseline_get(self, uid: str, site: str) -> Doc | None: ...
    def baseline_set(self, uid: str, site: str, doc: Doc) -> None: ...
    def baseline_delete(self, uid: str, site: str) -> None: ...
    def routine_list(self, uid: str) -> list[tuple[str, Doc]]: ...
    def routine_get(self, uid: str, entry_id: str) -> Doc | None: ...
    def routine_set(self, uid: str, entry_id: str, doc: Doc) -> None: ...
    def routine_delete(self, uid: str, entry_id: str) -> None: ...
    def routine_log_mark(self, uid: str, day: str, entry_id: str, slot: str, used: bool) -> Doc: ...
    def routine_logs(self, uid: str, first: str, last: str) -> list[Doc]: ...
    def routine_log_forget(self, uid: str, entry_id: str, days: list[str]) -> None: ...
    def usage_incr(self, uid: str, day: str, key: str, delta: int = 1) -> int: ...
    def user_get(self, uid: str) -> Doc | None: ...
    def user_merge(self, uid: str, fields: Doc) -> None: ...
    def users_list(self) -> list[tuple[str, Doc]]: ...
    def delete_user(self, uid: str) -> None: ...
    def product_tests_list(self, uid: str) -> list[tuple[str, Doc]]: ...
    def product_test_get(self, uid: str, test_id: str) -> Doc | None: ...
    def product_test_set(self, uid: str, test_id: str, doc: Doc) -> None: ...
    def product_test_delete(self, uid: str, test_id: str) -> None: ...
    def push_list(self, uid: str) -> list[tuple[str, Doc]]: ...
    def push_set(self, uid: str, sub_id: str, doc: Doc) -> None: ...
    def push_delete(self, uid: str, sub_id: str) -> None: ...
    def reminder_claim(self, uid: str, day: str, doc: Doc) -> bool: ...
    # Advisor (slice F): read today's counters without counting; the chat history.
    def usage_get(self, uid: str, day: str) -> Doc: ...
    def advisor_add(self, uid: str, turns: list[Doc], keep: int) -> None: ...
    def advisor_list(self, uid: str) -> list[Doc]: ...
    def advisor_clear(self, uid: str) -> None: ...
    # Proof-gated promotion (app/campaigns.py): campaigns/{id}, daily/{day}, seen/{key}.
    def campaign_set(self, cid: str, doc: Doc) -> None: ...
    def campaign_get(self, cid: str) -> Doc | None: ...
    def campaign_update(self, cid: str, fields: Doc) -> None: ...
    def campaign_delete(self, cid: str) -> None: ...
    def campaigns_of(self, uid: str) -> list[tuple[str, Doc]]: ...
    def campaigns_active(self) -> list[tuple[str, Doc]]: ...
    def campaign_days(self, cid: str) -> list[tuple[str, Doc]]: ...
    def campaign_event(self, cid: str, day: str, seen_id: str, kind: str) -> bool: ...
    # Randomised holdout: campaigns/{id}/members/{sha(uid)} {group, first_day, added}.
    def campaign_member_join(self, cid: str, member_id: str, doc: Doc) -> Doc: ...
    def campaign_member_get(self, cid: str, member_id: str) -> Doc | None: ...
    def campaign_member_update(self, cid: str, member_id: str, fields: Doc) -> None: ...
    def campaign_members(self, cid: str) -> list[Doc]: ...
    # Shelf vs results (app/shelf.py): shelf/{uid}, the retailer's uploaded facings or stock.
    def shelf_get(self, uid: str) -> Doc | None: ...
    def shelf_set(self, uid: str, doc: Doc) -> None: ...
    def shelf_delete(self, uid: str) -> None: ...
    # AutoCampaign (app/autopilot.py): campaign_rules/{id}, autopilot_activity/{id}.
    def rule_set(self, rid: str, doc: Doc) -> None: ...
    def rule_get(self, rid: str) -> Doc | None: ...
    def rule_update(self, rid: str, fields: Doc) -> None: ...
    def rule_delete(self, rid: str) -> None: ...
    def rules_of(self, uid: str) -> list[tuple[str, Doc]]: ...
    def rules_all(self) -> list[tuple[str, Doc]]: ...
    def activity_add(self, aid: str, doc: Doc) -> bool: ...
    def activity_get(self, aid: str) -> Doc | None: ...
    def activity_update(self, aid: str, fields: Doc) -> None: ...
    def activities_of(self, uid: str) -> list[tuple[str, Doc]]: ...
    def activity_delete(self, aid: str) -> None: ...
    # Product requests (app/product_requests.py): users/{uid}/product_requests/{id}, and one
    # product_requests/{key} per requested product with who asked (so all of them hear back).
    def product_request_set(self, uid: str, rid: str, doc: Doc) -> None: ...
    def product_request_update(self, uid: str, rid: str, fields: Doc) -> None: ...
    def product_requests_of(self, uid: str) -> list[tuple[str, Doc]]: ...
    def product_wish_add(self, key: str, uid: str, doc: Doc) -> Doc: ...
    def product_wish_get(self, key: str) -> Doc | None: ...
    def product_wish_update(self, key: str, fields: Doc) -> None: ...
    def product_wishes(self) -> list[tuple[str, Doc]]: ...


def _running(doc: Doc, stale: timedelta) -> bool:
    started = doc.get("processing_started_at")
    return (
        doc.get("status") == "processing"
        and isinstance(started, datetime)
        and datetime.now(UTC) - started < stale
    )


class FirestoreStore:
    def _db(self):
        return gcp.firestore_client()

    def session_get(self, uid: str, sid: str) -> Doc | None:
        snap = self._db().document(f"users/{uid}/sessions/{sid}").get()
        return snap.to_dict() if snap.exists else None

    def session_set(self, uid: str, sid: str, doc: Doc) -> None:
        self._db().document(f"users/{uid}/sessions/{sid}").set(doc)

    def session_update(self, uid: str, sid: str, fields: Doc) -> None:
        self._db().document(f"users/{uid}/sessions/{sid}").update(fields)

    def session_claim(self, uid: str, sid: str, stale: timedelta) -> bool:
        """Atomically move a session to "processing" unless another analysis is already running
        (and not stale). Two tabs or a reload can no longer both run the engine."""
        from google.cloud import firestore

        db = self._db()
        ref = db.document(f"users/{uid}/sessions/{sid}")

        @firestore.transactional
        def claim(tx) -> bool:
            snap = ref.get(transaction=tx)
            doc = snap.to_dict() or {}
            if _running(doc, stale):
                return False
            tx.update(ref, {"status": "processing", "processing_started_at": datetime.now(UTC)})
            return True

        return claim(db.transaction())

    def sessions_list(self, uid: str) -> list[tuple[str, Doc]]:
        # A person has tens of sessions at most; filter and sort in Python, no composite index.
        snaps = self._db().collection(f"users/{uid}/sessions").stream()
        return [(s.id, s.to_dict()) for s in snaps]

    def baseline_get(self, uid: str, site: str) -> Doc | None:
        snap = self._db().document(f"users/{uid}/baselines/{site}").get()
        return snap.to_dict() if snap.exists else None

    def baseline_set(self, uid: str, site: str, doc: Doc) -> None:
        self._db().document(f"users/{uid}/baselines/{site}").set(doc)

    def baseline_delete(self, uid: str, site: str) -> None:
        self._db().document(f"users/{uid}/baselines/{site}").delete()

    def routine_list(self, uid: str) -> list[tuple[str, Doc]]:
        return [(s.id, s.to_dict()) for s in self._db().collection(f"users/{uid}/routine").stream()]

    def routine_get(self, uid: str, entry_id: str) -> Doc | None:
        snap = self._db().document(f"users/{uid}/routine/{entry_id}").get()
        return snap.to_dict() if snap.exists else None

    def routine_set(self, uid: str, entry_id: str, doc: Doc) -> None:
        self._db().document(f"users/{uid}/routine/{entry_id}").set(doc)

    def routine_delete(self, uid: str, entry_id: str) -> None:
        self._db().document(f"users/{uid}/routine/{entry_id}").delete()

    def routine_log_mark(self, uid: str, day: str, entry_id: str, slot: str, used: bool) -> Doc:
        """users/{uid}/routine_log/{day}: {date, used: {entry_id: [slots]}}; atomic per tick."""
        from google.cloud import firestore

        ref = self._db().document(f"users/{uid}/routine_log/{day}")
        change = firestore.ArrayUnion([slot]) if used else firestore.ArrayRemove([slot])
        ref.set(
            {"date": day, "used": {entry_id: change}, "updated_at": datetime.now(UTC)},
            merge=True,
        )
        return ref.get().to_dict() or {"date": day, "used": {}}

    def routine_logs(self, uid: str, first: str, last: str) -> list[Doc]:
        q = (
            self._db()
            .collection(f"users/{uid}/routine_log")
            .where("date", ">=", first)
            .where("date", "<=", last)
        )
        return sorted((s.to_dict() for s in q.stream()), key=lambda d: d["date"])

    def routine_log_forget(self, uid: str, entry_id: str, days: list[str]) -> None:
        """Drop one product's ticks from these days (the product was removed)."""
        from google.cloud import firestore
        from google.cloud.firestore_v1.field_path import FieldPath

        db = self._db()
        path = FieldPath("used", entry_id).to_api_repr()  # quoted: ids may hold "-"
        for start in range(0, len(days), 450):  # a batch holds at most 500 writes
            batch = db.batch()
            for day in days[start : start + 450]:
                batch.update(
                    db.document(f"users/{uid}/routine_log/{day}"), {path: firestore.DELETE_FIELD}
                )
            batch.commit()

    def user_get(self, uid: str) -> Doc | None:
        snap = self._db().document(f"users/{uid}").get()
        return snap.to_dict() if snap.exists else None

    def user_merge(self, uid: str, fields: Doc) -> None:
        self._db().document(f"users/{uid}").set(fields, merge=True)

    def users_list(self) -> list[tuple[str, Doc]]:
        return [(s.id, s.to_dict()) for s in self._db().collection("users").stream()]

    def usage_incr(self, uid: str, day: str, key: str, delta: int = 1) -> int:
        from google.cloud import firestore

        ref = self._db().document(f"users/{uid}/usage/{day}")
        ref.set({key: firestore.Increment(delta)}, merge=True)
        return int((ref.get().to_dict() or {}).get(key, 0))

    def delete_user(self, uid: str) -> None:
        from google.cloud import firestore

        db = self._db()
        # recursive: every subcollection goes too (sessions, routine, usage, advisor_messages,
        # product_requests); and the person leaves every product request they were counted in
        wishes = db.collection("product_requests").where("requesters", "array_contains", uid)
        for snap in wishes.stream():
            n = len([u for u in (snap.to_dict() or {}).get("requesters", []) if u != uid])
            snap.reference.update({"requesters": firestore.ArrayRemove([uid]), "count": n})
        db.recursive_delete(db.document(f"users/{uid}"))

    def product_tests_list(self, uid: str) -> list[tuple[str, Doc]]:
        snaps = self._db().collection(f"users/{uid}/product_tests").stream()
        return [(s.id, s.to_dict()) for s in snaps]

    def product_test_get(self, uid: str, test_id: str) -> Doc | None:
        snap = self._db().document(f"users/{uid}/product_tests/{test_id}").get()
        return snap.to_dict() if snap.exists else None

    def product_test_set(self, uid: str, test_id: str, doc: Doc) -> None:
        self._db().document(f"users/{uid}/product_tests/{test_id}").set(doc)

    def product_test_delete(self, uid: str, test_id: str) -> None:
        self._db().document(f"users/{uid}/product_tests/{test_id}").delete()

    def push_list(self, uid: str) -> list[tuple[str, Doc]]:
        return [(s.id, s.to_dict()) for s in self._db().collection(f"users/{uid}/push").stream()]

    def push_set(self, uid: str, sub_id: str, doc: Doc) -> None:
        self._db().document(f"users/{uid}/push/{sub_id}").set(doc)

    def push_delete(self, uid: str, sub_id: str) -> None:
        self._db().document(f"users/{uid}/push/{sub_id}").delete()

    def reminder_claim(self, uid: str, day: str, doc: Doc) -> bool:
        """users/{uid}/reminders_sent/{day}: created once; a second run that day gets False."""
        from google.api_core.exceptions import AlreadyExists, Conflict

        try:
            self._db().document(f"users/{uid}/reminders_sent/{day}").create(doc)
        except (AlreadyExists, Conflict):
            return False
        return True

    def usage_get(self, uid: str, day: str) -> Doc:
        snap = self._db().document(f"users/{uid}/usage/{day}").get()
        return (snap.to_dict() or {}) if snap.exists else {}

    def advisor_add(self, uid: str, turns: list[Doc], keep: int) -> None:
        from google.cloud import firestore

        db = self._db()
        col = db.collection(f"users/{uid}/advisor_messages")
        batch = db.batch()
        for t in turns:
            batch.set(col.document(t["id"]), {k: v for k, v in t.items() if k != "id"})
        batch.commit()
        # newest `keep` stay: everything older goes
        old = col.order_by("created_at", direction=firestore.Query.DESCENDING).offset(keep)
        refs = [s.reference for s in old.select([]).stream()]
        for i in range(0, len(refs), 400):
            prune = db.batch()
            for ref in refs[i : i + 400]:
                prune.delete(ref)
            prune.commit()

    def advisor_list(self, uid: str) -> list[Doc]:
        col = self._db().collection(f"users/{uid}/advisor_messages")
        return [{"id": s.id, **s.to_dict()} for s in col.order_by("created_at").stream()]

    def advisor_clear(self, uid: str) -> None:
        db = self._db()
        db.recursive_delete(db.collection(f"users/{uid}/advisor_messages"))

    def campaign_set(self, cid: str, doc: Doc) -> None:
        self._db().document(f"campaigns/{cid}").set(doc)

    def campaign_get(self, cid: str) -> Doc | None:
        snap = self._db().document(f"campaigns/{cid}").get()
        return snap.to_dict() if snap.exists else None

    def campaign_update(self, cid: str, fields: Doc) -> None:
        self._db().document(f"campaigns/{cid}").update(fields)

    def campaign_delete(self, cid: str) -> None:
        db = self._db()
        db.recursive_delete(db.document(f"campaigns/{cid}"))  # daily counters and seen keys too

    def campaigns_of(self, uid: str) -> list[tuple[str, Doc]]:
        # single-field equality: Firestore's automatic index, no composite index
        q = self._db().collection("campaigns").where("owner_uid", "==", uid)
        return [(s.id, s.to_dict()) for s in q.stream()]

    def campaigns_active(self) -> list[tuple[str, Doc]]:
        q = self._db().collection("campaigns").where("status", "==", "active")
        return [(s.id, s.to_dict()) for s in q.stream()]

    def campaign_days(self, cid: str) -> list[tuple[str, Doc]]:
        snaps = self._db().collection(f"campaigns/{cid}/daily").stream()
        return [(s.id, s.to_dict()) for s in snaps]

    def campaign_event(self, cid: str, day: str, seen_id: str, kind: str) -> bool:
        """Atomically: count `kind` once per person per day (seen/{seen_id}); a click or an add
        only after an impression that day. Returns whether it counted."""
        from google.cloud import firestore

        db = self._db()
        seen = db.document(f"campaigns/{cid}/seen/{seen_id}")
        daily = db.document(f"campaigns/{cid}/daily/{day}")

        @firestore.transactional
        def count(tx) -> bool:
            had = seen.get(transaction=tx).to_dict() or {}
            if had.get(kind) or (kind != "impression" and not had.get("impression")):
                return False
            tx.set(seen, {"day": day, kind: True}, merge=True)
            tx.set(daily, {"day": day, f"{kind}s": firestore.Increment(1)}, merge=True)
            return True

        return count(db.transaction())

    def campaign_member_join(self, cid: str, member_id: str, doc: Doc) -> Doc:
        """Create-if-absent: the first assignment stands; returns the doc on record."""
        from google.api_core.exceptions import AlreadyExists, Conflict

        ref = self._db().document(f"campaigns/{cid}/members/{member_id}")
        try:
            ref.create(doc)
            return dict(doc)
        except (AlreadyExists, Conflict):
            return ref.get().to_dict() or dict(doc)

    def campaign_member_get(self, cid: str, member_id: str) -> Doc | None:
        snap = self._db().document(f"campaigns/{cid}/members/{member_id}").get()
        return snap.to_dict() if snap.exists else None

    def campaign_member_update(self, cid: str, member_id: str, fields: Doc) -> None:
        self._db().document(f"campaigns/{cid}/members/{member_id}").update(fields)

    def campaign_members(self, cid: str) -> list[Doc]:
        return [s.to_dict() for s in self._db().collection(f"campaigns/{cid}/members").stream()]

    def shelf_get(self, uid: str) -> Doc | None:
        snap = self._db().document(f"shelf/{uid}").get()
        return snap.to_dict() if snap.exists else None

    def shelf_set(self, uid: str, doc: Doc) -> None:
        self._db().document(f"shelf/{uid}").set(doc)

    def shelf_delete(self, uid: str) -> None:
        self._db().document(f"shelf/{uid}").delete()

    def rule_set(self, rid: str, doc: Doc) -> None:
        self._db().document(f"campaign_rules/{rid}").set(doc)

    def rule_get(self, rid: str) -> Doc | None:
        snap = self._db().document(f"campaign_rules/{rid}").get()
        return snap.to_dict() if snap.exists else None

    def rule_update(self, rid: str, fields: Doc) -> None:
        self._db().document(f"campaign_rules/{rid}").update(fields)

    def rule_delete(self, rid: str) -> None:
        self._db().document(f"campaign_rules/{rid}").delete()

    def rules_of(self, uid: str) -> list[tuple[str, Doc]]:
        q = self._db().collection("campaign_rules").where("owner_uid", "==", uid)
        return [(s.id, s.to_dict()) for s in q.stream()]

    def rules_all(self) -> list[tuple[str, Doc]]:
        q = self._db().collection("campaign_rules").where("enabled", "==", True)
        return [(s.id, s.to_dict()) for s in q.stream()]

    def activity_add(self, aid: str, doc: Doc) -> bool:
        """Create once: an id already written (the same action on the same day) is left alone."""
        from google.api_core.exceptions import AlreadyExists

        try:
            self._db().document(f"autopilot_activity/{aid}").create(doc)
        except AlreadyExists:
            return False
        return True

    def activity_get(self, aid: str) -> Doc | None:
        snap = self._db().document(f"autopilot_activity/{aid}").get()
        return snap.to_dict() if snap.exists else None

    def activity_update(self, aid: str, fields: Doc) -> None:
        self._db().document(f"autopilot_activity/{aid}").update(fields)

    def activity_delete(self, aid: str) -> None:
        self._db().document(f"autopilot_activity/{aid}").delete()

    def activities_of(self, uid: str) -> list[tuple[str, Doc]]:
        q = self._db().collection("autopilot_activity").where("owner_uid", "==", uid)
        return [(s.id, s.to_dict()) for s in q.stream()]

    def product_request_set(self, uid: str, rid: str, doc: Doc) -> None:
        self._db().document(f"users/{uid}/product_requests/{rid}").set(doc)

    def product_request_update(self, uid: str, rid: str, fields: Doc) -> None:
        self._db().document(f"users/{uid}/product_requests/{rid}").update(fields)

    def product_requests_of(self, uid: str) -> list[tuple[str, Doc]]:
        snaps = self._db().collection(f"users/{uid}/product_requests").stream()
        return [(s.id, s.to_dict()) for s in snaps]

    def product_wish_add(self, key: str, uid: str, doc: Doc) -> Doc:
        """Count this person once for the product (a transaction, so two at once both count)."""
        from google.cloud import firestore

        db = self._db()
        ref = db.document(f"product_requests/{key}")

        @firestore.transactional
        def add(tx) -> Doc:
            snap = ref.get(transaction=tx)
            cur = snap.to_dict() if snap.exists else {**doc, "requesters": [], "count": 0}
            if uid not in cur["requesters"]:
                cur["requesters"] = [*cur["requesters"], uid]
                cur["count"] = len(cur["requesters"])
            cur["last_at"] = doc["last_at"]
            tx.set(ref, cur)
            return cur

        return add(db.transaction())

    def product_wish_get(self, key: str) -> Doc | None:
        snap = self._db().document(f"product_requests/{key}").get()
        return snap.to_dict() if snap.exists else None

    def product_wish_update(self, key: str, fields: Doc) -> None:
        self._db().document(f"product_requests/{key}").update(fields)

    def product_wishes(self) -> list[tuple[str, Doc]]:
        return [(s.id, s.to_dict()) for s in self._db().collection("product_requests").stream()]


class MemoryStore:
    def __init__(self) -> None:
        self.sessions: dict[tuple[str, str], Doc] = {}
        self.baselines: dict[tuple[str, str], Doc] = {}
        self.routine: dict[tuple[str, str], Doc] = {}
        self.routine_log: dict[tuple[str, str], Doc] = {}
        self.usage: dict[tuple[str, str, str], int] = {}
        self.users: dict[str, Doc] = {}
        self.product_tests: dict[tuple[str, str], Doc] = {}
        self.push: dict[tuple[str, str], Doc] = {}
        self.reminders_sent: dict[tuple[str, str], Doc] = {}
        self.advisor: dict[tuple[str, str], Doc] = {}
        self.campaigns: dict[str, Doc] = {}
        self.campaign_daily: dict[tuple[str, str], Doc] = {}
        self.campaign_seen: dict[tuple[str, str], Doc] = {}
        self.campaign_member: dict[tuple[str, str], Doc] = {}
        self.shelf: dict[str, Doc] = {}
        self.rules: dict[str, Doc] = {}
        self.activity: dict[str, Doc] = {}
        self.product_requests: dict[tuple[str, str], Doc] = {}
        self.wishes: dict[str, Doc] = {}

    def session_get(self, uid: str, sid: str) -> Doc | None:
        doc = self.sessions.get((uid, sid))
        return copy.deepcopy(doc) if doc is not None else None

    def session_set(self, uid: str, sid: str, doc: Doc) -> None:
        self.sessions[(uid, sid)] = copy.deepcopy(doc)

    def session_update(self, uid: str, sid: str, fields: Doc) -> None:
        doc = self.sessions[(uid, sid)]
        for key, value in copy.deepcopy(fields).items():
            *parents, leaf = key.split(".")  # a dotted key is a field path, as in Firestore
            node = doc
            for part in parents:
                node = node.setdefault(part, {})
            node[leaf] = value

    def session_claim(self, uid: str, sid: str, stale: timedelta) -> bool:
        doc = self.sessions.get((uid, sid)) or {}
        if _running(doc, stale):
            return False
        doc.update(status="processing", processing_started_at=datetime.now(UTC))
        return True

    def sessions_list(self, uid: str) -> list[tuple[str, Doc]]:
        return [(sid, copy.deepcopy(d)) for (u, sid), d in self.sessions.items() if u == uid]

    def baseline_get(self, uid: str, site: str) -> Doc | None:
        doc = self.baselines.get((uid, site))
        return copy.deepcopy(doc) if doc is not None else None

    def baseline_set(self, uid: str, site: str, doc: Doc) -> None:
        self.baselines[(uid, site)] = copy.deepcopy(doc)

    def baseline_delete(self, uid: str, site: str) -> None:
        self.baselines.pop((uid, site), None)

    def routine_list(self, uid: str) -> list[tuple[str, Doc]]:
        return [(eid, copy.deepcopy(d)) for (u, eid), d in self.routine.items() if u == uid]

    def routine_get(self, uid: str, entry_id: str) -> Doc | None:
        doc = self.routine.get((uid, entry_id))
        return copy.deepcopy(doc) if doc is not None else None

    def routine_set(self, uid: str, entry_id: str, doc: Doc) -> None:
        self.routine[(uid, entry_id)] = copy.deepcopy(doc)

    def routine_delete(self, uid: str, entry_id: str) -> None:
        self.routine.pop((uid, entry_id), None)

    def routine_log_mark(self, uid: str, day: str, entry_id: str, slot: str, used: bool) -> Doc:
        doc = self.routine_log.setdefault((uid, day), {"date": day, "used": {}})
        slots = doc["used"].setdefault(entry_id, [])
        if used and slot not in slots:
            slots.append(slot)
        elif not used and slot in slots:
            slots.remove(slot)
        return copy.deepcopy(doc)

    def routine_logs(self, uid: str, first: str, last: str) -> list[Doc]:
        days = [d for (u, day), d in self.routine_log.items() if u == uid and first <= day <= last]
        return copy.deepcopy(sorted(days, key=lambda d: d["date"]))

    def routine_log_forget(self, uid: str, entry_id: str, days: list[str]) -> None:
        for day in days:
            (self.routine_log.get((uid, day)) or {}).get("used", {}).pop(entry_id, None)

    def user_get(self, uid: str) -> Doc | None:
        return copy.deepcopy(self.users.get(uid))

    def user_merge(self, uid: str, fields: Doc) -> None:
        self.users.setdefault(uid, {}).update(copy.deepcopy(fields))

    def users_list(self) -> list[tuple[str, Doc]]:
        return [(u, copy.deepcopy(d)) for u, d in self.users.items()]

    def usage_incr(self, uid: str, day: str, key: str, delta: int = 1) -> int:
        k = (uid, day, key)
        self.usage[k] = self.usage.get(k, 0) + delta
        return self.usage[k]

    def delete_user(self, uid: str) -> None:
        for table in (self.sessions, self.baselines, self.routine, self.routine_log, self.usage):
            for key in [k for k in table if k[0] == uid]:
                del table[key]
        for table in (self.push, self.reminders_sent):
            for key in [k for k in table if k[0] == uid]:
                del table[key]
        self.users.pop(uid, None)
        for key in [k for k in self.product_requests if k[0] == uid]:
            del self.product_requests[key]
        for wish in self.wishes.values():
            if uid in wish["requesters"]:
                wish["requesters"].remove(uid)
                wish["count"] = len(wish["requesters"])
        for key in [k for k in self.product_tests if k[0] == uid]:
            del self.product_tests[key]
        self.advisor_clear(uid)

    def product_tests_list(self, uid: str) -> list[tuple[str, Doc]]:
        return [(t, copy.deepcopy(d)) for (u, t), d in self.product_tests.items() if u == uid]

    def product_test_get(self, uid: str, test_id: str) -> Doc | None:
        doc = self.product_tests.get((uid, test_id))
        return copy.deepcopy(doc) if doc is not None else None

    def product_test_set(self, uid: str, test_id: str, doc: Doc) -> None:
        self.product_tests[(uid, test_id)] = copy.deepcopy(doc)

    def product_test_delete(self, uid: str, test_id: str) -> None:
        self.product_tests.pop((uid, test_id), None)

    def push_list(self, uid: str) -> list[tuple[str, Doc]]:
        return [(sid, copy.deepcopy(d)) for (u, sid), d in self.push.items() if u == uid]

    def push_set(self, uid: str, sub_id: str, doc: Doc) -> None:
        self.push[(uid, sub_id)] = copy.deepcopy(doc)

    def push_delete(self, uid: str, sub_id: str) -> None:
        self.push.pop((uid, sub_id), None)

    def reminder_claim(self, uid: str, day: str, doc: Doc) -> bool:
        if (uid, day) in self.reminders_sent:
            return False
        self.reminders_sent[(uid, day)] = copy.deepcopy(doc)
        return True

    def usage_get(self, uid: str, day: str) -> Doc:
        return {k: v for (u, d, k), v in self.usage.items() if u == uid and d == day}

    def advisor_add(self, uid: str, turns: list[Doc], keep: int) -> None:
        for t in turns:
            self.advisor[(uid, t["id"])] = copy.deepcopy({k: v for k, v in t.items() if k != "id"})
        rows = self.advisor_list(uid)
        for doc in rows[: max(0, len(rows) - keep)]:
            del self.advisor[(uid, doc["id"])]

    def advisor_list(self, uid: str) -> list[Doc]:
        rows = [{"id": i, **copy.deepcopy(d)} for (u, i), d in self.advisor.items() if u == uid]
        return sorted(rows, key=lambda d: (d["created_at"], d["id"]))

    def advisor_clear(self, uid: str) -> None:
        for key in [k for k in self.advisor if k[0] == uid]:
            del self.advisor[key]

    def campaign_set(self, cid: str, doc: Doc) -> None:
        self.campaigns[cid] = copy.deepcopy(doc)

    def campaign_get(self, cid: str) -> Doc | None:
        return copy.deepcopy(self.campaigns.get(cid))

    def campaign_update(self, cid: str, fields: Doc) -> None:
        self.campaigns[cid].update(copy.deepcopy(fields))

    def campaign_delete(self, cid: str) -> None:
        self.campaigns.pop(cid, None)
        for table in (self.campaign_daily, self.campaign_seen, self.campaign_member):
            for key in [k for k in table if k[0] == cid]:
                del table[key]

    def campaigns_of(self, uid: str) -> list[tuple[str, Doc]]:
        return [(c, copy.deepcopy(d)) for c, d in self.campaigns.items() if d["owner_uid"] == uid]

    def campaigns_active(self) -> list[tuple[str, Doc]]:
        return [(c, copy.deepcopy(d)) for c, d in self.campaigns.items() if d["status"] == "active"]

    def campaign_days(self, cid: str) -> list[tuple[str, Doc]]:
        return [(day, copy.deepcopy(d)) for (c, day), d in self.campaign_daily.items() if c == cid]

    def campaign_event(self, cid: str, day: str, seen_id: str, kind: str) -> bool:
        had = self.campaign_seen.setdefault((cid, seen_id), {"day": day})
        if had.get(kind) or (kind != "impression" and not had.get("impression")):
            return False
        had[kind] = True
        row = self.campaign_daily.setdefault((cid, day), {"day": day})
        row[f"{kind}s"] = row.get(f"{kind}s", 0) + 1
        return True

    def campaign_member_join(self, cid: str, member_id: str, doc: Doc) -> Doc:
        return copy.deepcopy(self.campaign_member.setdefault((cid, member_id), copy.deepcopy(doc)))

    def campaign_member_get(self, cid: str, member_id: str) -> Doc | None:
        return copy.deepcopy(self.campaign_member.get((cid, member_id)))

    def campaign_member_update(self, cid: str, member_id: str, fields: Doc) -> None:
        self.campaign_member[(cid, member_id)].update(copy.deepcopy(fields))

    def campaign_members(self, cid: str) -> list[Doc]:
        return [copy.deepcopy(d) for (c, _), d in self.campaign_member.items() if c == cid]

    def shelf_get(self, uid: str) -> Doc | None:
        return copy.deepcopy(self.shelf.get(uid))

    def shelf_set(self, uid: str, doc: Doc) -> None:
        self.shelf[uid] = copy.deepcopy(doc)

    def shelf_delete(self, uid: str) -> None:
        self.shelf.pop(uid, None)

    def rule_set(self, rid: str, doc: Doc) -> None:
        self.rules[rid] = copy.deepcopy(doc)

    def rule_get(self, rid: str) -> Doc | None:
        return copy.deepcopy(self.rules.get(rid))

    def rule_update(self, rid: str, fields: Doc) -> None:
        self.rules[rid].update(copy.deepcopy(fields))

    def rule_delete(self, rid: str) -> None:
        self.rules.pop(rid, None)

    def rules_of(self, uid: str) -> list[tuple[str, Doc]]:
        return [(r, copy.deepcopy(d)) for r, d in self.rules.items() if d["owner_uid"] == uid]

    def rules_all(self) -> list[tuple[str, Doc]]:
        return [(r, copy.deepcopy(d)) for r, d in self.rules.items() if d.get("enabled")]

    def activity_add(self, aid: str, doc: Doc) -> bool:
        if aid in self.activity:
            return False
        self.activity[aid] = copy.deepcopy(doc)
        return True

    def activity_get(self, aid: str) -> Doc | None:
        return copy.deepcopy(self.activity.get(aid))

    def activity_update(self, aid: str, fields: Doc) -> None:
        self.activity[aid].update(copy.deepcopy(fields))

    def activity_delete(self, aid: str) -> None:
        self.activity.pop(aid, None)

    def activities_of(self, uid: str) -> list[tuple[str, Doc]]:
        return [(a, copy.deepcopy(d)) for a, d in self.activity.items() if d["owner_uid"] == uid]

    def product_request_set(self, uid: str, rid: str, doc: Doc) -> None:
        self.product_requests[(uid, rid)] = copy.deepcopy(doc)

    def product_request_update(self, uid: str, rid: str, fields: Doc) -> None:
        self.product_requests[(uid, rid)].update(copy.deepcopy(fields))

    def product_requests_of(self, uid: str) -> list[tuple[str, Doc]]:
        return [(r, copy.deepcopy(d)) for (u, r), d in self.product_requests.items() if u == uid]

    def product_wish_add(self, key: str, uid: str, doc: Doc) -> Doc:
        cur = self.wishes.setdefault(key, {**copy.deepcopy(doc), "requesters": [], "count": 0})
        if uid not in cur["requesters"]:
            cur["requesters"].append(uid)
            cur["count"] = len(cur["requesters"])
        cur["last_at"] = doc["last_at"]
        return copy.deepcopy(cur)

    def product_wish_get(self, key: str) -> Doc | None:
        return copy.deepcopy(self.wishes.get(key))

    def product_wish_update(self, key: str, fields: Doc) -> None:
        self.wishes[key].update(copy.deepcopy(fields))

    def product_wishes(self) -> list[tuple[str, Doc]]:
        return [(k, copy.deepcopy(d)) for k, d in self.wishes.items()]


@lru_cache
def get_store() -> Store:
    from app.settings import get_settings

    s = get_settings()
    if s.auth_mode == "dev" and s.dev_store == "memory":
        return MemoryStore()  # local only: nothing reaches the project's Firestore
    return FirestoreStore()


def iso(value: datetime | str | None) -> str | None:
    if value is None:
        return None
    return value if isinstance(value, str) else value.isoformat().replace("+00:00", "Z")
