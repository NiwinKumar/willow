"""Copies of the shared contract files (schemas/ and fixtures/ at the repo root).

The api image is built from api/ only, so it carries its own copies. tests/test_contract_copies.py
fails if they drift from the originals.
"""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

HERE = Path(__file__).parent


@lru_cache
def load(name: str) -> dict[str, Any]:
    return json.loads((HERE / name).read_text())


@lru_cache
def validator(schema_name: str) -> Draft202012Validator:
    return Draft202012Validator(load(schema_name))


def errors(schema_name: str, instance: Any) -> list[str]:
    """Human-readable schema violations, empty when valid."""
    found = validator(schema_name).iter_errors(instance)
    return [f"{'/'.join(map(str, e.absolute_path)) or '(root)'}: {e.message}" for e in found]
