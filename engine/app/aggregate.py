"""Per-frame values -> mean, SD, MDC95, delta, verdict (docs/CONTRACT.md 2.4)."""

import math
import statistics

from scipy import stats

from app import config


def mdc95(sd: float | None, n: int | None = None) -> float | None:
    """Smallest change we can trust when a later photo is compared with this session.

    1.96 * sqrt(2) * SD (docs/METRICS.md), widened for small sessions: an SD estimated from 2 or
    3 photos is itself very uncertain, and with z = 1.96 a 2-photo baseline called pure noise a
    "real change" about 1 time in 4 (Oct 14, simulation). With n photos the band is at least
    t(0.975, n - 1) * SD * sqrt(1 + 1/n), the 95% prediction interval for one new photo, which
    holds the false-alarm rate near 5% at every n and changes little at n = 5 (x1.1).
    """
    if sd is None:
        return None
    band = config.MDC_Z * math.sqrt(2) * sd
    if n is not None and n >= 2:
        band = max(band, float(stats.t.ppf(0.975, n - 1)) * sd * math.sqrt(1 + 1 / n))
    return band


def summarize(values: list[float], baseline: dict | None, min_sd: float = 0.0) -> dict:
    """min_sd: the smallest photo-to-photo SD this metric can honestly have (config.MIN_SD).
    Identical values in every photo (a count that did not move, 0% dark spots) would otherwise
    give a band of 0, and any later difference would be called real."""
    mean = statistics.fmean(values)
    sd = max(statistics.stdev(values), min_sd) if len(values) > 1 else None
    band = mdc95(sd, len(values))
    out = {
        "value": round(mean, 3),
        "within_session_sd": None if sd is None else round(sd, 3),
        "mdc95": None if band is None else round(band, 3),
        "delta": None,
        "verdict": "no_baseline",
        "direction": "none",
    }
    if baseline:
        delta = round(mean - baseline["mean"], 3)
        out["delta"] = delta + 0.0  # never -0.0
        # from the rounded delta: a change of 0.0 has no direction
        out["direction"] = "increase" if delta > 0 else "decrease" if delta < 0 else "none"
        base_mdc = baseline.get("mdc95")
        if base_mdc is not None:
            out["verdict"] = "real_change" if abs(delta) > base_mdc else "within_noise"
    return out
