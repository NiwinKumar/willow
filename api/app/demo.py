"""Judge mode (docs/DEMO_PLAN.md): hosted sample photos, a ready-made routine, the seeded journey
and a live status of every service.

Sample photos live in the captures bucket under demo/samples/{id}/ with a manifest that lists them,
so new consented captures go live with `scripts/seed_demo.py`, without a deploy. A sample run
copies the frames server-side into the person's own session; from there it is an ordinary session
(the same analyze call, engine, baseline rule and Gemini explanation as anyone's photos).
"""

import hashlib
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any

from pydantic import BaseModel, Field, model_validator

from app import __version__, catalog, engine, gcp, sessions, storage, views
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
_ttl: dict[str, float] = {}  # a key kept for other than its caller's `seconds` (keep_for)
_key_locks: dict[str, threading.Lock] = {}
_key_locks_guard = threading.Lock()


STATUS_RETRY_S = 10.0  # a status with a failed check is asked again after this
_status_lock = threading.Lock()


def _fresh(key: str, seconds: float) -> tuple[bool, Any]:
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _ttl.get(key, seconds):
        return True, hit[1]
    return False, None


def _cached(key: str, seconds: float, make, keep_for=None):
    """`make()` kept `seconds` (or `keep_for(value)` seconds when given). Single-flight per key:
    while one caller makes it, the others with the same key wait for that answer instead of
    making their own (a shared Gemini call is made once)."""
    ok, value = _fresh(key, seconds)
    if ok:
        return value
    with _key_locks_guard:
        lock = _key_locks.setdefault(key, threading.Lock())
    with lock:
        ok, value = _fresh(key, seconds)  # made while this one waited
        if ok:
            return value
        value = make()
        _cache[key] = (time.time(), value)
        if keep_for is not None:
            _ttl[key] = keep_for(value)
        else:
            _ttl.pop(key, None)
        return value


def clear_cache() -> None:
    _cache.clear()
    _ttl.clear()


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


# A new guest's starter check-ins: Mei's first week (face, then the cheek close-up), already
# measured, copied with their photos and results so the app is not empty on day one. They are
# sample sessions (sample_id): read on their own, never a baseline, hidden from Home once the
# guest's own check-ins exist.
STARTER_SESSIONS = {
    "s_20260823_810e21e6": "mei_face_week1",
    "s_20260823_d31f4642": "mei_cheek_week1",
}
# What a starter copies from the source session; everything else starts fresh.
STARTER_FIELDS = (
    "site",
    "capture_mode",
    "content_types",
    "n_frames",
    "measured",
    "status",
    "explanation",
    "explanation_source",
    "labels",
    "label_details",
    "deviation",
)


def starter_session_id(uid: str, source_id: str, now: datetime) -> str:
    """The same id for the same guest and source, so two tabs cannot add a starter twice."""
    return f"s_{now:%Y%m%d}_{hashlib.sha1(f'{uid}:{source_id}'.encode()).hexdigest()[:8]}"


def add_starter_sessions(store: Store, uid: str) -> int:
    """Copy the starter check-ins into a guest's account; returns how many were added."""
    demo_uid = get_settings().demo_user_id
    now = datetime.now(UTC)
    added = 0
    for i, (source_id, sample_id) in enumerate(STARTER_SESSIONS.items()):
        src = store.session_get(demo_uid, source_id)
        if not src or src.get("status") != "done" or not src.get("result_json"):
            continue
        sid = starter_session_id(uid, source_id, now)
        if store.session_get(uid, sid):
            continue
        for prefix in (views.uploads_prefix, views.results_prefix):
            storage.copy_prefix(prefix(demo_uid, source_id), prefix(uid, sid))
        old_path, new_path = f"{demo_uid}/{source_id}", f"{uid}/{sid}"
        doc = {k: src[k] for k in STARTER_FIELDS if k in src}
        doc.update(
            frame_uris=[u.replace(old_path, new_path) for u in src.get("frame_uris") or []],
            result_json=src["result_json"].replace(old_path, new_path).replace(source_id, sid),
            # a few minutes ago, face first: the newest check-in on Home is the close-up's pair
            created_at=now - timedelta(minutes=10 - i),
            analyzed_at=now,
            stage=None,
            error=None,
            note=None,
            is_baseline=False,
            compared_with=None,
            counts_compared_with=None,
            sample_id=sample_id,
        )
        store.session_set(uid, sid, doc)
        added += 1
    return added


def judge_routine_entries() -> list[tuple[dict[str, Any], list[str]]]:
    return [(p, slots) for pid, slots in JUDGE_ROUTINE if (p := catalog.by_id(pid))]


