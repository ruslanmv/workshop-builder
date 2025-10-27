# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from typing import Callable, List, Mapping, MutableMapping, Sequence

from ..config import Settings

import logging

log = logging.getLogger("workshop.services.providers")

ChatFn = Callable[[Sequence[Mapping[str, str]] | str], str]


def _normalize_messages(msgs: Sequence[Mapping[str, str]] | str) -> List[dict]:
    if isinstance(msgs, str):
        return [{"role": "user", "content": msgs}]
    out: List[dict] = []
    for m in msgs:
        role = str(m.get("role") or "user")
        content = str(m.get("content") or "")
        out.append({"role": role, "content": content})
    return out


# ------------------------------ watsonx ------------------------------


def _make_watsonx_chat(settings: Settings) -> ChatFn:
    """
    Create a simple chat function backed by IBM watsonx.ai
    Requires: ibm-watsonx-ai>=1.0
    """
    try:
        # Foundation Model SDK
        from ibm_watsonx_ai.foundation_models import Model
    except Exception as e:  # pragma: no cover
        raise RuntimeError("ibm-watsonx-ai is not installed.") from e

    model_id = settings.MODEL_ID or "ibm/granite-3-8b-instruct"
    url = settings.IBM_CLOUD_URL or "https://us-south.ml.cloud.ibm.com"
    apikey = settings.IBM_CLOUD_API_KEY
    project = settings.IBM_CLOUD_PROJECT_ID
    if not (apikey and project):
        raise RuntimeError("Missing IBM credentials: IBM_CLOUD_API_KEY and IBM_CLOUD_PROJECT_ID are required.")

    # Build model object once; reuse for calls
    m = Model(
        model_id=model_id,
        params={
            "decoding_method": "greedy",
            "max_new_tokens": 1024,
            "temperature": 0.0,
        },
        credentials={"apikey": apikey, "url": url},
        project_id=project,
    )

    def chat(messages: Sequence[Mapping[str, str]] | str) -> str:
        normalized = _normalize_messages(messages)
        # Simple single-turn prompt composition
        prompt = "\n".join([f"{m['role']}: {m['content']}" for m in normalized]) + "\nassistant:"
        try:
            res = m.generate_text(prompt=prompt)
            # SDK returns dict-like with 'results'
            if isinstance(res, dict):
                out = res.get("results") or res.get("generated_text") or ""
                if isinstance(out, list) and out:
                    return str(out[0].get("generated_text") or out[0].get("text") or "")
                return str(out)
            return str(res)
        except Exception as e:
            log.exception("watsonx chat failed")
            raise RuntimeError(f"watsonx error: {e}") from e

    return chat


# ------------------------------ OpenAI ------------------------------


def _make_openai_chat(settings: Settings) -> ChatFn:
    """
    Create a simple chat function backed by OpenAI (compatible clients).
    Requires: openai>=1.0.0
    """
    try:
        from openai import OpenAI  # type: ignore
    except Exception as e:  # pragma: no cover
        raise RuntimeError("openai client is not installed.") from e

    api_key = settings.OPENAI_API_KEY
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")
    base_url = settings.OPENAI_API_BASE or None
    model = settings.OPENAI_API_MODEL or "gpt-4o-mini"

    client = OpenAI(api_key=api_key, base_url=base_url)

    def chat(messages: Sequence[Mapping[str, str]] | str) -> str:
        normalized = _normalize_messages(messages)
        try:
            resp = client.chat.completions.create(model=model, messages=normalized)
            return str(resp.choices[0].message.content or "")
        except Exception as e:
            log.exception("openai chat failed")
            raise RuntimeError(f"openai error: {e}") from e

    return chat


# ------------------------------ Factory ------------------------------


def make_chat_fn(settings: Settings | None = None) -> ChatFn:
    """
    Return a callable(messages|str) -> str for the selected provider.
    """
    cfg = settings or Settings()
    provider = (cfg.LLM_PROVIDER or "watsonx").lower()
    if provider in ("watsonx", "ibm", "ibm_watsonx"):
        return _make_watsonx_chat(cfg)
    if provider in ("openai",):
        return _make_openai_chat(cfg)
    raise ValueError(f"Unsupported LLM provider: {cfg.LLM_PROVIDER}")
