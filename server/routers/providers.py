from __future__ import annotations
from fastapi import APIRouter, HTTPException, Depends
from ..security import require_auth

router = APIRouter(prefix="/api", tags=["providers"], dependencies=[Depends(require_auth)])

@router.get("/providers")
def list_providers():
    return {"ok": True, "providers": [{"id":"watsonx","label":"IBM watsonx.ai","chat":True,"embed":True}], "selected": {"id":"watsonx"}}

@router.post("/providers/select")
def select_provider(body: dict):
    if body.get("id") != "watsonx":
        raise HTTPException(400, "Only watsonx.ai is enabled")
    return {"ok": True, "selected": {"id":"watsonx"}}
