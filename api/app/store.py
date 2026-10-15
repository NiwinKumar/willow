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
        batch = db.batch()
        for day in days:
            ref = db.document(f"users/{uid}/routine_log/{day}")
            path = FieldPath("used", entry_id).to_api_repr()  # quoted: ids may hold "-"
            batch.update(ref, {path: firestore.DELETE_FIELD})
        if days:
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
        db = self._db()
        db.recursive_delete(db.document(f"users/{uid}"))


class MemoryStore:
    def __init__(self) -> None:
        self.sessions: dict[tuple[str, str], Doc] = {}
        self.baselines: dict[tuple[str, str], Doc] = {}
        self.routine: dict[tuple[str, str], Doc] = {}
        self.routine_log: dict[tuple[str, str], Doc] = {}
        self.usage: dict[tuple[str, str, str], int] = {}
        self.users: dict[str, Doc] = {}

    def session_get(self, uid: str, sid: str) -> Doc | None:
        doc = self.sessions.get((uid, sid))
        return copy.deepcopy(doc) if doc is not None else None

    def session_set(self, uid: str, sid: str, doc: Doc) -> None:
        self.sessions[(uid, sid)] = copy.deepcopy(doc)

    def session_update(self, uid: str, sid: str, fields: Doc) -> None:
        self.sessions[(uid, sid)].update(copy.deepcopy(fields))

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
        self.users.pop(uid, None)


@lru_cache
def get_store() -> Store:
    return FirestoreStore()


def iso(value: datetime | str | None) -> str | None:
    if value is None:
        return None
    return value if isinstance(value, str) else value.isoformat().replace("+00:00", "Z")
