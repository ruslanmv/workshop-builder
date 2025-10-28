# workers/worker.py
from __future__ import annotations

"""
RQ worker entrypoint compatible with redis>=5 and rq>=1.16.

- Avoids deprecated/removed `rq.connections.Connection`
- Passes the Redis connection explicitly to Queue/Worker
- Keeps your existing `run_job_worker` function intact
"""

from typing import Any, Dict, Optional
import importlib
import os
import signal
import sys
from contextlib import suppress

from rq import get_current_job, Queue, Worker
from redis import Redis

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


# ---------- Worker bootstrap ----------

def _resolve_worker_class(env_value: Optional[str]):
    """
    If RQ_WORKER_CLASS is set (e.g. 'rq.worker.SimpleWorker'), import and return it.
    Falls back to rq.Worker.
    """
    if not env_value:
        return Worker
    try:
        module_name, class_name = env_value.rsplit(".", 1)
        mod = importlib.import_module(module_name)
        cls = getattr(mod, class_name)
        return cls
    except Exception:  # pragma: no cover (best-effort)
        print(
            f"[worker] WARNING: Could not import RQ_WORKER_CLASS='{env_value}'. "
            f"Falling back to rq.Worker.",
            file=sys.stderr,
        )
        return Worker


def _graceful_shutdown(worker: Worker):
    """Attach SIGTERM/SIGINT handlers that ask the worker to stop gracefully."""
    def handler(signum, _frame):
        print(f"[worker] Caught signal {signum}; stopping after current job…", file=sys.stderr)
        with suppress(Exception):
            worker.request_stop()  # rq>=1.10
    signal.signal(signal.SIGTERM, handler)
    signal.signal(signal.SIGINT, handler)


def main():
    cfg = Settings()

    # Build a Redis connection and queue
    redis_url = os.getenv("REDIS_URL", cfg.REDIS_URL)  # allow env override
    queue_name = os.getenv("RQ_QUEUE", cfg.RQ_QUEUE)

    conn = Redis.from_url(redis_url)
    queue = Queue(queue_name, connection=conn)

    # Allow optional override to SimpleWorker for debugging (no fork)
    worker_cls = _resolve_worker_class(os.getenv("RQ_WORKER_CLASS"))
    worker = worker_cls([queue], connection=conn)

    _graceful_shutdown(worker)

    print(f"[worker] Starting {worker_cls.__name__} on queue '{queue_name}' @ {redis_url}", flush=True)
    # Disable scheduler in this process; run a separate RQ scheduler if you need one
    worker.work(with_scheduler=False)


if __name__ == "__main__":
    # Run via: python -m workers.worker
    main()
