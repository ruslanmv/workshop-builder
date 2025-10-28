# server/services/flows/workshop_flow.py
from __future__ import annotations

import os
from typing import List, Dict, Any
from pydantic import BaseModel, Field

# Flow primitives
from crewai.flow.flow import Flow, listen, start, router, or_  # type: ignore

# Crew primitives
from crewai import Crew, Agent, Task, Process  # type: ignore

# NOTE: this file lives in server/services/flows, so:
# - events/jobs are at the parent level (..)
# - config is at the package root (...config)
from ...config import Settings
from ..events import JobEmitter
from ..jobs import job_dirs


class WorkshopState(BaseModel):
    """Typed flow state to coordinate steps and outputs."""
    phase: str = "init"
    outline: List[str] = Field(default_factory=list)
    confidence: float = 0.0
    recommendations: List[str] = Field(default_factory=list)
    artifacts: List[Dict[str, Any]] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)


class WorkshopBuildFlow(Flow[WorkshopState]):
    """CrewAI Flow for building workshops/books with conditional routing."""

    def __init__(self, cfg: Settings, emitter: JobEmitter, project: Dict[str, Any], tenant: str, job_id: str, llm: Any):
        super().__init__(initial_state=WorkshopState())
        self.cfg = cfg
        self.emitter = emitter
        self.project = project
        self.tenant = tenant
        self.job_id = job_id
        # IMPORTANT: `llm` must be a native CrewAI LLM (e.g., watsonx via LiteLLM),
        # so Agents/Crew won't fallback to OpenAI.
        self.llm = llm

        # Resolve dirs once (creates artifacts dir)
        d = job_dirs(self.cfg, self.tenant, self.job_id)
        self.root_dir = d["root"]
        self.art_dir = d["artifacts"]

    # ---------------------- Utils ----------------------

    def _write_artifact(self, kind: str, label: str, filename: str, content: bytes) -> Dict[str, Any]:
        os.makedirs(self.art_dir, exist_ok=True)
        path = os.path.join(self.art_dir, filename)
        with open(path, "wb") as f:
            f.write(content)
        meta: Dict[str, Any] = {
            "type": kind,
            "label": label,
            "path": path,
            "filename": filename,
            "size": len(content),
        }
        self.state.artifacts.append(meta)
        self.emitter.artifact(meta)
        return meta

    # ---------------------- Flow Steps ----------------------

    @start()
    def bootstrap(self) -> Dict[str, Any]:
        """Gather initial inputs for the crew."""
        self.state.phase = "bootstrap"
        self.emitter.log("info", "Bootstrapping flow")
        self.emitter.progress(5, "Bootstrapping")

        project = self.project or {}
        topic = project.get("name", "Untitled Workshop")
        scope = project.get("scope", "workshop")
        language = project.get("language", "en")
        return {"topic": topic, "scope": scope, "language": language}

    @listen(bootstrap)
    def plan_and_research(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Planner + Researcher crew builds an outline and confidence."""
        self.state.phase = "planning"
        self.emitter.progress(15, "Planning & Research")

        # Define agents (pass native CrewAI LLM via `llm=...`)
        planner = Agent(
            role="Workshop Planner",
            goal="Design a clear, practical workshop outline",
            backstory="You create modular, time-boxed, hands-on learning tracks.",
            llm=self.llm,
        )
        researcher = Agent(
            role="Technical Researcher",
            goal="Gather precise, trustworthy references and examples",
            backstory="You verify facts and extract concise, actionable insights.",
            llm=self.llm,
        )

        # Tasks
        plan_task = Task(
            description="Draft a structured outline for a {topic} {scope} in {language} with modules and learning objectives.",
            expected_output="A bullet list of sections with durations and objectives.",
            agent=planner,
        )
        research_task = Task(
            description="Collect 5-10 high-value references/examples to support the outline.",
            expected_output="Cited references with 1-2 key points each.",
            agent=researcher,
        )

        crew = Crew(
            agents=[planner, researcher],
            tasks=[plan_task, research_task],
            process=Process.sequential,
            verbose=False,
            llm=self.llm,     # ensure no provider fallback inside Crew
            memory=False,     # avoid default OpenAI embedder; enable later with a watsonx embedder if needed
        )

        # Kickoff with named inputs
        result = crew.kickoff(inputs=inputs)

        # Parse outline/confidence (simplified; adapt to your output schema)
        outline: List[str] = []
        if isinstance(result, dict):
            outline = result.get("outline", []) or outline
            try:
                self.state.confidence = float(result.get("confidence", 0.7))
            except Exception:
                self.state.confidence = 0.7

        if not outline:
            # Fallback: split any markdown bullets into an outline
            text = str(result)
            outline = [
                ln.strip("-* ").strip()
                for ln in text.splitlines()
                if ln.strip().startswith(("-", "*"))
            ]

        self.state.outline = outline or ["Introduction", "Core Concepts", "Hands-on Lab", "Review & Next Steps"]
        self.emitter.log("info", f"Outline size: {len(self.state.outline)}; confidence={self.state.confidence:.2f}")
        self.emitter.progress(35, "Outline ready")
        return {"outline": self.state.outline}

    @router(plan_and_research)
    def route_after_plan(self) -> str:
        """Decide whether to proceed or reinforce research."""
        c = self.state.confidence
        if c > 0.8:
            return "high_confidence"
        elif c > 0.6:
            return "medium_confidence"
        return "low_confidence"

    @listen(or_("low_confidence", "medium_confidence"))
    def reinforce_research(self) -> Dict[str, Any]:
        """Optional reinforcement step to improve confidence."""
        self.state.phase = "reinforce"
        self.emitter.progress(45, "Reinforcing with additional research")
        self.state.recommendations.append("Reinforced with extra sources")
        # Naive boost; in practice, launch another crew round
        self.state.confidence = max(self.state.confidence, 0.75)
        return {"confidence": self.state.confidence}

    @listen(or_("high_confidence", "medium_confidence"))
    def write_and_format(self) -> Dict[str, Any]:
        """Writer + Formatter crew generates content and formats export-ready text."""
        self.state.phase = "write"
        self.emitter.progress(65, "Writing content")

        writer = Agent(
            role="Technical Writer",
            goal="Write clear, didactic, hands-on workshop content grounded in sources",
            backstory="You explain complex ideas simply with runnable steps.",
            llm=self.llm,
        )
        formatter = Agent(
            role="Formatter",
            goal="Normalize headings, add front-matter, and ensure consistency",
            backstory="You polish the manuscript for downstream exporters.",
            llm=self.llm,
        )

        write_task = Task(
            description="Write the full workshop content based on the outline: {outline}",
            expected_output="Structured Markdown with sections and labs.",
            agent=writer,
        )
        format_task = Task(
            description="Format the manuscript with front-matter and consistent styles.",
            expected_output="Clean Markdown ready for export (PDF/EPUB/MkDocs).",
            agent=formatter,
        )

        crew = Crew(
            agents=[writer, formatter],
            tasks=[write_task, format_task],
            process=Process.sequential,
            verbose=False,
            llm=self.llm,
            memory=False,
        )
        result = crew.kickoff(inputs={"outline": self.state.outline})

        # Persist a minimal manuscript (replace with your actual content/output)
        manuscript = (str(result) or "# Workshop\n\n").encode("utf-8")
        self._write_artifact("md", "Manuscript", "manuscript.md", manuscript)
        self.emitter.progress(80, "Manuscript ready")
        return {"manuscript_path": os.path.join(self.art_dir, "manuscript.md")}

    @listen(write_and_format)
    def export_artifacts(self, manuscript_info: Dict[str, Any]) -> Dict[str, Any]:
        """Export step (stub). Hook your real exporters here."""
        self.state.phase = "export"
        self.emitter.progress(90, "Exporting artifacts")

        # Replace these stubs with your real PDF/EPUB/MkDocs builders.
        fake_pdf = b"%PDF-1.4\n% minimal demo\n"
        self._write_artifact("pdf", "Print PDF", "print.pdf", fake_pdf)

        fake_epub = b"EPUB-DATA"
        self._write_artifact("epub", "EPUB", "book.epub", fake_epub)

        fake_site = b"ZIPDATA"
        self._write_artifact("mkdocs", "MkDocs Site", "site.zip", fake_site)

        self.emitter.progress(100, "Done")
        return {"artifacts": self.state.artifacts}
