# workers/worker.py
from __future__ import annotations

from typing import Any, Dict

from rq import get_current_job
import redis

from server.config import Settings
from server.services.jobs import publish_event


def _pub(cfg: Settings, job_id: str, event: str, data: dict):
    publish_event(cfg, job_id, event, data)


def run_job_worker(project: Dict[str, Any], tenant: str, cfg_dict: Dict[str, Any]):
    """
    RQ job entrypoint: runs the pipeline and emits progress/done events.
    Heavy imports happen here (in the child) to avoid macOS fork issues.
    """
    # ✅ Lazy import to keep parent worker "clean" before fork
    from server.services.crewai_pipeline import run_job as run_job_impl

    cfg = Settings.model_validate(cfg_dict)
    job = get_current_job()
    job_id = job.id if job else "local"
    _pub(cfg, job_id, "log", {"level": "info", "msg": "Job started"})
    artifacts = run_job_impl(job_id, project, tenant, cfg_dict)
    _pub(cfg, job_id, "done", {"ok": True, "artifacts": artifacts})
    return artifacts


if __name__ == "__main__":
    # Import worker classes only when running this module directly.
    from rq.worker import Worker
    from rq.connections import Connection

    cfg = Settings()
    redis_conn = redis.Redis.from_url(cfg.REDIS_URL)
    with Connection(redis_conn):
        w = Worker([cfg.RQ_QUEUE])
        w.work(with_scheduler=False)
