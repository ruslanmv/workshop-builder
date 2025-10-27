# src/services/export/__init__.py
# SPDX-License-Identifier: Apache-2.0
"""
Export services for book/workshop deliverables.

This package provides:
- Pandoc-based exporters (EPUB, PDF)
- Kindle EPUB post-processing helpers
- Springer LaTeX rendering & compilation

Public entry points:
- pandoc.export_epub(plan, out_dir, file_name?)
- pandoc.export_pdf(plan, out_dir, file_name?)
- kindle.tweak_epub(epub_path, title?, author?)
- springer_latex.export_springer(plan, out_dir)
"""
from __future__ import annotations

__all__ = [
    "pandoc",
    "kindle",
    "springer_latex",
]
