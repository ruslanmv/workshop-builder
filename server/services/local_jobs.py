# server/services/local_jobs.py
from __future__ import annotations
import asyncio
import json
import uuid
from typing import Any, Dict, Tuple, AsyncIterator

Event = Tuple[str, Dict[str, Any]]

class LocalJob:
    def __init__(self, job_id: str):
        self.id = job_id
        self.queue: asyncio.Queue[Event] = asyncio.Queue()
        self.done = asyncio.Event()
        self.error: str | None = None

    def publish(self, event: str, data: Dict[str, Any]) -> None:
        try:
            self.queue.put_nowait((event, data))
        except Exception:
            # best-effort: ignore backpressure in dev mode
            pass

    def mark_done(self) -> None:
        self.done.set()
        # also push a final newline to wake SSE readers
        self.publish("done", {"ok": self.error is None, "error": self.error})

_jobs: Dict[str, LocalJob] = {}

def create_job() -> LocalJob:
    jid = uuid.uuid4().hex
    job = LocalJob(jid)
    _jobs[jid] = job
    return job

def get_job(job_id: str) -> LocalJob | None:
    return _jobs.get(job_id)

def exists(job_id: str) -> bool:
    return job_id in _jobs

def set_error(job_id: str, msg: str) -> None:
    j = _jobs.get(job_id)
    if j:
        j.error = msg
        j.publish("error", {"message": msg})
        j.mark_done()

async def sse_iter(job: LocalJob) -> AsyncIterator[bytes]:
    """Yield SSE frames from the job queue until done."""
    try:
        while True:
            if job.done.is_set() and job.queue.empty():
                break
            try:
                event, payload = await asyncio.wait_for(job.queue.get(), timeout=0.5)
            except asyncio.TimeoutError:
                # keep-alive comment every ~15s handled by client; we can skip here
                continue
            yield f"event: {event}\n".encode("utf-8")
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")
    finally:
        # Let the job linger for a bit or prune immediately
        _jobs.pop(job.id, None)
