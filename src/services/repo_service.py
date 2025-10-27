# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import requests

from ..models.repo import DocMap, RepoFile

# Direct module logger
import logging

log = logging.getLogger("workshop.services.repo")

_SKIP_DIRS = {".git", ".svn", ".hg", "node_modules", ".venv", "venv", "__pycache__", "site", "build", "dist"}


# ------------------------------ Git helpers ------------------------------


def _safe_git_url(url: str) -> str:
    s = url.strip()
    if not (s.startswith("https://") or s.startswith("http://") or s.startswith("git@")):
        raise ValueError("Only https/http/ssh Git URLs are allowed.")
    if any(token in s for token in (";", "&&", "|", "$(", "`")):
        raise ValueError("Unsafe characters detected in Git URL.")
    return s


def _slugify_repo(url: str) -> str:
    base = url.strip().rstrip("/").split("/")[-1]
    if base.endswith(".git"):
        base = base[:-4]
    return re.sub(r"[^a-zA-Z0-9._-]", "-", base).lower()


def clone_or_refresh(github_url: str, dest_root: Path) -> Path:
    """
    Shallow clone or refresh a repository in dest_root.
    Returns the repository directory path.
    """
    git = _safe_git_url(github_url)
    dest_root.mkdir(parents=True, exist_ok=True)
    target = dest_root / _slugify_repo(git)

    if target.exists():
        log.info("Refreshing repo", extra={"path": str(target)})
        subprocess.run(["git", "-C", str(target), "fetch", "--all", "--depth", "1"], check=True)
        # Reset to default branch HEAD
        subprocess.run(["git", "-C", str(target), "reset", "--hard", "origin/HEAD"], check=True)
    else:
        log.info("Cloning repo", extra={"url": git, "dest": str(target)})
        subprocess.run(["git", "clone", "--depth", "1", git, str(target)], check=True)

    return target


# ------------------------------ Path helpers ------------------------------


def resolve_local_path(raw: str) -> Path:
    p = Path(raw).expanduser().resolve()
    if not p.exists():
        raise FileNotFoundError(f"Path not found: {p}")
    return p


def download_to_temp(url: str, dest_root: Path) -> Path:
    """
    Download a file into dest_root and return the local Path.
    Supports large files (streamed). Infers filename from Content-Disposition or URL.
    """
    dest_root.mkdir(parents=True, exist_ok=True)
    headers = {"User-Agent": "workshop-builder/1.0 (+ingest)"}
    with requests.get(url, stream=True, timeout=60, headers=headers) as r:
        r.raise_for_status()
        cd = r.headers.get("content-disposition", "") or ""
        name = None
        if "filename=" in cd:
            # poor-man's parse
            name = cd.split("filename=", 1)[1].strip().strip('"\' ')
        if not name:
            name = url.rstrip("/").split("/")[-1] or "download.bin"
        tmp = dest_root / name
        with tmp.open("wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        log.info("Downloaded file", extra={"url": url, "path": str(tmp), "size": tmp.stat().st_size})
        return tmp


def stage_inline_text(text: str, dest_root: Path, filename: str = "inline_ingest.md") -> Path:
    dest_root.mkdir(parents=True, exist_ok=True)
    p = dest_root / filename
    p.write_text(text, encoding="utf-8")
    return p


# ------------------------------ Scan helpers ------------------------------


def _sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _first_heading(p: Path) -> Optional[str]:
    try:
        with p.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.lstrip().startswith("#"):
                    return line.strip().lstrip("#").strip()
    except Exception:
        pass
    return None


def _git_commit(dir_path: Path) -> str:
    try:
        out = subprocess.check_output(["git", "-C", str(dir_path), "rev-parse", "HEAD"], text=True)
        return out.strip()
    except Exception:
        return "unknown"


def scan_markdown(repo_dir: Path, repo_url: Optional[str] = None) -> DocMap:
    """
    Recursively list markdown files for DocMap.
    """
    files: list[RepoFile] = []
    for p in repo_dir.rglob("*.md"):
        # Skip hidden/system dirs
        if any(seg in _SKIP_DIRS for seg in p.parts):
            continue
        rel = p.relative_to(repo_dir).as_posix()
        files.append(
            RepoFile(
                path=rel,
                title=_first_heading(p),
                size=p.stat().st_size,
                sha256=_sha256_file(p),
                mediaType="text/markdown",
            )
        )
    return DocMap(repo=repo_url or repo_dir.name, commit=_git_commit(repo_dir), files=files)


def scan_single_text(path: Path) -> DocMap:
    """
    Turn a single .md/.txt file into a one-file DocMap (best effort).
    """
    title = _first_heading(path)
    if not title:
        try:
            # derive from first non-empty line
            with path.open("r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if line.strip():
                        title = line.strip()[:80]
                        break
        except Exception:
            title = path.name

    rf = RepoFile(
        path=path.name,
        title=title or path.stem,
        size=path.stat().st_size,
        sha256=_sha256_file(path),
        mediaType="text/plain" if path.suffix.lower() == ".txt" else "text/markdown",
    )
    return DocMap(repo="local-file", commit="unknown", files=[rf])


# ------------------------------ Temp workspace ------------------------------


def temp_workspace(prefix: str = "wsb_") -> Path:
    """
    Create and return a temporary workspace path (caller is responsible for cleanup).
    """
    p = Path(tempfile.mkdtemp(prefix=prefix))
    log.debug("Created temp workspace", extra={"path": str(p)})
    return p


def cleanup_path(path: Path) -> None:
    try:
        shutil.rmtree(path, ignore_errors=True)
    except Exception:
        pass
