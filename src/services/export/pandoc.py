# src/services/export/pandoc.py
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import shutil
import subprocess
import textwrap
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional

from ...models.book import BookPlan, BookSection  # type: ignore
from ...utils.fs import safe_filename  # type avoid


@dataclass(frozen=True)
class PandocCheck:
    pandoc: str
    xelatex: Optional[str]


def _which_or_raise(cmd: str) -> str:
    path = shutil.which(cmd)
    if not path:
        raise RuntimeError(
            f"Required tool '{cmd}' was not found on PATH. "
            f"Install it and try again."
        )
    return path


def _check_tools(require_xelatex: bool = False) -> PandocCheck:
    pandoc = _which_or_raise("pandoc")
    xelatex = shutil.which("xelatex") if require_xelatex else None
    if require_xelatex and not xelatex:
        raise RuntimeError(
            "PDF export requires 'xelatex' on PATH (TeX distribution). "
            "Install TeX Live or MacTeX, ensure 'xelatex' is available."
        )
    return PandocCheck(pandoc=pandoc, xelatex=xelatex)


def _normalize_authors(obj: object) -> List[str]:
    if obj is None:
        return []
    if isinstance(obj, (list, tuple)):
        return [str(a).strip() for a in obj if str(a).strip()]
    s = str(obj).strip()
    return [s] if s else []


def _section_body(sec: BookSection) -> str:
    # Best-effort extraction of section body from various fields
    for attr in ("content", "body", "text", "markdown", "md", "summary"):
        if hasattr(sec, attr):
            val = getattr(sec, attr)
            if isinstance(val, str) and val.strip():
                return val.strip()
    return ""


def _write_markdown_bundle(plan: BookPlan, work_dir: Path) -> Path:
    """
    Create a single Markdown file combining all sections.
    Includes YAML metadata block compatible with Pandoc.
    """
    work_dir.mkdir(parents=True, exist_ok=True)
    title = getattr(plan, "title", None) or "Untitled Book"
    authors = _normalize_authors(getattr(plan, "authors", None))

    meta_lines = ["---", f'title: "{title}"']
    if authors:
        if len(authors) == 1:
            meta_lines.append(f'author: "{authors[0]}"')
        else:
            meta_lines.append("author:")
            meta_lines.extend([f'  - "{a}"' for a in authors])
    meta_lines.append("lang: en")
    meta_lines.append("...")

    parts: List[str] = ["\n".join(meta_lines), ""]

    # Optional front matter
    if getattr(plan, "subtitle", None):
        parts.append(f"_{getattr(plan, 'subtitle')}_\n")

    sections: Iterable[BookSection] = getattr(plan, "sections", []) or []
    for i, sec in enumerate(sections, start=1):
        heading = getattr(sec, "title", None) or f"Section {i}"
        parts.append(f"# {heading}\n")
        body = _section_body(sec)
        if not body:
            body = "_(content to be written)_"
        parts.append(body.strip())
        parts.append("")  # blank line

    md_path = work_dir / "book_bundle.md"
    md_path.write_text("\n".join(parts).strip() + "\n", encoding="utf-8")
    return md_path


def _run(cmd: List[str], cwd: Optional[Path] = None) -> None:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"Command failed ({proc.returncode}):\n$ {' '.join(cmd)}\n\n{proc.stdout}"
        )


def export_epub(plan: BookPlan, out_dir: Path, file_name: Optional[str] = None) -> Path:
    """
    Build an EPUB via Pandoc.
    Returns the absolute path to the generated .epub.
    """
    check = _check_tools(require_xelatex=False)

    out_dir = out_dir.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    work_dir = out_dir / ".pandoc_epub_tmp"
    if work_dir.exists():
        shutil.rmtree(work_dir, ignore_errors=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    bundle = _write_markdown_bundle(plan, work_dir)

    title = getattr(plan, "title", None) or "book"
    base = safe_filename(file_name or f"{title}.epub")
    out_path = out_dir / base

    # Cover & CSS are optional enhancements; skip if not provided
    args = [
        check.pandoc,
        str(bundle),
        "--to=epub",
        "--output", str(out_path),
        "--toc",
        "--embed-resources",
    ]
    _run(args)
    return out_path


def export_pdf(plan: BookPlan, out_dir: Path, file_name: Optional[str] = None) -> Path:
    """
    Build a PDF via Pandoc -> xelatex.
    Returns the absolute path to the generated .pdf.
    """
    check = _check_tools(require_xelatex=True)

    out_dir = out_dir.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    work_dir = out_dir / ".pandoc_pdf_tmp"
    if work_dir.exists():
        shutil.rmtree(work_dir, ignore_errors=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    bundle = _write_markdown_bundle(plan, work_dir)

    title = getattr(plan, "title", None) or "book"
    base = safe_filename(file_name or f"{title}.pdf")
    out_path = out_dir / base

    # A minimal but solid set of flags for decent typography
    args = [
        check.pandoc,
        str(bundle),
        "--pdf-engine=xelatex",
        "--from=markdown+yaml_metadata_block",
        "--toc",
        "--output", str(out_path),
        # Better defaults; users can override in future with custom templates
        "--variable", "mainfont=Latin Modern Roman",
        "--variable", "geometry:margin=1in",
    ]
    _run(args)
    return out_path
