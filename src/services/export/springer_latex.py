# src/services/export/springer_latex.py
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import shutil
import subprocess
import textwrap
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from ...models.book import BookPlan, BookSection  # type: ignore
from ...utils.fs import safe_filename  # type: ignore


SPRINGER_FALLBACK_TEMPLATE = r"""
\documentclass[graybox,envcountchap,sectrefs]{svmono}

% --- Basic packages ---
\usepackage{graphicx}
\usepackage{hyperref}
\usepackage{amsmath,amssymb}
\usepackage{listings}
\usepackage{longtable}
\usepackage{enumitem}
\usepackage{geometry}
\geometry{margin=1.1in}

\hypersetup{
  colorlinks=true,
  linkcolor=blue,
  urlcolor=blue,
  citecolor=blue
}

\title{{{TITLE}}}
\author{{{AUTHOR}}}

\begin{document}
\maketitle
\tableofcontents

{{{BODY}}}

\end{document}
""".strip()


@dataclass(frozen=True)
class Toolchain:
    xelatex: str


def _which_or_raise(cmd: str) -> str:
    path = shutil.which(cmd)
    if not path:
        raise RuntimeError(f"Required tool '{cmd}' not found on PATH.")
    return path


def _check_tools() -> Toolchain:
    return Toolchain(xelatex=_which_or_raise("xelatex"))


def _sec_body(sec: BookSection) -> str:
    for attr in ("content", "body", "text", "markdown", "md", "summary"):
        if hasattr(sec, attr):
            val = getattr(sec, attr)
            if isinstance(val, str) and val.strip():
                return val.strip()
    return ""


def _render_body(plan: BookPlan) -> str:
    sections: Iterable[BookSection] = getattr(plan, "sections", []) or []
    tex_parts = []
    for i, sec in enumerate(sections, start=1):
        title = getattr(sec, "title", None) or f"Section {i}"
        tex_parts.append(f"\\chapter{{{_escape_tex(title)}}}")
        body = _sec_body(sec)
        if not body:
            body = "_(content to be written)_"
        tex_parts.append(_mdish_to_tex(body))
        tex_parts.append("")  # blank line
    return "\n".join(tex_parts)


def _escape_tex(s: str) -> str:
    return (
        s.replace("\\", "\\textbackslash{}")
        .replace("&", "\\&")
        .replace("%", "\\%")
        .replace("$", "\\$")
        .replace("#", "\\#")
        .replace("_", "\\_")
        .replace("{", "\\{")
        .replace("}", "\\}")
        .replace("~", "\\textasciitilde{}")
        .replace("^", "\\textasciicircum{}")
    )


def _mdish_to_tex(md: str) -> str:
    """
    Minimal Markdown-ish -> LaTeX conversion:
    - # => \section, ## => \subsection, ### => \subsubsection
    - code fences => verbatim
    - inline code => \texttt{}
    - bullet lists => itemize
    This is intentionally simple; for production-quality output, consider pandoc.
    """
    lines = md.splitlines()
    out = []
    in_verbatim = False
    # Ensure itemize is closed if started
    def _close_itemize(current_out: list[str]) -> None:
        # Check if the last item was an \item and the itemize environment was opened before that
        if len(current_out) >= 2 and current_out[-1].startswith("\\item ") and "\\begin{itemize}" in current_out[-2]:
            # This is a bit simplistic and might fail complex nesting, but works for the simple logic below
            current_out.append("\\end{itemize}")

    for i, line in enumerate(lines):
        if line.strip().startswith("```"):
            if in_verbatim:
                out.append("\\end{verbatim}")
                in_verbatim = False
            else:
                out.append("\\begin{verbatim}")
                in_verbatim = True
            continue

        if in_verbatim:
            out.append(line)
            continue

        # Close itemize environment if the current line is NOT a bullet,
        # and the previous line started a list item.
        is_bullet_line = line.strip().startswith(("-", "*"))
        if not is_bullet_line and out and out[-1].startswith("\\item "):
             _close_itemize(out)


        if line.startswith("### "):
            out.append(f"\\subsubsection{{{_escape_tex(line[4:].strip())}}}")
            continue
        if line.startswith("## "):
            out.append(f"\\subsection{{{_escape_tex(line[3:].strip())}}}")
            continue
        if line.startswith("# "):
            out.append(f"\\section{{{_escape_tex(line[2:].strip())}}}")
            continue

        if is_bullet_line:
            # Start itemize environment if not already
            if not out or not out[-1].startswith("\\begin{itemize}"):
                out.append("\\begin{itemize}")
            out.append(f"\\item {_escape_tex(line.lstrip('-* ').strip())}")
            continue
        
        # Regular paragraph/text line (and not a list closing line we just added)
        # Apply inline code replacement here
        escaped_line = _escape_tex(line)
        # Note: This crude replacement might break if ` is inside an already escaped sequence.
        out.append(escaped_line.replace("`", "\\texttt{").replace("\\texttt{ ", "\\texttt{").replace(" }", "}"))

    # Ensure itemize closed at file end if left open
    if out and out[-1].startswith("\\item "):
        _close_itemize(out)


    return "\n".join(out)


def _write_tex(plan: BookPlan, build_dir: Path) -> Path:
    build_dir.mkdir(parents=True, exist_ok=True)
    title = getattr(plan, "title", None) or "Untitled Book"
    authors = getattr(plan, "authors", None) or []
    author_s = ", ".join([str(a) for a in authors]) if authors else "Anonymous"

    body = _render_body(plan)

    tex = (
        SPRINGER_FALLBACK_TEMPLATE.replace("{{{TITLE}}}", _escape_tex(title))
        .replace("{{{AUTHOR}}}", _escape_tex(author_s))
        .replace("{{{BODY}}}", body)
    )

    main_tex = build_dir / "main.tex"
    main_tex.write_text(tex, encoding="utf-8")
    return main_tex


def _run(cmd: list[str], cwd: Path) -> None:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"Command failed ({proc.returncode}):\n$ {' '.join(cmd)}\n\n{proc.stdout}"
        )


def export_springer(plan: BookPlan, out_dir: Path) -> Path:
    """
    Render Springer-style LaTeX and compile with xelatex.
    Returns the path to the resulting PDF.
    """
    tools = _check_tools()
    out_dir = out_dir.expanduser().resolve()
    build_dir = out_dir / "springer"
    if build_dir.exists():
        shutil.rmtree(build_dir, ignore_errors=True)
    build_dir.mkdir(parents=True, exist_ok=True)

    main_tex = _write_tex(plan, build_dir)

    # Run xelatex twice for TOC
    cmd = [tools.xelatex, "-interaction=nonstopmode", "-halt-on-error", "main.tex"]
    _run(cmd, build_dir)
    _run(cmd, build_dir)

    pdf_path = build_dir / "main.pdf"
    if not pdf_path.exists():
        raise RuntimeError("LaTeX compilation did not produce main.pdf")
    return pdf_path
