from __future__ import annotations
import os, json
from ..config import Settings
from ..deps import get_redis

def job_dirs(cfg: Settings, tenant: str, job_id: str) -> dict[str, str]:
    root = os.path.join(cfg.JOBS_DIR, tenant, job_id)
    art = os.path.join(root, "artifacts")
    os.makedirs(art, exist_ok=True)
    return {"root": root, "artifacts": art}

def publish_event(cfg: Settings, job_id: str, event: str, data: dict):
    r = get_redis(cfg)
    payload = json.dumps({"event": event, "data": data})
    r.publish(f"job:{job_id}:events", payload)

def set_cancelled(cfg: Settings, job_id: str):
    r = get_redis(cfg)
    r.setex(f"job:{job_id}:cancel", 600, b"1")

def is_cancelled(cfg: Settings, job_id: str) -> bool:
    r = get_redis(cfg)
    return r.get(f"job:{job_id}:cancel") is not None
