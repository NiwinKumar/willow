"""Persistence for users/{uid}/** (CONTRACT.md section 4).

`FirestoreStore` is the real one; `MemoryStore` backs local dev without credentials and the tests.
Routes get the store through `Depends(get_store)`.

`result` is kept as a JSON string (`result_json`): Firestore cannot hold arrays of arrays, and ROI
polygons are exactly that.
"""

import copy
from datetime import datetime
from functools import lru_cache
from typing import Any, Protocol

from app import gcp

Doc = dict[str, Any]


class Store(Protocol):
    def session_get(self, uid: str, sid: str) -> Doc | None: ...
    def session_set(self, uid: str, sid: str, doc: Doc) -> None: ...
    def session_update(self, uid: str, sid: str, fields: Doc) -> None: ...
    def sessions_list(self, uid: str) -> list[tuple[str, Doc]]: ...
    def baseline_get(self, uid: str, site: str) -> Doc | None: ...
    def baseline_set(self, uid: str, site: str, doc: Doc) -> None: ...
    def delete_user(self, uid: str) -> None: ...


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

    def sessions_list(self, uid: str) -> list[tuple[str, Doc]]:
        # A person has tens of sessions at most; filter and sort in Python, no composite index.
        snaps = self._db().collection(f"users/{uid}/sessions").stream()
        return [(s.id, s.to_dict()) for s in snaps]

    def baseline_get(self, uid: str, site: str) -> Doc | None:
        snap = self._db().document(f"users/{uid}/baselines/{site}").get()
        return snap.to_dict() if snap.exists else None

    def baseline_set(self, uid: str, site: str, doc: Doc) -> None:
        self._db().document(f"users/{uid}/baselines/{site}").set(doc)

    def delete_user(self, uid: str) -> None:
        db = self._db()
        db.recursive_delete(db.document(f"users/{uid}"))


class MemoryStore:
    def __init__(self) -> None:
        self.sessions: dict[tuple[str, str], Doc] = {}
        self.baselines: dict[tuple[str, str], Doc] = {}

    def session_get(self, uid: str, sid: str) -> Doc | None:
        doc = self.sessions.get((uid, sid))
        return copy.deepcopy(doc) if doc is not None else None

    def session_set(self, uid: str, sid: str, doc: Doc) -> None:
        self.sessions[(uid, sid)] = copy.deepcopy(doc)

    def session_update(self, uid: str, sid: str, fields: Doc) -> None:
        self.sessions[(uid, sid)].update(copy.deepcopy(fields))

    def sessions_list(self, uid: str) -> list[tuple[str, Doc]]:
        return [(sid, copy.deepcopy(d)) for (u, sid), d in self.sessions.items() if u == uid]

    def baseline_get(self, uid: str, site: str) -> Doc | None:
        doc = self.baselines.get((uid, site))
        return copy.deepcopy(doc) if doc is not None else None

    def baseline_set(self, uid: str, site: str, doc: Doc) -> None:
        self.baselines[(uid, site)] = copy.deepcopy(doc)

    def delete_user(self, uid: str) -> None:
        for key in [k for k in self.sessions if k[0] == uid]:
            del self.sessions[key]
        for key in [k for k in self.baselines if k[0] == uid]:
            del self.baselines[key]


@lru_cache
def get_store() -> Store:
    return FirestoreStore()


def iso(value: datetime | str | None) -> str | None:
    if value is None:
        return None
    return value if isinstance(value, str) else value.isoformat().replace("+00:00", "Z")
