# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, List, Optional

from pydantic import AliasChoices, BaseModel, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Central configuration (production-ready).

    - Loads .env automatically (non-fatal if missing).
    - Tolerates legacy lowercase env keys via AliasChoices.
    - Creates working directories on first use.
    """

    # Flask
    FLASK_HOST: str = "0.0.0.0"
    FLASK_PORT: int = 5000
    FLASK_DEBUG: bool = False

    # Logging
    LOG_LEVEL: str = "INFO"

    # CORS
    CORS_ENABLE: bool = True
    CORS_ALLOW_ORIGINS: List[str] = Field(default_factory=lambda: ["*"])
    CORS_ALLOW_METHODS: List[str] = Field(default_factory=lambda: ["*"])
    CORS_ALLOW_HEADERS: List[str] = Field(default_factory=lambda: ["*"])
    CORS_ALLOW_CREDENTIALS: bool = False

    # Paths
    APP_ROOT: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[1])
    REPOS_DIR: Path = Field(default_factory=lambda: Path.cwd() / "repos")
    PROJECTS_DIR: Path = Field(default_factory=lambda: Path.cwd() / "projects")
    BUILD_DIR: Path = Field(default_factory=lambda: Path.cwd() / "build")
    CREWAI_STORAGE_DIR: Path = Field(default_factory=lambda: Path.cwd() / ".crewai")

    # Universal A2A (RAG) server
    A2A_HOST: Optional[str] = Field(default=None, validation_alias=AliasChoices("A2A_HOST", "a2a_host"))
    A2A_PORT: Optional[int] = Field(default=None, validation_alias=AliasChoices("A2A_PORT", "a2a_port"))
    PUBLIC_URL: Optional[str] = Field(default=None, validation_alias=AliasChoices("PUBLIC_URL", "public_url"))
    A2A_BASE: str = "http://localhost:8000"

    A2A_ENABLE_KNOWLEDGE: bool = True
    A2A_COLLECTION: str = "workshop_docs"
    A2A_VDB: str = "chromadb"  # or "qdrant"
    A2A_CHUNK_SIZE: int = 1200
    A2A_CHUNK_OVERLAP: int = 160
    A2A_INCLUDE_EXT: str = ".md,.mdx,.py,.ipynb,.txt"
    A2A_EXCLUDE_EXT: str = ".png,.jpg,.jpeg,.gif,.pdf"

    # LLM Provider selection
    LLM_PROVIDER: str = Field(default="watsonx", description="watsonx | openai")
    MODEL_ID: str = Field(default="ibm/granite-3-8b-instruct")

    # OpenAI
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_API_BASE: Optional[str] = None
    OPENAI_CHAT_MODEL: str = "gpt-4o-mini"

    # IBM watsonx
    WATSONX_API_KEY: Optional[str] = Field(default=None, validation_alias=AliasChoices("WATSONX_API_KEY", "IBM_CLOUD_API_KEY"))
    WATSONX_URL: Optional[str] = Field(default="https://us-south.ml.cloud.ibm.com", validation_alias=AliasChoices("WATSONX_URL", "IBM_CLOUD_URL"))
    WATSONX_PROJECT_ID: Optional[str] = Field(default=None, validation_alias=AliasChoices("WATSONX_PROJECT_ID", "IBM_CLOUD_PROJECT_ID", "PROJECT_ID"))

    # Embeddings (used by A2A server; provided here for visibility)
    A2A_EMBEDDINGS_PROVIDER: Optional[str] = None  # e.g., "watsonx" | "openai"
    A2A_EMBEDDINGS_MODEL: Optional[str] = None

    # Settings behavior
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Validators & post-init ---------------------------------------------

    @field_validator("REPOS_DIR", "PROJECTS_DIR", "BUILD_DIR", "CREWAI_STORAGE_DIR", mode="after")
    @classmethod
    def _ensure_dirs(cls, v: Path) -> Path:
        v.mkdir(parents=True, exist_ok=True)
        return v

    def model_post_init(self, __context: Any) -> None:
        # Derive A2A_BASE
        base = self.A2A_BASE
        if self.PUBLIC_URL:
            base = self.PUBLIC_URL.rstrip("/")
        elif self.A2A_HOST and self.A2A_PORT:
            base = f"http://{self.A2A_HOST}:{self.A2A_PORT}"
        object.__setattr__(self, "A2A_BASE", base)

        # Side-effects for libraries that read env directly
        os.environ.setdefault("CREWAI_STORAGE_DIR", str(self.CREWAI_STORAGE_DIR))
