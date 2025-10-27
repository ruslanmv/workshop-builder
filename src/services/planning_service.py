# SPDX-License-Identifier: Apache-2.0
"""
Planning service (heuristics + optional CrewAI multi-agent path).

- Heuristic outline from a scanned DocMap (works offline).
- Optional CrewAI 2-agent pipeline (Researcher + Writer) using:
    * watsonx via LiteLLM provider for high-quality reasoning
    * Universal A2A RAG tool for repo-scale retrieval (a2a_universal.ext.crew_rag)

Falls back to heuristics automatically if:
- USE_CREWAI != "1"
- crewai or dependencies are not installed
- Watsonx credentials are missing or invalid
"""

from __future__ import annotations

import json
import logging
import os
from typing import List, Optional

from ..models.book import BookPlan, BookSection
from ..models.repo import DocMap
from ..models.workshop import WorkshopPlan, Module, ScheduleBlock
from ..utils.time import hours_to_minutes

log = logging.getLogger("planning")


# ------------------------------- Heuristics -------------------------------


def _slug(title: str) -> str:
    import re

    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def heuristic_book_outline(docmap: DocMap, topic: Optional[str] = None) -> BookPlan:
    """
    Very robust fallback: draft 8–12 sections using first headings or filenames.
    """
    files = list(docmap.files or [])
    # Prefer files under docs/ or manuscript/ if present
    files.sort(key=lambda f: (0 if f.path.startswith("docs/") else 1, f.path))

    sections: List[BookSection] = []
    for f in files[:12]:
        title = f.title or f.path.rsplit("/", 1)[-1].replace(".md", "").replace("_", " ").title()
        sections.append(
            BookSection(
                title=title,
                target_slug=_slug(title),
                sources=[f.path],
                summary=None,
            )
        )

    if not sections:
        sections = [
            BookSection(title="Introduction", target_slug="introduction", sources=[], summary=None),
            BookSection(title="Background", target_slug="background", sources=[], summary=None),
        ]

    return BookPlan(
        title=topic or f"{docmap.repo} — Workshop Book",
        subtitle="Auto-generated draft (heuristic)",
        authors=["Workshop Builder"],
        sections=sections,
    )


