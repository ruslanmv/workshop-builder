# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from dataclasses import replace
from typing import Dict, List, Tuple

from ..models.workshop import Module, ScheduleBlock, WorkshopPlan

import logging

log = logging.getLogger("workshop.services.schedule")


def summarize_minutes(plan: WorkshopPlan) -> Dict[str, int]:
    """
    Compute aggregate minute totals across the entire plan.
    """
    t_theory = t_lab = t_break = 0
    for m in plan.modules:
        for b in m.blocks:
            if b.kind == "theory":
                t_theory += b.minutes
            elif b.kind == "lab":
                t_lab += b.minutes
            elif b.kind == "break":
                t_break += b.minutes
    return {
        "total_minutes": t_theory + t_lab + t_break,
        "theory_minutes": t_theory,
        "lab_minutes": t_lab,
        "break_minutes": t_break,
        "budget_minutes": plan.duration_days * plan.day_minutes,
    }


def _scale_block_minutes(blocks: List[ScheduleBlock], scale: float) -> List[ScheduleBlock]:
    """
    Proportionally scale non-break blocks by 'scale' and round to whole minutes.
    Breaks remain unchanged (you can change this policy if desired).
    """
    out: List[ScheduleBlock] = []
    for b in blocks:
        if b.kind in ("theory", "lab"):
            new_m = max(1, int(round(b.minutes * scale)))
            out.append(replace(b, minutes=new_m))
        else:
            out.append(b)
    return out


def _cap_daily_budget(blocks: List[ScheduleBlock], day_budget: int) -> List[ScheduleBlock]:
    """
    Sequentially cap blocks so their sum doesn't exceed the daily budget.
    Breaks are included in the budget.
    """
    total = 0
    out: List[ScheduleBlock] = []
    for b in blocks:
        remaining = day_budget - total
        if remaining <= 0:
            break
        use = min(b.minutes, remaining)
        out.append(replace(b, minutes=use))
        total += use
    return out


def normalize(plan: WorkshopPlan, enforce_budget: bool | None = None) -> WorkshopPlan:
    """
    Return a normalized plan:
    - optionally enforce total budget across all days
    - ensure no negative or zero-length theory/lab blocks
    """
    enforce = plan.enforce_daily_budget if enforce_budget is None else enforce_budget
    blocks: List[ScheduleBlock] = [b for m in plan.modules for b in m.blocks]

    # Remove non-positive time blocks defensively
    clean: List[ScheduleBlock] = []
    for b in blocks:
        if b.minutes <= 0 and b.kind in ("theory", "lab"):
            continue
        clean.append(b)

    if not enforce:
        # Recompose into modules with cleaned blocks (original grouping preserved)
        idx = 0
        new_modules: List[Module] = []
        for m in plan.modules:
            count = len(m.blocks)
            new_modules.append(replace(m, blocks=clean[idx : idx + count]))
            idx += count
        return replace(plan, modules=new_modules)

    # Enforce overall budget (duration_days * day_minutes)
    totals = summarize_minutes(plan)
    budget = totals["budget_minutes"]
    current = totals["total_minutes"]
    if current <= 0:
        return plan

    if current > budget:
        scale = budget / current
        scaled_blocks = _scale_block_minutes(clean, scale=scale)
    else:
        scaled_blocks = clean

    # Now cap per-day budget by walking the sequence
    per_day = plan.day_minutes
    day_chunks: List[List[ScheduleBlock]] = []
    i = 0
    remaining = list(scaled_blocks)
    for _ in range(plan.duration_days):
        chunk = _cap_daily_budget(remaining, per_day)
        day_chunks.append(chunk)
        # advance pointer by consumed count
        consumed = len(chunk)
        remaining = remaining[consumed:]

    # Flatten back; if anything remains after all days, drop it
    normalized_blocks = [b for day in day_chunks for b in day]

    # Recompose into modules with same original cardinality (approx)
    idx = 0
    new_modules: List[Module] = []
    for m in plan.modules:
        cnt = min(len(m.blocks), len(normalized_blocks) - idx)
        new_modules.append(replace(m, blocks=normalized_blocks[idx : idx + cnt]))
        idx += cnt

    log.info("Plan normalized", extra={"scaled_from": current, "budget": budget, "final": sum(b.minutes for b in normalized_blocks)})
    return replace(plan, modules=new_modules)
