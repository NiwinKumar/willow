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


# Comparison words must agree with the numbers they compare (a juror read "dark spots moved by
# -0.3, within the 0.25 your photos usually vary": every digit was in the input, the claim was
# false). "Within" words claim |change| <= the band; "beyond" words claim |change| > it.
_WITHIN = r"no more than|not more than|within|inside|less than|smaller than|below|under"
_BEYOND = (
    r"beyond|outside|more than|larger than|bigger than|greater than|above|over|exceed(?:s|ed|ing)?"
)
_FILLER = (
    r"the|your|its|their|a|an|what|how much|of|normal|usual|typical|everyday|day-to-day|own|"
    r"expected|photos?|readings?|skin"
)
_RANGE = (
    r"range|vary|varies|variation|wobble|noise|spread|band|swing|limits?|margin|normally|"
    r"usually|typically"
)
COMPARE = re.compile(
    rf"\b(?P<kw>{_WITHIN}|{_BEYOND})\b\s+(?:(?:{_FILLER})\s+){{0,4}}"
    rf"(?:(?P<num>[-+−]?\d+(?:[.,]\d+)?)|(?P<range>{_RANGE})\b)",
    re.I,
)
_NEGATED = re.compile(r"\b(not|never|no longer|isn't|wasn't|aren't|weren't)\s+(\w+\s+)?$", re.I)
_SENTENCE = re.compile(r"(?<=[.!?;])\s+")


def _num(text: str) -> float:
    return abs(float(text.replace("−", "-").replace(",", ".")))


def compared(obj: Any) -> list[dict[str, Any]]:
    """Every {delta, mdc95} pair in a JSON-like structure (a metric as the model saw it)."""
    out: list[dict[str, Any]] = []
    if isinstance(obj, dict):
        if isinstance(obj.get("delta"), int | float) and isinstance(obj.get("mdc95"), int | float):
            out.append(obj)
        for v in obj.values():
            out += compared(v)
    elif isinstance(obj, list | tuple):
        for v in obj:
            out += compared(v)
    return out


def false_comparison(
    text: str, metrics: list[dict[str, Any]], subject: dict[str, Any] | None = None
) -> str | None:
    """The first comparison phrase in `text` that the numbers contradict, or None.

    `metrics`: dicts with the shown `delta` and `mdc95` (the band "your photos usually vary").
    A sentence is tied to the metrics whose change it quotes; with none quoted, to `subject` (the
    metric an explanation item is about). "within 0.25" is checked against the quoted change;
    "within your usual range" against the tied metric's own band. A claim is false only when no
    tied metric bears it out, so a change two metrics share never rejects a true sentence."""
    usable = [m for m in metrics if m.get("delta") and m.get("mdc95") is not None]
    if not usable:
        return None
    for sentence in _SENTENCE.split(text):
        for match in COMPARE.finditer(sentence):
            rest = sentence[: match.start()] + " " + sentence[match.end() :]
            quoted = in_text(rest)
            tied = [m for m in usable if collect(abs(float(m["delta"]))) & quoted]
            if not tied and subject in usable:
                tied = [subject]
            if not tied:
                continue
            within = bool(re.fullmatch(_WITHIN, match["kw"], re.I))
            if _NEGATED.search(sentence[: match.start()]):
                within = not within
            if match["num"]:
                limit = _num(match["num"])
                bands = {abs(float(m["mdc95"])) for m in usable}
                if limit not in bands:
                    continue  # only the band is compared ("more than 2 weeks" is not a claim)
                limits = [limit] * len(tied)
            else:
                limits = [abs(float(m["mdc95"])) for m in tied]
            changes = [abs(float(m["delta"])) for m in tied]
            holds = [
                c <= lim if within else c >= lim for c, lim in zip(changes, limits, strict=True)
            ]
            if not any(holds):
                return match.group(0)
    return None
