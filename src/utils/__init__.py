# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations
"""
Utility package for workshop_builder.
Exports:
- fs: filesystem helpers (safe filenames, path guards, temp dirs, atomic writes)
- time: duration and time helpers (parse/format minutes/hours)
"""
from . import fs as fs  # re-export
from . import time as time  # re-export
__all__ = ["fs", "time"]
