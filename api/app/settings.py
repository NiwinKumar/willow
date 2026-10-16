"""Runtime settings. Every value comes from the environment (see docs/LOCAL_DEV.md)."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    project_id: str = "willow-511508"
    bucket: str = "willow-511508-captures"
    engine_mode: Literal["fixture", "http"] = "fixture"
    engine_url: str | None = None
    gemini_model: str = "gemini-3.8-flash"
    vertex_location: str = "global"
    bq_dataset: str = "willow_insights"
    allowed_origins: str = "http://localhost:5173"
    demo_user_id: str = "demo_willow"
    # Signed upload URLs are signed with IAM signBlob as this account (no key files).
    signing_service_account: str = "sa-api@willow-511508.iam.gserviceaccount.com"
    upload_url_ttl_seconds: int = 900
    # "firebase": verify Firebase ID tokens. "dev": trust the X-Dev-Uid header (local only).
    auth_mode: Literal["firebase", "dev"] = "firebase"
    # Local end-to-end runs only (needs auth_mode=dev): upload links point at this api, which
    # writes to the real bucket with your ADC, so no signing permission is needed on a laptop.
    dev_uploads: bool = False
    dev_public_url: str = "http://localhost:8080"
    # Check-in reminders (app/reminders.py). Web Push is off unless all three VAPID values are set
    # (Secret Manager in production, never committed); without them reminders are calendar only.
    vapid_public_key: str | None = None
    vapid_private_key: str | None = None
    vapid_subject: str | None = None  # "mailto:..." or an https URL the push services can reach
    # The web app, for the calendar event's link and notification clicks.
    app_url: str = "https://willow-511508.web.app"
    # the one store people are sent to buy from (web: VITE_PARTNER_STORE); else the brand site
    partner_store: str = "Nykaa"
    # POST /v1/internal/reminders accepts Cloud Scheduler's OIDC token only with this audience and
    # this service account's email. Unset audience: the route answers 503 (except AUTH_MODE=dev).
    reminders_audience: str | None = None
    scheduler_service_account: str = "sa-scheduler@willow-511508.iam.gserviceaccount.com"
    # A reminder goes out on the first run at or after the scheduled time, up to this long after it.
    reminder_window_minutes: int = 30

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
