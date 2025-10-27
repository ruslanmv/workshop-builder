# server/routers/ingest.py
from __future__ import annotations
from fastapi import APIRouter, UploadFile, Form, File, HTTPException, Depends, Request, status
from typing import List
from ..config import Settings
from ..security import require_auth, get_tenant_id
from ..services.rag import ingest_texts

router = APIRouter(prefix="/api", tags=["ingest"], dependencies=[Depends(require_auth)])

def _require_wx(cfg: Settings):
    if not cfg.WATSONX_API_KEY or not cfg.WATSONX_PROJECT_ID:
        raise HTTPException(400, "watsonx.ai credentials missing")

@router.post("/ingest/files", status_code=status.HTTP_202_ACCEPTED)
async def ingest_files(
    request: Request,
    collection: str = Form("workshop_docs"),
    files: List[UploadFile] = File(...),
    tenant: str = Depends(get_tenant_id),
):
    cfg = Settings(); cfg.ensure_dirs(); _require_wx(cfg)
    items = []
    for f in files:
        text = (await f.read()).decode("utf-8", errors="ignore")
        items.append({"path": f.filename, "text": text})
    stats = ingest_texts(cfg, collection, items, tenant=tenant)
    docmap = {"nodes": [{"path": it["path"], "tokens": len((it["text"] or "").split())} for it in items]}
    return {"ok": True, "collection": collection, "count": stats["count"], "docmap": docmap}

@router.post("/ingest/github", status_code=status.HTTP_202_ACCEPTED)
def ingest_github(body: dict, tenant: str = Depends(get_tenant_id)):
    cfg = Settings(); cfg.ensure_dirs(); _require_wx(cfg)
    collection = (body.get("collection") or "workshop_docs").strip()
    files = body.get("files") or []   # [{path,text,title?}]
    stats = ingest_texts(cfg, collection, files, tenant=tenant)
    docmap = {"nodes": [{"path": it.get("path","doc"), "tokens": len((it.get("text") or "").split())} for it in files]}
    return {"ok": True, "collection": collection, "commit": "demo", "count": stats["count"], "docmap": docmap}

@router.post("/ingest/web", status_code=status.HTTP_202_ACCEPTED)
def ingest_web(body: dict, tenant: str = Depends(get_tenant_id)):
    cfg = Settings(); cfg.ensure_dirs(); _require_wx(cfg)
    collection = (body.get("collection") or "workshop_docs").strip()
    pages = body.get("pages") or []   # [{url,text,title?}]
    items = [{"path": p.get("url","page"), "text": p.get("text",""), "title": p.get("title")} for p in pages]
    stats = ingest_texts(cfg, collection, items, tenant=tenant)
    docmap = {"nodes": [{"path": it["path"], "tokens": len((it.get("text") or "").split())} for it in items]}
    return {"ok": True, "collection": collection, "count": stats["count"], "docmap": docmap}
