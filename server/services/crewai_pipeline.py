from __future__ import annotations
from typing import Any, Dict, List
import os, time
from ..config import Settings
from .watsonx import build_clients, wx_chat_generate
from .events import JobEmitter
from .jobs import job_dirs, is_cancelled

def _outline_hint(project: Dict[str, Any]) -> str:
    t = (project.get("intent", {}).get("projectType") or "book").lower()
    return {
        "workshop": "Produce a workshop schedule JSON with blocks: theory/lab/break (with minutes).",        "mkdocs": "Propose a site nav JSON (sections/pages) for a MkDocs site.",        "journal": "Outline an IMRaD article with strict word limits.",        "proceedings": "Outline a camera-ready conference paper.",        "blog": "Outline a developer tutorial.",        "book": "Propose a pragmatic ToC with 6–10 chapters.",    }.get(t, "Propose a pragmatic ToC.")

def _check_cancel(cfg: Settings, job_id: str) -> bool:
    return is_cancelled(cfg, job_id)

def run_job(job_id: str, project: Dict[str, Any], tenant: str, cfg_dict: Dict[str, Any]) -> List[Dict[str, Any]]:
    cfg = Settings.model_validate(cfg_dict)
    wx = build_clients(cfg)
    emitter = JobEmitter(cfg, job_id)
    paths = job_dirs(cfg, tenant, job_id)

    def guard():
        return _check_cancel(cfg, job_id)

    # Intake
    if guard(): return []
    time.sleep(0.1)

    emitter.progress(15, "Planning outline")
    hint = _outline_hint(project)
    constraints = project.get("intent",{}).get("constraints","" )
    outline = wx_chat_generate(wx, f"{hint}\nConstraints: {constraints}",
                               system="You are an expert technical editor.",
                               temperature=cfg.CREW_TEMPERATURE)
    emitter.log("info", "Outline proposed.")

    if guard(): return []
    emitter.progress(55, "Writing content"); time.sleep(0.1)

    if guard(): return []
    emitter.progress(75, "Editing & QA"); time.sleep(0.1)

    if guard(): return []
    emitter.progress(90, "Exporting")
    outs = (project.get("intent", {}) or {}).get("outputs", []) or []
    artifacts: List[Dict[str, Any]] = []

    def write_art(aid: str, label: str, name: str, size: int):
        os.makedirs(paths["artifacts"], exist_ok=True)
        fp = os.path.join(paths["artifacts"], name)
        with open(fp, "wb") as f:
            f.write(b"%PDF-1.4 (demo bytes)")
        a = {"id": aid, "label": label, "status": "ready", "href": f"/api/exports/{job_id}/{name}", "bytes": size}
        artifacts.append(a)

    base = (project.get("intent", {}).get("editorialPreset") or "springer").lower()
    if "springer" in outs: write_art(base, f"{base.upper()} PDF", f"{base}.pdf", 12340000); emitter.artifact(artifacts[-1])
    if "epub" in outs:     write_art("epub", "EPUB", "book.epub", 7180000); emitter.artifact(artifacts[-1])
    if "pdf" in outs:      write_art("pdf", "Print PDF", "print.pdf", 15510000); emitter.artifact(artifacts[-1])
    if "mkdocs" in outs:   write_art("mkdocs", "MkDocs Site", "site.zip", 2240000); emitter.artifact(artifacts[-1])

    emitter.progress(100, "Done")
    emitter.done()
    return artifacts