def heuristic_workshop_plan(
    docmap: DocMap, total_hours: float = 8.0, theory_ratio: float = 0.6
) -> WorkshopPlan:
    """
    Simple baseline: split into 4 modules; balance theory/lab minutes.
    """
    total_mins = hours_to_minutes(total_hours)
    per_mod = max(30, total_mins // 4)

    modules: List[Module] = []
    for i in range(1, 5):
        theory = int(per_mod * theory_ratio)
        lab = per_mod - theory
        blocks = [
            ScheduleBlock(kind="theory", minutes=theory, title=f"Module {i} Theory"),
            ScheduleBlock(kind="lab", minutes=lab, title=f"Module {i} Lab"),
        ]
        modules.append(Module(title=f"Module {i}", blocks=blocks))

    return WorkshopPlan(
        title=f"{docmap.repo} Workshop",
        duration_minutes=total_mins,
        modules=modules,
    )


# ---------------------------- CrewAI integration ---------------------------


def _crewai_available() -> bool:
    try:
        import crewai  # noqa: F401
        return True
    except Exception as e:
        log.info("CrewAI not available, falling back to heuristics: %s", e)
        return False


def _watsonx_creds() -> Optional[dict]:
    api_key = os.getenv("WATSONX_API_KEY")
    url = os.getenv("WATSONX_URL")
    project_id = os.getenv("WATSONX_PROJECT_ID")
    if all([api_key, url, project_id]):
        return {
            "api_key": api_key,
            "base_url": url,
            "project_id": project_id,
            "model_id": os.getenv("MODEL_ID", "ibm/granite-3-8b-instruct"),
        }
    return None


def _build_crewai_llm_watsonx():
    """Return (LLM, provider_str) or (None, reason)."""
    try:
        from crewai import LLM
    except Exception as e:
        return None, f"CrewAI LLM import failed: {e}"

    creds = _watsonx_creds()
    if not creds:
        return None, "Missing Watsonx credentials"

    try:
        llm = LLM(
            model=f"watsonx/{creds['model_id']}",
            api_key=creds["api_key"],
            base_url=creds["base_url"],
            project_id=creds["project_id"],
            temperature=0.1,
            max_tokens=2048,
        )
        return llm, "watsonx"
    except Exception as e:
        return None, f"LLM init failed: {e}"


def _build_rag_tool(collection: Optional[str]):
    """
    Build a Universal A2A RagTool configured by environment.
    """
    try:
        from a2a_universal.ext.crew_rag import get_rag
        rag_tool = get_rag(collection_name=collection or None)
        return rag_tool
    except Exception as e:
        log.info("RAG tool not available: %s", e)
        return None


def plan_book_with_crewai(
    docmap: DocMap,
    topic: Optional[str] = None,
    collection: Optional[str] = None,
) -> Optional[BookPlan]:
    """
    2-agent Researcher+Writer: produce a JSON outline; return BookPlan or None on failure.
    """
    if os.getenv("USE_CREWAI", "0") != "1":
        return None
    if not _crewai_available():
        return None

    llm, why = _build_crewai_llm_watsonx()
    if llm is None:
        log.info("CrewAI: %s", why)
        return None

    rag_tool = _build_rag_tool(collection)
    tools = [rag_tool] if rag_tool else []

    try:
        from crewai import Agent, Task, Crew
    except Exception as e:
        log.info("CrewAI import error: %s", e)
        return None

    # Agents
    researcher = Agent(
        role="Researcher",
        goal="Produce a precise outline from repository docs and RAG.",
        backstory="You extract structure and key topics from large repos.",
        tools=tools,
        llm=llm,
        allow_delegation=False,
        verbose=False,
    )

    writer = Agent(
        role="Writer",
        goal="Refine the outline into publishable book sections.",
        backstory="Technical writer focusing on clean, concise structure.",
        tools=tools,
        llm=llm,
        allow_delegation=False,
        verbose=False,
    )

    # Tasks
    docmap_json = json.dumps(docmap.model_dump(), ensure_ascii=False)
    t1 = Task(
        description=(
            "Using the RAG tool if helpful, analyze the repository DocMap and propose a JSON outline.\n"
            "Return STRICT JSON with this shape:\n"
            "{ 'title': str, 'subtitle': str, 'sections': [ {'title': str, 'sources': [str]} ] }\n"
            "Prefer sources that exist in the DocMap. Topic hint: "
            f"{topic or 'N/A'}\n"
        ),
        expected_output="Valid JSON only. No prose, no markdown, just JSON.",
        agent=researcher,
        context=[docmap_json],
    )

    t2 = Task(
        description=(
            "Refine the outline into well-named sections that could compile in LaTeX/MkDocs.\n"
            "Return STRICT JSON with keys title, subtitle, and sections (same shape)."
        ),
        expected_output="Valid JSON only.",
        agent=writer,
        context=[t1],
    )

    crew = Crew(agents=[researcher, writer], tasks=[t1, t2], verbose=False)

    try:
        result = str(crew.kickoff())
    except Exception as e:
        log.warning("CrewAI run failed: %s", e)
        return None

    try:
        data = json.loads(result)
    except Exception:
        # Some crew versions wrap result; attempt to extract JSON
        try:
            start = result.find("{")
            end = result.rfind("}")
            data = json.loads(result[start : end + 1])
        except Exception as e:
            log.warning("CrewAI JSON parse failed: %s", e)
            return None

    # Build BookPlan
    title = (data.get("title") or topic or f"{docmap.repo} — Workshop Book").strip()
    subtitle = (data.get("subtitle") or "Generated by CrewAI").strip()

    sections: List[BookSection] = []
    for s in data.get("sections", []) or []:
        stitle = str(s.get("title") or "").strip() or "Untitled"
        srcs = [str(x) for x in (s.get("sources") or []) if isinstance(x, str)]
        sections.append(BookSection(title=stitle, target_slug=_slug(stitle), sources=srcs, summary=None))

    if not sections:
        return None

    return BookPlan(title=title, subtitle=subtitle, authors=["Workshop Builder"], sections=sections)


# ------------------------------- Public API -------------------------------


def plan_book(
    docmap: DocMap,
    topic: Optional[str] = None,
    collection: Optional[str] = None,
) -> BookPlan:
    """
    Try CrewAI plan first (if enabled), else heuristics.
    """
    bp = plan_book_with_crewai(docmap, topic=topic, collection=collection)
    if bp:
        return bp
    return heuristic_book_outline(docmap, topic)


def plan_workshop(
    docmap: DocMap,
    total_hours: float = 8.0,
    theory_ratio: float = 0.6,
) -> WorkshopPlan:
    """
    Right now heuristic only; Crew orchestration for workshops can be added similarly.
    """
    return heuristic_workshop_plan(docmap, total_hours=total_hours, theory_ratio=theory_ratio)
