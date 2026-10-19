"""The contract's JSON Schemas (schemas/ at the repo root), each read and checked once per
process: jsonschema.validate re-checks the schema itself on every call."""

import json
from functools import cache
from pathlib import Path

from jsonschema import validators
from jsonschema.exceptions import best_match

SCHEMAS = Path(__file__).resolve().parents[2] / "schemas"
RESULT = SCHEMAS / "analysis_result.schema.json"
REQUEST = SCHEMAS / "analyze_request.schema.json"


@cache
def _validator(path: Path):
    schema = json.loads(path.read_text())
    cls = validators.validator_for(schema)
    cls.check_schema(schema)
    return cls(schema)


def validate(instance, path: Path = RESULT) -> None:
    """jsonschema.validate(instance, <schema at path>): raises the same best-match
    ValidationError."""
    error = best_match(_validator(path).iter_errors(instance))
    if error is not None:
        raise error
