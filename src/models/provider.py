# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class ProviderType(str, Enum):
    watsonx = "watsonx"
    openai = "openai"


class ProviderConfig(BaseModel):
    """
    Runtime-selected LLM provider & credentials.

    Note:
      - For CrewAI w/ LiteLLM, Watsonx models are addressed as: f"watsonx/{model_id}"
      - OpenAI defaults to OPENAI_API_BASE if provided.
    """
    provider: ProviderType = Field(default=ProviderType.watsonx)
    model_id: str = Field(default="ibm/granite-3-8b-instruct")

    # OpenAI
    openai_api_key: Optional[str] = None
    openai_api_base: Optional[str] = None

    # watsonx
    watsonx_api_key: Optional[str] = None
    watsonx_url: Optional[str] = None
    watsonx_project_id: Optional[str] = None

    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, ge=32, le=32768)

    @field_validator("model_id")
    @classmethod
    def _model_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("model_id cannot be empty")
        return v.strip()

    def is_configured(self) -> bool:
        if self.provider == ProviderType.openai:
            return bool(self.openai_api_key)
        if self.provider == ProviderType.watsonx:
            return bool(self.watsonx_api_key and self.watsonx_project_id)
        return False

    # Convenience helpers for LiteLLM/CrewAI wiring
    def litellm_model(self) -> str:
        if self.provider == ProviderType.watsonx:
            return f"watsonx/{self.model_id}"
        return self.model_id

    def base_url(self) -> Optional[str]:
        return self.watsonx_url if self.provider == ProviderType.watsonx else self.openai_api_base
