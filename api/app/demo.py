"""Judge mode (docs/DEMO_PLAN.md): hosted sample photos, a ready-made routine, the seeded journey
and a live status of every service.

Sample photos live in the captures bucket under demo/samples/{id}/ with a manifest that lists them,
so new consented captures go live with `scripts/seed_demo.py`, without a deploy. A sample run
copies the frames server-side into the person's own session; from there it is an ordinary session
(the same analyze call, engine, baseline rule and Gemini explanation as anyone's photos).
"""

import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from pydantic import BaseModel, Field, model_validator

from app import __version__, catalog, engine, sessions, storage, views
from app.models import CONTENT_TYPES, CaptureMode, Site
from app.settings import get_settings
from app.store import Store

log = logging.getLogger("willow.demo")

SAMPLES_PREFIX = "demo/samples/"
MANIFEST = f"{SAMPLES_PREFIX}manifest.json"
CACHE_SECONDS = 300

EXT_CONTENT_TYPE = {"dng": "image/x-adobe-dng", "jpg": "image/jpeg", "jpeg": "image/jpeg"}

# A routine that shows what the rule table catches: a retinoid and a BHA in the same evening,
# and no sunscreen in the morning.
JUDGE_ROUTINE: list[tuple[str, list[str]]] = [
    ("the-derma-co-2-niacinamide-gentle-skin-cleanser", ["am", "pm"]),
    ("dot-and-key-barrier-repair-intense-moisturizer-ceramides", ["am", "pm"]),
    ("minimalist-retinol-0-3-face-serum", ["pm"]),
    ("paulas-choice-skin-perfecting-2-bha-liquid-exfoliant", ["pm"]),
]


class Sample(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9_]{2,40}$")
    title: str
    note: str = ""
    site: Site
    capture_mode: CaptureMode
    frames: list[str] = Field(min_length=1, max_length=5)
    # Shown to judges: whose photos and that they agreed (docs/CAPTURE_PROTOCOL.md consent note).
    credit: str = ""
    order: int = 0

    @model_validator(mode="after")
    def _frames_fit_the_mode(self) -> "Sample":
        """A bad manifest entry fails when the manifest loads (and is logged), not as a 503 on
        every judge's sample run."""
        exts = {f.rsplit(".", 1)[-1].lower() for f in self.frames}
        if not exts <= set(EXT_CONTENT_TYPE):
            raise ValueError(f"sample {self.id}: unsupported frames {sorted(exts)}")
        if (self.capture_mode == "calibrated_raw") != (exts == {"dng"}):
            raise ValueError(f"sample {self.id}: {self.capture_mode} with {sorted(exts)} frames")
        return self

    def content_types(self) -> list[str]:
        return [EXT_CONTENT_TYPE[f.rsplit(".", 1)[-1].lower()] for f in self.frames]


_cache: dict[str, tuple[float, Any]] = {}


STATUS_RETRY_S = 10.0  # a status with a failed check is asked again after this
_status_lock = threading.Lock()


def _cached(key: str, seconds: float, make):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < seconds:
        return hit[1]
    value = make()
    _cache[key] = (time.time(), value)
    return value


def clear_cache() -> None:
    _cache.clear()


def samples() -> list[Sample]:
    def load() -> list[Sample]:
        raw = storage.read_text(MANIFEST)
        if not raw:
            return []
        items = []
        for entry in json.loads(raw).get("samples", []):
            try:
                items.append(Sample.model_validate(entry))
            except ValueError as exc:  # one bad entry hides itself, not the whole list
                log.error("demo manifest: skipped %s: %s", entry.get("id"), exc)
        return sorted(items, key=lambda s: (s.order, s.id))

    return _cached("samples", CACHE_SECONDS, load)


def sample(sample_id: str) -> Sample | None:
    return next((s for s in samples() if s.id == sample_id), None)


