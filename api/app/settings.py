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

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
