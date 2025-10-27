# SPDX-License-Identifier: Apache-2.0
"""
Content ingestion pipeline (production-ready, optional niceties)

Responsibilities
----------------
- Normalize mixed inputs (local file/dir, inline text, URL, PDF, HTML, TXT)
- Convert PDFs to plain text (best-effort) using `pypdf`
- Convert HTML to Markdown using `markdownify` (fallback to BeautifulSoup get_text)
- Stage normalized .md/.txt files into a temp (or provided) directory
- Call Universal A2A /knowledge ingest via rag_service

Typical usage
-------------
pipeline = IngestPipeline(staging_dir=Path("/tmp/stage"))
paths = pipeline.normalize_inputs([
    {"source": "url", "url": "https://example.com/blog.html"},
    {"source": "pdf", "path": "/files/paper.pdf"},
    {"source": "inline", "name": "notes.md", "content": "# Title\n..."},
])
pipeline.feed_rag(
    base_url=settings.A2A_BASE,
    paths=paths,
    collection="workshop_docs",
    chunk_size=1400,
    chunk_overlap=160,
    include_ext=[".md", ".txt"],
    exclude_ext=[".png",".jpg",".pdf"],
)

Notes
-----
- This module is optional; basic /ingest can still call rag_service directly
  for repo and local directory ingestion.
- Dependencies: pypdf, markdownify, requests, beautifulsoup4 (fallback)
"""

from __future__ import annotations

import mimetypes
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Tuple, Union

import logging

try:
    import requests
except Exception as _e:
    requests = None  # type: ignore

# PDF
try:
    from pypdf import PdfReader  # type: ignore
except Exception:  # pragma: no cover
    PdfReader = None  # type: ignore

# HTML -> Markdown
try:
    from markdownify import markdownify as md_to_md  # type: ignore
except Exception:  # pragma: no cover
    md_to_md = None  # type: ignore

try:
    from bs4 import BeautifulSoup  # type: ignore
except Exception:  # pragma: no cover
    BeautifulSoup = None  # type: ignore

from ..utils.fs import safe_filename, ensure_dir
from ..services import rag_service


log = logging.getLogger("ingest.pipeline")


@dataclass(frozen=True)
class NormalizedItem:
    """Represents a single staged file on disk (text/markdown)."""
    path: Path
    media_type: str  # e.g., text/markdown, text/plain


def _guess_media_type(p: Path) -> str:
    t, _ = mimetypes.guess_type(str(p))
    if t:
        return t
    # heuristic
    if p.suffix.lower() in {".md", ".markdown"}:
        return "text/markdown"
    return "text/plain"


def _coerce_md(text: str) -> str:
    # Normalize CRLF, strip trailing whitespace, ensure final newline
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # collapse too many blank lines
    text = re.sub(r"\n{4,}", "\n\n", text)
    text = text.strip() + "\n"
    return text


