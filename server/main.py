from __future__ import annotations
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, ORJSONResponse
from fastapi.staticfiles import StaticFiles

from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .config import Settings
from .logging import setup_logging
from .metrics import setup_metrics
from .routers import health, providers, settings as settings_rt, ingest, knowledge, generate, exports
from .routers.generate import sse_event_gen

cfg = Settings(); cfg.ensure_dirs()
logger = setup_logging(cfg.LOG_LEVEL)

app = FastAPI(
    title=cfg.APP_NAME,
    version=cfg.APP_VERSION,
    default_response_class=ORJSONResponse,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in cfg.CORS_ALLOW_ORIGINS.split(",") if o.strip()],
    allow_methods=[m.strip() for m in cfg.CORS_ALLOW_METHODS.split(",") if m.strip()],
    allow_headers=[h.strip() for h in cfg.CORS_ALLOW_HEADERS.split(",") if h.strip()],
)

# Rate limits (per IP)
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])  # tune for prod
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)

@app.exception_handler(RateLimitExceeded)
def _ratelimit_handler(request, exc):
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse("Too Many Requests", status_code=429)


# Routers
app.include_router(health.router)
app.include_router(providers.router)
app.include_router(settings_rt.router)
app.include_router(ingest.router)
app.include_router(knowledge.router)
app.include_router(generate.router)
app.include_router(exports.router)

# Metrics
setup_metrics(app, enable=cfg.ENABLE_PROMETHEUS)

# Static UI
dist = Path(cfg.STATIC_ROOT).resolve()
if (dist / "assets").exists():
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

@app.get("/")
def index():
    index_html = dist / "index.html"
    return FileResponse(str(index_html)) if index_html.exists() else {"ok": False, "message": "UI not built"}

# SPA fallback (non-API)
@app.get("/{full_path:path}")
def spa(full_path: str, request: Request):
    if full_path.startswith("api/"):
        return {"ok": False, "error": {"message":"Not Found"}}
    index_html = dist / "index.html"
    return FileResponse(str(index_html)) if index_html.exists() else {"ok": False, "message": "UI not built"}


@limiter.exempt
@app.get("/api/generate/stream")
async def sse_stream(job_id: str):
    return sse_event_gen(job_id)
