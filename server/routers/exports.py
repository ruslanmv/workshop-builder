from __future__ import annotations
import os
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse
from ..config import Settings
from ..security import require_auth, get_tenant_id

router = APIRouter(prefix="/api", tags=["exports"], dependencies=[Depends(require_auth)])

@router.get("/exports/{job_id}")
def list_artifacts(job_id: str, tenant: str = Depends(get_tenant_id)):
    cfg = Settings()
    aroot = os.path.join(cfg.JOBS_DIR, tenant, job_id, "artifacts")
    if not os.path.exists(aroot):
        return {"ok": True, "artifacts": []}
    items = []
    for fn in os.listdir(aroot):
        fp = os.path.join(aroot, fn)
        if os.path.isfile(fp):
            items.append({"id": fn.rsplit(".",1)[0], "label": fn, "href": f"/api/exports/{job_id}/{fn}", "bytes": os.path.getsize(fp)})
    return {"ok": True, "artifacts": items}

@router.get("/exports/{job_id}/{filename:path}")
def download(job_id: str, filename: str, tenant: str = Depends(get_tenant_id)):
    cfg = Settings()
    path = os.path.join(cfg.JOBS_DIR, tenant, job_id, "artifacts", filename)
    if not os.path.exists(path):
        raise HTTPException(404, "file not found")
    return FileResponse(path, filename=filename)
