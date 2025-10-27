# src/routes/exports.py
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations
import json
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from flask import Blueprint, jsonify, request
from ..config import settings
from ..models.book import BookPlan
bp = Blueprint("exports", __name__, url_prefix="/api/exports")
_EXPORTS_DIR = Path(settings.PROJECT_DIR) / "exports"
_EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
def _load_plan_from_payload(payload: Dict) -> Optional[BookPlan]:
    """Accept either embedded plan or plan_id that points to .plans/plan_id.json."""
    # Embedded plan
    if "plan" in payload and isinstance(payload["plan"], dict):
        try:
            return BookPlan.model_validate(payload["plan"])
        except Exception:
            pass
    # plan_id reference (shared with /api/books/preview)
    plans_dir = Path(settings.PROJECT_DIR) / ".plans"
    pid = str(payload.get("plan_id") or "")
    if pid:
        fp = plans_dir / f"{pid}.json"
        if fp.exists():
            try:
                raw = json.loads(fp.read_text(encoding="utf-8"))
                return BookPlan.model_validate(raw)
            except Exception:
                return None
    return None
def _ensure_outdir(root: Optional[str]) -> Path:
    if root:
        out = Path(root).expanduser().resolve()
    else:
        out = _EXPORTS_DIR / f"run-{uuid.uuid4()}"
    out.mkdir(parents=True, exist_ok=True)
    return out
def _try_import_exporters():
    """
    Import exporters lazily; return (pandoc_mod, springer_mod).
    Each may be None if not installed. Routes handle graceful fallbacks.
    """
    pandoc_mod = None
    springer_mod = None
    try:
        from ..services.export import pandoc as _pandoc  # type: ignore
        pandoc_mod = _pandoc
    except Exception:
        pandoc_mod = None
    try:
        from ..services.export import springer_latex as _springer  # type: ignore
        springer_mod = _springer
    except Exception:
        springer_mod = None
    return pandoc_mod, springer_mod
@bp.post("")
def export_book():
    """
    Export a BookPlan into one or more formats.
    Body:
      {
        "plan_id": "plan-uuid" | null,
        "plan": { ...BookPlan... } | null,
        "formats": ["epub","pdf","springer"],   # at least one required
        "out_dir": "/abs/output/dir"            # optional; default: PROJECT/exports/run-UUID
      }
    Returns:
      {
        "out_dir": "/abs/dir",
        "artifacts": [
          {"format":"epub","path":"/abs/dir/book.epub","ok":true},
          {"format":"pdf","path":"/abs/dir/book.pdf","ok":true},
          {"format":"springer","path":"/abs/dir/build/main.pdf","ok":true}
        ],
        "warnings": ["..."]
      }
    """
    data = request.get_json(force=True, silent=True) or {}
    fmts: List[str] = [f.strip().lower() for f in (data.get("formats") or []) if f and str(f).strip()]
    if not fmts:
        return jsonify({"error": "formats array is required (e.g., ['epub','pdf','springer'])"}), 400
    plan = _load_plan_from_payload(data)
    if plan is None:
        return jsonify({"error": "missing or invalid plan / plan_id"}), 400
    out_dir = _ensure_outdir(data.get("out_dir"))
    pandoc, springer = _try_import_exporters()
    artifacts: List[Dict[str, object]] = []
    warnings: List[str] = []
    # Normalize title -> filesystem-friendly
    base_name = (plan.slug or "book").strip() or "book"
    if "epub" in fmts:
        if pandoc and hasattr(pandoc, "export_epub"):
            try:
                epub_path = pandoc.export_epub(plan, out_dir, file_name=f"{base_name}.epub")
                artifacts.append({"format": "epub", "path": str(epub_path), "ok": True})
            except Exception as e:
                artifacts.append({"format": "epub", "path": str(out_dir / f"{base_name}.epub"), "ok": False, "error": str(e)})
        else:
            warnings.append("EPUB export unavailable (pandoc exporter not installed)")
    if "pdf" in fmts:
        if pandoc and hasattr(pandoc, "export_pdf"):
            try:
                pdf_path = pandoc.export_pdf(plan, out_dir, file_name=f"{base_name}.pdf")
                artifacts.append({"format": "pdf", "path": str(pdf_path), "ok": True})
            except Exception as e:
                artifacts.append({"format": "pdf", "path": str(out_dir / f"{base_name}.pdf"), "ok": False, "error": str(e)})
        else:
            warnings.append("PDF export via pandoc unavailable (pandoc exporter not installed)")
    if "springer" in fmts:
        if springer and hasattr(springer, "export_springer"):
            try:
                spath = springer.export_springer(plan, out_dir)  # expected to build LaTeX and compile
                artifacts.append({"format": "springer", "path": str(spath), "ok": True})
            except Exception as e:
                artifacts.append({"format": "springer", "path": str(out_dir / "springer"), "ok": False, "error": str(e)})
        else:
            warnings.append("Springer LaTeX export unavailable (springer exporter not installed)")
    if not artifacts and warnings:
        return jsonify({"error": "no exporters available", "warnings": warnings}), 501
    return jsonify({"out_dir": str(out_dir), "artifacts": artifacts, "warnings": warnings})
