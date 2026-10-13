"""Session ids, object names and the new-session document (CONTRACT.md sections 4 and 6)."""

import secrets
from datetime import UTC, datetime
from typing import Any


def new_session_id(now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    return f"s_{now:%Y%m%d}_{secrets.token_hex(4)}"


def frame_object_name(uid: str, session_id: str, index: int, ext: str) -> str:
    return f"uploads/{uid}/{session_id}/frame_{index}.{ext}"


def new_doc(data: dict[str, Any]) -> dict[str, Any]:
    return {
        **data,
        "created_at": datetime.now(UTC),
        "status": "uploading",
        "is_baseline": False,
        "result_json": None,
        "labels": {},
        "explanation": None,
        "note": None,
        "deviation": False,
        "error": None,
    }
