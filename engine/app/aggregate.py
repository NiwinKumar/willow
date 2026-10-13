"""Per-frame values -> mean, SD, MDC95, delta, verdict (docs/CONTRACT.md 2.4)."""

import math
import statistics

from app import config


def mdc95(sd: float | None) -> float | None:
    """Smallest change we can trust: 1.96 * sqrt(2) * within-session SD."""
    return None if sd is None else config.MDC_Z * math.sqrt(2) * sd


def summarize(values: list[float], baseline: dict | None) -> dict:
    mean = statistics.fmean(values)
    sd = statistics.stdev(values) if len(values) > 1 else None
    out = {
        "value": round(mean, 3),
        "within_session_sd": None if sd is None else round(sd, 3),
        "mdc95": None if sd is None else round(mdc95(sd), 3),
        "delta": None,
        "verdict": "no_baseline",
        "direction": "none",
    }
    if baseline:
        delta = mean - baseline["mean"]
        out["delta"] = round(delta, 3)
        out["direction"] = "increase" if delta > 0 else "decrease" if delta < 0 else "none"
        base_mdc = baseline.get("mdc95")
        if base_mdc is not None:
            out["verdict"] = "real_change" if abs(delta) > base_mdc else "within_noise"
    return out
