from __future__ import annotations
from typing import Any, Dict
from ..config import Settings
from .jobs import publish_event

class JobEmitter:
    def __init__(self, cfg: Settings, job_id: str):
        self.cfg = cfg
        self.job_id = job_id

    async def progress(self, percent: int, label: str):
        publish_event(self.cfg, self.job_id, "progress", {"percent": int(percent), "label": label})

    async def log(self, level: str, msg: str):
        publish_event(self.cfg, self.job_id, "log", {"level": level, "msg": msg})

    async def artifact(self, a: Dict[str, Any]):
        publish_event(self.cfg, self.job_id, "artifact", a)

    async def done(self):
        publish_event(self.cfg, self.job_id, "done", {"ok": True})
