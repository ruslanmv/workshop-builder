# server/services/crewai_pipeline.py
from __future__ import annotations
from typing import Any, Dict, List

from .events import JobEmitter
from ..config import Settings
from .flows.workshop_flow import WorkshopBuildFlow
from .llms import build_crewai_llm


def _llm_name(llm: Any) -> str:
    # Best-effort model id/name for logs
    for attr in ("model", "model_id", "name"):
        v = getattr(llm, attr, None)
        if v:
            return str(v)
    return "unknown"


def run_job(job_id: str, project: Dict[str, Any], tenant: str, cfg_dict: Dict[str, Any]) -> List[Dict[str, Any]]:
    """RQ job entrypoint (invoked by workers.worker.run_job_worker).

    Instantiates and runs the CrewAI Flow-based pipeline with an explicit LLM,
    streaming progress/log/artifact events via Redis Pub/Sub for SSE.
    """
    cfg = Settings.model_validate(cfg_dict)
    emitter = JobEmitter(cfg, job_id)

    try:
        llm = build_crewai_llm(cfg)
        emitter.log("info", f"Launching CrewAI Flow with LLM={type(llm).__name__}({_llm_name(llm)})")

        flow = WorkshopBuildFlow(
            cfg=cfg,
            emitter=emitter,
            project=project,
            tenant=tenant,
            job_id=job_id,
            llm=llm,   # <- explicitly inject CrewAI LLM for all Agents/Crew to avoid fallback
        )

        result = flow.kickoff()  # Flow returns the last step's output (dict)

        # Prefer authoritative state if available; fall back to last step output.
        artifacts: List[Dict[str, Any]] = []
        if getattr(flow, "state", None) and getattr(flow.state, "artifacts", None):
            artifacts = flow.state.artifacts
        elif isinstance(result, dict):
            artifacts = result.get("artifacts", []) or []

        emitter.done(artifacts=artifacts)
        return artifacts

    except Exception as e:
        # Ensure terminal signal is published for SSE consumers
        emitter.log("error", f"Flow failed: {e!r}")
        emitter.done(ok=False, error=str(e))
        # Re-raise so RQ marks the job as failed, honoring failure_ttl
        raise
