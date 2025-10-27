# SPDX-License-Identifier: Apache-2.0
"""
Filesystem utilities: safe filenames, temp dirs, path guards, and
container-friendly bind mapping helpers (symlink/copy staging).
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional, Tuple


# -------------------------- Names & directories --------------------------


def safe_filename(name: str, default: str = "file.txt") -> str:
    s = (name or "").strip().replace("\\", "/").split("/")[-1]
    s = "".join(ch for ch in s if ch.isalnum() or ch in ("-", "_", ".", " "))
    s = "_".join(s.split())  # collapse whitespace
    return s or default


def ensure_dir(path: Path) -> Path:
    p = Path(path).expanduser().resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


def temp_dir(prefix: str = "wb_") -> Path:
    return Path(tempfile.mkdtemp(prefix=prefix)).resolve()


# ------------------------------- Path guards ------------------------------


def is_under(path: Path | str, root: Path | str) -> bool:
    p = Path(path).resolve()
    r = Path(root).resolve()
    try:
        p.relative_to(r)
        return True
    except Exception:
        return False


def assert_under(path: Path | str, root: Path | str, what: str = "path") -> Path:
    p = Path(path).resolve()
    if not is_under(p, root):
        raise PermissionError(f"{what} must be under {Path(root).resolve()}: {p}")
    return p


# ------------------------ Container bind helpers -------------------------


def rewrite_for_container(path: Path | str, host_root: Path | str, container_root: Path | str) -> Optional[Path]:
    """
    If `path` is under `host_root`, rewrite it to the equivalent `container_root` path.
    Otherwise return None.
    """
    p = Path(path).resolve()
    host_root = Path(host_root).resolve()
    container_root = Path(container_root)
    try:
        rel = p.relative_to(host_root)
    except Exception:
        return None
    return (container_root / rel).resolve()


def _try_symlink(src: Path, dst: Path) -> bool:
    try:
        if dst.exists() or dst.is_symlink():
            if dst.is_dir() and not dst.is_symlink():
                shutil.rmtree(dst)
            else:
                dst.unlink()
        dst.parent.mkdir(parents=True, exist_ok=True)
        os.symlink(src, dst)
        return True
    except Exception:
        return False


def _copy_fallback(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        shutil.copytree(src, dst)
    else:
        shutil.copy2(src, dst)


def stage_into_bind(
    source: Path | str,
    host_root: Path | str,
    container_root: Path | str,
    stage_root: Optional[Path | str] = None,
) -> Tuple[Path, Path]:
    """
    Safely stage a file/dir into a host-side location that is visible inside
    a container via bind mount, and return:
        (host_staged_path, container_visible_path)

    - If symlinks are supported, stage as a symlink to save disk and time.
    - Otherwise, fall back to a copy.
    - stage_root defaults to <host_root>/.wb_stage
    """
    src = Path(source).expanduser().resolve()
    host_root = Path(host_root).resolve()
    container_root = Path(container_root)

    if stage_root is None:
        stage_root = host_root / ".wb_stage"
    stage_root = Path(stage_root).resolve()
    stage_root.mkdir(parents=True, exist_ok=True)

    # Place staged item under a deterministic folder mirroring source name
    host_staged = stage_root / src.name

    # Prefer symlink; fallback to copy
    linked = _try_symlink(src, host_staged)
    if not linked:
        _copy_fallback(src, host_staged)

    # Compute container path
    try:
        rel = host_staged.relative_to(host_root)
        container_path = (container_root / rel).resolve()
    except Exception:
        # If stage_root isn't under host_root, we can't map to container path.
        # In that case, recommend using rewrite_for_container on the original src.
        mapped = rewrite_for_container(src, host_root, container_root)
        container_path = mapped if mapped else Path(f"/work/{src.name}")

    return host_staged, container_path
