# src/routes/books.py
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations
import json
import textwrap
import uuid
from pathlib import Path
from typing import Any, Dict, Optional
from flask import Blueprint, Response, jsonify, request
from ..config import settings
from ..models.book import BookPlan
from ..models.repo import DocMap
from ..services.planning_service import (
    build_book_plan_from_docmap,
    heuristic_book_skeleton,
)
from ..services.repo_service import build_docmap_from_source
bp = Blueprint("books", __name__, url_prefix="/api/books")
_PLANS_DIR = Path(settings.PROJECT_DIR) / ".plans"
_PLANS_DIR.mkdir(parents=True, exist_ok=True)
def _save_plan(plan: BookPlan) -> str:
    plan_id = f"plan-{uuid.uuid4()}"
    ( _PLANS_DIR / f"{plan_id}.json" ).write_text(
        plan.model_dump_json(indent=2), encoding="utf-8"
    )
    return plan_id
def _load_plan(plan_id: str) -> Optional[BookPlan]:
    fp = _PLANS_DIR / f"{plan_id}.json"
    if not fp.exists():
        return None
    try:
        raw = json.loads(fp.read_text(encoding="utf-8"))
        return BookPlan.model_validate(raw)
    except Exception:
        return None
@bp.post("/plan")
def plan_book():
    """
    Build a draft BookPlan using RAG+heuristics/LLM over a source.
    Body (examples):
      { "source": { "type": "github", "url": "https://github.com/org/repo.git" } }
      { "source": { "type": "local", "path": "/path/to/repo-or-docs" } }
      { "source": { "type": "inline", "text": "# Title\\n..." } }
    Returns:
      {
        "docmap": { ... },
        "plan": { ... },
        "plan_id": "plan-uuid"
      }
    """
    data = request.get_json(force=True, silent=True) or {}
    source = data.get("source") or {}
    if not isinstance(source, dict) or not source.get("type"):
        return jsonify({"error": "source is required (type=github|local|inline|url|pdf|txt)"}), 400
    try:
        docmap: DocMap = build_docmap_from_source(source)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"failed to read source: {e}"}), 500
    # Try LLM-assisted planning; fall back to heuristic if needed
    plan: Optional[BookPlan] = None
    try:
        plan = build_book_plan_from_docmap(docmap)
    except Exception:
        plan = None
    if plan is None:
        plan = heuristic_book_skeleton(docmap)
    plan_id = _save_plan(plan)
    return jsonify(
        {
            "docmap": docmap.model_dump(),
            "plan": plan.model_dump(),
            "plan_id": plan_id,
        }
    )
@bp.get("/preview")
def preview_book():
    """
    Render a lightweight preview of a BookPlan (markdown).
    Query params:
      - plan_id: required. Use the id returned by POST /api/books/plan
      - format:  "markdown" (default) or "text"
      - sections: optional integer limit
    """
    plan_id = request.args.get("plan_id")
    if not plan_id:
        return jsonify({"error": "plan_id is required"}), 400
    plan = _load_plan(plan_id)
    if plan is None:
        return jsonify({"error": f"plan not found: {plan_id}"}), 404
    limit = request.args.get("sections", type=int) or 9999
    fmt = (request.args.get("format") or "markdown").lower()
    # Very lightweight preview renderer (not the final export path)
    parts = [f"# {plan.title or 'Book Draft'}", ""]
    for i, sec in enumerate(plan.sections[:limit], start=1):
        parts.append(f"## {i:02d}. {sec.title}")
        if sec.summary:
            parts.append(textwrap.dedent(sec.summary).strip())
        else:
            parts.append("_(summary TBD)_")
        parts.append("")
    body = "\n".join(parts)
    if fmt == "text":
        body = body.replace("#", "").strip()
    return Response(body, mimetype="text/markdown; charset=utf-8")
