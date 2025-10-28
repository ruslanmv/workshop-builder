# server/routers/generate.py
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator, Optional

from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from rq.job import Job

from ..config import Settings
from ..models import StartJobRequest
from ..security import require_auth, get_tenant_id
from ..deps import get_rq_queue, get_redis

from workers import run_job_worker

router = APIRouter(prefix="/api", tags=["generate"], dependencies=[Depends(require_auth)])


def _job_channel(job_id: str) -> str:
    return f"job:{job_id}:events"


@router.post("/generate/start")
async def start(body: dict, tenant: str = Depends(get_tenant_id)):
    cfg = Settings()
    cfg.ensure_dirs()

    try:
        req = StartJobRequest(**body)
    except Exception as e:
        raise HTTPException(400, str(e))

    q = get_rq_queue(cfg)

    job: Job = q.enqueue(
        run_job_worker,
        req.project.model_dump(),
        tenant,
        cfg.model_dump(),
        job_timeout=900,
        failure_ttl=3600,
        result_ttl=3600,
        description=f"generate workshop for tenant={tenant}",
    )

    return {
        "ok": True,
        "job_id": job.id,
        "stream": f"/api/generate/stream?job_id={job.id}",
    }


async def _pubsub_sse(r, channel: str, request: Optional[Request] = None) -> AsyncIterator[str]:
    psub = r.pubsub()
    await asyncio.to_thread(psub.subscribe, channel)
    try:
        yield "event: ping\ndata: {}\n\n"
        while True:
            if request is not None:
                try:
                    if await request.is_disconnected():
                        break
                except Exception:
                    pass
            msg = await asyncio.to_thread(psub.get_message, timeout=1.0)
            if not msg:
                yield "event: ping\ndata: {}\n\n"
                await asyncio.sleep(0.5)
                continue
            if msg.get("type") != "message":
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
            await asyncio.to_thread(psub.unsubscribe, channel)
        finally:
            psub.close()


async def sse_event_gen(job_id: str):
    cfg = Settings()
    r = get_redis(cfg)
    channel = _job_channel(job_id)
    return _pubsub_sse(r, channel, request=None)


@router.get("/generate/stream")
async def stream(job_id: str, request: Request):
    cfg = Settings()
    r = get_redis(cfg)
    channel = _job_channel(job_id)
    return StreamingResponse(
        _pubsub_sse(r, channel, request=request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/generate/cancel")
def cancel(body: dict):
    cfg = Settings()
    job_id = body.get("job_id")
    if not job_id:
        raise HTTPException(400, "job_id required")
    r = get_redis(cfg)
    r.setex(f"job:{job_id}:cancel", 600, b"1")
    return {"ok": True, "cancelled": True}
