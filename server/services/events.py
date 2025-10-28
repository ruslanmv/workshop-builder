# server/services/events.py
from __future__ import annotations
from typing import Any, Dict

from ..config import Settings
from .jobs import publish_event


class JobEmitter:
    """Synchronous emitter for job events via Redis Pub/Sub.

    We keep this sync because RQ workers (and SimpleWorker on macOS)
    execute jobs synchronously. The SSE endpoint remains async, but it
    only *reads* from Redis Pub/Sub, so that's fine.
    """

    __slots__ = ("cfg", "job_id")

    def __init__(self, cfg: Settings, job_id: str):
        self.cfg = cfg
        self.job_id = job_id

    def _pub(self, event: str, data: Dict[str, Any]):
        publish_event(self.cfg, self.job_id, event, data)

    # ---- Event helpers (sync) ----
    def progress(self, pct: int, msg: str):
        self._pub("progress", {"pct": int(pct), "msg": msg})

    def log(self, level: str, msg: str):
        self._pub("log", {"level": level, "msg": msg})

    def artifact(self, artifact: Dict[str, Any]):
        # Expecting an artifact dict like {"type": "pdf", "name": "...", "bytes": ...}
        self._pub("artifact", artifact)

    def done(self, **extra: Any):
        payload = {"ok": True}
        if extra:
            payload.update(extra)
        self._pub("done", payload)