# Live checks (decision 8). ok: answered in time; degraded: answered slowly, or busy (rate
# limited, overloaded), or only partly (BigQuery up, insights query failing); unreachable.
LIVE_KEYS = ("engine", "bigquery", "gemini", "storage")
SLOW_MS = {"gemini": 6000, "storage": 2500, "bigquery": 4000}
PROBE_TIMEOUT_S = 8
BUSY = ("429", "503", "RESOURCE_EXHAUSTED", "UNAVAILABLE")


def probe_gemini() -> None:
    """Model metadata from Vertex (free, no tokens). If this account may not read model
    metadata, the smallest real generate call instead: either way, the advisor's own path."""
    from google.genai import types

    from app import gemini

    model = get_settings().gemini_model
    http = types.HttpOptions(timeout=PROBE_TIMEOUT_S * 1000)
    try:
        gemini.client().models.get(model=model, config=types.GetModelConfig(http_options=http))
    except Exception as exc:
        if not any(c in str(exc) for c in ("403", "PERMISSION_DENIED")):
            raise
        gemini.client().models.generate_content(
            model=model,
            contents="Reply with the word ok.",
            config=types.GenerateContentConfig(
                http_options=http,
                max_output_tokens=64,
                thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
            ),
        )


def probe_storage() -> None:
    """List one object in the captures bucket (the api's own read permission)."""
    s = get_settings()
    blobs = gcp.storage_client().list_blobs(s.bucket, max_results=1, timeout=PROBE_TIMEOUT_S)
    next(iter(blobs), None)


def probe_bigquery() -> None:
    """Table metadata for the cohort table the insights read (free: no query, no bytes)."""
    from app import retailer

    s = get_settings()
    retailer.bq_client().get_table(
        f"{s.project_id}.{s.bq_dataset}.sessions_flat", timeout=PROBE_TIMEOUT_S
    )


def live_check(name: str, probe) -> dict[str, Any]:
    started = time.monotonic()
    try:
        probe()
    except Exception as exc:
        ms = round((time.monotonic() - started) * 1000)
        log.warning("status: %s check failed: %s: %s", name, type(exc).__name__, str(exc)[:200])
        if any(c in str(exc) for c in BUSY):
            return {"status": "degraded", "latency_ms": ms, "reason": "busy"}
        return {"status": "unreachable", "latency_ms": None}
    ms = round((time.monotonic() - started) * 1000)
    if ms > SLOW_MS.get(name, 5000):
        return {"status": "degraded", "latency_ms": ms, "reason": "slow"}
    return {"status": "ok", "latency_ms": ms}


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
            live = live_check("bigquery", probe_bigquery)
            if live["status"] == "unreachable":
                return {**live, "dataset": settings.bq_dataset}
            try:
                from app import retailer

                c = retailer.insights()["cohort"]
            except Exception as exc:
                # the warehouse answers, but the insights query does not
                log.warning("status: bigquery insights failed: %s", exc)
                return {**live, "status": "degraded", "dataset": settings.bq_dataset}
            return {
                **live,
                "dataset": settings.bq_dataset,
                "people": c["synthetic"] + c["real"],
                "synthetic": c["synthetic"],
            }

        # Side by side: a cold engine (about 10 s, and the check wakes it for the judge's first
        # run) must not also wait for BigQuery, Gemini or storage.
        with ThreadPoolExecutor(max_workers=4) as pool:
            eng, bq = pool.submit(engine_check), pool.submit(bigquery_check)
            gem = pool.submit(live_check, "gemini", probe_gemini)
            sto = pool.submit(live_check, "storage", probe_storage)
            out["engine"], out["bigquery"] = eng.result(), bq.result()
            out["gemini"].update(gem.result())
            out["storage"].update(sto.result())
        out["checked_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        return out

    # all good: kept a minute; a failed check only STATUS_RETRY_S (a waking engine is up soon)
    hit = _cache.get("status")
    if hit:
        good = all(hit[1][k].get("status") == "ok" for k in LIVE_KEYS)
        if time.time() - hit[0] < (60 if good else STATUS_RETRY_S):
            return hit[1]
        # Stale: answer with the last check at once and re-check in the background (it can take
        # 45 s on a cold engine). One check at a time: a check already running is left alone.
        if _status_lock.acquire(blocking=False):
            threading.Thread(target=_check_in_background, args=(check,), daemon=True).start()
        return hit[1]
    # Nothing to show yet: the first caller runs the check, the others wait for its answer.
    with _status_lock:
        again = _cache.get("status")
        if again is not None:  # finished while this one waited
            return again[1]
        value = check()
        _cache["status"] = (time.time(), value)
        return value


def _check_in_background(check) -> None:
    """Run a status check into the cache; releases _status_lock, which the caller acquired."""
    try:
        _cache["status"] = (time.time(), check())
    except Exception as exc:  # the last answer stays; the next request tries again
        log.warning("status: background check failed: %s", exc)
    finally:
        _status_lock.release()
