from __future__ import annotations
from fastapi import APIRouter, Depends
from ..config import Settings
from ..security import require_auth

router = APIRouter(prefix="/api", tags=["settings"], dependencies=[Depends(require_auth)])

@router.get("/settings")
def get_settings():
    cfg = Settings()
    return {
        "ok": True,
        "settings": {
            "default_collection": "workshop_docs",
            "chunk_size": 1200,
            "chunk_overlap": 160,
            "embed_model": cfg.WATSONX_EMBED_MODEL,
            "chat_model": cfg.WATSONX_CHAT_MODEL,
            "a2a_base": None
        }
    }

@router.post("/settings")
def set_settings(_: dict):
    return {"ok": True}
