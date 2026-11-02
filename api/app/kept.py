"""Gemini answers kept across instances (docs/GEMINI_SPEC.md "Kept answers").

An answer is kept under a hash of everything that shaped it (model, prompt id, instructions,
schema, temperature and every input part, images by their bytes), so the same question over the
same data is answered from Firestore in a few milliseconds instead of a 4-30 s Gemini call, even
on a fresh instance or right after a deploy. Different data gives a different key, so a kept
answer is never stale. Only answers that passed the schema are kept, and only for prompts whose
inputs are aggregates, products or the team's sample photos (callers opt in with keep=True):
nothing a person could ask to have deleted.

Off unless KEEP_GEMINI_ANSWERS is set (production); local runs and tests never reach Firestore.
"""

import hashlib
import json
import logging
import threading
from collections import OrderedDict
from datetime import UTC, datetime, timedelta
from typing import Any

from google.genai import types

from app import gcp
from app.settings import get_settings

log = logging.getLogger("willow.kept")

COLLECTION = "gemini_kept"
# Bump to drop every kept answer at once (a prompt or validator change that the key misses).
VERSION = 1
KEEP_FOR = timedelta(days=21)
# This instance's own copy, so a repeat does not even wait for Firestore.
MEMORY_MAX = 500

_memory: OrderedDict[str, str] = OrderedDict()
_lock = threading.Lock()


def enabled() -> bool:
    return get_settings().keep_gemini_answers


def key(
    prompt_id: str,
    model: str,
    instructions: str,
    schema: type,
    temperature: float,
    contents: list[types.Part | str],
) -> str:
    h = hashlib.sha256()
    head = {
        "v": VERSION,
        "prompt_id": prompt_id,
        "model": model,
        "instructions": instructions,
        "schema": schema.model_json_schema(),
        "temperature": temperature,
    }
    h.update(json.dumps(head, sort_keys=True).encode())
    for part in contents:
        h.update(b"\x00")
        if isinstance(part, str):
            h.update(part.encode())
        elif part.inline_data is not None and part.inline_data.data is not None:
            h.update((part.inline_data.mime_type or "").encode())
            h.update(hashlib.sha256(part.inline_data.data).digest())
        else:
            h.update(part.model_dump_json(exclude_none=True).encode())
    return h.hexdigest()


def get(k: str) -> str | None:
    """The kept answer text, or None (also when Firestore cannot be read: then Gemini answers)."""
    with _lock:
        if k in _memory:
            _memory.move_to_end(k)
            return _memory[k]
    try:
        snap = gcp.firestore_client().document(f"{COLLECTION}/{k}").get()
    except Exception as exc:
        log.warning("kept answer %s unreadable: %s", k[:12], exc)
        return None
    doc: dict[str, Any] | None = snap.to_dict() if snap.exists else None
    if not doc or doc.get("expires_at", datetime.min.replace(tzinfo=UTC)) < datetime.now(UTC):
        return None
    _remember(k, doc["text"])
    return doc["text"]


def put(k: str, prompt_id: str, text: str) -> None:
    """Keep an answer; best effort (a failed write only means the next one asks Gemini)."""
    _remember(k, text)
    now = datetime.now(UTC)
    try:
        gcp.firestore_client().document(f"{COLLECTION}/{k}").set(
            {"prompt_id": prompt_id, "text": text, "kept_at": now, "expires_at": now + KEEP_FOR}
        )
    except Exception as exc:
        log.warning("could not keep %s answer: %s", prompt_id, exc)


def _remember(k: str, text: str) -> None:
    with _lock:
        _memory[k] = text
        _memory.move_to_end(k)
        while len(_memory) > MEMORY_MAX:
            _memory.popitem(last=False)


def clear_memory() -> None:
    with _lock:
        _memory.clear()
