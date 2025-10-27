# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import platform
import sys
from typing import Any, Dict

from flask import Blueprint

from ..config import Settings
from . import json_ok

bp = Blueprint("health", __name__)


@bp.get("/")
def health() -> Any:
    cfg = Settings()
    info: Dict[str, Any] = {
        "service": "workshop-builder-api",
        "python": sys.version.split()[0],
        "platform": platform.platform(terse=True),
        "provider": cfg.LLM_PROVIDER,
        "a2a_base": cfg.A2A_BASE,
        "knowledge_enabled": cfg.A2A_ENABLE_KNOWLEDGE,
    }
    return json_ok({"status": "ok", "info": info})