class IngestPipeline:
    """
    Normalize content and push to the RAG index.

    The pipeline writes normalized files into `staging_dir` so that the
    A2A server (which might be in Docker) can access them, assuming the
    directory is visible from the server.
    """

    def __init__(self, staging_dir: Optional[Path] = None) -> None:
        if staging_dir is None:
            self.staging_dir = Path(tempfile.mkdtemp(prefix="wb_ingest_")).resolve()
        else:
            self.staging_dir = staging_dir.expanduser().resolve()
            ensure_dir(self.staging_dir)
        log.info("Ingest pipeline staging dir: %s", self.staging_dir)

    # ------------------------- Staging helpers -------------------------

    def _stage_text(self, text: str, name: str, media_type: str = "text/markdown") -> NormalizedItem:
        name = safe_filename(name or "content.md")
        if not name.endswith(".md") and media_type == "text/markdown":
            name += ".md"
        path = self.staging_dir / name
        path.write_text(_coerce_md(text), encoding="utf-8")
        return NormalizedItem(path=path, media_type=media_type)

    def _stage_bytes(self, data: bytes, name: str) -> Path:
        name = safe_filename(name or "blob.bin")
        path = self.staging_dir / name
        path.write_bytes(data)
        return path

    # -------------------------- Converters -----------------------------

    def _pdf_to_text(self, pdf_path: Path) -> str:
        if PdfReader is None:
            raise RuntimeError(
                "PDF ingestion requires 'pypdf'. Install it and retry."
            )
        try:
            reader = PdfReader(str(pdf_path))
        except Exception as e:  # pragma: no cover
            raise RuntimeError(f"Cannot read PDF: {pdf_path}") from e

        parts: List[str] = []
        for i, page in enumerate(reader.pages):
            try:
                txt = page.extract_text() or ""
            except Exception:
                txt = ""
            if txt.strip():
                parts.append(txt.strip())
            else:
                parts.append(f"[Page {i+1}: (no extractable text)]")
            parts.append("\n\n---\n\n")  # page separator
        text = "".join(parts).strip()
        # Wrap as Markdown-ish
        return f"# Extracted PDF: {pdf_path.name}\n\n{text}\n"

    def _html_to_markdown(self, html: str, title_hint: Optional[str] = None) -> str:
        if md_to_md is not None:
            try:
                md = md_to_md(html, heading_style="ATX", strip=["script", "style"])  # type: ignore
                # prepend title if available
                if title_hint and title_hint.strip():
                    md = f"# {title_hint.strip()}\n\n" + md
                return _coerce_md(md)
            except Exception:
                pass  # fall back to BeautifulSoup

        if BeautifulSoup is None:  # pragma: no cover
            raise RuntimeError(
                "HTML ingestion requires 'markdownify' or 'beautifulsoup4'."
            )
        soup = BeautifulSoup(html, "html.parser")
        title = title_hint or (soup.title.string if soup.title else "")
        text = soup.get_text(separator="\n").strip()
        head = f"# {title.strip()}\n\n" if title else ""
        return _coerce_md(head + text)

    # --------------------------- Fetchers ------------------------------

    def _fetch_url(self, url: str) -> Tuple[str, str]:
        """
        Returns (content_text_or_html, content_type)
        """
        if requests is None:  # pragma: no cover
            raise RuntimeError("URL ingestion requires the 'requests' package.")
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
        return resp.text, ctype or "text/plain"

    # ------------------------- Normalization ---------------------------

    def normalize_inputs(
        self,
        items: Iterable[Union[str, dict]],
    ) -> List[Path]:
        """
        Accept a mixed list of items:
          - str paths (file or directory)
          - dict objects with any of:
                {"source":"inline","name":"x.md","content":"..."}
                {"source":"local","path":"/abs/path/or/rel"}
                {"source":"pdf","path":"/file.pdf"}
                {"source":"txt","path":"/file.txt"}
                {"source":"html","path":"/file.html"}
                {"source":"url","url":"https://..."}
        Returns a list of staged file/directory paths to pass to RAG.
        """
        staged: List[Path] = []

        for it in items:
            if isinstance(it, str):
                p = Path(it).expanduser().resolve()
                if not p.exists():
                    raise FileNotFoundError(p)
                staged.append(p)
                continue

            if not isinstance(it, dict):
                raise ValueError(f"Unsupported ingest item: {it!r}")

            source = str(it.get("source", "")).lower().strip()
            if source == "inline":
                name = it.get("name") or "inline.md"
                content = it.get("content") or ""
                staged.append(self._stage_text(str(content), str(name)).path)
                continue

            if source in {"local", "pdf", "txt", "html"}:
                raw = it.get("path")
                if not raw:
                    raise ValueError("Missing 'path' for local/pdf/txt/html item.")
                p = Path(str(raw)).expanduser().resolve()
                if not p.exists():
                    raise FileNotFoundError(p)

                if source == "local":
                    # Pass through directories and supported text files
                    if p.is_dir():
                        staged.append(p)
                    else:
                        if p.suffix.lower() in {".md", ".markdown", ".txt"}:
                            # copy/normalize to staging for consistent charset
                            text = p.read_text(encoding="utf-8", errors="ignore")
                            staged.append(self._stage_text(text, p.name).path)
                        elif p.suffix.lower() == ".pdf":
                            md = self._pdf_to_text(p)
                            staged.append(self._stage_text(md, p.stem + ".md").path)
                        elif p.suffix.lower() in {".htm", ".html"}:
                            html = p.read_text(encoding="utf-8", errors="ignore")
                            md = self._html_to_markdown(html, title_hint=p.stem)
                            staged.append(self._stage_text(md, p.stem + ".md").path)
                        else:
                            # Unknown extension -> treat as plain text
                            text = p.read_text(encoding="utf-8", errors="ignore")
                            staged.append(self._stage_text(text, p.stem + ".txt", "text/plain").path)
                    continue

                if source == "pdf":
                    md = self._pdf_to_text(p)
                    staged.append(self._stage_text(md, p.stem + ".md").path)
                    continue

                if source == "txt":
                    text = p.read_text(encoding="utf-8", errors="ignore")
                    staged.append(self._stage_text(text, p.stem + ".txt", "text/plain").path)
                    continue

                if source == "html":
                    html = p.read_text(encoding="utf-8", errors="ignore")
                    md = self._html_to_markdown(html, title_hint=p.stem)
                    staged.append(self._stage_text(md, p.stem + ".md").path)
                    continue

            if source == "url":
                url = str(it.get("url") or "")
                if not url:
                    raise ValueError("Missing 'url' for url item.")
                text, ctype = self._fetch_url(url)
                name_hint = safe_filename(it.get("name") or Path(url).name or "page.md")
                if "html" in ctype:
                    md = self._html_to_markdown(text, title_hint=name_hint.rsplit(".", 1)[0])
                    staged.append(self._stage_text(md, name_hint if name_hint.endswith(".md") else name_hint + ".md").path)
                elif "pdf" in ctype:
                    # Need bytes to feed pypdf; re-fetch as bytes
                    if requests is None:  # pragma: no cover
                        raise RuntimeError("requests needed to fetch PDF bytes.")
                    resp = requests.get(url, timeout=30)
                    resp.raise_for_status()
                    pdf_tmp = self._stage_bytes(resp.content, name_hint if name_hint.endswith(".pdf") else name_hint + ".pdf")
                    md = self._pdf_to_text(pdf_tmp)
                    staged.append(self._stage_text(md, Path(name_hint).stem + ".md").path)
                else:
                    staged.append(self._stage_text(text, name_hint if name_hint.endswith(".txt") else name_hint + ".txt", "text/plain").path)
                continue

            # Unknown dict form
            raise ValueError(f"Unsupported ingest dict source: {source!r}")

        # De-duplicate while preserving order
        uniq: List[Path] = []
        seen = set()
        for p in staged:
            key = str(p)
            if key not in seen:
                uniq.append(p)
                seen.add(key)

        log.info("Normalized %d ingest items", len(uniq))
        return uniq

    # --------------------------- Feed RAG -------------------------------

    def feed_rag(
        self,
        base_url: str,
        paths: List[Path],
        collection: Optional[str] = None,
        chunk_size: int = 1400,
        chunk_overlap: int = 160,
        include_ext: Optional[Iterable[str]] = None,
        exclude_ext: Optional[Iterable[str]] = None,
        timeout_s: int = 600,
    ) -> dict:
        """
        Call Universal A2A /knowledge/ingest with normalized paths.
        """
        str_paths = [str(p) for p in paths]
        include = list(include_ext) if include_ext else None
        exclude = list(exclude_ext) if exclude_ext else None
        log.info(
            "Feeding RAG",
            extra={
                "base": base_url,
                "n_paths": len(str_paths),
                "collection": collection,
                "chunk_size": chunk_size,
                "chunk_overlap": chunk_overlap,
                "include": include,
                "exclude": exclude,
            },
        )
        return rag_service.ingest_paths(
            base_url=base_url,
            paths=str_paths,
            collection=collection,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            include_ext=include,
            exclude_ext=exclude,
            timeout_s=timeout_s,
        )
