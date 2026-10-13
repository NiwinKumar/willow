"""The number validator (GEMINI_SPEC.md): Gemini may only quote numbers that are in its input."""

import re
from typing import Any

NUMBER = re.compile(r"(?<![A-Za-z])[-+−]?\d+(?:[.,]\d+)?")


def _variants(x: float) -> set[str]:
    out = {f"{x:g}"}
    for d in range(0, 4):
        out.add(f"{x:.{d}f}")
    if float(x).is_integer():
        out.add(str(int(x)))
    return {v.lstrip("+-") for v in out}


def collect(obj: Any) -> set[str]:
    """Every number in a JSON-like structure, in the ways it may reasonably be written."""
    found: set[str] = set()
    if isinstance(obj, bool) or obj is None:
        return found
    if isinstance(obj, int | float):
        return _variants(float(obj))
    if isinstance(obj, str):
        return in_text(obj)
    if isinstance(obj, dict):
        for v in obj.values():
            found |= collect(v)
    elif isinstance(obj, list | tuple):
        for v in obj:
            found |= collect(v)
    return found


def in_text(text: str) -> set[str]:
    found: set[str] = set()
    for m in NUMBER.findall(text):
        clean = m.replace("−", "-").replace(",", ".").lstrip("+-")
        try:
            found |= _variants(float(clean))
        except ValueError:
            continue
        found.add(clean)
    return found


def only_known(text: str, allowed: set[str]) -> bool:
    for m in NUMBER.findall(text):
        clean = m.replace("−", "-").replace(",", ".").lstrip("+-")
        if clean not in allowed:
            return False
    return True


def percents(obj: Any) -> set[str]:
    """Shares in the aggregates written as whole (or one-decimal) percents.

    Only 0..1: the validator compares magnitudes, so a negative difference such as a lift of
    -0.08 must not let "8 points above" through."""
    out: set[str] = set()
    if isinstance(obj, bool) or obj is None:
        return out
    if isinstance(obj, float) and 0 <= obj <= 1:
        out |= collect(round(obj * 100)) | collect(round(obj * 100, 1))
    elif isinstance(obj, dict):
        for v in obj.values():
            out |= percents(v)
    elif isinstance(obj, list):
        for v in obj:
            out |= percents(v)
    return out
