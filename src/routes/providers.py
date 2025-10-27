# src/routes/providers.py
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, TypedDict
from flask import Blueprint, jsonify, request
from ..config import settings
bp = Blueprint("providers", __name__, url_prefix="/api/providers")
_PROVIDER_STATE = Path(settings.PROJECT_DIR) / ".state" / "provider.json"
_PROVIDER_STATE.parent.mkdir(parents=True, exist_ok=True)
class ProviderInfo(TypedDict, total=False):
    id: str                 # "watsonx" | "openai"
    label: str              # Human-friendly
    models_hint: List[str]  # Common models for quick-pick
    requires: List[str]     # Env keys to consider "configured"
    configured: bool        # Derived by checking env/persisted state
    base_url_hint: Optional[str]
def _redact(value: Optional[str]) -> Optional[str]:
    if not value:
        return value
    if len(value) <= 8:
        return "****"
    return value[:4] + "****" + value[-4:]
def _read_state() -> Dict[str, Any]:
    if _PROVIDER_STATE.exists():
        try:
            return json.loads(_PROVIDER_STATE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}
def _write_state(obj: Dict[str, Any]) -> None:
    _PROVIDER_STATE.parent.mkdir(parents=True, exist_ok=True)
    _PROVIDER_STATE.write_text(json.dumps(obj, indent=2), encoding="utf-8")
def _supported() -> List[ProviderInfo]:
    env = os.environ
    watsonx_conf = bool(
        env.get("WATSONX_API_KEY")
        and (env.get("WATSONX_PROJECT_ID") or env.get("IBM_CLOUD_PROJECT_ID") or env.get("PROJECT_ID"))
        and (env.get("WATSONX_URL") or env.get("EMBEDDINGS_WATSONX_URL"))
    )
    openai_conf = bool(env.get("OPENAI_API_KEY"))
    return [
        ProviderInfo(
            id="watsonx",
            label="IBM watsonx.ai",
            models_hint=[
                "ibm/granite-3-8b-instruct",
                "ibm/granite-3-2b-instruct",
            ],
            requires=["WATSONX_API_KEY", "WATSONX_PROJECT_ID", "WATSONX_URL"],
            configured=watsonx_conf,
            base_url_hint=env.get("WATSONX_URL", "https://us-south.ml.cloud.ibm.com"),
        ),
        ProviderInfo(
            id="openai",
            label="OpenAI",
            models_hint=[
                "gpt-4o-mini",
                "gpt-4o",
            ],
            requires=["OPENAI_API_KEY"],
            configured=openai_conf,
            base_url_hint=os.getenv("OPENAI_API_BASE"),
        ),
    ]
@bp.get("")
def get_providers():
    """
    Return current provider selection and supported providers.
    Redacts any secrets.
    """
    state = _read_state()
    current = {
        "provider": state.get("provider") or os.getenv("LLM_PROVIDER") or "watsonx",
        "model_id": state.get("model_id") or os.getenv("MODEL_ID") or "ibm/granite-3-8b-instruct",
        # Optional connection hints (redacted)
        "openai": {
            "api_key": _redact(os.getenv("OPENAI_API_KEY")),
            "api_base": os.getenv("OPENAI_API_BASE"),
        },
        "watsonx": {
            "api_key": _redact(os.getenv("WATSONX_API_KEY") or os.getenv("IBM_CLOUD_API_KEY")),
            "project_id": os.getenv("WATSONX_PROJECT_ID") or os.getenv("IBM_CLOUD_PROJECT_ID") or os.getenv("PROJECT_ID"),
            "url": os.getenv("WATSONX_URL"),
        },
    }
    return jsonify({"current": current, "supported": _supported()})
@bp.put("")
def set_provider():
    """
    Update selected provider/model at runtime.
    Persist minimal state to .state/provider.json (no secrets).
    Body:
      {
        "provider": "watsonx" | "openai",
        "model_id": "string",
        "api_base": "optional (OpenAI)",
        "project_id": "optional (watsonx)",
        "url": "optional (watsonx)"
      }
    """
    data = request.get_json(force=True, silent=True) or {}
    provider = str(data.get("provider", "")).strip().lower()
    model_id = str(data.get("model_id", "")).strip()
    if provider not in {"watsonx", "openai"}:
        return jsonify({"error": "provider must be 'watsonx' or 'openai'"}), 400
    if not model_id:
        return jsonify({"error": "model_id is required"}), 400
    # Persisted (no secrets) so UI can reflect the choice across restarts if desired
    state = _read_state()
    state.update(
        {
            "provider": provider,
            "model_id": model_id,
            # Non-secret hints
            "api_base": data.get("api_base"),
            "url": data.get("url"),
            "project_id": data.get("project_id"),
        }
    )
    _write_state(state)
    # Update process env hints (non-secret) — optional, to help downstream factories
    if provider == "openai" and data.get("api_base"):
        os.environ["OPENAI_API_BASE"] = str(data["api_base"])
    if provider == "watsonx":
        if data.get("url"):
            os.environ["WATSONX_URL"] = str(data["url"])
        if data.get("project_id"):
            os.environ["WATSONX_PROJECT_ID"] = str(data["project_id"])
    return jsonify({"ok": True, "current": {"provider": provider, "model_id": model_id}})
