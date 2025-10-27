# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import secrets
import time
from typing import Any, Dict, Tuple

from flask import Blueprint, jsonify, make_response, request

bp = Blueprint("root", __name__)  # placeholder; real routes live in sibling modules


def request_id() -> str:
    rid = request.headers.get("X-Request-ID")
    return rid or f"req_{int(time.time()*1000)}_{secrets.token_hex(6)}"


def json_ok(payload: Dict[str, Any], status: int = 200):
    resp = make_response(jsonify({"ok": True, **payload}), status)
    resp.headers.setdefault("X-Request-ID", request_id())
    resp.headers.setdefault("Cache-Control", "no-store")
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    resp.headers.setdefault("Referrer-Policy", "no-referrer-when-downgrade")
    return resp


def json_err(code: str, message: str, details: Any | None = None, status: int = 400):
    resp = make_response(
        jsonify({"ok": False, "error": {"code": code, "message": message, "details": details}}),
        status,
    )
    resp.headers.setdefault("X-Request-ID", request_id())
    resp.headers.setdefault("Cache-Control", "no-store")
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    resp.headers.setdefault("Referrer-Policy", "no-referrer-when-downgrade")
    return resp


def get_json(strict: bool = True) -> Tuple[dict, bool]:
    """
    Return (data, ok). When strict and parsing fails, returns ({}, False).
    """
    try:
        data = request.get_json(force=strict, silent=not strict) or {}
        return (data, True)
    except Exception:
        return ({}, False)
