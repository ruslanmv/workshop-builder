# server/services/events.py
from __future__ import annotations
from typing import Any, Dict

from ..config import Settings
from .jobs import publish_event


class JobEmitter:
    """Synchronous emitter for job events via Redis Pub/Sub.

    RQ workers execute jobs synchronously, so keep this emitter sync.
    The SSE endpoint remains async (it only reads from Redis Pub/Sub).
    """

    __slots__ = ("cfg", "job_id")

    def __init__(self, cfg: Settings, job_id: str):
        self.cfg = cfg
        self.job_id = job_id

    def _pub(self, event: str, data: Dict[str, Any]) -> None:
        publish_event(self.cfg, self.job_id, event, data)

    # ---- Event helpers (sync) ----
    def progress(self, pct: int, msg: str) -> None:
        self._pub("progress", {"pct": int(pct), "msg": msg})

    def log(self, level: str, msg: str) -> None:
        self._pub("log", {"level": level, "msg": msg})

    def artifact(self, artifact: Dict[str, Any]) -> None:
        # e.g. {"type":"pdf","label":"Print PDF","path":"/.../print.pdf","size":12345}
        self._pub("artifact", artifact)

    def done(self, **extra: Any) -> None:
        payload: Dict[str, Any] = {"ok": True}
        if extra:
            payload.update(extra)
        self._pub("done", payload)