def create_sample_session(store: Store, uid: str, s: Sample) -> str:
    """Copy a sample's frames into a new session of this person, ready to analyze."""
    session_id = sessions.new_session_id()
    content_types = s.content_types()
    ext_for = CONTENT_TYPES[s.capture_mode]
    uris = []
    for i, (frame, ct) in enumerate(zip(s.frames, content_types, strict=True), start=1):
        dest = sessions.frame_object_name(uid, session_id, i, ext_for[ct])
        storage.copy_object(f"{SAMPLES_PREFIX}{s.id}/{frame}", dest)
        uris.append(storage.object_uri(dest))
    doc = sessions.new_doc(
        {
            "site": s.site,
            "capture_mode": s.capture_mode,
            "n_frames": len(s.frames),
            "frame_uris": uris,
            "content_types": content_types,
            "sample_id": s.id,
        }
    )
    preview = f"{SAMPLES_PREFIX}{s.id}/preview.jpg"
    if storage.object_info(preview).exists:
        # The RAW frame cannot be shown in a browser; seed_demo.py stores a JPEG of frame 1.
        storage.copy_object(preview, views.preview_name(uid, session_id))
    store.session_set(uid, session_id, doc)
    return session_id


def judge_routine_entries() -> list[tuple[dict[str, Any], list[str]]]:
    return [(p, slots) for pid, slots in JUDGE_ROUTINE if (p := catalog.by_id(pid))]


def status() -> dict[str, Any]:
    """What is running right now, checked live (cached a minute, a failed check 10 s)."""

    def check() -> dict[str, Any]:
        settings = get_settings()
        out: dict[str, Any] = {
            "api": {"status": "ok", "version": __version__, "runtime": "Cloud Run, us-central1"},
            "gemini": {
                "model": settings.gemini_model,
                "endpoint": f"Vertex AI ({settings.vertex_location})",
            },
            "catalog": {"products": len(catalog.products())},
            "storage": {"bucket": settings.bucket},
        }

        def engine_check() -> dict[str, Any]:
            started = time.monotonic()
            try:
                h = engine.health()
            except engine.EngineError as exc:
                log.warning("status: engine check failed: %s", exc.message)
                # still starting after HEALTH_TIMEOUT_S: the check itself woke it
                state = "waking" if exc.code == "engine_waking" else "unreachable"
                return {"status": state, "mode": settings.engine_mode}
            except Exception as exc:  # IAM, token, network
                log.warning("status: engine check failed: %s", exc)
                return {"status": "unreachable", "mode": settings.engine_mode}
            return {
                "status": "ok",
                "version": h.get("engine_version"),
                "mode": settings.engine_mode,
                "latency_ms": round((time.monotonic() - started) * 1000),
            }

        def bigquery_check() -> dict[str, Any]:
            try:
                from app import retailer

                c = retailer.insights()["cohort"]
            except Exception as exc:
                log.warning("status: bigquery check failed: %s", exc)
                return {"status": "unavailable"}
            return {
                "status": "ok",
                "dataset": settings.bq_dataset,
                "people": c["synthetic"] + c["real"],
                "synthetic": c["synthetic"],
            }

        # Side by side: a cold engine (about 10 s, and the check wakes it for the judge's first
        # run) must not also wait for BigQuery.
        with ThreadPoolExecutor(max_workers=2) as pool:
            eng, bq = pool.submit(engine_check), pool.submit(bigquery_check)
            out["engine"], out["bigquery"] = eng.result(), bq.result()
        out["checked_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        return out

    # all good: kept a minute; a failed check only STATUS_RETRY_S (a waking engine is up soon)
    hit = _cache.get("status")
    if hit:
        good = hit[1]["engine"]["status"] == "ok" and hit[1]["bigquery"]["status"] == "ok"
        if time.time() - hit[0] < (60 if good else STATUS_RETRY_S):
            return hit[1]
    # One check at a time (it can wait 45 s on a cold engine): while one runs, others get the
    # last answer if there is one, else wait for this one.
    if not _status_lock.acquire(blocking=hit is None):
        return hit[1]
    try:
        again = _cache.get("status")
        if again is not hit and again is not None:  # finished while this one waited
            return again[1]
        value = check()
        _cache["status"] = (time.time(), value)
        return value
    finally:
        _status_lock.release()
