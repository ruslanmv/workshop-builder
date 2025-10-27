from __future__ import annotations
import os, sys
from rq import Connection, Worker, get_current_job
import redis
from typing import Any, Dict
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from server.config import Settings
from server.services.crewai_pipeline import run_job as run_job_impl
from server.services.jobs import publish_event

def _pub(cfg: Settings, job_id: str, event: str, data: dict):
    publish_event(cfg, job_id, event, data)

def run_job_worker(project: Dict[str, Any], tenant: str, cfg_dict: Dict[str, Any]):
    cfg = Settings.model_validate(cfg_dict)
    job = get_current_job()
    job_id = job.id if job else "local"
    _pub(cfg, job_id, "log", {"level": "info", "msg": "Job started"})
    artifacts = run_job_impl(job_id, project, tenant, cfg_dict)
    _pub(cfg, job_id, "done", {"ok": True, "artifacts": artifacts})
    return artifacts

if __name__ == "__main__":
    cfg = Settings()
    redis_conn = redis.Redis.from_url(cfg.REDIS_URL)
    with Connection(redis_conn):
        w = Worker([cfg.RQ_QUEUE])
        w.work(with_scheduler=False)
