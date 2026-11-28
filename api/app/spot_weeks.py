"""Spot diary, week by week (GET /v1/spots/weeks, Nov 28).

Each measured face check-in as its photos show it: per view (front, left cheek, right cheek) the
photo, its areas and every blemish and dark spot the check-in counted on it, with the counts
Progress shows (the whole face and by area). Nothing is matched across weeks: the person
compares weeks by eye, side by side or area by area, so no number rests on deciding which
mark is "the same spot" (the old diary's appeared / faded totals did, and were inflated).

Marks come from the engine's extras.marks (0.4.3+: every counted mark). Older results only have
`candidates` (at most 40 a check-in, the front's first); those check-ins say `complete: false`
until they are measured again. A mark where Gemini saw a mole is never shown.
"""

from datetime import UTC, datetime
from typing import Any

from app import storage, views
from app.results import measured_result
from app.store import Store, iso

NEVER_SHOWN = {"mole"}  # web/src/lib/spotLabels.ts NEVER_SHOWN
VIEW_CODE = {0: "front", 1: "right", 2: "left"}  # engine VIEW_CODE (features.view)
KINDS = (("blemishes", "blemish"), ("pigment_spots", "spot"))


def _metric(result: dict[str, Any], metric_id: str) -> dict[str, Any]:
    return next((m for m in result.get("metrics", []) if m["id"] == metric_id), {})


def _candidate_marks(result: dict[str, Any]) -> list[dict[str, Any]]:
    """Marks from candidates (results before extras.marks): centre and radius of each bbox."""
    out = []
    for c in result.get("candidates") or []:
        f = c.get("features") or {}
        x, y, w, h = c["bbox"]
        out.append(
            {
                "kind": c["kind"],
                "view": VIEW_CODE.get(int(f.get("view") or 0), "front"),
                "frame_index": int(f.get("frame_index") or 0),
                "x": round(x + w / 2, 1),
                "y": round(y + h / 2, 1),
                "r": round(w / 3, 1),  # the bbox is 3 radii across (engine _candidates)
                "zone": _zone_name(f.get("zone")),
            }
        )
    return out


ZONES = (
    "forehead",
    "nose",
    "right_cheek",
    "left_cheek",
    "around_mouth",
    "chin",
    "right_jaw",
    "left_jaw",
)


def _zone_name(code: Any) -> str | None:
    try:
        i = int(code or 0)
    except (TypeError, ValueError):
        return None
    return ZONES[i - 1] if 1 <= i <= len(ZONES) else None


def marks_of(result: dict[str, Any], labels: dict[str, str]) -> tuple[list[dict[str, Any]], bool]:
    """(every mark to draw, complete). Complete: the engine listed every counted mark."""
    listed = [_metric(result, mid).get("extras", {}).get("marks") for mid, _ in KINDS]
    complete = all(isinstance(m, list) for m in listed)
    if complete:
        marks = [
            {**m, "kind": kind}
            for (_, kind), ms in zip(KINDS, listed, strict=True)
            for m in ms  # type: ignore[union-attr]
        ]
    else:
        marks = _candidate_marks(result)
    # a mark where Gemini saw a mole: never drawn or listed (Willow does not assess moles)
    moles = [c for c in result.get("candidates") or [] if labels.get(c["id"]) in NEVER_SHOWN]

    def is_mole(m: dict[str, Any]) -> bool:
        for c in moles:
            f = c.get("features") or {}
            if VIEW_CODE.get(int(f.get("view") or 0), "front") != m["view"]:
                continue
            x, y, w, h = c["bbox"]
            if x <= m["x"] <= x + w and y <= m["y"] <= y + h:
                return True
        return False

    return [m for m in marks if not is_mole(m)], complete


def _counts(result: dict[str, Any]) -> dict[str, Any]:
    """The check-in's counts as Progress shows them: blemishes and dark spots, whole face and by
    area (by_zone; dark spots by area are counted from the marks, which the engine places)."""
    blem, spots = _metric(result, "blemishes"), _metric(result, "pigment_spots")
    by_zone: dict[str, dict[str, int]] = {}
    for zone, v in ((blem.get("extras") or {}).get("by_zone") or {}).items():
        if v.get("value") is not None:
            by_zone.setdefault(zone, {})["blemishes"] = round(v["value"])
    for m in (spots.get("extras") or {}).get("marks") or []:
        if m.get("zone"):
            z = by_zone.setdefault(m["zone"], {})
            z["dark_spots"] = z.get("dark_spots", 0) + 1
    count = (spots.get("extras") or {}).get("count")
    return {
        "blemishes": round(blem["value"]) if blem.get("value") is not None else None,
        "dark_spots": round(count) if count is not None else None,
        "by_zone": by_zone,
    }


def weeks(store: Store, uid: str) -> dict[str, Any]:
    rows = []
    for sid, d in store.sessions_list(uid):
        result = measured_result(d)
        if d.get("site") != "face_full" or d.get("status") != "done" or not result:
            continue
        if not (result.get("quality") or {}).get("passed"):
            continue
        rows.append((sid, d, result))
    rows.sort(key=lambda r: r[1].get("created_at") or datetime.min.replace(tzinfo=UTC))
    existing = storage.list_names(views.results_prefix(uid)) if rows else set()

    # each check-in's photos: its views (front + cheek photos), else its one front photo
    plans = []
    for sid, d, result in rows:
        photos = []
        for v in result.get("views") or []:
            name = storage.name_from_uri(v.get("preview_uri") or "")
            photos.append((v, name if name in existing else None))
        if not photos:
            front = {
                "view": "front",
                "frame_index": views.reference_index(result),
                "image_size": result.get("image_size"),
                "rois": result.get("rois") or [],
            }
            photos.append((front, views.photo_name(uid, sid, d, existing)))
        plans.append((sid, d, result, photos))
    signed = views.sign_all([n for *_, photos in plans for _, n in photos if n])

    out = []
    for sid, d, result, photos in plans:
        marks, complete = marks_of(result, d.get("labels") or {})
        # each photo's face-mesh landmarks (engine extras.face_points): carry a place between weeks
        landmarks = {
            p["view"]: p["points"]
            for p in (_metric(result, "blemishes").get("extras") or {}).get("face_points") or []
        }
        shown = []
        for v, name in photos:
            if not name or name not in signed:
                continue
            size = v.get("image_size") or {}
            mine = [m for m in marks if m["view"] == v["view"]]
            shown.append(
                {
                    "view": v["view"],
                    "photo": {
                        "url": signed[name],
                        "width": size.get("width"),
                        "height": size.get("height"),
                    },
                    "rois": v.get("rois") or [],
                    "landmarks": landmarks.get(v["view"]),
                    # the front photo's whole areas: with cheek photos, its own outlines (`rois`)
                    # leave out the chin and mouth skin those photos measure (result.rois does not)
                    "full_rois": (result.get("rois") or [])
                    if v["view"] == "front" and result.get("views")
                    else None,
                    "marks": [{k: m[k] for k in ("kind", "x", "y", "r", "zone")} for m in mine],
                    # this photo's counts, only when every mark is listed (else they would be
                    # the candidates', not the check-in's)
                    "blemishes": sum(m["kind"] == "blemish" for m in mine) if complete else None,
                    "dark_spots": sum(m["kind"] == "spot" for m in mine) if complete else None,
                }
            )
        if not shown:
            continue
        out.append(
            {
                "id": sid,
                "created_at": iso(d.get("created_at")),
                "complete": complete,
                **_counts(result),
                "views": shown,
            }
        )
    return {"weeks": out}
