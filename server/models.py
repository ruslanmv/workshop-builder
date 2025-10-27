from __future__ import annotations
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

ProjectType = Literal["book","workshop","mkdocs","journal","proceedings","blog"]
OutputFormat = Literal["springer","epub","pdf","mkdocs"]
EditorialPreset = Literal["springer","oxford","acm","ieee"]

class IntakeData(BaseModel):
    collection: Optional[str] = None
    lastIngest: Optional[Any] = None
    docmap: Optional[Any] = None

class IntentData(BaseModel):
    projectType: Optional[ProjectType] = None
    outputs: List[OutputFormat] = Field(default_factory=list)
    title: Optional[str] = None
    subtitle: Optional[str] = None
    authors: Optional[List[str]] = None
    audience: Optional[str] = None
    tone: Optional[str] = None
    constraints: Optional[str] = None
    due: Optional[str] = None
    editorialPreset: Optional[EditorialPreset] = None

class OutlineData(BaseModel):
    plan: Optional[Any] = None
    scheduleJson: Optional[Any] = None
    approved: Optional[bool] = None

class Project(BaseModel):
    id: str
    name: str
    createdAt: int
    intake: IntakeData
    intent: IntentData
    outline: OutlineData

class StartJobRequest(BaseModel):
    project: Project

class StartJobResponse(BaseModel):
    ok: bool = True
    job_id: str
    stream: str

class Artifact(BaseModel):
    id: Literal["springer","oxford","acm","ieee","epub","pdf","mkdocs"]
    label: str
    status: Literal["pending","ready","failed"]
    href: Optional[str] = None
    bytes: Optional[int] = None
    meta: Optional[Dict[str, Any]] = None
