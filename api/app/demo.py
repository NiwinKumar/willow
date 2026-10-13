"""Judge mode (docs/DEMO_PLAN.md): hosted sample photos, a ready-made routine, the seeded journey
and a live status of every service.

Sample photos live in the captures bucket under demo/samples/{id}/ with a manifest that lists them,
so new consented captures go live with `scripts/seed_demo.py`, without a deploy. A sample run
copies the frames server-side into the person's own session; from there it is an ordinary session
(the same analyze call, engine, baseline rule and Gemini explanation as anyone's photos).
"""

import json
import time
from typing import Any

from pydantic import BaseModel, Field

from app import __version__, catalog, engine, sessions, storage, views
from app.models import CONTENT_TYPES, CaptureMode, Site
from app.settings import get_settings
from app.store import Store

SAMPLES_PREFIX = "demo/samples/"
MANIFEST = f"{SAMPLES_PREFIX}manifest.json"
CACHE_SECONDS = 300
DAILY_SAMPLE_RUNS = 12

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

    def content_types(self) -> list[str]:
        return [EXT_CONTENT_TYPE[f.rsplit(".", 1)[-1].lower()] for f in self.frames]


_cache: dict[str, tuple[float, Any]] = {}


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
        items = [Sample.model_validate(s) for s in json.loads(raw).get("samples", [])]
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
    """What is running right now, checked live (cached for a minute)."""

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
        started = time.monotonic()
        try:
            h = engine.health()
            out["engine"] = {
                "status": "ok",
                "version": h.get("engine_version"),
                "mode": settings.engine_mode,
                "latency_ms": round((time.monotonic() - started) * 1000),
            }
        except Exception as exc:  # cold start timeout, IAM, network
            out["engine"] = {
                "status": "unreachable",
                "mode": settings.engine_mode,
                "error": str(exc)[:120],
            }
        try:
            from app import retailer

            data = retailer.insights()
            c = data["cohort"]
            out["bigquery"] = {
                "status": "ok",
                "dataset": settings.bq_dataset,
                "people": c["synthetic"] + c["real"],
                "synthetic": c["synthetic"],
            }
        except Exception as exc:
            out["bigquery"] = {"status": "unavailable", "error": str(exc)[:120]}
        out["checked_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        return out

    return _cached("status", 60, check)
