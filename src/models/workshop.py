# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field, computed_field, field_validator, model_validator


class BlockKind(str, Enum):
    theory = "theory"
    lab = "lab"
    break_ = "break"
    other = "other"


class ScheduleBlock(BaseModel):
    """
    A single block within a workshop module.
    """
    title: str
    kind: BlockKind = Field(default=BlockKind.theory)
    minutes: int = Field(default=30, ge=0, le=8 * 60)  # sanity cap: 8 hours
    objectives: Optional[str] = None
    prerequisites: Optional[str] = None

    @field_validator("title")
    @classmethod
    def _not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Block title cannot be empty")
        return v.strip()


class Module(BaseModel):
    """
    A module containing several schedule blocks.
    """
    title: str
    description: Optional[str] = None
    blocks: List[ScheduleBlock] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def _not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Module title cannot be empty")
        return v.strip()

    @computed_field
    @property
    def total_minutes(self) -> int:
        return sum(b.minutes for b in self.blocks)

    @computed_field
    @property
    def theory_minutes(self) -> int:
        return sum(b.minutes for b in self.blocks if b.kind == BlockKind.theory)

    @computed_field
    @property
    def lab_minutes(self) -> int:
        return sum(b.minutes for b in self.blocks if b.kind == BlockKind.lab)

    @computed_field
    @property
    def break_minutes(self) -> int:
        return sum(b.minutes for b in self.blocks if b.kind == BlockKind.break_)


class WorkshopPlan(BaseModel):
    """
    Top-level plan describing the workshop layout.
    """
    title: str = "AI Workshop"
    subtitle: Optional[str] = None
    duration_days: int = Field(default=1, ge=1, le=10)
    day_minutes: int = Field(default=6 * 60, ge=60, le=10 * 60)
    modules: List[Module] = Field(default_factory=list)
    enforce_daily_budget: bool = True

    @field_validator("title")
    @classmethod
    def _title_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Workshop title cannot be empty")
        return v.strip()

    @model_validator(mode="after")
    def _budget_check(self):
        """
        Ensure the sum of module minutes does not exceed total budget
        when enforce_daily_budget=True.
        """
        if not self.enforce_daily_budget:
            return self
        total = sum(m.total_minutes for m in self.modules)
        budget = self.duration_days * self.day_minutes
        if total > budget:
            raise ValueError(
                f"Planned minutes ({total}) exceed budget ({budget}). "
                f"Either reduce content or increase duration/day_minutes."
            )
        return self

    # -------- Summaries --------

    @computed_field
    @property
    def total_minutes(self) -> int:
        return sum(m.total_minutes for m in self.modules)

    @computed_field
    @property
    def theory_minutes(self) -> int:
        return sum(m.theory_minutes for m in self.modules)

    @computed_field
    @property
    def lab_minutes(self) -> int:
        return sum(m.lab_minutes for m in self.modules)

    @computed_field
    @property
    def break_minutes(self) -> int:
        return sum(m.break_minutes for m in self.modules)
