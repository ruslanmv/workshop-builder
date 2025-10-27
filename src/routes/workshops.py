# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import logging
from typing import Any, Dict, List

from flask import Blueprint, jsonify, request

from ..models.workshop import WorkshopPlan, Module
from ..services.planning_service import plan_workshop
from ..utils.time import minutes_to_hours_str

bp = Blueprint("workshops", __name__, url_prefix="/api/workshops")
log = logging.getLogger("routes.workshops")


@bp.post("/plan")
def plan() -> Any:
    """
    POST /api/workshops/plan
    Body: { "docmap": {...}, "total_hours": 8.0, "theory_ratio": 0.6 }
    Returns: WorkshopPlan dict with computed duration
    """
    payload: Dict[str, Any] = request.get_json(force=True) or {}
    docmap = payload.get("docmap")
    if not isinstance(docmap, dict):
        return jsonify({"error": "docmap is required"}), 400

    from ..models.repo import DocMap  # lazy to avoid circulars
    try:
        dm = DocMap.model_validate(docmap)
    except Exception as e:
        return jsonify({"error": f"invalid docmap: {e}"}), 400

    total_hours = float(payload.get("total_hours", 8.0))
    theory_ratio = float(payload.get("theory_ratio", 0.6))

    plan_obj = plan_workshop(dm, total_hours=total_hours, theory_ratio=theory_ratio)
    return jsonify(plan_obj.model_dump())


@bp.get("/preview")
def preview() -> Any:
    """
    GET /api/workshops/preview
    Query:
      plan=<urlencoded JSON of WorkshopPlan>
    Returns totals per module and overall summary, without mutating plan.
    """
    plan_str = request.args.get("plan", "").strip()
    if not plan_str:
        return jsonify({"error": "plan query parameter (JSON) is required"}), 400

    try:
        import json

        plan_json = json.loads(plan_str)
    except Exception as e:
        return jsonify({"error": f"invalid plan JSON: {e}"}), 400

    try:
        plan_obj = WorkshopPlan.model_validate(plan_json)
    except Exception as e:
        return jsonify({"error": f"invalid WorkshopPlan: {e}"}), 400

    per_module: List[Dict[str, Any]] = []
    total = {"theory": 0, "lab": 0, "break": 0, "other": 0, "total": 0}

    for m in plan_obj.modules or []:
        assert isinstance(m, Module)
        sums = {"theory": 0, "lab": 0, "break": 0, "other": 0}
        for b in m.blocks or []:
            kind = (b.kind or "other").lower()
            mins = int(b.minutes or 0)
            if kind in sums:
                sums[kind] += mins
            else:
                sums["other"] += mins
        mod_total = sum(sums.values())
        per_module.append(
            {
                "title": m.title,
                "theory": sums["theory"],
                "lab": sums["lab"],
                "break": sums["break"],
                "other": sums["other"],
                "total": mod_total,
                "total_h": minutes_to_hours_str(mod_total),
            }
        )
        total["theory"] += sums["theory"]
        total["lab"] += sums["lab"]
        total["break"] += sums["break"]
        total["other"] += sums["other"]
        total["total"] += mod_total

    total_h = minutes_to_hours_str(total["total"])
    return jsonify({"modules": per_module, "summary": {**total, "total_h": total_h}})
