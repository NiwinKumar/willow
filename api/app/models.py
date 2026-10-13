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


class ObjectStatus(BaseModel):
    index: int
    object_uri: str
    exists: bool
    size: int | None
    md5_base64: str | None
    content_type: str | None


class SessionObjectsResponse(BaseModel):
    session_id: str
    objects: list[ObjectStatus]
