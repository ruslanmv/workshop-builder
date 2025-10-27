from __future__ import annotations
from fastapi import APIRouter, HTTPException, Depends
from ..config import Settings
from ..security import require_auth, get_tenant_id
from ..services.rag import query as rag_query

router = APIRouter(prefix="/api", tags=["knowledge"], dependencies=[Depends(require_auth)])

@router.post("/knowledge/query")
def rag_query_endpoint(body: dict, tenant: str = Depends(get_tenant_id)):
    cfg = Settings()
    q = body.get("q") or ""
    if not q:
        raise HTTPException(400, "q required")
    collection = f"{tenant}:{(body.get('collection') or 'workshop_docs')}"
    k = int(body.get("k") or 6)
    hits = rag_query(cfg, collection, q, k)
    return {"ok": True, "hits": hits}
