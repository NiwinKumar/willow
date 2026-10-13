"""Session documents in Firestore: users/{uid}/sessions/{session_id} (CONTRACT.md section 4)."""

import secrets
from datetime import UTC, datetime
from typing import Any

from app import gcp


def new_session_id(now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    return f"s_{now:%Y%m%d}_{secrets.token_hex(4)}"


def frame_object_name(uid: str, session_id: str, index: int, ext: str) -> str:
    return f"uploads/{uid}/{session_id}/frame_{index}.{ext}"


def create(uid: str, session_id: str, data: dict[str, Any]) -> None:
    doc = {
        **data,
        "created_at": datetime.now(UTC),
        "status": "uploading",
        "is_baseline": False,
        "result": None,
        "labels": {},
        "explanation": None,
    }
    gcp.firestore_client().document(f"users/{uid}/sessions/{session_id}").set(doc)


def get(uid: str, session_id: str) -> dict[str, Any] | None:
    snap = gcp.firestore_client().document(f"users/{uid}/sessions/{session_id}").get()
    return snap.to_dict() if snap.exists else None
