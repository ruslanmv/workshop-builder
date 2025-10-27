from __future__ import annotations
import os, asyncio, json
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from ..config import Settings
from ..models import StartJobRequest
from ..security import require_auth, get_tenant_id
from ..deps import get_rq_queue, get_redis

from rq.job import Job

router = APIRouter(prefix="/api", tags=["generate"], dependencies=[Depends(require_auth)])

def _job_channel(job_id: str) -> str:
    return f"job:{job_id}:events"

@router.post("/generate/start")
async def start(body: dict, tenant: str = Depends(get_tenant_id)):
    cfg = Settings(); cfg.ensure_dirs()
    try:
        req = StartJobRequest(**body)
    except Exception as e:
        raise HTTPException(400, str(e))

    q = get_rq_queue(cfg)
    job: Job = q.enqueue(
        "workers.worker.run_job_worker",
        req.project.model_dump(),
        tenant,
        cfg.model_dump(),
        job_timeout=900,
        failure_ttl=3600,
        result_ttl=3600,
    )
    return {"ok": True, "job_id": job.id, "stream": f"/api/generate/stream?job_id={job.id}"}


async def sse_event_gen(job_id: str):
    cfg = Settings()
    r = get_redis(cfg)
    psub = r.pubsub()
    channel = f"job:{job_id}:events"
    psub.subscribe(channel)
    async def event_gen():
        try:
            yield "event: ping\ndata: {}\n\n"
            while True:
                msg = psub.get_message(timeout=15.0)
                if not msg:
                    yield "event: ping\ndata: {}\n\n"
                    await asyncio.sleep(0.5)
                    continue
                if msg["type"] != "message":
                    continue
                payload = json.loads(msg["data"])
                event = payload.get("event", "log")
                data = payload.get("data", {})
                yield f"event: {event}\n"
                yield f"data: {json.dumps(data)}\n\n"
                if event == "done":
                    break
        finally:
            try:
                psub.unsubscribe(channel)
                psub.close()
            except Exception:
                pass
    return event_gen()

# stream endpoint moved to main with rate-limit exemption
#@router.get("/generate/stream")
async def stream(job_id: str):
    cfg = Settings()
    r = get_redis(cfg)
    psub = r.pubsub()
    channel = _job_channel(job_id)
    psub.subscribe(channel)

    async def event_gen():
        try:
            yield "event: ping\ndata: {}\n\n"
            while True:
                msg = psub.get_message(timeout=15.0)
                if not msg:
                    yield "event: ping\ndata: {}\n\n"
                    await asyncio.sleep(0.5)
                    continue
                if msg["type"] != "message":
                    continue
                payload = json.loads(msg["data"])
                event = payload.get("event", "log")
                data = payload.get("data", {})
                yield f"event: {event}\n"
                yield f"data: {json.dumps(data)}\n\n"
                if event == "done":
                    break
        finally:
            try:
                psub.unsubscribe(channel)
                psub.close()
            except Exception:
                pass

    return StreamingResponse(event_gen(), media_type="text/event-stream")

@router.post("/generate/cancel")
def cancel(body: dict):
    cfg = Settings()
    job_id = body.get("job_id")
    if not job_id:
        raise HTTPException(400, "job_id required")
    r = get_redis(cfg)
    r.setex(f"job:{job_id}:cancel", 600, b"1")
    return {"ok": True, "cancelled": True}
