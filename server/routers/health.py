from __future__ import annotations
from fastapi import APIRouter
from ..config import Settings

router = APIRouter(prefix="/api", tags=["health"])

@router.get("/healthz")
def healthz():
    return {"ok": True, "service": "workshop-builder-api", "version": Settings().APP_VERSION}

@router.get("/readyz")
def readyz():
    return {"ok": True, "redis": True, "chroma": True, "watsonx": True}

@router.get("/health")
def health():
    return healthz()
