"""Whether a stored session result is a measurement (placeholders never are)."""

import json
from typing import Any

from app import engine


def measured_result(doc: dict[str, Any]) -> dict[str, Any] | None:
    """The stored result if it is a measurement; None for placeholders (old docs included)."""
    if not doc.get("result_json"):
        return None
    result = json.loads(doc["result_json"])
    measured = doc.get("measured")
    if measured is None:  # sessions analysed before the measured flag existed
        measured = not engine.is_placeholder(result)
    return result if measured else None
