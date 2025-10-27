# tests/test_planner.py
from __future__ import annotations
from src.models.repo import DocMap, RepoFile
from src.services.planning_service import plan_from_docmap

def test_plan_from_docmap_minimal():
    dm = DocMap(repo="demo", files=[
        RepoFile(path="README.md", title="Intro", size=10, sha256="x", mediaType="text/markdown"),
        RepoFile(path="docs/overview/quick_start.md", title="Quickstart", size=10, sha256="y", mediaType="text/markdown"),
    ])
    book, ws = plan_from_docmap(dm)
    assert len(book.sections) >= 1
    assert ws.title
