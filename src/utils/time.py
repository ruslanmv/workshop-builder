# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations
"""
Time & duration helpers focused on minutes/hours handling for schedules.
Features
--------
- parse_minutes(): parse human durations like "90", "90m", "1h30m", "1:30", "PT1H30M".
- minutes_to_hours_tuple(): convert minutes -> (hours, minutes).
- format_minutes_compact(): "2h 30m", "45m", "3h".
- format_hhmm(): "HH:MM" from minutes (24h style).
- hours_to_minutes(), clamp_minutes(), ceil_to_increment().
"""
import re
from typing import Tuple

_ISO8601_RE = re.compile(
    r"^P(?:(?P<days>\d+)D)?(?:T(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?)?$",
    re.IGNORECASE,
)

def hours_to_minutes(hours: float) -> int:
    """Convert fractional hours to whole minutes (rounded)."""
    return max(0, int(round(hours * 60)))

def minutes_to_hours_tuple(total_minutes: int) -> Tuple[int, int]:
    """Convert minutes to (hours, minutes)."""
    total = max(0, int(total_minutes))
    return total // 60, total % 60

def format_minutes_compact(total_minutes: int) -> str:
    """Human-friendly duration like "2h 30m", "45m", "3h"."""
    h, m = minutes_to_hours_tuple(total_minutes)
    parts = []
    if h:
        parts.append(f"{h}h")
    if m or not parts:
        parts.append(f"{m}m")
    return " ".join(parts)

def format_hhmm(total_minutes: int) -> str:
    """Render minutes as HH:MM (zero-padded), e.g., 95 -> "01:35"."""
    h, m = minutes_to_hours_tuple(total_minutes)
    return f"{h:02d}:{m:02d}"

def clamp_minutes(value: int, min_value: int = 0, max_value: int | None = None) -> int:
    """Clamp minutes into [min_value, max_value] if max_value is provided."""
    v = max(min_value, int(value))
    if max_value is not None:
        v = min(v, int(max_value))
    return v

def ceil_to_increment(minutes: int, increment: int) -> int:
    """Ceil minutes up to the nearest increment (e.g., 53 -> 60 for increment=15)."""
    if increment <= 0:
        return max(0, minutes)
    m = max(0, int(minutes))
    return ((m + increment - 1) // increment) * increment

def _parse_colon_hhmm(s: str) -> int | None:
    """Parse strings like "1:30", "00:45", "2:00" into minutes."""
    parts = s.split(":")
    if len(parts) != 2:
        return None
    try:
        h = int(parts[0].strip())
        m = int(parts[1].strip())
        if h < 0 or m < 0 or m >= 60:
            return None
        return h * 60 + m
    except ValueError:
        return None

def _parse_iso8601_duration(s: str) -> int | None:
    """
    Minimal ISO8601 duration parser for patterns like 'PT1H30M', 'P1DT45M'.
    Returns minutes. Seconds are ignored (rounded down).
    """
    m = _ISO8601_RE.match(s)
    if not m:
        return None
    days = int(m.group("days") or 0)
    hours = int(m.group("hours") or 0)
    minutes = int(m.group("minutes") or 0)
    # seconds = int(m.group("seconds") or 0)  # ignored
    return days * 24 * 60 + hours * 60 + minutes

def parse_minutes(text: str) -> int:
    """
    Parse a variety of human-friendly duration strings into minutes.
    Accepted forms:
    - "90", "45"
    - "90m", "1h", "1h30m", "2h 15m"
    - "1:30", "0:45"
    - "PT90M", "PT1H30M", "P1DT45M"
    """
    s = (text or "").strip().lower()
    if not s:
        raise ValueError("empty duration")

    # 1) HH:MM
    mm = _parse_colon_hhmm(s)
    if mm is not None:
        return mm

    # 2) ISO8601 subset
    mm = _parse_iso8601_duration(s.upper())
    if mm is not None:
        return mm

    # 3) numeric only -> minutes
    if re.fullmatch(r"\d+", s):
        return int(s)

    # 4) patterns with h/m (tolerant to spaces)
    h = 0
    m = 0
    mh = re.search(r"(\d+)\s*h", s)
    if mh:
        h = int(mh.group(1))
    mmatch = re.search(r"(\d+)\s*m", s)
    if mmatch:
        m = int(mmatch.group(1))
    if h == 0 and m == 0:
        raise ValueError(f"unrecognized duration: {text!r}")
    return h * 60 + m
