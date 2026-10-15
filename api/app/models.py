"""Pydantic models for the product API (docs/CONTRACT.md section 3)."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

Site = Literal["face_full", "cheek_macro", "nose_macro", "forearm_treated", "forearm_control"]
CaptureMode = Literal["calibrated_raw", "uncalibrated"]

# Content type the browser will PUT with -> file extension in GCS.
CONTENT_TYPES: dict[CaptureMode, dict[str, str]] = {
    "calibrated_raw": {"image/x-adobe-dng": "dng", "image/dng": "dng"},
    "uncalibrated": {"image/jpeg": "jpg", "image/heic": "heic", "image/heif": "heic"},
}


class CreateSessionRequest(BaseModel):
    site: Site
    capture_mode: CaptureMode
    n_frames: int = Field(ge=1, le=5)
    content_types: list[str]

    @model_validator(mode="after")
    def _check(self) -> "CreateSessionRequest":
        if len(self.content_types) != self.n_frames:
            raise ValueError("content_types must have exactly n_frames entries")
        allowed = CONTENT_TYPES[self.capture_mode]
        bad = [c for c in self.content_types if c not in allowed]
        if bad:
            raise ValueError(f"content type not allowed for {self.capture_mode}: {bad[0]}")
        return self


class UploadTarget(BaseModel):
    index: int
    object_uri: str
    url: str
    headers: dict[str, str]


class CreateSessionResponse(BaseModel):
    session_id: str
    upload_urls: list[UploadTarget]
    expires_in_seconds: int


class DuplicateOf(BaseModel):
    """An uploaded frame byte-identical (GCS MD5) to a frame of another (or this) session."""

    session_id: str
    index: int


class ObjectStatus(BaseModel):
    index: int
    object_uri: str
    exists: bool
    size: int | None
    md5_base64: str | None
    content_type: str | None
    duplicate_of: DuplicateOf | None = None


class SessionObjectsResponse(BaseModel):
    session_id: str
    objects: list[ObjectStatus]


class PatchSessionRequest(BaseModel):
    note: str | None = Field(default=None, max_length=280)
    deviation: bool | None = None


class SetBaselineRequest(BaseModel):
    session_id: str = Field(pattern=r"^s_\d{8}_[0-9a-f]{8}$")  # never arbitrary text in a path


MAX_FRAMES = 5  # AnalyzeRequest frames maxItems (schemas/analyze_request.schema.json)


class AddFramesRequest(BaseModel):
    """POST /v1/sessions/{id}/frames: more photos for a session (top-up, or an edit before analyze).
    Content types are checked against the session's capture mode by the route."""

    add: int = Field(ge=1, le=MAX_FRAMES)
    content_types: list[str]

    @model_validator(mode="after")
    def _check(self) -> "AddFramesRequest":
        if len(self.content_types) != self.add:
            raise ValueError("content_types must have exactly `add` entries")
        return self


class AddFramesResponse(BaseModel):
    session_id: str
    n_frames: int
    # Upload targets for the new frames only (index = the frame's 1-based place in the session).
    upload_urls: list[UploadTarget]
    expires_in_seconds: int
    # Frames the engine left out of a measured session, dropped to make room (1-based, as before).
    dropped: list[int]
