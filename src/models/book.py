# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field, computed_field, field_validator


class BookFormat(str, Enum):
    epub = "epub"
    pdf = "pdf"
    springer = "springer"  # LaTeX build targeting Springer format


class BookSection(BaseModel):
    """
    A section/chapter of the book; maps to a target file path in the manuscript.
    """
    title: str
    target_path: str = Field(
        description="Relative path where the section will be written (e.g., manuscript/chapters/01-intro.md)"
    )
    sources: List[str] = Field(
        default_factory=list,
        description="Source file paths or identifiers used to generate this section",
    )
    summary: Optional[str] = None

    @field_validator("title", "target_path")
    @classmethod
    def _not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Field cannot be empty")
        return v.strip()


class ExportOptions(BaseModel):
    """
    Export configuration (used for rendering).
    """
    formats: List[BookFormat] = Field(default_factory=lambda: [BookFormat.epub, BookFormat.pdf])
    output_dir: str = Field(default="build/book")
    springer_template_dir: Optional[str] = Field(
        default=None, description="Custom template dir for Springer LaTeX"
    )
    pdf_engine: str = Field(default="xelxtex")
    epub_cover_path: Optional[str] = None


class BookPlan(BaseModel):
    """
    Full book plan: metadata + chapter/lab lists. Compatible with Workshop Planner outputs.
    """
    title: str = "Workshop Book"
    subtitle: Optional[str] = None
    authors: List[str] = Field(default_factory=list)
    isbn: Optional[str] = None
    # Keep both sets for flexibility (some flows separate labs in the book)
    chapters: List[BookSection] = Field(default_factory=list)
    labs: List[BookSection] = Field(default_factory=list)
    # Export options are provided at export-time; default shown here
    default_export: ExportOptions = Field(default_factory=ExportOptions)

    @computed_field
    @property
    def section_count(self) -> int:
        return len(self.chapters) + len(self.labs)

    @field_validator("authors", mode="before")
    @classmethod
    def _strip_authors(cls, v):
        if not v:
            return []
        return [str(a).strip() for a in v if str(a).strip()]
