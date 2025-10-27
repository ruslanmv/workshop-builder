# server/config.py
from __future__ import annotations
import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # App
    APP_NAME: str = "Workshop Builder API"
    APP_VERSION: str = "1.1.0"
    LOG_LEVEL: str = "INFO"
    ENV: str = "dev"

    # Static
    STATIC_ROOT: str = "./ui/dist"

    # CORS
    CORS_ALLOW_ORIGINS: str = "http://localhost:5173"
    CORS_ALLOW_METHODS: str = "GET,POST,PUT,DELETE,OPTIONS"
    CORS_ALLOW_HEADERS: str = "Authorization,Content-Type,X-Tenant-Id,X-API-Key"

    # Auth / tenancy
    TENANCY_HEADER: str = "X-Tenant-Id"
    DEFAULT_TENANT: str = "public"
    # Hard-default a dev API key so local E2E works without a .env
    API_KEYS: str | None = "dev-key-123"
    JWT_AUDIENCE: str | None = None
    JWT_ISSUER: str | None = None
    JWT_JWKS_URL: str | None = None
    JWT_SECRET: str | None = None

    # Paths
    DATA_DIR: str = "./data"
    DOCMAP_DIR: str = "./data/docmaps"
    JOBS_DIR: str = "./data/jobs"
    CHROMA_DIR: str = "./data/chroma"

    # Redis / RQ
    REDIS_URL: str = "redis://localhost:6379/0"
    RQ_QUEUE: str = "jobs"
    RQ_WORKERS: int = 2

    # watsonx.ai
    WATSONX_API_KEY: str | None = None
    WATSONX_PROJECT_ID: str | None = None
    WATSONX_REGION: str = "us-south"
    WATSONX_CHAT_MODEL: str = "meta-llama/llama-3-3-70b-instruct"
    WATSONX_EMBED_MODEL: str = "ibm/granite-embedding-278m-multilingual"

    # Crew
    CREW_TEMPERATURE: float = 0.2

    # Observability
    ENABLE_OTEL: bool = False
    OTEL_EXPORTER_OTLP_ENDPOINT: str | None = None
    ENABLE_PROMETHEUS: bool = True


    class Config:
        env_file = ".env"
        extra = "ignore"

    def ensure_dirs(self) -> None:
        for p in (self.DATA_DIR, self.DOCMAP_DIR, self.JOBS_DIR, self.CHROMA_DIR):
            os.makedirs(p, exist_ok=True)
