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
    def routine_list(self, uid: str) -> list[tuple[str, Doc]]: ...
    def routine_get(self, uid: str, entry_id: str) -> Doc | None: ...
    def routine_set(self, uid: str, entry_id: str, doc: Doc) -> None: ...
    def routine_delete(self, uid: str, entry_id: str) -> None: ...
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

    def routine_list(self, uid: str) -> list[tuple[str, Doc]]:
        return [(s.id, s.to_dict()) for s in self._db().collection(f"users/{uid}/routine").stream()]

    def routine_get(self, uid: str, entry_id: str) -> Doc | None:
        snap = self._db().document(f"users/{uid}/routine/{entry_id}").get()
        return snap.to_dict() if snap.exists else None

    def routine_set(self, uid: str, entry_id: str, doc: Doc) -> None:
        self._db().document(f"users/{uid}/routine/{entry_id}").set(doc)

    def routine_delete(self, uid: str, entry_id: str) -> None:
        self._db().document(f"users/{uid}/routine/{entry_id}").delete()

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

    def routine_list(self, uid: str) -> list[tuple[str, Doc]]:
        return [(eid, copy.deepcopy(d)) for (u, eid), d in self.routine.items() if u == uid]

    def routine_get(self, uid: str, entry_id: str) -> Doc | None:
        doc = self.routine.get((uid, entry_id))
        return copy.deepcopy(doc) if doc is not None else None

    def routine_set(self, uid: str, entry_id: str, doc: Doc) -> None:
        self.routine[(uid, entry_id)] = copy.deepcopy(doc)

    def routine_delete(self, uid: str, entry_id: str) -> None:
        self.routine.pop((uid, entry_id), None)

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
        for table in (self.sessions, self.baselines, self.routine, self.usage):
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
