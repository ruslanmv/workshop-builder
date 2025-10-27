# a2a_server.py
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations
"""
Universal A2A Agent — Production FastAPI bootstrap (RAG-ready)
- Loads env from `.env`, falling back to `.env.template` or `.env.example` (no override).
- Builds the Universal A2A FastAPI app (OpenAI-compatible endpoints, /a2a, /rpc).
- Optionally mounts `/knowledge` (RAG) when A2A_ENABLE_KNOWLEDGE=1.
- Adds production middleware: GZip, CORS, TrustedHost, ProxyHeaders.
- Safe Qdrant check: only mounts /knowledge with Qdrant when compatible client is present.
Env highlights
--------------
A2A_ENABLE_KNOWLEDGE=1
A2A_VDB=chromadb|qdrant
A2A_QDRANT_URL=http://localhost:6333
A2A_CHROMA_COLLECTION=a2a-knowledge
A2A_QDRANT_COLLECTION=a2a-knowledge
CORS_ALLOW_ORIGINS="*"
CORS_ALLOW_METHODS="*"
CORS_ALLOW_HEADERS="*"
CORS_ALLOW_CREDENTIALS=false
ALLOWED_HOSTS="*"
PROXY_HEADERS=1
A2A_HOST=0.0.0.0
A2A_PORT=8000
A2A_RELOAD=0
"""
import importlib
import logging
import os
from typing import Iterable, List
from dotenv import find_dotenv, load_dotenv
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.proxy_headers import ProxyHeadersMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
# ---- Load env early (do not override process env) ---------------------------
_env = (
    find_dotenv(".env", usecwd=True)
    or find_dotenv(".env.template", usecwd=True)
    or find_dotenv(".env.example", usecwd=True)
)
if _env:
    load_dotenv(_env, override=False)
# ---- Configure logging (plays nice with uvicorn) ----------------------------
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("a2a.server")
# ---- Universal A2A builder --------------------------------------------------
from a2a_universal.app import build as build_universal  # noqa: E402
def _csv_env(name: str, default: str | None = None) -> List[str]:
    """
    Parse a CSV env var into a list. If "*" or empty -> ["*"].
    """
    raw = os.getenv(name, default or "")
    if raw is None:
        return ["*"]
    raw = raw.strip()
    if raw in ("", "*"):
        return ["*"]
    parts: Iterable[str] = (x.strip() for x in raw.split(","))
    items = [x for x in parts if x]
    return items or ["*"]
def _bool_env(name: str, default: bool = False) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return v.lower() in ("1", "true", "yes", "on")
def _qdrant_ready() -> bool:
    """
    If A2A_VDB=qdrant, verify a new-enough qdrant-client is present.
    We check for `HasVectorCondition` (appears in >=1.13).
    """
    if (os.getenv("A2A_VDB", "chromadb") or "").lower() != "qdrant":
        return True
    try:
        m = importlib.import_module("qdrant_client.models")
        getattr(m, "HasVectorCondition")
        return True
    except Exception as e:
        log.warning(
            "A2A_VDB=qdrant but qdrant-client appears incompatible/missing. "
            "Disable Qdrant or: pip install -U 'qdrant-client>=1.13'. "
            "Proceeding WITHOUT /knowledge.",
            exc_info=e,
        )
        return False
async def _default_text_handler(text: str) -> str:
    """Simple default handler used by build_universal when no framework provided."""
    return f"A2A is running. You said: {text[:240]}"
def build_app() -> FastAPI:
    """
    Construct the FastAPI app via Universal A2A's builder, then attach middleware
    and optionally mount the /knowledge router.
    """
    app = build_universal(
        handler=_default_text_handler,
        name=os.getenv("AGENT_NAME", "Universal A2A"),
        description="Universal A2A Agent with optional /knowledge RAG endpoints.",
    )
    # ---- Production middleware ---------------------------------------------
    # Response compression
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_csv_env("CORS_ALLOW_ORIGINS", os.getenv("PUBLIC_URL", "*")),
        allow_methods=_csv_env("CORS_ALLOW_METHODS", "*"),
        allow_headers=_csv_env("CORS_ALLOW_HEADERS", "*"),
        allow_credentials=_bool_env("CORS_ALLOW_CREDENTIALS", False),
    )
    # Trusted hosts
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=_csv_env("ALLOWED_HOSTS", "*"),
    )
    # Honor X-Forwarded-* when behind proxies/load balancers
    if _bool_env("PROXY_HEADERS", True):
        app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")
    # ---- Optionally mount /knowledge (RAG) ---------------------------------
    if os.getenv("A2A_ENABLE_KNOWLEDGE", "0") == "1" and _qdrant_ready():
        try:
            from a2a_universal.routers import knowledge as knowledge_router
            app.include_router(knowledge_router.router)
            log.info(
                "Mounted /knowledge",
                extra={"vdb": os.getenv("A2A_VDB", "chromadb")},
            )
        except Exception:
            log.exception("Failed to mount /knowledge")
    else:
        log.info(
            "Knowledge API not mounted",
            extra={
                "enabled": os.getenv("A2A_ENABLE_KNOWLEDGE", "0"),
                "vdb": os.getenv("A2A_VDB", "chromadb"),
            },
        )
    return app
# Global ASGI app (importable by uvicorn/gunicorn)
app = build_app()
def main() -> None:
    """
    Local/dev entry point:
      uv run a2a-server
      python -m a2a_server
      python a2a_server.py
    """
    from a2a_universal import run
    host = os.getenv("A2A_HOST", os.getenv("HOST", "0.0.0.0"))
    port = int(os.getenv("A2A_PORT", os.getenv("PORT", "8000")))
    reload = _bool_env("A2A_RELOAD", False)
    log.info("Starting A2A server", extra={"host": host, "port": port, "reload": reload})
    run(
        "a2a_server:app",
        host=host,
        port=port,
        reload=reload,
    )
if __name__ == "__main__":
    main()
