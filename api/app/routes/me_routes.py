import re
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any, Literal
from zoneinfo import available_timezones

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app import baselines, campaigns, storage, tracks, views
from app.auth import AuthUser, current_user
from app.models import SetBaselineRequest, Site
from app.results import measured_result
from app.store import Store, get_store, iso

router = APIRouter(prefix="/v1", tags=["timeline", "baselines", "me"])


@router.get("/timeline")
def timeline(
    site: Site = Query(),
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Per-metric series for one site, oldest first, from analyzed sessions only."""
    rows = [
        (sid, d)
        for sid, d in store.sessions_list(user.uid)
        if d["site"] == site and d.get("status") == "done" and measured_result(d) is not None
    ]
    rows.sort(key=lambda r: r[1].get("created_at") or datetime.min.replace(tzinfo=UTC))
    series: dict[str, list[dict[str, Any]]] = {}
    for sid, d in rows:
        for m in measured_result(d)["metrics"]:
            series.setdefault(m["id"], []).append(
                {
                    "session_id": sid,
                    "created_at": iso(d.get("created_at")),
                    "value": m["value"],
                    "delta": m.get("delta"),
                    "mdc95": m.get("mdc95"),
                    "verdict": m["verdict"],
                    "confidence": m["confidence"],
                    "capture_mode": d["capture_mode"],
                }
            )
    calibrated = baselines.get(store, user.uid, site, "calibrated_raw")
    quick = baselines.get(store, user.uid, site, "uncalibrated")
    return {
        "site": site,
        "baseline_session_id": calibrated["session_id"] if calibrated else None,
        "baseline_session_ids": {
            "calibrated_raw": calibrated["session_id"] if calibrated else None,
            "uncalibrated": quick["session_id"] if quick else None,
        },
        "metrics": series,
    }


@router.get("/spots")
def spots(
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Spot diary (face): each mark followed across sessions, oldest first. Sessions are the
    diary's columns; each track lists its sightings with a signed crop. docs/METRICS.md."""
    rows = [
        (sid, d)
        for sid, d in store.sessions_list(user.uid)
        if d["site"] == "face_full" and d.get("status") == "done"
    ]
    rows.sort(key=lambda r: r[1].get("created_at") or datetime.min.replace(tzinfo=UTC))
    used, docs, not_mapped = [], {}, 0
    for sid, d in rows:
        result = measured_result(d)
        if not tracks.usable(result):
            # passed but measured before the face map existed: re-measuring fills it in
            if result and result.get("quality", {}).get("passed") and tracks.is_front(result):
                not_mapped += 1
            continue
        docs[sid] = d
        used.append(
            {
                "id": sid,
                "created_at": d["created_at"],
                "marks": tracks.observations(result, d.get("labels") or {}),
            }
        )
    diary = tracks.follow(used)
    prefix = views.results_prefix(user.uid)
    existing = storage.list_names(prefix, (*storage.DISPLAYABLE, "**/crops/*")) if used else set()
    photos = {s["id"]: views.photo_name(user.uid, s["id"], docs[s["id"]], existing) for s in used}
    # every sighting's tight crop; the 3x context crop only for each spot's latest sighting
    # (each signature is an IAM call)
    crops = [
        name
        for t in diary["tracks"]
        for i, o in enumerate(t["observations"])
        for k in ("crop_uri", "context_crop_uri")
        if (k == "crop_uri" or i == len(t["observations"]) - 1)
        and (name := storage.name_from_uri(o.get(k) or ""))
        and name in existing
    ]
    signed = views.sign_all([p for p in photos.values() if p] + crops)

    def url(uri: str | None) -> str | None:
        name = storage.name_from_uri(uri or "")
        return signed.get(name) if name else None

    for t in diary["tracks"]:
        for o in t["observations"]:
            o["crop_url"] = url(o.pop("crop_uri"))
            o["context_crop_url"] = url(o.pop("context_crop_uri"))
    t0 = used[0]["created_at"] if used else None
    diary["sessions"] = [
        {
            "id": s["id"],
            "created_at": iso(s["created_at"]),
            "day": tracks.days(s["created_at"], t0),
            "photo_url": signed.get(photos[s["id"]] or ""),
            "marks": len(s["marks"]),
        }
        for s in used
    ]
    diary["sessions_not_mapped"] = not_mapped
    return diary


@router.post("/baselines/{site}")
def set_baseline(
    site: Site,
    body: SetBaselineRequest,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    doc = store.session_get(user.uid, body.session_id)
    if doc is None or doc["site"] != site:
        raise HTTPException(404, {"code": "not_found", "message": "session not found for site"})
    if doc.get("status") != "done" or not doc.get("result_json"):
        raise HTTPException(409, {"code": "conflict", "message": "session not analyzed yet"})
    result = measured_result(doc)
    if result is None:
        raise HTTPException(409, {"code": "conflict", "message": "this session is not measured"})
    if not result["quality"]["passed"]:
        raise HTTPException(409, {"code": "conflict", "message": "photo quality too low"})
    saved = baselines.set_baseline(store, user.uid, body.session_id, doc)
    return {
        "site": site,
        "capture_mode": saved["capture_mode"],
        "has_noise_band": saved["has_noise_band"],
        "session_id": saved["session_id"],
        "created_at": iso(saved["created_at"]),
        "metrics": saved["metrics"],
    }


@router.delete("/me", status_code=204)
def delete_me(
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> Response:
    """Delete everything stored for this person: photos, results, sessions, baselines.

    Records first, so the app forgets them at once even if removing many files takes a while."""
    store.delete_user(user.uid)
    campaigns.delete_owned(store, user.uid)
    store.shelf_delete(user.uid)  # a retailer's shelf upload (app/shelf.py)
    storage.delete_prefix(f"uploads/{user.uid}/")
    storage.delete_prefix(f"results/{user.uid}/")
    return Response(status_code=204)


class ConsentRequest(BaseModel):
    version: str = Field(min_length=1, max_length=20)
    aggregate_insights_opt_in: bool


@router.put("/me/consent")
def put_consent(
    body: ConsentRequest,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """CONTRACT section 4 users/{uid}.consent; the retailer export reads the opt-in from here."""
    previous = (store.user_get(user.uid) or {}).get("consent") or {}
    consent = {
        "version": body.version,
        "accepted_at": previous.get("accepted_at")
        if previous.get("version") == body.version
        else datetime.now(UTC),
        "aggregate_insights_opt_in": body.aggregate_insights_opt_in,
        "updated_at": datetime.now(UTC),
    }
    store.user_merge(user.uid, {"consent": consent, "is_demo": False})
    return {"consent": {k: iso(v) if isinstance(v, datetime) else v for k, v in consent.items()}}


@router.get("/me")
def get_me(
    user: AuthUser = Depends(current_user), store: Store = Depends(get_store)
) -> dict[str, Any]:
    doc = store.user_get(user.uid) or {}
    consent = doc.get("consent")
    return {
        "uid": user.uid,
        "consent": {k: iso(v) if isinstance(v, datetime) else v for k, v in consent.items()}
        if consent
        else None,
        "profile": _profile_out(doc["profile"]) if doc.get("profile") else None,
    }


# The 8 goals a person can pick (web/src/lib/metrics.ts GOALS), each matched to catalog concerns.
Goal = Literal[
    "dark_spots",
    "even_tone",
    "redness",
    "blemishes",
    "pores_texture",
    "lines",
    "under_eye",
    "oil_glow",
]
MAX_GOALS = 5
# Places a check-in walks through, chosen once in onboarding (web lib/places.ts). The forearms are
# one choice in the app and two places here (treated and untreated arm).
TrackPlace = Literal["cheek_macro", "nose_macro", "face_full", "forearm_treated", "forearm_control"]
PROFILE_FIELDS = (
    "goals",
    "photo_time",
    "display_name",
    "skin_type",
    "checkin",
    "hide_sponsored",
    "track",
)
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class Checkin(BaseModel):
    """The person's check-in schedule: weekdays (0 = Monday) at a local time in their time zone."""

    model_config = ConfigDict(extra="forbid")
    days: list[int] = Field(min_length=1, max_length=7)
    time: str
    tz: str = Field(min_length=1, max_length=64)

    @field_validator("days")
    @classmethod
    def _days(cls, v: list[int]) -> list[int]:
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("days are 0 (Monday) to 6 (Sunday)")
        return sorted(set(v))

    @field_validator("time")
    @classmethod
    def _time(cls, v: str) -> str:
        if not _HHMM.match(v):
            raise ValueError("time is HH:MM, 24-hour")
        return v

    @field_validator("tz")
    @classmethod
    def _tz(cls, v: str) -> str:
        if not _known_zone(v):
            raise ValueError("tz is an IANA time zone name")
        return v


_ZONE_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_+\-]*(/[A-Za-z0-9_+\-]+){0,2}$")


@lru_cache
def _zones() -> frozenset[str]:
    return frozenset(available_timezones())


def _known_zone(name: str) -> bool:
    """In the time zone database; where the image ships none, a well-formed IANA-style name."""
    zones = _zones()
    return name in zones or name == "UTC" if zones else bool(_ZONE_NAME.match(name))


class ProfileUpdate(BaseModel):
    """PUT /v1/me/profile: any subset of the profile; fields left out keep their saved value."""

    model_config = ConfigDict(extra="forbid")
    goals: list[Goal] | None = Field(default=None, max_length=MAX_GOALS)
    photo_time: Literal["morning", "midday", "evening"] | None = None
    display_name: str | None = Field(default=None, max_length=60)
    skin_type: Literal["oily", "combination", "dry", "normal", "sensitive"] | None = None
    checkin: Checkin | None = None
    # Routine's "Sponsored · Willow Proven" card off (null = back to the default, shown)
    hide_sponsored: bool | None = None
    # the places every check-in covers, in capture order (null = the app's default)
    track: list[TrackPlace] | None = Field(default=None, min_length=1, max_length=5)

    @field_validator("track")
    @classmethod
    def _track(cls, v: list[str] | None) -> list[str] | None:
        return list(dict.fromkeys(v)) if v else v

    @field_validator("goals")
    @classmethod
    def _goals(cls, v: list[str] | None) -> list[str]:
        # null clears the goals; duplicates collapse, first pick first
        return list(dict.fromkeys(v or []))

    @field_validator("display_name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        v = " ".join((v or "").split())
        return v or None


def _profile_out(p: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {
        "goals": list(p.get("goals") or []),
        "photo_time": p.get("photo_time"),
        "display_name": p.get("display_name"),
        "skin_type": p.get("skin_type"),
        "checkin": p.get("checkin"),
        "hide_sponsored": bool(p.get("hide_sponsored")),
        "track": list(p["track"]) if p.get("track") else None,
    }
    out["updated_at"] = iso(p.get("updated_at"))
    return out


@router.put("/me/profile")
def put_profile(
    body: ProfileUpdate,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """CONTRACT section 4 users/{uid}.profile. Partial: only the fields sent change."""
    saved = (store.user_get(user.uid) or {}).get("profile") or {}
    changes = body.model_dump(include=body.model_fields_set)
    profile = {k: saved.get(k) for k in PROFILE_FIELDS} | changes
    profile["goals"] = profile.get("goals") or []
    profile["hide_sponsored"] = bool(profile.get("hide_sponsored"))
    profile["updated_at"] = datetime.now(UTC)
    store.user_merge(user.uid, {"profile": profile})
    return {"profile": _profile_out(profile)}
