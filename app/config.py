from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Twilio
    twilio_account_sid: str
    twilio_auth_token: str
    twilio_from_number: str

    # LlamaParse
    llama_cloud_api_key: str

    # Gemini
    gemini_api_key: str

    # Anthropic
    anthropic_api_key: str

    # Google
    google_service_account_file: str
    google_sheets_id: str = ""
    google_drive_folder_id: str = ""

    # GCS
    gcs_bucket_name: str = ""

    # Postgres
    database_url: str = "postgresql+asyncpg://accountant:accountant@postgres:5432/accountant"

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # App
    environment: str = "development"

    # Drive poller interval (seconds) — 30s for dev, increase for prod
    drive_poll_interval_seconds: int = 30

    # JWT auth
    jwt_secret: str = "change-me-in-production"

    # Admin superuser (env vars, no DB row needed)
    admin_username: str = "admin"
    admin_password: str = "change-me-in-production"

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
