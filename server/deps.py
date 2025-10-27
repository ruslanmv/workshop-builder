from __future__ import annotations
import redis
from rq import Queue
from .config import Settings

def get_redis(cfg: Settings | None = None):
    cfg = cfg or Settings()
    return redis.Redis.from_url(cfg.REDIS_URL, decode_responses=False)

def get_rq_queue(cfg: Settings | None = None):
    cfg = cfg or Settings()
    r = get_redis(cfg)
    return Queue(cfg.RQ_QUEUE, connection=r)
