# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class RepoFile(BaseModel):
    """
    A single repository file that may be used for planning and ingestion.
    """
    path: str
    title: Optional[str] = Field(
        default=None, description="First markdown heading or inferred title"
    )
    size: int = Field(ge=0)
    sha256: str = Field(description="Content hash for change detection")
    media_type: str = Field(
        default="text/markdown", description="MIME-like string (e.g., text/markdown)"
    )

    model_config = {"extra": "ignore"}


class DocMap(BaseModel):
    """
    Repository mapping discovered by a scanner (e.g., Git clone or local dir).
    """
    repo_name: str
    repo_url: Optional[str] = None
    ref: Optional[str] = Field(default=None, description="Branch or tag")
    commit: str = Field(default="unknown", description="Commit SHA if known")
    files: List[RepoFile] = Field(default_factory=list)

    model_config = {"extra": "ignore"}
