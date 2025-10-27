# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import logging
import os

__all__ = [
    "repo_service",
    "rag_service",
    "planning_service",
    "providers",
    "schedule_service",
]

# Lightweight, consistent logger for the service layer
_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=_level,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("workshop.services")
