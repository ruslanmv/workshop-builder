# server/services/llms.py
from __future__ import annotations
import os
from typing import Any

from ..config import Settings


def _lower(s: str | None) -> str:
    return (s or "").strip().lower()


def _ensure_watsonx_env_aliases(cfg: Settings) -> str:
    """
    Ensure environment variables are set consistently for LiteLLM / watsonx.ai.

    LiteLLM expects:
      - WATSONX_APIKEY
      - WATSONX_URL
      - WATSONX_PROJECT_ID

    We also mirror from your app's WATSONX_API_KEY and WATSONX_REGION.
    Returns the resolved base URL.
    """
    base_url = os.getenv("WATSONX_URL") or f"https://{cfg.WATSONX_REGION}.ml.cloud.ibm.com"
    os.environ.setdefault("WATSONX_URL", base_url)

    # Mirror API key between both names so any lib can find it
    if getattr(cfg, "WATSONX_API_KEY", None):
        os.environ.setdefault("WATSONX_API_KEY", cfg.WATSONX_API_KEY)
        os.environ.setdefault("WATSONX_APIKEY", cfg.WATSONX_API_KEY)

    if getattr(cfg, "WATSONX_PROJECT_ID", None):
        os.environ.setdefault("WATSONX_PROJECT_ID", cfg.WATSONX_PROJECT_ID)

    return base_url


def build_crewai_llm(cfg: Settings) -> Any:
    """
    Return an LLM usable by CrewAI Agents.

    Priority:
      1) watsonx.ai (CrewAI native LLM via LiteLLM)
      2) OpenAI     (crewai.LLM)
      3) Ollama     (crewai.LLM)
    """
    provider = _lower(os.getenv("CREW_PROVIDER", getattr(cfg, "CREW_PROVIDER", "")))

    # ---------- 1) watsonx.ai via LiteLLM ----------
    if provider in {"watsonx", "ibm", "ibm-watsonx-ai"} or os.getenv("WATSONX_APIKEY") or os.getenv("WATSONX_API_KEY"):
        # Fail fast with a clear error if LiteLLM isn't installed
        try:
            import litellm  # noqa: F401
        except Exception as e:
            raise RuntimeError(
                "watsonx via CrewAI requires 'litellm'. Install it with: pip install 'litellm>=1.60.0'"
            ) from e

        from crewai import LLM

        # Normalize env names for LiteLLM
        _ensure_watsonx_env_aliases(cfg)

        # CrewAI/LiteLLM expects a watsonx-prefixed model
        model = f"watsonx/{cfg.WATSONX_CHAT_MODEL}"

        # Do NOT pass api_key/base_url here; CrewAI reads LiteLLM envs.
        return LLM(
            model=model,
            temperature=float(getattr(cfg, "CREW_TEMPERATURE", 0.2)),
            max_tokens=2048,
        )

    # ---------- 2) OpenAI ----------
    if provider == "openai" or os.getenv("OPENAI_API_KEY"):
        from crewai import LLM
        model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        return LLM(
            model=model,
            api_key=os.environ["OPENAI_API_KEY"],
            temperature=float(getattr(cfg, "CREW_TEMPERATURE", 0.2)),
        )

    # ---------- 3) Ollama ----------
    if provider == "ollama" or os.getenv("OLLAMA_HOST"):
        from crewai import LLM
        return LLM(
            model=os.getenv("OLLAMA_MODEL", "llama3.1"),
            base_url=os.getenv("OLLAMA_HOST", "http://localhost:11434"),
            api_key="ollama",  # placeholder for interface
            temperature=float(getattr(cfg, "CREW_TEMPERATURE", 0.2)),
            provider="ollama",
        )

    raise RuntimeError(
        "No LLM provider configured. Set CREW_PROVIDER and corresponding envs.\n"
        "watsonx: WATSONX_APIKEY, WATSONX_URL, WATSONX_PROJECT_ID (we mirror from WATSONX_API_KEY/REGION too)\n"
        "openai:  OPENAI_API_KEY (OPENAI_MODEL optional)\n"
        "ollama:  OLLAMA_HOST (OLLAMA_MODEL optional)"
    )
