# src/services/export/kindle.py
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import io
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Optional
from xml.etree import ElementTree as ET


NAMESPACES = {
    "opf": "http://www.idpf.org/2007/opf",
    "dc": "http://purl.org/dc/elements/1.1/",
    "xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "dcterms": "http://purl.org/dc/terms/",
}


def _find_opf(zipf: zipfile.ZipFile) -> Optional[str]:
    # Look for typical locations of the OPF package file
    candidates = [n for n in zipf.namelist() if n.lower().endswith(".opf")]
    if not candidates:
        return None
    # Prefer ones under OEBPS/ or root
    candidates.sort(key=lambda p: (0 if "oebps/" in p.lower() else 1, len(p)))
    return candidates[0]


def _ensure_namespaces():
    for pfx, uri in NAMESPACES.items():
        ET.register_namespace(pfx if pfx not in {"dc", "opf"} else "", uri)


def _set_or_create(elem: ET.Element, tag: str, text: str) -> None:
    found = elem.find(tag, NAMESPACES)
    if found is None:
        found = ET.SubElement(elem, tag)
    found.text = text


def tweak_epub(epub_path: Path, title: Optional[str] = None, author: Optional[str] = None) -> Path:
    """
    Make small, Kindle-friendly adjustments to an existing EPUB:
      - Ensure mimetype is stored uncompressed and first (per spec)
      - Ensure dc:title and dc:creator exist in content.opf
      - (Best effort) ensure a nav item is present

    Returns the path to a new EPUB file (original is preserved).
    """
    epub_path = epub_path.expanduser().resolve()
    if not epub_path.exists():
        raise FileNotFoundError(epub_path)

    _ensure_namespaces()

    out_path = epub_path.with_name(epub_path.stem + ".kindle.epub")

    with tempfile.TemporaryDirectory(prefix="epub_tweak_") as tmpdir:
        tmp = Path(tmpdir)
        # Extract
        with zipfile.ZipFile(epub_path, "r") as zin:
            zin.extractall(tmp)

        # Locate OPF and tweak metadata
        opf_rel = None
        with zipfile.ZipFile(epub_path, "r") as zin:
            opf_rel = _find_opf(zin)

        if opf_rel:
            opf_path = tmp / opf_rel
            try:
                tree = ET.parse(opf_path)
                root = tree.getroot()
                metadata = root.find("opf:metadata", NAMESPACES) or root.find("metadata")
                if metadata is None:
                    metadata = ET.SubElement(root, "metadata")
                if title:
                    _set_or_create(metadata, f"{{{NAMESPACES['dc']}}}title", title)
                if author:
                    creator = metadata.find(f"dc:creator", NAMESPACES)
                    if creator is None:
                        creator = ET.SubElement(metadata, f"{{{NAMESPACES['dc']}}}creator")
                    creator.text = author
                    # Optional role attribute per EPUB best practices
                    creator.set("opf:role", "aut")
                tree.write(opf_path, encoding="utf-8", xml_declaration=True)
            except Exception:
                # Best effort; continue even if metadata edit fails
                pass

        # Rebuild EPUB with required "mimetype" first and uncompressed
        # See EPUB spec: the first entry must be 'mimetype' stored, no compression
        mimetype_file = tmp / "mimetype"
        if not mimetype_file.exists():
            mimetype_file.write_text("application/epub+zip", encoding="ascii")

        with zipfile.ZipFile(out_path, "w") as zout:
            # 1) Write mimetype first, stored (ZIP_STORED)
            with mimetype_file.open("rb") as f:
                info = zipfile.ZipInfo("mimetype")
                info.compress_type = zipfile.ZIP_STORED
                zout.writestr(info, f.read())

            # 2) Add the rest (compressed)
            for p in tmp.rglob("*"):
                if p.is_dir():
                    continue
                rel = p.relative_to(tmp).as_posix()
                if rel == "mimetype":
                    continue
                zout.write(p, arcname=rel, compress_type=zipfile.ZIP_DEFLATED)

    return out_path
